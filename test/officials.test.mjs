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

test('the separate title column is honoured when the name cell has no role', () => {
  // Regression: the OCL files carry DPOH_TITLE_EN in its own column. Ignoring
  // it collapsed every role to 'unknown' and reported 0% sitting members.
  assert.equal(parseDpoh('Thériault, Jean-Yves', 'House of Commons', 'Member of Parliament').roleClass, 'mp');
  assert.equal(parseDpoh('Doe, Jane', 'Finance Canada (FIN)', 'Chief of Staff').roleClass, 'staff');
});

test('a title column on an empty name cell still classifies the role', () => {
  const p = parseDpoh('', 'Finance Canada (FIN)', 'Deputy Minister');
  assert.equal(p.kind, 'role_only');
  assert.equal(p.roleClass, 'staff');
});

test('a structured DPOH row composes surname-first, which parseDpoh trusts', async () => {
  // The real export splits the official's name across DPOH_LAST_NM_TCPD and
  // DPOH_FIRST_NM_PRENOM_TCPD. Composing 'Surname, Given' preserves the one
  // thing the file states outright; 'Given Surname' would discard it.
  const { normalizeDpohRows } = await import('../src/fetch/ingest-lobbying.mjs');
  const [row] = normalizeDpohRows([{
    communication_id: 'C1', dpoh_surname: 'Thériault', dpoh_given: 'Jean-Yves',
    dpoh_title_raw: 'Member of Parliament', institution: 'House of Commons',
  }]);
  assert.equal(row.dpoh_raw, 'Thériault, Jean-Yves');
  const p = parseDpoh(row.dpoh_raw, row.institution, row.dpoh_title_raw);
  assert.equal(p.surname, 'Thériault');
  assert.equal(p.given, 'Jean-Yves');
  assert.equal(p.roleClass, 'mp');
});

test('a DPOH row with no name at all stays a role-only row', async () => {
  const { normalizeDpohRows } = await import('../src/fetch/ingest-lobbying.mjs');
  const [row] = normalizeDpohRows([{ communication_id: 'C2', dpoh_surname: '', dpoh_given: '', dpoh_title_raw: 'Senior Policy Advisor' }]);
  assert.equal(row.dpoh_raw, '');
  assert.equal(parseDpoh(row.dpoh_raw, '', row.dpoh_title_raw).kind, 'role_only');
});

test('titles typed by hand in the real file still classify', () => {
  // All four appear verbatim in the published DPOH export.
  assert.equal(classifyRole('Member of Parliment'), 'mp');            // sic, 1,000 rows
  assert.equal(classifyRole('Member of the House of Commons'), 'mp');
  assert.equal(classifyRole('M.P.'), 'mp');
  assert.equal(classifyRole('ADM'), 'staff');                          // assistant deputy minister
});

test('a minister whose title never says minister is not filed as staff', () => {
  assert.equal(classifyRole('President of the Treasury Board'), 'minister');
  assert.equal(classifyRole('President'), 'staff');                    // an agency head
  assert.equal(classifyRole('Deputy Minister'), 'staff');              // still a public servant
});
