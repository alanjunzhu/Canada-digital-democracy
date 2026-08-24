import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateHoldings, buildOfficeIndex, resolveOffice, summarizeOffices } from '../src/match/office.mjs';

const roster = JSON.parse(readFileSync(new URL('./fixtures/office-holders.json', import.meta.url), 'utf8'));
const { holdings, errors, overlaps } = validateHoldings(roster.holdings, roster.aliases);
const index = buildOfficeIndex(holdings, roster.aliases);
const at = (role, date) => resolveOffice(role, date, index);

test('the fixture roster is clean', () => {
  assert.deepEqual(errors, []);
  assert.deepEqual(overlaps, []);
});

test('office resolution is temporal: the holder on the date, not the current one', () => {
  assert.equal(at('Minister of Finance', '2025-09-01').person_id, 'p-smith-robert');
  assert.equal(at('Minister of Finance', '2026-03-01').person_id, 'p-oconnell');
});

test('a date before the roster starts is unmatched, not back-filled', () => {
  const r = at('Minister of Finance', '2020-01-01');
  assert.equal(r.status, 'unmatched');
  assert.equal(r.reason, 'out-of-term');
  assert.equal(r.person_id, null);
});

test('a staff row names the office, never the minister as if they were there', () => {
  const r = at('Chief of Staff, Office of the Minister of Finance', '2025-09-01');
  assert.equal(r.status, 'office');
  assert.equal(r.person_id, null);                    // the individual stays unknown
  assert.equal(r.principal_person_id, 'p-smith-robert'); // whose office it is, separately
  assert.equal(r.holding_id, 'h-fin-1');
});

test('an office nobody is recorded in resolves to the chair, not to a person', () => {
  const r = at('Deputy Minister of Finance', '2025-09-01');
  assert.equal(r.status, 'office');
  assert.equal(r.person_id, null);
});

test('overlapping holdings make the date ambiguous instead of picking one', () => {
  const dodgy = validateHoldings([
    { title: 'Minister of Health', person_id: 'p-a', start_date: '2025-06-01', end_date: null },
    { title: 'Minister of Health', person_id: 'p-b', start_date: '2025-09-01', end_date: null },
  ]);
  assert.equal(dodgy.overlaps.length, 1);
  const r = resolveOffice('Minister of Health', '2025-10-01', buildOfficeIndex(dodgy.holdings));
  assert.equal(r.status, 'ambiguous');
  assert.equal(r.person_id, null);
  assert.equal(r.candidate_count, 2);
});

test('a roster row that cannot be canonicalized is an error, not a silent drop', () => {
  const v = validateHoldings([{ title: 'Chair of Something Unrecognized', start_date: '2025-01-01' }]);
  assert.equal(v.holdings.length, 0);
  assert.match(v.errors[0], /does not canonicalize/);
});

test('bad dates are reported with the offending row', () => {
  const v = validateHoldings([
    { title: 'Minister of Finance', start_date: 'June 2025' },
    { title: 'Minister of Finance', start_date: '2025-06-01', end_date: '2025-01-01' },
  ]);
  assert.equal(v.errors.length, 2);
  assert.match(v.errors[1], /precedes start_date/);
});

test('an empty roster attributes nothing and claims nothing', () => {
  const empty = buildOfficeIndex([]);
  assert.equal(resolveOffice('Minister of Finance', '2026-03-01', empty).status, 'unmatched');
});

test('the office summary reports what failed to match, by key', () => {
  const s = summarizeOffices([
    at('Minister of Finance', '2026-03-01'),
    at('Chief of Staff, Office of the Minister of Finance', '2026-03-01'),
    at('Chef de cabinet, Cabinet de la ministre des Pêches', '2026-03-01'),
  ]);
  assert.equal(s.resolved, 1);
  assert.equal(s.office, 1);
  assert.equal(s.unmatched, 1);
  assert.equal(s.top_unmatched_office_keys[0].key, 'ministre des peches');
});
