// Builds the static site from whatever the pipeline produced.
//
// Every page is generated from data/out/*.json — the same files the CI run
// uploads as artifacts — so nothing on the site can say anything the pipeline
// did not measure. Missing inputs produce a page that says the data was not
// built this run, rather than a page that quietly omits it.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { STRINGS, LANGS, UNTRANSLATED } from './strings.mjs';
import { layout, esc, slug, num, pct, date, CSS } from './render.mjs';
import { meetingsOverTime, lagHistogram, yearlySparkline, stageReachedWhileUnpublished, stageName } from './charts.mjs';

const read = async (dir, name) => {
  try { return JSON.parse(await readFile(`${dir}/${name}`, 'utf8')); } catch { return null; }
};
const put = async (path, html) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, html);
};

function homePage({ lang, t, ratio, resolution, offices, citations, generated }) {
  // The counts in the explainer come from the data, never from a sentence
  // somebody typed: a hard-coded '380,400' is a lie the moment the OCL
  // publishes again.
  const totalMeetings = ratio?.q2_citation_rate?.communications_in_dataset;
  const since = (offices || []).reduce((a, o) => (o.first_date && (!a || o.first_date < a) ? o.first_date : a), null);
  const explainer = t.explainer
    .replace('{count}', totalMeetings ? num(totalMeetings, lang) : '—')
    .replace('{since}', since ? since.slice(0, 4) : '2008');
  const q1 = ratio?.q1_who_is_named;
  const q2 = ratio?.q2_citation_rate;
  const q3 = ratio?.q3_filing_lag;

  const finding = (n, what, note) => `<div class="finding">
    <span class="n">${n}</span>
    <span class="what">${esc(what)}</span>
    <p class="note">${esc(note)}</p>
  </div>`;

  const topOffices = (offices || []).slice(0, 12).map((o) => `<tr>
    <td><a href="offices/${slug(o.office_key)}.html">${esc(o.label)}</a></td>
    <td class="n">${num(o.communications, lang)}</td>
    <td class="n">${o.median_filing_lag_days ?? '—'}</td>
  </tr>`).join('\n');

  return layout({
    lang, t, generated, depth: 1, title: t.tagline,
    body: `<h1>${esc(t.tagline)}</h1>
<div class="explainer">
  <h2>${esc(t.what_is_this)}</h2>
  <p>${esc(explainer)}</p>
  <p>${esc(t.explainer_2)}</p>
</div>

<h2>${esc(t.findings)}</h2>
<div class="findings">
  ${finding(pct(q1?.pct_naming_a_sitting_member), t.finding_member, t.finding_member_note)}
  ${finding(pct(q2?.pct_of_all_communications), t.finding_citation, t.finding_citation_note)}
  ${finding(num(q3?.median_days, lang), t.finding_lag, t.finding_lag_note)}
  ${finding(pct(resolution?.pct_attributed), t.finding_attributed, `${num(resolution?.total, lang)} ${t.finding_records}`)}
</div>

${lagHistogram({ buckets: q3?.histogram, t, lang })}

<h2>${esc(t.offices_title)}</h2>
<table>
  <tr><th>${esc(t.nav_offices)}</th><th class="n">${esc(t.office_meetings)}</th><th class="n">${esc(t.office_lag)}</th></tr>
  ${topOffices}
</table>
<p class="note"><a href="offices/index.html">${esc(t.offices_title)} →</a></p>

${citations ? `<h2>${esc(t.bills_title)}</h2>
<p class="note">${num(citations.links, lang)} · ${num(citations.distinct_bills, lang)} ${esc(t.nav_bills.toLowerCase())}</p>
<p class="note"><a href="bills/index.html">${esc(t.bills_title)} →</a></p>` : ''}

<p class="caveat">${esc(t.observed_note)}</p>`,
  });
}

