import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite } from '../src/site/build.mjs';

const dataDir = new URL('./fixtures/site-data', import.meta.url).pathname;
let outDir;

test.before(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'site-'));
  await buildSite({ dataDir, outDir });
});
test.after(async () => { await rm(outDir, { recursive: true, force: true }); });

const page = (p) => readFile(join(outDir, p), 'utf8');

test('both languages are built, and neither is a copy of the other', async () => {
  const en = await page('en/index.html');
  const fr = await page('fr/index.html');
  assert.match(en, /Who was in the room/);
  assert.match(fr, /Qui était dans la pièce/);
  assert.doesNotMatch(fr, /Who was in the room/);
});

test('a bill page renders its stages, including the empty one', async () => {
  const p = await page('en/bills/45-1-c-5.html');
  assert.match(p, /C-5/);
  assert.match(p, /One Canadian Economy Act/);
  assert.match(p, /first reading/);
  assert.match(p, /2025-06-06/);
  assert.match(p, /Business Council of Canada/);
  // A stage with no lobbying in its window is still shown: absence is a fact.
  assert.match(p, /royal assent/);
});

test('an office page carries the observation-window caveat, not an appointment claim', async () => {
  const p = await page('en/offices/finance-canada-fin.html');
  assert.match(p, /Flaherty, Jim/);
  assert.match(p, /observation windows/);
  assert.doesNotMatch(p, /appointed on/i);
});

test('client names from the filings are escaped, not executed', async () => {
  // Client names are registrant-supplied free text and end up in HTML.
  const p = await page('en/offices/finance-canada-fin.html');
  assert.match(p, /&lt;script&gt;/);
  assert.doesNotMatch(p, /<script>alert/);
});

test('the four measurements reach the home page', async () => {
  const p = await page('en/index.html');
  assert.match(p, /26\.4%/);
  assert.match(p, /0\.64%/);
  assert.match(p, /26/);
  assert.match(p, /95%/);
});

test('the root page offers a language choice rather than defaulting to English', async () => {
  const p = await page('index.html');
  assert.match(p, /en\/index\.html/);
  assert.match(p, /fr\/index\.html/);
});

test('a bill page names the officials who were in the room', () => {
  // The whole point of the join: not just that a client lobbied before a
  // stage, but who they met.
  return page('en/bills/45-1-c-5.html').then((p) => {
    assert.match(p, /Officials named/);
    assert.match(p, /Doe, Jane — Chief of Staff/);
  });
});
