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
import { surnameKeys, surnameMatch, givenNameMatch, normalizeName } from '../normalize/names.mjs';

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
function scoreCandidate(parsed, term) {
  const sm = surnameMatch(parsed.surname, term.surname);
  if (sm === 'none') return null;

  let score = sm === 'exact' ? 0.6 : 0.35;
  const reasons = [sm === 'exact' ? 'surname' : 'surname-part'];

  const gm = parsed.given ? givenNameMatch(parsed.given, term.given_name) : 'none';
  if (gm === 'exact') { score += 0.4; reasons.push('given'); }
  else if (gm === 'nickname') { score += 0.3; reasons.push('given-nickname'); }
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
 * @param {object} opts      { institution, overrides }
 */
export function resolveDpoh(dpohRaw, commDate, index, opts = {}) {
  const { institution = '', overrides = {} } = opts;
  const parsed = parseDpoh(dpohRaw, institution);

  const base = { dpoh_raw: dpohRaw, parsed, person_id: null, candidate_count: 0 };

  const override = overrides[dpohRaw] ?? overrides[normalizeName(dpohRaw)];
  if (override) {
    return { ...base, status: 'resolved', method: 'override', confidence: 1, person_id: override };
  }
  if (parsed.kind === 'role_only') {
    // Not a failure: a role with no name is correctly reported, it simply has
    // no person to attach. These roll up under 'staff access' instead.
    return { ...base, status: 'not_a_person', method: null, confidence: 0 };
  }
  if (!isCommonsRole(parsed.roleClass)) {
    return { ...base, status: 'not_a_person', method: parsed.roleClass, confidence: 0 };
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

  const eligible = pool.filter((t) => inTerm(t, commDate));
  // If nobody was sitting on that date, the filing may predate our roster or
  // name a former member. Report it rather than falling back to the current
  // roster, which is how these pipelines quietly produce wrong answers.
  if (!eligible.length) {
    return { ...base, status: 'unresolved', method: pool.length ? 'out-of-term' : 'no-surname-match', confidence: 0, candidate_count: pool.length };
  }

  const scored = eligible.map((t) => scoreCandidate(parsed, t)).filter(Boolean)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) {
    return { ...base, status: 'unresolved', method: 'no-surname-match', confidence: 0 };
  }

  const [best, second] = scored;
  const decisive = !second || best.score - second.score >= 0.15;

  if (best.score >= 0.7 && decisive) {
    return {
      ...base, status: 'resolved', method: best.method, confidence: Number(best.score.toFixed(3)),
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
  const by = { resolved: 0, ambiguous: 0, unresolved: 0, not_a_person: 0 };
  const unresolvedCounts = new Map();
  for (const r of results) {
    by[r.status] = (by[r.status] || 0) + 1;
    if (r.status === 'unresolved' || r.status === 'ambiguous') {
      unresolvedCounts.set(r.dpoh_raw, (unresolvedCounts.get(r.dpoh_raw) || 0) + 1);
    }
  }
  const total = results.length || 1;
  const personRows = total - by.not_a_person || 1;
  return {
    total,
    ...by,
    pct_resolved_of_all: +(100 * by.resolved / total).toFixed(1),
    pct_resolved_of_named_persons: +(100 * by.resolved / personRows).toFixed(1),
    top_problem_strings: [...unresolvedCounts.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 25)
      .map(([raw, n]) => ({ raw, n })),
  };
}