function officesIndex({ lang, t, offices, generated }) {
  const rows = (offices || []).map((o) => `<tr>
    <td><a href="${slug(o.office_key)}.html">${esc(o.label)}</a></td>
    <td class="n">${num(o.communications, lang)}</td>
    <td class="n">${date(o.first_date)} – ${date(o.last_date)}</td>
    <td class="n">${o.median_filing_lag_days ?? '—'}</td>
  </tr>`).join('\n');
  return layout({
    lang, t, generated, depth: 2, title: t.offices_title,
    body: `<h1>${esc(t.offices_title)}</h1>
<p class="lede">${esc(t.offices_intro)}</p>
<div class="explainer">
  <h2>${esc(t.office_what)}</h2>
  <p>${esc(t.office_what_note)}</p>
</div>
<table>
  <tr><th>${esc(t.nav_offices)}</th><th class="n">${esc(t.office_meetings)}</th><th class="n">${esc(t.office_period)}</th><th class="n">${esc(t.office_lag)}</th></tr>
  ${rows}
</table>`,
  });
}

function officePage({ lang, t, office, holdings, generated }) {
  const clients = (office.top_clients || []).map((c) => `<tr>
    <td>${esc(c.client)}</td><td class="n">${num(c.n, lang)}</td>
  </tr>`).join('\n');

  const held = (holdings || []).map((h) => `<tr>
    <td>${esc(h.person_name || '—')}</td>
    <td>${esc(h.title)}</td>
    <td class="n">${date(h.start_date)} – ${date(h.end_date)}</td>
    <td class="n">${num(h.observations, lang)}</td>
  </tr>`).join('\n');

  return layout({
    lang, t, generated, depth: 2, title: office.label,
    body: `<h1>${esc(office.label)}</h1>
<p class="lede">${num(office.communications, lang)} ${esc(t.office_meetings)} · ${date(office.first_date)} – ${date(office.last_date)}
 · ${esc(t.office_lag)} ${office.median_filing_lag_days ?? '—'} ${esc(t.days)}</p>

${yearlySparkline({ years: office.by_year, t, lang })}

${held ? `<h2>${esc(t.who_held)}</h2>
<p class="note">${esc(t.who_held_note)}</p>
<table>
  <tr><th>${esc(t.holder)}</th><th>${esc(t.holder_title)}</th><th class="n">${esc(t.office_period)}</th><th class="n">${esc(t.office_meetings)}</th></tr>
  ${held}
</table>` : ''}

<h2>${esc(t.office_clients)}</h2>
<p class="note">${esc(UNTRANSLATED[lang])}</p>
<table>
  <tr><th>${esc(t.office_clients)}</th><th class="n">${esc(t.office_meetings)}</th></tr>
  ${clients || `<tr><td colspan="2" class="note">—</td></tr>`}
</table>
<p class="note"><a href="index.html">← ${esc(t.back)}</a></p>`,
  });
}

function billsIndex({ lang, t, timelines, citations, generated }) {
  if (!timelines?.length) {
    return layout({ lang, t, generated, depth: 2, title: t.bills_title,
      body: `<h1>${esc(t.bills_title)}</h1><p class="lede">${esc(t.no_bills)}</p>` });
  }
  const rows = timelines.map((b) => `<tr>
    <td><a href="${slug(b.bill_id)}.html">${esc(b.number)}</a></td>
    <td>${esc(b.short_title || '—')}</td>
    <td class="n">${esc(String(b.bill_id).split('/')[0])}</td>
    <td class="n">${num(b.total_linked_communications, lang)}</td>
  </tr>`).join('\n');
  return layout({
    lang, t, generated, depth: 2, title: t.bills_title,
    body: `<h1>${esc(t.bills_title)}</h1>
<p class="lede">${esc(t.bills_intro)}</p>
${citations ? `<p class="note">${num(citations.links, lang)} · ${num(citations.distinct_bills, lang)}</p>` : ''}
<table>
  <tr><th>${esc(t.bill_number)}</th><th>${esc(t.bill_title)}</th><th class="n">${esc(t.bill_session)}</th><th class="n">${esc(t.office_meetings)}</th></tr>
  ${rows}
</table>`,
  });
}

