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
  // minPersonMeetings is lowered so the small fixture office produces person
  // pages; on the real data the default keeps the page count sane.
  await buildSite({ dataDir, outDir, minPersonMeetings: 2 });
});
test.after(async () => { await rm(outDir, { recursive: true, force: true }); });

const page = (p) => readFile(join(outDir, p), 'utf8');

test('both languages are built, and neither is a copy of the other', async () => {
  const en = await page('en/index.html');
  const fr = await page('fr/index.html');
  assert.match(en, /how long before the rest of us find out/);
  assert.match(fr, /combien de temps avant que nous le sachions/);
  assert.doesNotMatch(fr, /how long before/);
});

test('a bill page renders its stages, including the empty one', async () => {
  const p = await page('en/bills/45-1-c-5.html');
  assert.match(p, /C-5/);
  assert.match(p, /One Canadian Economy Act/);
  // Plain names, not '1R' and 'RA': a reader who has never heard of a
  // 'reading' has to be able to follow the page.
  assert.match(p, /Introduced/);
  assert.match(p, /2025-06-06/);
  assert.match(p, /Business Council of Canada/);
  assert.doesNotMatch(p, />1R</);
  // A stage with no lobbying in its window is still shown: absence is a fact.
  assert.match(p, /Became law/);
});

