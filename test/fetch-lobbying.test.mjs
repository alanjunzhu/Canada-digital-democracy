import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickResources, ckanUrl } from '../src/fetch/fetch-lobbying.mjs';

const pkg = JSON.parse(readFileSync(new URL('./fixtures/ckan-package.json', import.meta.url), 'utf8'));
const picked = pickResources(pkg.result.resources);

test('the DPOH secondary file is identified by what it is, not by its position', () => {
  // CKAN reorders resources between publications, so position means nothing.
  assert.match(picked.dpoh.url, /Communication_DPOH\.zip$/);
});

test('the primary communications file is not confused with the DPOH one', () => {
  assert.match(picked.communications.url, /Communications\.csv$/);
});

test('English resources win when both languages are published', () => {
  assert.doesNotMatch(picked.communications.url, /_fr\./);
});

test('non-tabular resources are never downloaded as data', () => {
  assert.ok(picked.all.some((r) => r.format === 'HTML'));      // still listed for the human
  assert.notEqual(picked.communications.format, 'HTML');
});

test('the data dictionary is picked up even though it is not a CSV', () => {
  // It is the artefact that settles the column-name question, so it is fetched
  // alongside the data rather than left on the portal.
  assert.match(picked.dictionary.url, /dictionary\.xlsx$/);
});

test('nothing is guessed when nothing matches', () => {
  const empty = pickResources([{ name: 'Something else', format: 'CSV', url: 'https://example.invalid/x.csv' }]);
  assert.equal(empty.communications, null);
  assert.equal(empty.dpoh, null);
  assert.equal(empty.all.length, 1);          // the human still sees what was there
});

test('the CKAN package id is the stable handle, not a hash-pathed download link', () => {
  assert.match(ckanUrl(), /open\.canada\.ca\/data\/api\/3\/action\/package_show\?id=a34eb330-/);
});
