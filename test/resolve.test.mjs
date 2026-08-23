import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPersonIndex, resolveDpoh, summarize } from '../src/match/resolve.mjs';

const { terms } = JSON.parse(readFileSync(new URL('./fixtures/members-45.json', import.meta.url), 'utf8'));
const index = buildPersonIndex(terms);
const r = (raw, date, opts) => resolveDpoh(raw, date, index, opts);

test('a bare surname shared by two sitting MPs is ambiguous, never guessed', () => {
  const res = r('Gill, Member of Parliament', '2026-02-18');
  assert.equal(res.status, 'ambiguous');
  assert.equal(res.person_id, null);
  assert.ok(res.candidates.length >= 2);
});

test('resolution is temporal: a 2023 filing matches the 44th Parliament member', () => {
  assert.equal(r('Tremblay, Helena, Member of Parliament', '2023-06-02').person_id, 'p-former');
});

test('the same name outside any term is unresolved, not back-filled to today', () => {
  const res = r('Tremblay, Helena, Member of Parliament', '2026-02-18');
  assert.equal(res.status, 'unresolved');
  assert.equal(res.method, 'out-of-term');
});

test('nickname and initial matches resolve with reduced confidence', () => {
  const nick = r('Bob Smith, Member of Parliament', '2026-01-05');
  assert.equal(nick.person_id, 'p-smith-robert');
  assert.ok(nick.confidence < 1);
  assert.equal(r("O'Connell, J., Member of Parliament", '2026-02-20').person_id, 'p-oconnell');
});

test('staff and role-only rows are classified, not counted as failures', () => {
  assert.equal(r('Senior Policy Advisor, Office of the Minister of Finance', '2026-02-10').status, 'not_a_person');
});

test('overrides win outright', () => {
  const res = r('Gill, Member of Parliament', '2026-02-18', { overrides: { 'Gill, Member of Parliament': 'p-gill-a' } });
  assert.equal(res.status, 'resolved');
  assert.equal(res.method, 'override');
});

test('summary separates person rows from role-only rows', () => {
  const rows = [r('Thériault, Jean-Yves, MP', '2026-02-10'), r('Deputy Minister', '2026-02-10')];
  const s = summarize(rows);
  assert.equal(s.not_a_person, 1);
  assert.equal(s.pct_resolved_of_named_persons, 100);
});
