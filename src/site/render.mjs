// HTML rendering primitives. No template engine, no build step, no
// dependencies: the whole site is a few hundred static files, and a
// dependency-free generator is one less thing to keep alive between the
// monthly runs.

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const slug = (s) => String(s || '')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'x';

export const num = (n, lang) => (n === null || n === undefined || Number.isNaN(n)
  ? '—' : Number(n).toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA'));

export const pct = (n) => (n === null || n === undefined ? '—' : `${n}%`);

/** A date as filed. Kept ISO: it is a record, not prose. */
export const date = (d) => (d ? esc(String(d).slice(0, 10)) : '—');

/**
 * Filter box for a table. The rows are all in the HTML already — this only
 * hides the ones that do not match, so the page works with JavaScript turned
 * off, prints whole, and is fully readable to a crawler. That is also why the
 * filter is per page rather than across the archive: a static page cannot
 * search what it has not been sent.
 */
export function filterBox({ t, targetId }) {
  return `<div class="filter">
  <label for="q-${targetId}">${esc(t.filter_label)}</label>
  <input id="q-${targetId}" type="search" autocomplete="off" data-filter="${targetId}"
         placeholder="${esc(t.filter_example)}">
  <span class="note" id="count-${targetId}">${esc(t.filter_all)}</span>
  <p class="note">${esc(t.filter_hint)}</p>
</div>
<script>
(function () {
  var input = document.getElementById('q-${targetId}');
  var table = document.getElementById('${targetId}');
  var count = document.getElementById('count-${targetId}');
  if (!input || !table) return;
  var rows = Array.prototype.slice.call(table.tBodies[0].rows);
  var all = ${JSON.stringify(t.filter_all)};
  var showing = ${JSON.stringify(t.filter_showing)};
  input.addEventListener('input', function () {
    var q = input.value.trim().toLowerCase();
    var shown = 0;
    for (var i = 0; i < rows.length; i++) {
      var hit = !q || rows[i].textContent.toLowerCase().indexOf(q) !== -1;
      rows[i].hidden = !hit;
      if (hit) shown++;
    }
    count.textContent = q ? showing + ' ' + shown + ' / ' + rows.length : all;
  });
})();
</script>`;
}

/** Page links for a paginated list. Plain links: no JS, no history games. */
export function pager({ t, pages, current, href }) {
  if (pages <= 1) return '';
  const nums = [];
  for (let i = 1; i <= pages; i++) {
    // First, last, and a window around the current page — a 374-page office
    // must not print 374 links.
    if (i === 1 || i === pages || Math.abs(i - current) <= 2) {
      nums.push(i === current
        ? `<strong aria-current="page">${i}</strong>`
        : `<a href="${esc(href(i))}">${i}</a>`);
    } else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  return `<nav class="pager" aria-label="${esc(t.page)}">
    ${current > 1 ? `<a href="${esc(href(current - 1))}">← ${esc(t.prev_page)}</a>` : ''}
    ${nums.join(' ')}
    ${current < pages ? `<a href="${esc(href(current + 1))}">${esc(t.next_page)} →</a>` : ''}
  </nav>`;
}

export function layout({ lang, t, title, depth = 0, body, generated }) {
  // Two different roots, and conflating them broke every link in the nav:
  //   assets -> the SITE root, where style.css lives
  //   home   -> this LANGUAGE's root, where the nav's pages live
  // From /en/index.html those are '../' and '' respectively; from
  // /en/bills/C-5.html they are '../../' and '../'.
  const assets = '../'.repeat(depth);
  const home = '../'.repeat(Math.max(depth - 1, 0));
  const other = lang === 'en' ? 'fr' : 'en';
  return `<!doctype html>
<html lang="${lang}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — ${esc(t.site_title)}</title>
<link rel="stylesheet" href="${assets}style.css">
<body>
<header>
  <a class="wordmark" href="${home}index.html">${esc(t.site_title)}</a>
  <nav>
    <a href="${home}index.html">${esc(t.nav_home)}</a>
    <a href="${home}offices/index.html">${esc(t.nav_offices)}</a>
    <a href="${home}clients/index.html">${esc(t.nav_clients)}</a>
    <a href="${home}bills/index.html">${esc(t.nav_bills)}</a>
    <a href="${home}method.html">${esc(t.nav_method)}</a>
    <a class="lang" href="${assets}${other}/index.html">${esc(t.other_lang)}</a>
  </nav>
</header>
<main>
${body}
</main>
<footer>
  <p>${esc(t.source)}</p>
  <p class="note">${esc(t.legal_note)}</p>
  <p class="note">${generated ? `${esc(t.updated)} ${date(generated)}` : ''}</p>
</footer>
</body>
</html>`;
}

export const CSS = `:root {
  color-scheme: light;
  --ink: #16191d; --muted: #5b6570; --rule: #dfe3e8; --bg: #fbfbfa;
  --accent: #7a1f2b; --panel: #fff;
  --text-secondary: #5b6570;
  /* Chart slots, validated against this site's own surfaces in both modes.
     Blue is an ordinary logged meeting; red is one that was still unpublished
     when the bill moved — and it never carries that meaning alone, it is
     always paired with a triangle marker and a legend label. */
  --series-access: #2a78d6;
  --series-late: #d03b3b;
  --chart-rule: #c9cfd6;
  --caveat-bg: #fff8e8; --caveat-rule: #e8d9b0;
}
/* Dark mode is selected, not an inverted light mode: the chart steps are the
   dark steps of the same hues, re-validated against the dark surface. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --ink: #f2f3f5; --muted: #a4adb8; --rule: #2b3038; --bg: #101317;
    --accent: #e08a95; --panel: #16191d;
    --text-secondary: #a4adb8;
    --series-access: #3987e5;
    --series-late: #d03b3b;
    --chart-rule: #39404a;
    --caveat-bg: #241f14; --caveat-rule: #4a3f24;
  }
}
/* The same steps again under an explicit stamp, so a future theme toggle wins
   in both directions rather than only agreeing with the OS. */
:root[data-theme="dark"] {
  color-scheme: dark;
  --ink: #f2f3f5; --muted: #a4adb8; --rule: #2b3038; --bg: #101317;
  --accent: #e08a95; --panel: #16191d;
  --text-secondary: #a4adb8;
  --series-access: #3987e5;
  --series-late: #d03b3b;
  --chart-rule: #39404a;
  --caveat-bg: #241f14; --caveat-rule: #4a3f24;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink);
  font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
header { display: flex; flex-wrap: wrap; gap: 1rem; align-items: baseline;
  padding: 1rem 1.5rem; border-bottom: 1px solid var(--rule); background: var(--panel); }
.wordmark { font-weight: 700; letter-spacing: -0.01em; color: var(--ink); text-decoration: none; }
nav { display: flex; gap: 1rem; flex-wrap: wrap; margin-left: auto; }
nav a { color: var(--muted); text-decoration: none; font-size: 0.94rem; }
nav a:hover { color: var(--accent); }
nav .lang { border-left: 1px solid var(--rule); padding-left: 1rem; }
main { max-width: 62rem; margin: 0 auto; padding: 2rem 1.5rem 4rem; }
h1 { font-size: 1.9rem; line-height: 1.2; margin: 0 0 0.4rem; letter-spacing: -0.015em; }
h2 { font-size: 1.15rem; margin: 2.4rem 0 0.8rem; }
.lede { color: var(--muted); margin: 0 0 2rem; max-width: 44rem; }
.findings { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); margin: 0 0 1rem; }
.finding { background: var(--panel); border: 1px solid var(--rule); border-radius: 6px; padding: 1rem 1.1rem; }
.finding .n { font-size: 2rem; font-weight: 700; letter-spacing: -0.02em; color: var(--accent); display: block; }
.finding .what { font-weight: 600; font-size: 0.95rem; }
.finding .note { color: var(--muted); font-size: 0.85rem; margin-top: 0.4rem; }
table { border-collapse: collapse; width: 100%; background: var(--panel);
  border: 1px solid var(--rule); border-radius: 6px; overflow: hidden; font-size: 0.94rem; }
th, td { text-align: left; padding: 0.55rem 0.8rem; border-bottom: 1px solid var(--rule); vertical-align: top; }
th { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); font-weight: 600; }
tr:last-child td { border-bottom: 0; }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
a { color: var(--accent); }
.note { color: var(--muted); font-size: 0.85rem; }
.flag { color: var(--series-late); font-weight: 700; }
.filter { margin: 0 0 1rem; }
.filter label { font-size: 0.85rem; color: var(--muted); margin-right: 0.5rem; }
.filter input { font: inherit; padding: 0.4rem 0.6rem; border: 1px solid var(--rule);
  border-radius: 6px; background: var(--panel); color: var(--ink); min-width: 16rem; }
.filter p { margin: 0.4rem 0 0; }
.pager { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: baseline;
  margin: 1rem 0; font-size: 0.92rem; }
.pager strong { padding: 0 0.2rem; }
.years { display: flex; flex-wrap: wrap; gap: 0.4rem 0.8rem; margin: 0 0 1.2rem;
  padding: 0; list-style: none; font-size: 0.92rem; }
td .note { font-size: 0.8rem; }
.stage { border-left: 3px solid var(--rule); padding: 0.2rem 0 0.2rem 1rem; margin: 0 0 1.2rem; }
.stage h3 { margin: 0 0 0.2rem; font-size: 1rem; }
.stage.busy { border-left-color: var(--accent); }
footer { border-top: 1px solid var(--rule); padding: 1.5rem; color: var(--muted); font-size: 0.85rem; }
footer p { margin: 0 0 0.35rem; max-width: 62rem; }
.chart { margin: 1.2rem 0 2rem; padding: 0; }
.chart figcaption { margin: 0 0 0.5rem; font-size: 0.95rem; }
.chart figcaption .note { display: block; font-weight: 400; margin-top: 0.15rem; }
.chart svg { display: block; width: 100%; height: auto; background: var(--panel);
  border: 1px solid var(--rule); border-radius: 6px; }
.chart .bar:hover line, .chart .bar:hover circle { opacity: 1; }
.legend { display: flex; flex-wrap: wrap; gap: 0.25rem 1.1rem; align-items: center;
  font-size: 0.85rem; color: var(--muted); margin: 0 0 0.5rem; }
.legend .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px;
  margin-right: 0.4rem; vertical-align: -1px; }
.stage-tick { font-size: 11px; fill: var(--muted); font-weight: 600; }
.steps { list-style: none; display: flex; flex-wrap: wrap; gap: 0.3rem 1.4rem;
  margin: 0.7rem 0 0; padding: 0; font-size: 0.9rem; }
.steps li { display: flex; align-items: baseline; gap: 0.4rem; }
.step-n { display: inline-flex; align-items: center; justify-content: center;
  width: 1.25rem; height: 1.25rem; border: 1px solid var(--rule); border-radius: 50%;
  font-size: 0.72rem; color: var(--muted); flex: none; }
.axis-label { font-size: 11px; fill: var(--muted); }
.explainer { background: var(--panel); border: 1px solid var(--rule); border-radius: 6px;
  padding: 0.2rem 1.1rem 0.9rem; margin: 0 0 2rem; }
.explainer h2 { margin: 1rem 0 0.5rem; font-size: 1rem; }
.explainer p { margin: 0 0 0.6rem; max-width: 46rem; }
.caveat { background: var(--caveat-bg); border: 1px solid var(--caveat-rule); color: var(--ink);
  border-radius: 6px; padding: 0.8rem 1rem; font-size: 0.9rem; }
`;
