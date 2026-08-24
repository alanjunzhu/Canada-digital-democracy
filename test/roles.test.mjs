import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalRole, classifyOfficeRole } from '../src/normalize/roles.mjs';

test('a staff title resolves to the office it serves, not to a person', () => {
  const r = canonicalRole('Chief of Staff, Office of the Minister of Finance');
  assert.equal(r.kind, 'staff');
  assert.equal(r.key, 'minister of finance');
});

test('the minister named alone is the principal, a distinct kind from their staff', () => {
  assert.equal(canonicalRole('Minister of Finance').kind, 'principal');
  assert.equal(canonicalRole('Minister of Finance').key, canonicalRole('Chief of Staff, Office of the Minister of Finance').key);
});

test('a parliamentary secretary is their own office, never folded into the minister', () => {
  const r = canonicalRole('Parliamentary Secretary to the Minister of Health');
  assert.equal(r.kind, 'parl_sec');
  assert.equal(r.key, 'parliamentary secretary to the minister of health');
  assert.notEqual(r.key, 'minister of health');
});

test('deputy ministers key off the department named after the title', () => {
  // 'Deputy Minister, Innovation, Science and Economic Development Canada' —
  // the department name is itself full of commas and must be rejoined.
  const r = canonicalRole('Deputy Minister, Innovation, Science and Economic Development Canada');
  assert.equal(r.kind, 'deputy');
  assert.equal(r.key, 'deputy minister of innovation science and economic development');
});

test('French office wrappers reach the same key as their English equivalent', () => {
  assert.equal(canonicalRole('Chef de cabinet, Cabinet de la ministre des Finances').key, 'minister of finance');
  assert.equal(canonicalRole('Directrice des politiques, Cabinet du premier ministre').key, 'prime minister');
});

test('an unknown portfolio yields an empty key rather than a fuzzy match', () => {
  const r = canonicalRole('Conseillère principale, Cabinet de la ministre des Pêches');
  assert.equal(r.key, 'ministre des peches');       // reported verbatim for aliasing
  assert.equal(canonicalRole('Member of Parliament, House of Commons').key, '');
  assert.equal(classifyOfficeRole('Member of Parliament'), 'unknown');
});

test('a key taken from the institution column is marked as such', () => {
  // An institution is a DEPARTMENT, not a minister's office: the caller must
  // not read a minister out of it.
  const r = canonicalRole('Chief of Staff', 'Finance Canada (FIN)');
  assert.equal(r.via, 'institution');
  assert.equal(canonicalRole('Chief of Staff, Office of the Minister of Finance', 'Finance Canada (FIN)').via, 'role');
});

test('supplied aliases extend the built-in portfolio table', () => {
  const aliases = { 'ministre des peches': 'minister of fisheries' };
  assert.equal(canonicalRole('Chef de cabinet, Cabinet de la ministre des Pêches', '', aliases).key, 'minister of fisheries');
});