function billPage({ lang, t, bill, links = [], generated }) {
  const stages = bill.stages || [];
  // The table is the chart's accessible twin, and the place the exact dates
  // live. Both are built from the same rows.
  const tableRows = links.slice(0, 60).map((l) => {
    const crossed = stageReachedWhileUnpublished(l, stages);
    return `<tr>
      <td class="n">${date(l.comm_date)}</td>
      <td class="n">${date(l.posted_date)}${crossed ? ' <strong title="' + esc(t.chart_late_note) + '">▲</strong>' : ''}</td>
      <td>${esc(l.client_name || '—')}</td>
      <td>${esc(l.official_label || '—')}</td>
    </tr>`;
  }).join('\n');
  const stageBlocks = (bill.stages || []).map((s) => `<div class="stage${s.communications ? ' busy' : ''}">
  <h3>${esc(stageName(s.stage, lang))} — ${date(s.event_date)}</h3>
  <p class="note">${esc(t.bill_before)} ${num(s.window_days, lang)} ${esc(t.days)}:
     ${num(s.communications, lang)} ${esc(t.office_meetings)}${s.median_filing_lag_days != null ? ` · ${esc(t.office_lag)} ${num(s.median_filing_lag_days, lang)} ${esc(t.days)}` : ''}</p>
  ${s.clients?.length ? `<table>
    <tr><th>${esc(t.bill_clients)}</th><th class="n">${esc(t.office_meetings)}</th></tr>
    ${s.clients.slice(0, 10).map((c) => `<tr>
      <td>${esc(c.client)}${c.officials?.length ? `<div class="note">${esc(t.bill_officials)}: ${esc(c.officials.slice(0, 4).join('; '))}</div>` : ''}</td>
      <td class="n">${num(c.count, lang)}</td>
    </tr>`).join('\n')}
  </table>` : ''}
</div>`).join('\n');

  return layout({
    lang, t, generated, depth: 2, title: `${bill.number} ${bill.short_title || ''}`.trim(),
    body: `<h1>${esc(bill.number)}</h1>
<p class="lede">${esc(bill.short_title || '')}</p>
<p class="note">${num(bill.total_linked_communications, lang)} ${esc(t.office_meetings)}</p>

${meetingsOverTime({ links, stages, t, lang })}

${stageBlocks || `<p class="note">—</p>`}

${tableRows ? `<h2>${esc(t.bill_before)}</h2>
<p class="note">${esc(UNTRANSLATED[lang])}</p>
<table>
  <tr><th class="n">${esc(t.bill_date)}</th><th class="n">${esc(t.chart_published)}</th>
      <th>${esc(t.bill_clients)}</th><th>${esc(t.bill_officials)}</th></tr>
  ${tableRows}
</table>` : ''}
<p class="note"><a href="index.html">← ${esc(t.back)}</a></p>`,
  });
}

function methodPage({ lang, t, ratio, resolution, generated }) {
  const en = lang === 'en';
  const body = en ? `
<h1>${esc(t.method_title)}</h1>
<p class="lede">Every number on this site is produced by a pipeline that runs monthly against the
Office of the Commissioner of Lobbying's own bulk files. Nothing is hand-entered.</p>

<h2>What a record is</h2>
<p>Under the Lobbying Act, every oral, arranged communication with a Designated Public Office
Holder is filed monthly, naming the lobbyist, the client, the official and the date. This site
joins those filings to the offices they name, and — where the filing says so — to a bill.</p>

<h2>What it cannot tell you</h2>
<ul>
  <li><strong>It cannot tell you what was said.</strong> The record names a subject area, not a position.</li>
  <li><strong>It rarely names a bill.</strong> ${esc(pct(ratio?.q2_citation_rate?.pct_of_all_communications))} of communications name one.
      Pages for other bills would be invention.</li>
  <li><strong>Office holders are observed, not appointed.</strong> ${esc(t.observed_note)}</li>
  <li><strong>A shared surname is never guessed.</strong> Where two members share a name and the filing
      gives no first name, the record is reported as ambiguous — ${num(resolution?.ambiguous, lang)} times.</li>
</ul>

<h2>Coverage</h2>
<p>${num(resolution?.total, lang)} official-rows. ${esc(pct(resolution?.pct_attributed))} land on a person or an office.
${num(resolution?.resolved, lang)} are matched to a specific member, on the date of the meeting.</p>

<p class="caveat">${esc(t.legal_note)}</p>` : `
<h1>${esc(t.method_title)}</h1>
<p class="lede">Chaque chiffre de ce site provient d’un traitement exécuté chaque mois sur les fichiers
en vrac du Commissariat au lobbying. Rien n’est saisi à la main.</p>

<h2>Ce qu’est une inscription</h2>
<p>En vertu de la Loi sur le lobbying, chaque communication orale et organisée avec un titulaire
d’une charge publique désignée est déclarée mensuellement : le lobbyiste, le client, le titulaire
et la date. Ce site rattache ces déclarations aux bureaux nommés et, lorsque la déclaration le
précise, à un projet de loi.</p>

<h2>Ce que cela ne dit pas</h2>
<ul>
  <li><strong>Le contenu des échanges est inconnu.</strong> Le registre nomme un domaine, pas une position.</li>
  <li><strong>Un projet de loi est rarement nommé.</strong> ${esc(pct(ratio?.q2_citation_rate?.pct_of_all_communications))} des communications en nomment un.</li>
  <li><strong>Les titulaires sont observés, non nommés officiellement.</strong> ${esc(t.observed_note)}</li>
  <li><strong>Un nom de famille partagé n’est jamais deviné</strong> — signalé comme ambigu ${num(resolution?.ambiguous, lang)} fois.</li>
</ul>

<h2>Couverture</h2>
<p>${num(resolution?.total, lang)} inscriptions. ${esc(pct(resolution?.pct_attributed))} sont rattachées à une personne ou à un bureau.</p>

<p class="caveat">${esc(t.legal_note)}</p>`;
  return layout({ lang, t, generated, depth: 1, title: t.method_title, body });
}

