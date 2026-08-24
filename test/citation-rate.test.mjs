import test from 'node:test';
import assert from 'node:assert/strict';
import { citationRateByCommunication } from '../src/match/stats.mjs';

// Shaped like the real export: one row per subject code, text repeated.
const rows = [
  { communication_id: '1', subject_codes: 'SMT-18', details: 'Discussion of Bill C-5 and its timelines.' },
  { communication_id: '1', subject_codes: 'SMT-45', details: 'Discussion of Bill C-5 and its timelines.' },
  { communication_id: '2', subject_codes: 'SMT-20', details: 'General policy discussion, no legislation named.' },
  { communication_id: '3', subject_codes: 'SMT-13', details: 'Projet de loi C-282, gestion de l’offre.' },
];

test('the rate is per communication, not per row', () => {
  // Communication 1 appears twice because it ticked two subject codes; that
  // says nothing about bills and must not count twice.
  const r = citationRateByCommunication(rows);
  assert.equal(r.rows_examined, 4);
  assert.equal(r.communications_examined, 3);
  assert.equal(r.communications_with_citation, 2);
  assert.equal(r.pct_with_citation, 66.7);
});

test('French citations count, and each bill is counted once per communication', () => {
  const r = citationRateByCommunication(rows);
  assert.deepEqual(r.top_bills_cited.map((b) => b.number).sort(), ['C-282', 'C-5']);
  assert.equal(r.top_bills_cited.find((b) => b.number === 'C-5').n, 1);
});

test("the literal string 'null' is not a lobbying client", async () => {
  // It appears 1,712 times in the real export and would otherwise rank as the
  // busiest client in the country.
  const { emptyToNull } = await import('../src/fetch/ingest-lobbying.mjs');
  assert.equal(emptyToNull('null'), null);
  assert.equal(emptyToNull('NULL'), null);
  assert.equal(emptyToNull('  '), null);
  assert.equal(emptyToNull('N/A'), null);
  assert.equal(emptyToNull('Canadian Bankers Association'), 'Canadian Bankers Association');
});
