import test from 'node:test';
import assert from 'node:assert/strict';
import { splitPersonName, surnameMatch, givenNameMatch, normalizeName, foldDiacritics } from '../src/normalize/names.mjs';

test('diacritics fold for comparison only', () => {
  assert.equal(surnameMatch('Theriault', 'Thériault'), 'exact');
  assert.equal(foldDiacritics('Bérubé'), 'Berube');
});

test('compound and particled surnames survive splitting', () => {
  assert.deepEqual(splitPersonName('Adam van Koeverden'), { given: 'Adam', surname: 'van Koeverden' });
  assert.deepEqual(splitPersonName('Blanchette-Joncas, Maxime'), { given: 'Maxime', surname: 'Blanchette-Joncas' });
  assert.deepEqual(splitPersonName("O'Connell, Jennifer"), { given: 'Jennifer', surname: "O'Connell" });
});

test('honorifics are stripped, including French forms', () => {
  assert.deepEqual(splitPersonName('The Hon. Marie-Claude Bibeau'), { given: 'Marie-Claude', surname: 'Bibeau' });
  assert.deepEqual(splitPersonName('Right Hon. Jane Doe'), { given: 'Jane', surname: 'Doe' });
});

test('partial surname match is reported as partial, never exact', () => {
  assert.equal(surnameMatch('Blanchette', 'Blanchette-Joncas'), 'part');
  assert.equal(surnameMatch('Smith', 'Smyth'), 'none');
});

test('given name forms', () => {
  assert.equal(givenNameMatch('Bob', 'Robert'), 'nickname');
  assert.equal(givenNameMatch('J.', 'Jennifer'), 'initial');
  assert.equal(givenNameMatch('Jean-Yves', 'Jean Yves'), 'exact');
  assert.equal(givenNameMatch('Marc', 'Sophie'), 'none');
});

test("O'Connell normalizes without the apostrophe splitting the token", () => {
  assert.equal(normalizeName("O'Connell"), 'oconnell');
});
