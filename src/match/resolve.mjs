// Resolves a DPOH string to a person, as of the communication date.
//
// Two rules govern this file:
//   1. NEVER guess silently. A tie returns 'ambiguous' with its candidates
//      attached. Publishing the wrong MP next to a lobbying record is the one
//      unrecoverable error this project can make.
//   2. Time is part of identity. 'Smith, John, MP' in 2019 and in 2026 can be
//      different people. Candidates are filtered to those actually holding the
//      seat on the communication date before scoring.

import { parseDpoh, isCommonsRole } from '../normalize/officials.mjs';
import { resolveOffice, EMPTY_OFFICE_INDEX } from './office.mjs';
import { surnameKeys, surnameMatch, givenNameMatch, normalizeName, uniqueNearSurname } from '../normalize/names.mjs';

const inTerm = (term, date) =>
  (!term.start_date || term.start_date <= date) && (!term.end_date || term.end_date >= date);

/** Builds a surname-keyed index over mp_term rows joined to person rows. */
export function buildPersonIndex(terms) {
  const index = new Map();
  for (const t of terms) {
    for (const key of surnameKeys(t.surname)) {
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(t);
    }
  }
  return index;
}

// Scores are additive and deliberately legible: you should be able to read a
// confidence back out to a human as a sentence.
function scoreCandidate(parsed, term, { typo = false } = {}) {
  const sm = typo ? 'typo' : surnameMatch(parsed.surname, term.surname);
  if (sm === 'none') return null;

  // A surname reached through a typo starts below an exact one, so the given
  // name has to do the work of confirming the identity.
  let score = sm === 'exact' ? 0.6 : sm === 'typo' ? 0.5 : 0.35;
  const reasons = [sm === 'exact' ? 'surname' : sm === 'typo' ? 'surname-typo' : 'surname-part'];

  const gm = parsed.given ? givenNameMatch(parsed.given, term.given_name) : 'none';
  if (gm === 'exact') { score += 0.4; reasons.push('given'); }
  else if (gm === 'nickname') { score += 0.3; reasons.push('given-nickname'); }
  else if (gm === 'short-form') { score += 0.25; reasons.push('given-short-form'); }
  else if (gm === 'initial') { score += 0.15; reasons.push('given-initial'); }
  else if (parsed.given) { score -= 0.35; reasons.push('given-conflict'); }
  else reasons.push('no-given');

  // The riding is occasionally written into the DPOH or institution text.
  if (term.riding && normalizeName(parsed.raw).includes(normalizeName(term.riding))) {
    score += 0.1; reasons.push('riding');
  }
  return { term, score: Math.max(0, Math.min(1, score)), method: gm === 'none' ? 'surname' : gm, reasons };
}

/**
 * @param {string} dpohRaw   verbatim DPOH string from the filing
 * @param {string} commDate  ISO date of the communication
 * @param {Map} index        from buildPersonIndex
 * @param {object} opts      { institution, title, overrides, offices }
 *   `offices` is an office index (see match/office.mjs). When supplied, rows
 *   that name no member — ministerial staff, bare roles — are attributed to
 *   the OFFICE they name instead of being dropped as 'not_a_person'. Omit it
 *   and the behaviour is exactly as before: an office is never invented.
 */
