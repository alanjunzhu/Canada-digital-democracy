// Resolves a role string to an OFFICE, as of the communication date.
//
// This is the sibling of `resolve.mjs`, and it exists because most logged
// access names a chair rather than a person. It obeys the same two rules —
// never guess, and time is part of identity — with one addition specific to
// offices:
//
//   A staff row resolves to the OFFICE, never to the principal. 'The Minister's
//   chief of staff met the registrant' and 'the Minister met the registrant'
//   are different facts, and collapsing the first into the second would be the
//   same unrecoverable error as naming the wrong MP. The principal is carried
//   in a separate field (`principal_person_id`) so a UI can say 'the office of
//   X' without ever implying X was in the room.
//
// The roster itself (`data/overrides/office-holders.json`) is hand-curated:
// the Privy Council appointment records are not available as a bulk file here,
// and inventing appointment dates would poison every downstream number. An
// empty roster is a supported state — every role row simply reports
// `unmatched`, exactly as it did before this module existed.

import { canonicalRole } from '../normalize/roles.mjs';
import { normalizeName } from '../normalize/names.mjs';

const covers = (h, date) =>
  !date || ((!h.start_date || h.start_date <= date) && (!h.end_date || h.end_date >= date));

/**
 * Validates a raw holdings array. Errors are returned, not thrown, so a bad
 * roster row is reported by `npm run offices` instead of taking down a run.
 */
export function validateHoldings(rows, aliases = {}) {
  const errors = [];
  const holdings = [];
  const iso = /^\d{4}-\d{2}-\d{2}$/;

  rows.forEach((row, i) => {
    const at = `office-holders[${i}]`;
    if (!row || typeof row !== 'object') return errors.push(`${at}: not an object`);
    if (!row.title) return errors.push(`${at}: missing title`);
    if (!row.start_date || !iso.test(row.start_date)) {
      return errors.push(`${at} (${row.title}): start_date must be ISO YYYY-MM-DD, got ${JSON.stringify(row.start_date)}`);
    }
    if (row.end_date && !iso.test(row.end_date)) {
      return errors.push(`${at} (${row.title}): end_date must be ISO YYYY-MM-DD or null, got ${JSON.stringify(row.end_date)}`);
    }
    if (row.end_date && row.end_date < row.start_date) {
      return errors.push(`${at} (${row.title}): end_date precedes start_date`);
    }
    const role = canonicalRole(row.title, row.institution || '', aliases);
    if (!role.key) {
      return errors.push(`${at}: title ${JSON.stringify(row.title)} does not canonicalize to an office key — add a portfolio alias in roles.mjs`);
    }
    holdings.push({
      holding_id: row.holding_id || `${role.key}@${row.start_date}`.replace(/\s+/g, '-'),
      person_id: row.person_id || null,
      title: row.title,
      institution: row.institution || '',
      is_staff: role.kind === 'staff' ? 1 : 0,
      start_date: row.start_date,
      end_date: row.end_date || null,
      office_key: role.key,
      kind: role.kind,
    });
  });

  // Two people holding the same chair on the same day is either a data entry
  // error or a genuine handover; either way the resolver will report those
  // dates ambiguous, so surface it here rather than at query time.
  const byKey = new Map();
  for (const h of holdings) {
    if (!byKey.has(h.office_key)) byKey.set(h.office_key, []);
    byKey.get(h.office_key).push(h);
  }
  const overlaps = [];
  for (const [key, hs] of byKey) {
    const sorted = [...hs].sort((a, b) => a.start_date.localeCompare(b.start_date));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      if (!prev.end_date || prev.end_date >= sorted[i].start_date) {
        overlaps.push(`${key}: ${prev.title} (${prev.start_date}..${prev.end_date || 'open'}) overlaps ${sorted[i].start_date}`);
      }
    }
  }
  return { holdings, errors, overlaps };
}

/** Index holdings by office key, and separately by institution. */
export function buildOfficeIndex(holdings, aliases = {}) {
  const byKey = new Map();
  const byInstitution = new Map();
  for (const h of holdings) {
    if (!byKey.has(h.office_key)) byKey.set(h.office_key, []);
    byKey.get(h.office_key).push(h);
    const inst = normalizeName(h.institution);
    if (inst) {
      if (!byInstitution.has(inst)) byInstitution.set(inst, []);
      byInstitution.get(inst).push(h);
    }
  }
  return { byKey, byInstitution, aliases, size: holdings.length };
}

export const EMPTY_OFFICE_INDEX = buildOfficeIndex([]);

/**
 * @param roleText   role/title text from the filing
 * @param date       ISO communication date; identity is scoped to it
 * @param index      from buildOfficeIndex
 * @param opts       { institution }
 * @returns {{ status, office_key, holding_id, person_id, principal_person_id, kind, via }}
 *   status: 'resolved'   the office holder themselves, named by role
 *           'office'     the office is known, the individual is not (staff)
 *           'ambiguous'  more than one holding covers that date
 *           'unmatched'  no office key, or no holding covering that date
 */
export function resolveOffice(roleText, date, index = EMPTY_OFFICE_INDEX, opts = {}) {
  const { institution = '' } = opts;
  const role = canonicalRole(roleText, institution, index.aliases || {});
  const base = {
    status: 'unmatched', office_key: role.key, office_kind: role.kind, via: role.via,
    holding_id: null, person_id: null, principal_person_id: null, office_title: null,
  };
  if (!role.key || !index.size) return base;

  // An institution-derived key names a department, not a minister's office, so
  // it may only match a holding's institution — never a portfolio title.
  const pool = role.via === 'institution'
    ? (index.byInstitution.get(normalizeName(role.key)) || index.byInstitution.get(normalizeName(institution)) || [])
    : (index.byKey.get(role.key) || []);
  if (!pool.length) return base;

  const covering = pool.filter((h) => covers(h, date));
  if (!covering.length) {
    return { ...base, status: 'unmatched', reason: 'out-of-term', candidate_count: pool.length };
  }
  if (covering.length > 1) {
    return {
      ...base, status: 'ambiguous', candidate_count: covering.length,
      candidates: covering.map((h) => ({ holding_id: h.holding_id, person_id: h.person_id, title: h.title })),
    };
  }

  const h = covering[0];
  const attributable = role.kind === 'principal' || role.kind === 'parl_sec' || role.kind === 'deputy';
  return {
    ...base,
    status: attributable && h.person_id ? 'resolved' : 'office',
    holding_id: h.holding_id,
    office_title: h.title,
    // Only when the filing names the office HOLDER does the office become a
    // person. Staff rows stop at the office by design.
    person_id: attributable ? h.person_id : null,
    principal_person_id: h.person_id,
    method: `office-${role.kind}`,
    confidence: attributable && h.person_id ? 0.9 : 0,
  };
}

/** Coverage report for role rows — the office-side analogue of summarize(). */
export function summarizeOffices(results) {
  const by = { resolved: 0, office: 0, ambiguous: 0, unmatched: 0 };
  const missKeys = new Map();
  for (const r of results) {
    by[r.status] = (by[r.status] || 0) + 1;
    if (r.status === 'unmatched') {
      const k = r.office_key || '(no office key)';
      missKeys.set(k, (missKeys.get(k) || 0) + 1);
    }
  }
  const total = results.length || 1;
  return {
    total: results.length,
    ...by,
    pct_attributed_to_an_office: +(100 * (by.resolved + by.office) / total).toFixed(1),
    top_unmatched_office_keys: [...missKeys.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 25).map(([key, n]) => ({ key, n })),
  };
}
