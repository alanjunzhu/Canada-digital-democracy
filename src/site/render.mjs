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

export function layout({ lang, t, title, depth = 0, body, generated }) {
  const up = '../'.repeat(depth);
  const other = lang === 'en' ? 'fr' : 'en';
  return `<!doctype html>
<html lang="${lang}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — ${esc(t.site_title)}</title>
<link rel="stylesheet" href="${up}style.css">
<body>
<header>
  <a class="wordmark" href="${up}index.html">${esc(t.site_title)}</a>
  <nav>
    <a href="${up}index.html">${esc(t.nav_home)}</a>
    <a href="${up}offices/index.html">${esc(t.nav_offices)}</a>
    <a href="${up}bills/index.html">${esc(t.nav_bills)}</a>
    <a href="${up}method.html">${esc(t.nav_method)}</a>
    <a class="lang" href="${'../'.repeat(depth + 1)}${other}/index.html">${esc(t.other_lang)}</a>
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
  --ink: #16191d; --muted: #5b6570; --rule: #dfe3e8; --bg: #fbfbfa;
  --accent: #7a1f2b; --panel: #fff;
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
.stage { border-left: 3px solid var(--rule); padding: 0.2rem 0 0.2rem 1rem; margin: 0 0 1.2rem; }
.stage h3 { margin: 0 0 0.2rem; font-size: 1rem; }
.stage.busy { border-left-color: var(--accent); }
footer { border-top: 1px solid var(--rule); padding: 1.5rem; color: var(--muted); font-size: 0.85rem; }
footer p { margin: 0 0 0.35rem; max-width: 62rem; }
.caveat { background: #fff8e8; border: 1px solid #e8d9b0; border-radius: 6px; padding: 0.8rem 1rem; font-size: 0.9rem; }
`;
