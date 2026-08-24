// Answers the four questions in NOTES.md from the real OCL files.
//
// These numbers decide what gets built next, so they are computed directly
// from the source files rather than from anything the resolver inferred —
// except Q1, which is by definition about resolution.

import { parseDpoh } from '../normalize/officials.mjs';
import { extractBillRefs } from './bill-refs.mjs';

const DAY = 86400000;
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const pct = (n, d) => (d ? +(100 * n / d).toFixed(1) : null);

// Q1 — what fraction of DPOH rows name an MP at all?
// This caps how member-centric the product can be. If most logged access is
// with staff, the unit of the product is the minister's OFFICE, not the MP.
export function dpohComposition(dpohRows) {
  const byClass = {};
  let named = 0;
  let roleOnly = 0;
  for (const r of dpohRows) {
    const p = parseDpoh(r.dpoh_raw, r.institution || '', r.dpoh_title_raw || '');
    const key = `${p.kind === 'person' ? 'named' : 'role_only'}:${p.roleClass}`;
    byClass[key] = (byClass[key] || 0) + 1;
    if (p.kind === 'person') named++; else roleOnly++;
  }
  const sittingMember = Object.entries(byClass)
    .filter(([k]) => k.startsWith('named:') && /(:mp|:parl_sec)$/.test(k))
    .reduce((a, [, n]) => a + n, 0);

  return {
    total_dpoh_rows: dpohRows.length,
    named_person: named,
    role_only: roleOnly,
    pct_naming_a_person: pct(named, dpohRows.length),
    pct_naming_a_sitting_member: pct(sittingMember, dpohRows.length),
    breakdown: Object.fromEntries(Object.entries(byClass).sort((a, b) => b[1] - a[1])),
  };
}

/**
 * Q2, computed the honest way: per COMMUNICATION, not per row.
 *
 * The subject-details export carries one row per subject code, so a
 * communication with four codes appears four times with the same text.
 * Counting rows would inflate or deflate the rate depending on how many codes
 * registrants happen to tick, which has nothing to do with bills.
 */
export function citationRateByCommunication(rows, { idField = 'communication_id', textField = 'details' } = {}) {
  const byComm = new Map();
  for (const r of rows) {
    const id = r[idField];
    if (!byComm.has(id)) byComm.set(id, []);
    byComm.get(id).push(r[textField] || '');
  }
  let withCitation = 0;
  const billCounts = new Map();
  for (const texts of byComm.values()) {
    const refs = extractBillRefs(texts.join(' \n '));
    if (refs.length) withCitation++;
    for (const ref of refs) billCounts.set(ref.number, (billCounts.get(ref.number) || 0) + 1);
  }
  return {
    rows_examined: rows.length,
    communications_examined: byComm.size,
    communications_with_citation: withCitation,
    pct_with_citation: pct(withCitation, byComm.size),
    distinct_bills_cited: billCounts.size,
    top_bills_cited: [...billCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
      .map(([number, n]) => ({ number, n })),
  };
}

// Q2 — how many records cite a bill number explicitly?
// The citation join is the only one precise enough to state as fact. If this
// is small, the timeline has to lean on the subject-category join, which is
// context, not evidence — and the product's claims must soften accordingly.
export function citationRate(rows, field = 'subject_raw') {
  let withCitation = 0;
  const billCounts = new Map();
  for (const r of rows) {
    const refs = extractBillRefs(r[field]);
    if (refs.length) withCitation++;
    for (const ref of refs) billCounts.set(ref.number, (billCounts.get(ref.number) || 0) + 1);
  }
  return {
    rows_examined: rows.length,
    rows_with_citation: withCitation,
    pct_with_citation: pct(withCitation, rows.length),
    distinct_bills_cited: billCounts.size,
    top_cited: [...billCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
      .map(([number, n]) => ({ number, n })),
  };
}

// Q3 — the real filing lag. If it is short, the "the public found out after
// the vote" framing is weaker than assumed and should be dropped, not stretched.
export function filingLag(comms) {
  const lags = comms
    .map((c) => (c.comm_date && c.posted_date
      ? Math.round((Date.parse(c.posted_date) - Date.parse(c.comm_date)) / DAY) : null))
    .filter((n) => Number.isFinite(n) && n >= 0);
  const sorted = [...lags].sort((a, b) => a - b);
  const at = (q) => (sorted.length ? sorted[Math.floor(q * (sorted.length - 1))] : null);
  // Buckets for the distribution chart. Fixed edges rather than equal-width
  // bins: the interesting structure is all under two months, and a linear
  // axis out to the multi-year outliers would hide it.
  const edges = [0, 7, 14, 21, 28, 35, 42, 60, 90, 180, 365];
  const histogram = edges.map((lo, i) => {
    const hi = edges[i + 1] ?? Infinity;
    return {
      label: hi === Infinity ? `${lo}+` : `${lo}\u2013${hi}`,
      from: lo,
      to: hi === Infinity ? null : hi,
      n: lags.filter((d) => d >= lo && d < hi).length,
    };
  });

  return {
    rows_with_both_dates: lags.length,
    histogram,
    median_days: median(lags),
    p25_days: at(0.25),
    p75_days: at(0.75),
    p90_days: at(0.90),
    max_days: sorted.at(-1) ?? null,
  };
}

// Q4 — one DPOH row per official, or a delimited list in one cell?
// The schema assumes one row per official. If it is delimited, ingest needs a
// splitter and every coverage number above is wrong until it has one.
export function dpohRowShape(dpohRows) {
  const perComm = new Map();
  let delimiterSuspects = 0;
  const samples = [];
  for (const r of dpohRows) {
    perComm.set(r.communication_id, (perComm.get(r.communication_id) || 0) + 1);
    const raw = String(r.dpoh_raw || '');
    // Two+ commas is normal ('Doe, Jane, MP'). A semicolon, a slash-separated
    // list, or ' and ' between name-shaped tokens suggests packing.
    if (/;|\s\/\s|\|/.test(raw) || /\b\w+,\s*\w+\s+and\s+\w+,\s*\w+/.test(raw)) {
      delimiterSuspects++;
      if (samples.length < 10) samples.push(raw);
    }
  }
  const counts = [...perComm.values()];
  return {
    distinct_communications: perComm.size,
    mean_dpoh_rows_per_communication: counts.length ? +(dpohRows.length / counts.length).toFixed(2) : null,
    // reduce, not Math.max(...counts): the real file has ~380k communications
    // and spreading that many arguments overflows the call stack.
    max_dpoh_rows_per_communication: counts.length ? counts.reduce((a, b) => (b > a ? b : a), 0) : null,
    rows_with_delimiter_suspects: delimiterSuspects,
    pct_suspect: pct(delimiterSuspects, dpohRows.length),
    verdict: delimiterSuspects / (dpohRows.length || 1) > 0.02
      ? 'LIKELY PACKED — add a splitter to ingestCsv before trusting coverage numbers'
      : 'looks like one row per official (schema assumption holds)',
    samples,
  };
}
