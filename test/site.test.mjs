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

test('the access timeline draws a line per meeting and marks the late ones', async () => {
  const p = await page('en/bills/45-1-c-5.html');
  // Three links in the fixture, so three bars.
  assert.equal([...p.matchAll(/<g class="bar">/g)].length, 3);
  // Link 1 (2025-05-20 → 2025-06-15) spans first reading on 2025-06-06, and
  // link 3 (2025-06-20 → 2025-07-30) spans royal assent on 2025-06-26. Both
  // are marked with the triangle, so the meaning never rests on colour alone.
  assert.equal([...p.matchAll(/<path d="M [\d.]+ [\d.]+ l 4 8 l -8 0 z"/g)].length, 2);
  assert.match(p, /still not on the public record/);
});

test('the timeline marks stages and stays inside its viewBox', async () => {
  const p = await page('en/bills/45-1-c-5.html');
  assert.match(p, />1R</);
  assert.match(p, />RA</);
  const [, w, h] = p.match(/viewBox="0 0 (\d+) (\d+)"/).map(Number);
  const xs = [...p.matchAll(/cx="([\d.]+)"/g)].map((m) => Number(m[1]));
  const ys = [...p.matchAll(/cy="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(xs.length && xs.every((x) => x >= 0 && x <= w), 'x inside viewBox');
  assert.ok(ys.length && ys.every((y) => y >= 0 && y <= h), 'y inside viewBox');
});

test('the chart has an accessible twin: a table with the same dates', async () => {
  const p = await page('en/bills/45-1-c-5.html');
  assert.match(p, /2025-05-20/);
  assert.match(p, /Business Council of Canada/);
  assert.match(p, /&lt;b&gt;Escapes&lt;\/b&gt; Ltd/);      // escaped in the table
  assert.doesNotMatch(p, /<b>Escapes<\/b>/);               // and never as markup
});

test('the lag histogram renders on the home page', async () => {
  const p = await page('en/index.html');
  assert.match(p, /How long filings take to become public/);
  assert.match(p, /<rect/);
});

test('dark mode is defined, not inherited', async () => {
  const css = await readFile(join(outDir, 'style.css'), 'utf8');
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(css, /--series-access: #3987e5/);   // the dark step, not the light one
});

test('no colour is hard-coded outside the token blocks', async () => {
  // The caveat box shipped a light background with no dark value, so its text
  // was unreadable in dark mode — invisible to every check except looking at
  // it. Component rules use tokens; raw hex belongs only in :root blocks.
  const css = await readFile(join(outDir, 'style.css'), 'utf8');
  const componentRules = css.split(/:root[^{]*\{[^}]*\}/).join('');
  const strayHex = componentRules.match(/#[0-9a-f]{3,6}\b/gi) || [];
  assert.deepEqual(strayHex, [], `hard-coded colours outside :root: ${strayHex.join(', ')}`);
});
