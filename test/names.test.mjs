import test from 'node:test';
import assert from 'node:assert/strict';
import { splitPersonName, surnameMatch, givenNameMatch, normalizeName, foldDiacritics, withinOneTypo, uniqueNearSurname } from '../src/normalize/names.mjs';

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

test('a transposed pair is one typo, which is the error people actually make', () => {
  // 'Hadju' for 'Hajdu', 119 times in the real file. Plain Levenshtein scores
  // a swap as two edits and would miss it.
  assert.equal(withinOneTypo('hadju', 'hajdu'), true);
  assert.equal(withinOneTypo('smith', 'smiht'), true);
  assert.equal(withinOneTypo('smith', 'smyth'), true);     // substitution
  assert.equal(withinOneTypo('smith', 'smiths'), true);    // insertion
  assert.equal(withinOneTypo('smith', 'jones'), false);
  assert.equal(withinOneTypo('gill', 'hill'), true);
});

test('a typo that fits two members is not a typo, it is a coin flip', () => {
  const keys = ['gill', 'hill'];
  assert.equal(uniqueNearSurname('bill', keys), null);
  assert.equal(uniqueNearSurname('gilll', ['gill', 'jones']), 'gill');
});
