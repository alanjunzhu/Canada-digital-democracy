// Builds the static site from whatever the pipeline produced.
//
// Every page is generated from data/out/*.json — the same files the CI run
// uploads as artifacts — so nothing on the site can say anything the pipeline
// did not measure. Missing inputs produce a page that says the data was not
// built this run, rather than a page that quietly omits it.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { STRINGS, LANGS, UNTRANSLATED } from './strings.mjs';
import { layout, esc, slug, num, pct, date, CSS, filterBox, pager } from './render.mjs';
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

function officePage({ lang, t, office, holdings, archive, generated }) {
  // Who was on the receiving end, with the position the lobbyist filed. A
  // person the resolver could not match to a sitting member is shown anyway
  // and labelled as unmatched — most of them are public servants, who are
  // correctly not members.
  const people = (office.people || []).map((p) => `<tr>
    <td>${esc(p.name)}${p.person_id ? '' : `<div class="note">${esc(t.unmatched_person)}</div>`}</td>
    <td>${esc(p.title || '—')}${p.branch ? `<div class="note">${esc(p.branch)}</div>` : ''}</td>
    <td class="n">${num(p.meetings, lang)}</td>
    <td class="n">${date(p.first_date)} – ${date(p.last_date)}</td>
    <td>${(p.top_clients || []).slice(0, 3).map((c) => `<div>${esc(c.client)} <span class="note">${num(c.n, lang)}</span></div>`).join('') || '—'}</td>
  </tr>`).join('\n');

  const meetings = (office.recent_meetings || []).map((m) => `<tr>
    <td class="n">${date(m.date)}</td>
    <td class="n">${date(m.posted_date)}</td>
    <td>${esc(m.client || '—')}${m.registrant ? `<div class="note">${esc(t.meeting_lobbyist)}: ${esc(m.registrant)}</div>` : ''}</td>
    <td>${(m.officials || []).map((o) => `<div>${esc(o.name)}${o.title ? `<span class="note"> — ${esc(o.title)}</span>` : ''}</div>`).join('') || '—'}</td>
  </tr>`).join('\n');
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

${people ? `<h2>${esc(t.people_title)}</h2>
<p class="note">${esc(t.people_note)}</p>
<table>
  <tr><th>${esc(t.people_person)}</th><th>${esc(t.people_position)}</th>
      <th class="n">${esc(t.people_meetings)}</th><th class="n">${esc(t.people_active)}</th>
      <th>${esc(t.people_asked)}</th></tr>
  ${people}
</table>` : ''}

${archive ? `<h2>${esc(t.all_meetings)}</h2>
<p class="note">${esc(t.archive_note)}</p>
<ul class="years">${archive.years.map((y) => `<li><a href="${slug(office.office_key)}--${y}.html">${esc(y)}</a> <span class="note">${num(archive.byYear.get(y).length, lang)} ${esc(t.office_meetings)}</span></li>`).join('')}</ul>`
  : `<p class="note">${esc(t.archive_partial)}</p>`}

${meetings ? `<h2>${esc(t.meetings_title)}</h2>
<p class="note">${esc(t.meetings_note)}</p>
<table>
  <tr><th class="n">${esc(t.bill_date)}</th><th class="n">${esc(t.chart_published)}</th>
      <th>${esc(t.meeting_who_asked)}</th><th>${esc(t.meeting_met)}</th></tr>
  ${meetings}
</table>` : ''}
<p class="note"><a href="index.html">← ${esc(t.back)}</a></p>`,
  });
}

/** One row of the meeting record, used by every table that lists meetings. */
function meetingRow({ t, m }) {
  return `<tr>
    <td class="n">${date(m.date)}</td>
    <td class="n">${date(m.posted_date)}</td>
    <td>${esc(m.client || '—')}${m.registrant ? `<div class="note">${esc(t.meeting_lobbyist)}: ${esc(m.registrant)}</div>` : ''}</td>
    <td>${(m.officials || []).map((o) => `<div>${esc(o.name)}${o.title ? `<span class="note"> — ${esc(o.title)}</span>` : ''}</div>`).join('') || '—'}</td>
  </tr>`;
}

/**
 * One page of an office's meeting archive: a single year, cut into pages.
 * Year first because that is the filter people actually want, and because it
 * keeps each file small enough to open on a phone.
 */
function officeMeetingsPage({ lang, t, office, year, years, rows, page, pages, total, from, generated }) {
  const tableId = 'meetings';
  const href = (p) => `${slug(office.office_key)}--${year}${p > 1 ? `-p${p}` : ''}.html`;
  const yearNav = `<ul class="years">${years.map((y) => (String(y) === String(year)
    ? `<li><strong>${esc(y)}</strong></li>`
    : `<li><a href="${slug(office.office_key)}--${y}.html">${esc(y)}</a></li>`)).join('')}</ul>`;

  return layout({
    lang, t, generated, depth: 2, title: `${office.label} — ${year}`,
    body: `<h1>${esc(office.label)}</h1>
<p class="lede">${esc(t.all_meetings)} · ${esc(year)} · ${num(total, lang)} ${esc(t.office_meetings)}${pages > 1
  ? ` · ${esc(t.page_of.replace('{page}', num(page, lang)).replace('{pages}', num(pages, lang)))} (${esc(t.showing_range
      .replace('{from}', num(from + 1, lang)).replace('{to}', num(from + rows.length, lang)))})`
  : ''}</p>
<p class="note"><a href="${slug(office.office_key)}.html">← ${esc(office.label)}</a></p>

<h2>${esc(t.browse_by_year)}</h2>
${yearNav}

${filterBox({ t, targetId: tableId })}
${pager({ t, pages, current: page, href })}

<table id="${tableId}">
  <thead>
    <tr><th class="n">${esc(t.bill_date)}</th><th class="n">${esc(t.chart_published)}</th>
        <th>${esc(t.meeting_who_asked)}</th><th>${esc(t.meeting_met)}</th></tr>
  </thead>
  <tbody>
    ${rows.map((m) => meetingRow({ t, m })).join('\n')}
  </tbody>
</table>

${pager({ t, pages, current: page, href })}`,
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
  // Every meeting, newest first — not a sample. The record is the point.
  const tableRows = [...links]
    .sort((a, b) => String(b.comm_date).localeCompare(String(a.comm_date)))
    .map((l) => {
      const crossed = stageReachedWhileUnpublished(l, stages);
      const officials = (l.officials?.length
        ? l.officials
        : [{ name: l.official_label, title: null }]).filter((o) => o.name);
      return `<tr>
      <td class="n">${date(l.comm_date)}</td>
      <td class="n">${date(l.posted_date)}${crossed ? ` <span class="flag" title="${esc(t.chart_hidden_short)}">▲</span>` : ''}</td>
      <td>${esc(l.client_name || '—')}${l.registrant_name ? `<div class="note">${esc(t.meeting_lobbyist)}: ${esc(l.registrant_name)}</div>` : ''}</td>
      <td>${officials.length
        ? officials.map((o) => `<div>${esc(o.name)}${o.title ? `<span class="note"> — ${esc(o.title)}</span>` : ''}${o.branch ? `<span class="note">, ${esc(o.branch)}</span>` : ''}</div>`).join('')
        : '—'}</td>
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
<p class="note">${esc(t.meeting_all)} ${esc(UNTRANSLATED[lang])}</p>
<table>
  <tr><th class="n">${esc(t.bill_date)}</th><th class="n">${esc(t.chart_published)}</th>
      <th>${esc(t.meeting_who_asked)}</th><th>${esc(t.meeting_met)}</th></tr>
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

export async function buildSite({ dataDir = 'data/out', outDir = 'site', maxOffices = 150, perPage = 500 } = {}) {
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

  // The full archive, one file per office, written by `resolve`. Its absence
  // is normal — a run without it still produces the whole site, minus the
  // deep pages.
  const archiveIndex = await read(dataDir, 'office-archive-index.json');
  const archives = new Map();
  for (const entry of archiveIndex?.offices || []) {
    const file = await read(`${dataDir}/office-meetings`, `${entry.slug}.json`);
    if (!file?.meetings?.length) continue;
    const byYear = new Map();
    for (const m of file.meetings) {
      const y = String(m.date || '').slice(0, 4) || 'undated';
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(m);
    }
    archives.set(entry.office_key, { byYear, years: [...byYear.keys()].sort().reverse() });
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
      const archive = archives.get(office.office_key);
      await put(`${outDir}/${lang}/offices/${slug(office.office_key)}.html`,
        officePage({ lang, t, office, holdings, archive, generated }));
      pages++;

      // Year pages, each cut into pages of `perPage`.
      for (const year of archive?.years || []) {
        const all = archive.byYear.get(year);
        const total = Math.max(Math.ceil(all.length / perPage), 1);
        for (let p = 1; p <= total; p++) {
          const rows = all.slice((p - 1) * perPage, p * perPage);
          await put(`${outDir}/${lang}/offices/${slug(office.office_key)}--${year}${p > 1 ? `-p${p}` : ''}.html`,
            officeMeetingsPage({ lang, t, office, year, years: archive.years, rows, page: p,
              pages: total, total: all.length, from: (p - 1) * perPage, generated }));
          pages++;
        }
      }
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