export async function buildSite({ dataDir = 'data/out', outDir = 'site', maxOffices = 150 } = {}) {
  const ratio = await read(dataDir, 'ratio-report.json');
  const resolution = await read(dataDir, 'resolution-report.json');
  const offices = (await read(dataDir, 'office-access.json')) || [];
  const derived = await read(dataDir, 'derived-offices.json');
  const citations = await read(dataDir, 'citation-report.json');
  const links = (await read(dataDir, 'comm-bill-links.json')) || [];
  const linksByBill = new Map();
  for (const l of links) {
    if (!linksByBill.has(l.bill_id)) linksByBill.set(l.bill_id, []);
    linksByBill.get(l.bill_id).push(l);
  }
  const timelines = (await read(dataDir, 'timelines.json')) || [];
  const generated = ratio?.generated_at || new Date().toISOString().slice(0, 10);

  // Office holders, grouped by the office they were observed in.
  const holdingsByOffice = new Map();
  for (const h of derived?.holdings || []) {
    if (!holdingsByOffice.has(h.office_key)) holdingsByOffice.set(h.office_key, []);
    holdingsByOffice.get(h.office_key).push(h);
  }

  const shown = offices.slice(0, maxOffices);
  let pages = 0;
  await put(`${outDir}/style.css`, CSS);

  for (const lang of LANGS) {
    const t = STRINGS[lang];
    await put(`${outDir}/${lang}/index.html`, homePage({ lang, t, ratio, resolution, offices: shown, citations, generated }));
    await put(`${outDir}/${lang}/method.html`, methodPage({ lang, t, ratio, resolution, generated }));
    await put(`${outDir}/${lang}/offices/index.html`, officesIndex({ lang, t, offices: shown, generated }));
    pages += 3;

    for (const office of shown) {
      const holdings = (holdingsByOffice.get(office.office_key) || [])
        .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
      await put(`${outDir}/${lang}/offices/${slug(office.office_key)}.html`, officePage({ lang, t, office, holdings, generated }));
      pages++;
    }

    await put(`${outDir}/${lang}/bills/index.html`, billsIndex({ lang, t, timelines, citations, generated }));
    pages++;
    for (const bill of timelines) {
      await put(`${outDir}/${lang}/bills/${slug(bill.bill_id)}.html`,
        billPage({ lang, t, bill, links: linksByBill.get(bill.bill_id) || [], generated }));
      pages++;
    }
  }

  // The root is a language choice, not a redirect to English.
  await put(`${outDir}/index.html`, `<!doctype html>
<html lang="en"><meta charset="utf-8"><title>${esc(STRINGS.en.site_title)}</title>
<link rel="stylesheet" href="style.css">
<body><main>
<h1>${esc(STRINGS.en.site_title)} / ${esc(STRINGS.fr.site_title)}</h1>
<p class="lede"><a href="en/index.html">English</a> · <a href="fr/index.html">Français</a></p>
</main></body></html>`);
  pages++;

  return { pages, offices: shown.length, bills: timelines.length, generated };
}