export function resolveDpoh(dpohRaw, commDate, index, opts = {}) {
  const { institution = '', title = '', overrides = {}, offices = EMPTY_OFFICE_INDEX } = opts;
  const parsed = parseDpoh(dpohRaw, institution, title);

  const base = { dpoh_raw: dpohRaw, parsed, person_id: null, candidate_count: 0 };

  const override = overrides[dpohRaw] ?? overrides[normalizeName(dpohRaw)];
  if (override) {
    return { ...base, status: 'resolved', method: 'override', confidence: 1, person_id: override };
  }
  // A row that names no sitting member is not a failure — it is access to an
  // office. Try to name the office before giving up on the row.
  const office = () => resolveOffice(parsed.role || parsed.raw, commDate, offices, { institution });
  // Attaches the office to a row without changing what the row says about the
  // person. Used where the person could not be identified: the chair is still
  // known, and 'access to Finance Canada' is the fact the product is about.
  const withOfficeContext = (row) => {
    const o = office();
    if (o.status === 'unmatched' || !o.office_key) return row;
    return { ...row, office_key: o.office_key, office_title: o.office_title, holding_id: o.holding_id, principal_person_id: o.principal_person_id };
  };

  const withOffice = (fallback) => {
    const o = office();
    if (o.status === 'unmatched') return fallback;
    return {
      ...fallback,
      // Office ambiguity gets its own status: it says nothing about whether a
      // NAMED person was identified, so it must not move that denominator.
      status: o.status === 'ambiguous' ? 'ambiguous_office' : o.status,   // 'resolved' | 'office'
      method: o.method,
      confidence: o.confidence ?? 0,
      person_id: o.person_id,
      holding_id: o.holding_id,
      office_key: o.office_key,
      office_title: o.office_title,
      principal_person_id: o.principal_person_id,
      candidate_count: o.candidate_count || 0,
      ...(o.candidates ? { candidates: o.candidates } : {}),
    };
  };

  if (parsed.kind === 'role_only') {
    // A role with no name has no person to attach; with a roster loaded it
    // still has a chair, and that is the fact worth keeping.
    return withOffice({ ...base, status: 'not_a_person', method: null, confidence: 0 });
  }
  if (!isCommonsRole(parsed.roleClass)) {
    // A named staffer or senator: the individual is known but is not an MP.
    // Their office is still recorded, and person_id stays null — a named
    // chief of staff is not the minister.
    const o = office();
    const fallback = { ...base, status: 'not_a_person', method: parsed.roleClass, confidence: 0 };
    return o.status === 'unmatched' ? fallback
      : { ...fallback, holding_id: o.holding_id, office_key: o.office_key, office_title: o.office_title, principal_person_id: o.principal_person_id };
  }

  const seen = new Set();
  const pool = [];
  for (const key of surnameKeys(parsed.surname)) {
    for (const term of index.get(key) || []) {
      if (seen.has(term.mp_term_id)) continue;
      seen.add(term.mp_term_id);
      pool.push(term);
    }
  }

  // Nothing matched the surname as written. Before giving up, check whether it
  // is a single-character typo of exactly one member's surname — and only
  // exactly one. See uniqueNearSurname.
  let method_prefix = '';
  if (!pool.length) {
    const near = uniqueNearSurname(parsed.surname, index.keys());
    if (near) {
      for (const term of index.get(near) || []) pool.push(term);
      method_prefix = 'typo-';
    }
  }

  const eligible = pool.filter((t) => inTerm(t, commDate));
  // If nobody was sitting on that date, the filing may predate our roster or
  // name a former member. Report it rather than falling back to the current
  // roster, which is how these pipelines quietly produce wrong answers.
  if (!eligible.length) {
    // Failing to identify the person does not mean the row is unattributable:
    // a senior public servant is named, and their institution is stated. Keep
    // the failure visible, attach the office.
    return withOfficeContext({ ...base, status: 'unresolved', method: pool.length ? 'out-of-term' : 'no-surname-match', confidence: 0, candidate_count: pool.length });
  }

  const scored = eligible.map((t) => scoreCandidate(parsed, t, { typo: Boolean(method_prefix) })).filter(Boolean)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) {
    return withOfficeContext({ ...base, status: 'unresolved', method: 'no-surname-match', confidence: 0 });
  }

  const [best, second] = scored;
  const decisive = !second || best.score - second.score >= 0.15;

  // A typo'd surname must clear a higher bar than a correctly spelled one, and
  // it must be carried by the given name: 'Hadju, Patty' resolves because
  // Patty is right, not because Hajdu is close.
  const floor = method_prefix ? 0.85 : 0.7;
  if (best.score >= floor && decisive) {
    return {
      ...base, status: 'resolved', method: method_prefix + best.method,
      confidence: Number((method_prefix ? best.score * 0.85 : best.score).toFixed(3)),
      person_id: best.term.person_id, candidate_count: scored.length, reasons: best.reasons,
    };
  }
  return {
    ...base, status: 'ambiguous', method: best.method, confidence: Number(best.score.toFixed(3)),
    candidate_count: scored.length,
    candidates: scored.slice(0, 5).map((c) => ({ person_id: c.term.person_id, riding: c.term.riding, score: Number(c.score.toFixed(3)) })),
  };
}

/** Aggregate coverage report — the tractability answer. */
export function summarize(results) {
  const by = { resolved: 0, ambiguous: 0, unresolved: 0, not_a_person: 0, office: 0, ambiguous_office: 0 };
  const unresolvedCounts = new Map();
  for (const r of results) {
    by[r.status] = (by[r.status] || 0) + 1;
    if (r.status === 'unresolved' || r.status === 'ambiguous') {
      unresolvedCounts.set(r.dpoh_raw, (unresolvedCounts.get(r.dpoh_raw) || 0) + 1);
    }
  }
  const total = results.length || 1;
  // Office rows named no individual, so they are not part of the denominator
  // for 'did we identify the person named'.
  const personRows = total - by.not_a_person - by.office - by.ambiguous_office || 1;
  return {
    total,
    ...by,
    pct_resolved_of_all: +(100 * by.resolved / total).toFixed(1),
    pct_resolved_of_named_persons: +(100 * by.resolved / personRows).toFixed(1),
    // How much of the whole file lands somewhere attributable — a person or a
    // chair. This is the number that says whether the site can be built.
    // Attribution means 'this row lands on an office or a person'. A staff row
    // naming Finance Canada is attributed even when no roster row says who led
    // Finance Canada that week — the office is the unit, and the file states it.
    // One definition, applied to every row: did this land on a person or on an
    // office? Status says which kind of landing it was.
    pct_attributed: +(100 * results.filter((r) => r.person_id || r.office_key).length / total).toFixed(1),
    top_problem_strings: [...unresolvedCounts.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 25)
      .map(([raw, n]) => ({ raw, n })),
  };
}
