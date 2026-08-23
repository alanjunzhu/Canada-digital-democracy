import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDpoh, classifyRole } from '../src/normalize/officials.mjs';

test('parliamentary secretaries are MPs, not staff', () => {
  // 'secretary' also appears in staff titles; ordering must not misclassify.
  assert.equal(parseDpoh('van Koeverden, Adam, Parliamentary Secretary').roleClass, 'parl_sec');
});

test('French role titles classify despite ASCII word boundaries', () => {
  // Regression: /\bd[ée]put[ée]\b/ never matches 'Député,' because the
  // trailing accented char is not an ASCII word character.
  assert.equal(parseDpoh('Thériault, Jean-Yves, Député, Chambre des communes').roleClass, 'mp');
  assert.equal(classifyRole('Sénateur'), 'senator');
});

test('deputy minister is staff, not a minister', () => {
  const p = parseDpoh('Deputy Minister, Innovation, Science and Economic Development Canada');
  assert.equal(p.roleClass, 'staff');
  assert.equal(p.kind, 'role_only');
});

test('role-only rows carry no fabricated name', () => {
  const p = parseDpoh('Senior Policy Advisor, Office of the Prime Minister');
  assert.equal(p.kind, 'role_only');
  assert.equal(p.surname, '');
});

test('leading person titles are separated from the name', () => {
  const p = parseDpoh('Sénatrice Marie Dupont');
  assert.equal(p.kind, 'person');
  assert.equal(p.surname, 'Dupont');
  assert.equal(p.roleClass, 'senator');
});

test('surname, given order is not mistaken for name + role', () => {
  const p = parseDpoh('Doe, Jane, Member of Parliament, House of Commons');
  assert.equal(p.given, 'Jane');
  assert.equal(p.surname, 'Doe');
});
