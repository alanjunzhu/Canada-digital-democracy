import test from 'node:test';
import assert from 'node:assert/strict';
import { dpohComposition, citationRate, filingLag, dpohRowShape } from '../src/match/stats.mjs';

const dpoh = [
  { communication_id: 'C1', dpoh_raw: 'Thériault, Jean-Yves', dpoh_title_raw: 'Member of Parliament', institution: 'House of Commons' },
  { communication_id: 'C1', dpoh_raw: 'Senior Policy Advisor', dpoh_title_raw: 'Senior Policy Advisor', institution: 'Finance Canada (FIN)' },
  { communication_id: 'C2', dpoh_raw: 'van Koeverden, Adam', dpoh_title_raw: 'Parliamentary Secretary', institution: 'House of Commons' },
];

test('composition separates named members from role-only rows', () => {
  const c = dpohComposition(dpoh);
  assert.equal(c.pct_naming_a_person, 66.7);
  assert.equal(c.pct_naming_a_sitting_member, 66.7); // MP + parl sec
  assert.equal(c.role_only, 1);
});

test('citation rate counts rows, not mentions', () => {
  const r = citationRate([
    { subject_raw: 'Bill C-14 and Bill S-5' },
    { subject_raw: 'Taxation and Finance' },
  ]);
  assert.equal(r.rows_with_citation, 1);
  assert.equal(r.pct_with_citation, 50);
  assert.equal(r.distinct_bills_cited, 2);
});

test('filing lag ignores rows missing either date', () => {
  const l = filingLag([
    { comm_date: '2026-02-10', posted_date: '2026-03-14' },
    { comm_date: '2026-02-18', posted_date: null },
  ]);
  assert.equal(l.rows_with_both_dates, 1);
  assert.equal(l.median_days, 32);
});

test('packed DPOH cells are flagged rather than silently ingested', () => {
  const packed = [
    { communication_id: 'C1', dpoh_raw: 'Doe, Jane; Roe, Richard', dpoh_title_raw: 'MP' },
    { communication_id: 'C2', dpoh_raw: 'Smith, John', dpoh_title_raw: 'MP' },
  ];
  assert.match(dpohRowShape(packed).verdict, /LIKELY PACKED/);
  assert.match(dpohRowShape(dpoh).verdict, /one row per official/);
});