test('an office page carries the observation-window caveat, not an appointment claim', async () => {
  const p = await page('en/offices/finance-canada-fin.html');
  assert.match(p, /Flaherty, Jim/);
  assert.match(p, /not their official start and end dates/);
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

test('a bill page names who was met, in plain words', () => {
  // The whole point of the join: not just that someone lobbied before a
  // stage, but who they met.
  return page('en/bills/45-1-c-5.html').then((p) => {
    assert.match(p, /Who they met/);
    assert.match(p, /Doe, Jane — Chief of Staff/);
  });
});

test('the chart counts meetings per month and separates the still-private ones', async () => {
  const p = await page('en/bills/45-1-c-5.html');
  // Three meetings across May, June and June — so bars for the months that
  // have any, and a stacked segment for the two that were still private when
  // the bill next moved.
  assert.ok([...p.matchAll(/<g class="bar">/g)].length >= 2);
  assert.match(p, /<strong>2 of 3<\/strong> meetings about this bill were still not public/);
});

test('the chart marks the bill steps and stays inside its viewBox', async () => {
  const p = await page('en/bills/45-1-c-5.html');
  assert.match(p, />Introduced</);
  assert.match(p, />Became law</);
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
  assert.match(p, /How long a meeting stays private/);
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

test('every internal link points at a file that exists', async () => {
  // The nav was broken on every page: one variable was being used both for the
  // path to the stylesheet (site root) and for the nav links (language root),
  // so 'Offices' pointed at /offices/ instead of /en/offices/.
  const { readdir } = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');
  const { dirname, resolve } = await import('node:path');

  const pages = (await readdir(outDir, { recursive: true }))
    .filter((f) => f.endsWith('.html'));
  const broken = [];
  for (const rel of pages) {
    const file = join(outDir, rel);
    const html = await readFile(file, 'utf8');
    for (const m of html.matchAll(/(?:href|src)="([^"#:]+)"/g)) {
      const target = resolve(dirname(file), m[1]);
      if (!existsSync(target)) broken.push(`${rel} -> ${m[1]}`);
    }
  }
  assert.deepEqual(broken, [], `broken links:\n${broken.join('\n')}`);
});

test('the home page explains what lobbying is before showing any number', async () => {
  const p = await page('en/index.html');
  const explainerAt = p.indexOf('What is this?');
  const firstNumberAt = p.indexOf('class="n"');
  assert.ok(explainerAt > -1, 'the explainer exists');
  assert.ok(explainerAt < firstNumberAt, 'and it comes before the first statistic');
  assert.match(p, /hire people called lobbyists/);
});

test('the offices index says what an office is, since the people rotate', async () => {
  const p = await page('en/offices/index.html');
  assert.match(p, /What counts as an .office.\?/);
  assert.match(p, /ministers are shuffled, MPs lose elections/);
});

test('no page uses parliamentary jargon without explaining it', async () => {
  const p = await page('en/index.html');
  for (const jargon of ['DPOH', 'designated public office holder', 'first reading', 'royal assent']) {
    assert.ok(!p.toLowerCase().includes(jargon.toLowerCase()), `home page should not say '${jargon}'`);
  }
});

test('the explainer counts come from the data, not from a typed sentence', async () => {
  const p = await page('en/index.html');
  // The fixture says 1,000 communications; a hard-coded number would survive
  // here and go stale the next time the OCL publishes.
  assert.match(p, /1,000 of them/);
  assert.doesNotMatch(p, /380,400/);
});

test('an office page names who was met, with the position as filed', async () => {
  const p = await page('en/offices/finance-canada-fin.html');
  assert.match(p, /Who lobbyists met here/);
  assert.match(p, /Nguyen, Mai/);
  assert.match(p, /Minister of Finance/);
  assert.match(p, /Chief Trade Negotiator/);
  // The count, the span of dates, and who was asking to see them.
  assert.match(p, /214/);
  assert.match(p, /2021-01-11 – 2026-06-30/);
  assert.match(p, /Canadian Cattle Association/);
});

test('a person the resolver could not match is shown and labelled, not dropped', async () => {
  // Most are public servants, who are correctly not MPs. Hiding them would
  // hide the majority of who lobbyists actually meet.
  const p = await page('en/offices/finance-canada-fin.html');
  assert.match(p, /Verheul, Steve/);
  assert.match(p, /not matched to a member/);
});

test('an office page lists whole meetings: who asked, who filed, who was met', async () => {
  const p = await page('en/offices/finance-canada-fin.html');
  assert.match(p, /Most recent meetings/);
  assert.match(p, /Lobbyist who filed it: Doe, John/);
  assert.match(p, /2026-06-30/);
  assert.match(p, /2026-07-24/);          // and when the public could see it
});

test('a bill page shows every meeting, with the lobbyist and each official met', async () => {
  const p = await page('en/bills/45-1-c-5.html');
  // One row per filed meeting — counted by the lobbyist line, which every row
  // in this table carries, rather than by date cells (a published date that
  // crossed a step also carries a flag, so it is not a bare cell).
  const rows = [...p.matchAll(/Lobbyist who filed it/g)].length;
  assert.equal(rows, 3, 'all three fixture meetings, not a sample');
  for (const d of ['2025-05-20', '2025-06-02', '2025-06-20']) assert.match(p, new RegExp(d));
  assert.match(p, /Lobbyist who filed it/);
  assert.match(p, /Nguyen, Mai<span class="note"> — Minister of Finance/);
});

// --- the full meeting archive: year pages, pagination, name filter ---------

test('the office summary links into the archive, one entry per year', async () => {
  const p = await page('en/offices/finance-canada-fin.html');
  assert.match(p, /All meetings/);
  assert.match(p, /finance-canada-fin--2024\.html/);
  assert.match(p, /finance-canada-fin--2023\.html/);
  // Newest year first: someone opening the page wants this year, not 2008.
  assert.ok(p.indexOf('--2024.html') < p.indexOf('--2023.html'));
});

test('an office with no archive says so rather than pretending to be complete', async () => {
  // The second fixture office is not in office-archive-index.json, exactly as
  // the long tail of real offices is not.
  const p = await page('en/offices/health-canada-hc.html');
  assert.match(p, /keeps its most recent meetings only/);
  assert.doesNotMatch(p, /health-canada-hc--20\d\d\.html/);
});

test('a year page carries the year navigation, the filter and the meetings', async () => {
  const p = await page('en/offices/finance-canada-fin--2024.html');
  assert.match(p, /Finance Canada \(FIN\)/);
  assert.match(p, /2024/);
  assert.match(p, /Filter by name/);
  assert.match(p, /Maple Leaf Foods/);
  assert.match(p, /Tremblay, Chantal/);
  // A link back to the office, and across to the other year.
  assert.match(p, /href="finance-canada-fin\.html"/);
  assert.match(p, /href="finance-canada-fin--2023\.html"/);
});

test('the filter works without JavaScript having run: the rows are in the HTML', async () => {
  // Progressive enhancement. If the script never loads the reader still has
  // every meeting; the script only hides rows it is told to hide.
  const p = await page('en/offices/finance-canada-fin--2024.html');
  const table = p.slice(p.indexOf('<table id="meetings">'), p.indexOf('</table>'));
  assert.match(table, /Maple Leaf Foods/);
  assert.match(table, /Tremblay, Chantal/);
  const script = p.slice(p.indexOf('<script>'), p.indexOf('<\/script>'));
  assert.doesNotMatch(script, /fetch\(|XMLHttpRequest|innerHTML/);
  assert.match(script, /hidden = /);
});

test('pagination keeps every meeting exactly once across the pages', async () => {
  // Built small on purpose: seven 2024 meetings at three per page is three
  // pages, including a short last one.
  const out = await mkdtemp(join(tmpdir(), 'site-paged-'));
  try {
    await buildSite({ dataDir, outDir: out, perPage: 3 });
    const read = (p) => readFile(join(out, p), 'utf8');
    const ids = [];
    for (const f of ['finance-canada-fin--2024.html',
                     'finance-canada-fin--2024-p2.html',
                     'finance-canada-fin--2024-p3.html']) {
      const html = await read(`en/offices/${f}`);
      for (const m of html.matchAll(/Canadian Bankers Association (\d)|Maple Leaf Foods/g)) ids.push(m[0]);
    }
    assert.equal(ids.length, 7, 'seven meetings, no page dropping or repeating rows');
    assert.equal(new Set(ids).size, 7, 'no meeting appears on two pages');

    // A fourth page must not exist, and page one must not offer a previous.
    await assert.rejects(() => read('en/offices/finance-canada-fin--2024-p4.html'));
    const first = await read('en/offices/finance-canada-fin--2024.html');
    assert.doesNotMatch(first, /Previous/);
    assert.match(first, /Next/);
    assert.match(first, /finance-canada-fin--2024-p2\.html/);

    const last = await read('en/offices/finance-canada-fin--2024-p3.html');
    assert.match(last, /Previous/);
    assert.doesNotMatch(last, /Next/);

    // The year with fewer meetings than a page gets no pager at all.
    const short = await read('en/offices/finance-canada-fin--2023.html');
    assert.doesNotMatch(short, /Next|Previous/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('the French archive is French, down to the pagination', async () => {
  const p = await page('fr/offices/finance-canada-fin--2024.html');
  assert.match(p, /Maple Leaf Foods/);
  assert.match(p, /Filtrer par nom/);
  assert.match(p, /Parcourir par ann\u00e9e|Parcourir par année/);
  assert.doesNotMatch(p, /Filter by name/);
});

test('a paged year says how many meetings the year holds, not how many this page shows', async () => {
  // The first version printed '3 meetings' on page 1 of 3 — a reader would
  // have believed the year held three.
  const out = await mkdtemp(join(tmpdir(), 'site-count-'));
  try {
    await buildSite({ dataDir, outDir: out, perPage: 3 });
    const p = await readFile(join(out, 'en/offices/finance-canada-fin--2024.html'), 'utf8');
    const lede = p.slice(p.indexOf('<p class="lede">'), p.indexOf('</p>', p.indexOf('<p class="lede">')));
    assert.match(lede, /7 meetings/);
    assert.match(lede, /Page 1 of 3/);
    assert.match(lede, /showing 1–3/);
    const last = await readFile(join(out, 'en/offices/finance-canada-fin--2024-p3.html'), 'utf8');
    assert.match(last, /showing 7–7/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

// --- organisations, people, and what a bill actually is --------------------

test('the organisations index ranks who is doing the asking', async () => {
  const p = await page('en/clients/index.html');
  assert.match(p, /Who is doing the asking/);
  assert.match(p, /Business Council of Canada/);
  assert.match(p, /business-council-of-canada\.html/);
  // Organisation names are registrant free text and end up in HTML.
  assert.match(p, /&lt;script&gt;/);
  assert.doesNotMatch(p, /<script>alert/);
});

test('an organisation page answers who they meet most, and links to that person', async () => {
  const p = await page('en/clients/business-council-of-canada.html');
  assert.match(p, /Who they meet most/);
  assert.match(p, /Nguyen, Mai/);
  assert.match(p, /Minister of Finance/);
  assert.match(p, /2 other job titles filed/);
  // Through to the person's own page, and to the office they sit in.
  assert.match(p, /href="\.\.\/offices\/finance-canada-fin--who--nguyen-mai\.html"/);
  assert.match(p, /href="\.\.\/offices\/finance-canada-fin\.html"/);
  // And where they lobby, and who files for them.
  assert.match(p, /Where they lobby/);
  assert.match(p, /Lobbyists who filed for them/);
  assert.match(p, /Vega, Adriana/);
});

test('an organisation page carries its whole meeting log, filterable', async () => {
  const p = await page('en/clients/business-council-of-canada.html');
  assert.match(p, /Every meeting they filed/);
  assert.match(p, /Filter by name/);
  const body = p.slice(p.indexOf('id="log"'));
  for (const d of ['2025-01-11', '2025-06-16']) assert.match(body, new RegExp(d));
});

test('an organisation with no published log says so instead of looking complete', async () => {
  const p = await page('en/clients/script-alert-1.html');
  assert.match(p, /published for the organisations that file the most/);
});

test('a person page is one name at one office, and says so', async () => {
  const p = await page('en/offices/finance-canada-fin--who--nguyen-mai.html');
  assert.match(p, /Nguyen, Mai/);
  assert.match(p, /Finance Canada \(FIN\)/);
  assert.match(p, /Job titles as filed/);
  assert.match(p, /Who asked to see them most/);
  assert.match(p, /Every meeting they were named in/);
  // The caution about identity is on the page, not buried in the method.
  assert.match(p, /two people who share a name/);
});

test('the office page links each person through to their own record', async () => {
  const p = await page('en/offices/finance-canada-fin.html');
  assert.match(p, /href="finance-canada-fin--who--nguyen-mai\.html"/);
});

test('bills are ordered by what happened most recently, not by volume', async () => {
  const p = await page('en/bills/index.html');
  // C-18 has four hundred linked meetings to C-5's 282, but its last step was
  // in 2023: ordering by volume put a finished 2023 bill above this month's.
  assert.ok(p.indexOf('45-1-c-5.html') < p.indexOf('44-1-c-18.html'), 'newest activity first');
  assert.match(p, /Newest first/);
  assert.match(p, /Filter by name/);
});

test('a bill page says what the bill is, how far it got, and where to read it', async () => {
  const p = await page('en/bills/45-1-c-5.html');
  assert.match(p, /What this bill is/);
  assert.match(p, /Government Bill/);
  assert.match(p, /Moved by Freeland, Chrystia/);
  assert.match(p, /Became law 2025-06-26/);
  assert.match(p, /https:\/\/www\.parl\.ca\/legisinfo\/en\/bill\/45-1\/c-5/);
  // Why it is here at all — measured, and explicitly not a judgement of worth.
  assert.match(p, /Why it is on this site/);
  assert.match(p, /282 filed meetings named this bill, from 5 organisations/);
  assert.match(p, /not how important anyone thinks it is/);
});

test('a bill page shows what those meetings were filed as being about', async () => {
  const p = await page('en/bills/45-1-c-5.html');
  assert.match(p, /What those meetings were about/);
  assert.match(p, /Infrastructure/);
  assert.match(p, /the subject categories the lobbyists ticked/i);
});

test('the French bill page points at the French bill, and the French titles', async () => {
  const p = await page('fr/bills/45-1-c-5.html');
  assert.match(p, /https:\/\/www\.parl\.ca\/legisinfo\/fr\/bill\/45-1\/c-5/);
  assert.match(p, /Loi concernant certains ouvrages/);
  assert.match(p, /Projet de loi du gouvernement/);
});
