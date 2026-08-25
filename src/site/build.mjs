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
let bytesWritten = 0;
const put = async (path, html) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, html);
  bytesWritten += Buffer.byteLength(html);
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

function officePage({ lang, t, office, holdings, archive, link, generated }) {
  // Who was on the receiving end, with the position the lobbyist filed. A
  // person the resolver could not match to a sitting member is shown anyway
  // and labelled as unmatched — most of them are public servants, who are
  // correctly not members.
  const people = (office.people || []).map((p) => `<tr>
    <td>${link.person(office.office_key, p.name)
      ? `<a href="${link.person(office.office_key, p.name)}">${esc(p.name)}</a>`
      : esc(p.name)}${p.person_id ? '' : `<div class="note">${esc(t.unmatched_person)}</div>`}</td>
    <td>${esc(p.title || '—')}${p.other_titles > 0 ? `<div class="note">${esc(t.other_titles.replace('{n}', p.other_titles))}</div>` : ''}${p.branch ? `<div class="note">${esc(p.branch)}</div>` : ''}</td>
    <td class="n">${num(p.meetings, lang)}</td>
    <td class="n">${date(p.first_date)} – ${date(p.last_date)}</td>
    <td>${(p.top_clients || []).slice(0, 3).map((c) => `<div>${link.client(c.client)
      ? `<a href="${link.client(c.client)}">${esc(c.client)}</a>`
      : esc(c.client)} <span class="note">${num(c.n, lang)}</span></div>`).join('') || '—'}</td>
  </tr>`).join('\n');

  const clients = (office.top_clients || []).map((c) => `<tr>
    <td>${link.client(c.client) ? `<a href="${link.client(c.client)}">${esc(c.client)}</a>` : esc(c.client)}</td>
    <td class="n">${num(c.n, lang)}</td>
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

${(office.recent_meetings || []).length ? `<h2>${esc(t.meetings_title)}</h2>
<p class="note">${esc(t.meetings_note)}</p>
${meetingTable({ t, lang, rows: office.recent_meetings, link, id: 'recent' })}` : ''}
<p class="note"><a href="index.html">← ${esc(t.back)}</a></p>`,
  });
}

/**
 * One row of the meeting record, used by every table that lists meetings.
 * `link` turns names into links wherever a page for that name exists; a name
 * with no page stays plain text rather than becoming a dead link.
 */
function meetingRow({ t, m, link, showOffice = false }) {
  const client = link?.client(m.client);
  const officials = (m.officials || []).map((o) => {
    const href = link?.person(m.office_key, o.name);
    const name = href ? `<a href="${href}">${esc(o.name)}</a>` : esc(o.name);
    return `<div>${name}${o.title ? `<span class="note"> — ${esc(o.title)}</span>` : ''}</div>`;
  }).join('') || '—';
  const office = link?.office(m.office_key);
  // Written without indentation on purpose: at 700,000 rows across the site,
  // the whitespace in a pretty-printed row is measured in megabytes.
  // `crossed` marks a meeting the public could not see until after the bill
  // had already taken its next step. It is the whole point of the lag column.
  return `<tr><td class="n">${date(m.date)}</td><td class="n">${date(m.posted_date)}`
    + `${m.crossed ? ` <span class="flag" title="${esc(t.chart_hidden_short)}">▲</span>` : ''}</td>`
    + `<td>${client ? `<a href="${client}">${esc(m.client)}</a>` : esc(m.client || '—')}`
    + `${m.registrant ? `<div class="note">${esc(t.meeting_lobbyist)}: ${esc(m.registrant)}</div>` : ''}</td>`
    + `<td>${officials}</td>`
    + `${showOffice ? `<td>${office ? `<a href="${office}">${esc(m.office_label || m.office_key)}</a>` : esc(m.office_label || '—')}</td>` : ''}`
    + '</tr>';
}

/**
 * A table of meetings with a filter box and, when there is more than one page
 * of them, pagers above and below. Every list of meetings on the site is this
 * function, so the filter behaves the same everywhere.
 */
function meetingTable({ t, lang, rows, link, showOffice = false, id = 'meetings', pages = 1, page = 1, href = null, total = null, from = 0 }) {
  const nav = pages > 1 && href ? pager({ t, pages, current: page, href }) : '';
  const counted = total ?? rows.length;
  return `<p class="lede">${num(counted, lang)} ${esc(t.office_meetings)}${pages > 1
    ? ` · ${esc(t.page_of.replace('{page}', num(page, lang)).replace('{pages}', num(pages, lang)))} (${esc(t.showing_range
        .replace('{from}', num(from + 1, lang)).replace('{to}', num(from + rows.length, lang)))})`
    : ''}</p>
${filterBox({ t, targetId: id })}
${nav}
<table id="${id}">
  <thead>
    <tr><th class="n">${esc(t.bill_date)}</th><th class="n">${esc(t.chart_published)}</th>
        <th>${esc(t.meeting_who_asked)}</th><th>${esc(t.meeting_met)}</th>
        ${showOffice ? `<th>${esc(t.nav_offices)}</th>` : ''}</tr>
  </thead>
  <tbody>
    ${rows.map((m) => meetingRow({ t, m, link, showOffice })).join('')}
  </tbody>
</table>
${nav}`;
}

/** The organisations that filed the most meetings, ranked. */
function clientsIndex({ lang, t, clients, generated }) {
  const rows = (clients || []).map((c, i) => `<tr>
    <td class="n">${num(i + 1, lang)}</td>
    <td><a href="${esc(c.slug)}.html">${esc(c.client)}</a></td>
    <td class="n">${num(c.communications, lang)}</td>
    <td class="n">${date(c.first_date)} – ${date(c.last_date)}</td>
    <td>${(c.top_people || []).slice(0, 1).map((p) => `${esc(p.name)}<span class="note"> — ${esc(p.office_label || '')}</span>`).join('') || '—'}</td>
  </tr>`).join('\n');
  return layout({
    lang, t, generated, depth: 2, title: t.clients_title,
    body: `<h1>${esc(t.clients_title)}</h1>
<p class="lede">${esc(t.clients_intro)}</p>
<p class="note">${esc(UNTRANSLATED[lang])}</p>
${filterBox({ t, targetId: 'orgs' })}
<table id="orgs">
  <thead>
    <tr><th class="n">#</th><th>${esc(t.clients_title)}</th><th class="n">${esc(t.client_meetings_filed)}</th>
        <th class="n">${esc(t.office_period)}</th><th>${esc(t.client_who_they_meet)}</th></tr>
  </thead>
  <tbody>
  ${rows}
  </tbody>
</table>`,
  });
}

/** One organisation: who they see, where, and their whole meeting log. */
function clientPage({ lang, t, client, link, rows, page, pages, total, from, generated }) {
  const people = (client.top_people || []).map((p) => {
    const href = link.person(p.office_key, p.name);
    return `<tr>
    <td>${href ? `<a href="${href}">${esc(p.name)}</a>` : esc(p.name)}</td>
    <td>${esc(p.title || '—')}${p.other_titles > 0 ? `<div class="note">${esc(t.other_titles.replace('{n}', p.other_titles))}</div>` : ''}</td>
    <td>${p.office_key && link.office(p.office_key)
      ? `<a href="${link.office(p.office_key)}">${esc(p.office_label || p.office_key)}</a>`
      : esc(p.office_label || '—')}</td>
    <td class="n">${num(p.n, lang)}</td>
    <td class="n">${date(p.first_date)} – ${date(p.last_date)}</td>
  </tr>`;
  }).join('\n');

  const offices = (client.top_offices || []).map((o) => `<tr>
    <td>${link.office(o.office_key) ? `<a href="${link.office(o.office_key)}">${esc(o.label || o.office_key)}</a>` : esc(o.label || o.office_key)}</td>
    <td class="n">${num(o.n, lang)}</td>
  </tr>`).join('\n');

  const registrants = (client.top_registrants || []).map((r) => `<tr>
    <td>${esc(r.registrant)}</td><td class="n">${num(r.n, lang)}</td>
  </tr>`).join('\n');

  const href = (p2) => `${client.slug}${p2 > 1 ? `-p${p2}` : ''}.html`;
  return layout({
    lang, t, generated, depth: 2, title: client.client,
    body: `<h1>${esc(client.client)}</h1>
<p class="lede">${num(client.communications, lang)} ${esc(t.office_meetings)} · ${date(client.first_date)} – ${date(client.last_date)}</p>
${page > 1 ? `<p class="note"><a href="${esc(client.slug)}.html">← ${esc(client.client)}</a></p>` : ''}

${page === 1 ? `${people ? `<h2>${esc(t.client_who_they_meet)}</h2>
<p class="note">${esc(t.client_who_note)}</p>
<table>
  <thead><tr><th>${esc(t.people_person)}</th><th>${esc(t.people_position)}</th><th>${esc(t.nav_offices)}</th>
      <th class="n">${esc(t.people_meetings)}</th><th class="n">${esc(t.people_active)}</th></tr></thead>
  <tbody>${people}</tbody>
</table>` : ''}

${offices ? `<h2>${esc(t.client_offices)}</h2>
<p class="note">${esc(t.client_offices_note)}</p>
<table>
  <thead><tr><th>${esc(t.nav_offices)}</th><th class="n">${esc(t.office_meetings)}</th></tr></thead>
  <tbody>${offices}</tbody>
</table>` : ''}

${registrants ? `<h2>${esc(t.client_registrants)}</h2>
<table>
  <thead><tr><th>${esc(t.client_registrants)}</th><th class="n">${esc(t.office_meetings)}</th></tr></thead>
  <tbody>${registrants}</tbody>
</table>` : ''}` : ''}

${rows ? `<h2>${esc(t.client_log)}</h2>
${meetingTable({ t, lang, rows, link, showOffice: true, id: 'log', pages, page, href, total, from })}`
  : `<p class="note">${esc(t.client_no_archive)}</p>`}

<p class="note"><a href="index.html">← ${esc(t.clients_title)}</a></p>`,
  });
}

/** One person, at one office: their whole logged meeting record. */
function personPage({ lang, t, person, link, rows, page, pages, total, from, generated }) {
  const href = (p2) => `${person.slug}${p2 > 1 ? `-p${p2}` : ''}.html`;
  const titles = person.titles.map(([title, n]) => `<tr><td>${esc(title || '—')}</td><td class="n">${num(n, lang)}</td></tr>`).join('\n');
  const clients = person.clients.map(([c, n]) => `<tr>
    <td>${link.client(c) ? `<a href="${link.client(c)}">${esc(c)}</a>` : esc(c)}</td>
    <td class="n">${num(n, lang)}</td></tr>`).join('\n');
  return layout({
    lang, t, generated, depth: 2, title: `${person.name} — ${person.office_label}`,
    body: `<h1>${esc(person.name)}</h1>
<p class="lede">${esc(t.person_at)} <a href="${esc(link.office(person.office_key) || '#')}">${esc(person.office_label)}</a>
 · ${num(person.total, lang)} ${esc(t.office_meetings)} · ${date(person.first_date)} – ${date(person.last_date)}</p>
<p class="note">${esc(t.person_note)}</p>
${page > 1 ? `<p class="note"><a href="${esc(person.slug)}.html">← ${esc(person.name)}</a></p>` : ''}

${page === 1 ? `<h2>${esc(t.person_titles)}</h2>
<table>
  <thead><tr><th>${esc(t.people_position)}</th><th class="n">${esc(t.office_meetings)}</th></tr></thead>
  <tbody>${titles}</tbody>
</table>

<h2>${esc(t.person_asked_by)}</h2>
<table>
  <thead><tr><th>${esc(t.meeting_who_asked)}</th><th class="n">${esc(t.office_meetings)}</th></tr></thead>
  <tbody>${clients}</tbody>
</table>` : ''}

<h2>${esc(t.person_log)}</h2>
${meetingTable({ t, lang, rows, link, id: 'log', pages, page, href, total, from })}
<p class="note"><a href="${esc(link.office(person.office_key) || 'index.html')}">← ${esc(person.office_label)}</a></p>`,
  });
}

/**
 * One page of an office's meeting archive: a single year, cut into pages.
 * Year first because that is the filter people actually want, and because it
 * keeps each file small enough to open on a phone.
 */
function officeMeetingsPage({ lang, t, office, year, years, rows, page, pages, total, from, link, generated }) {
  const href = (p) => `${slug(office.office_key)}--${year}${p > 1 ? `-p${p}` : ''}.html`;
  const yearNav = `<ul class="years">${years.map((y) => (String(y) === String(year)
    ? `<li><strong>${esc(y)}</strong></li>`
    : `<li><a href="${slug(office.office_key)}--${y}.html">${esc(y)}</a></li>`)).join('')}</ul>`;

  return layout({
    lang, t, generated, depth: 2, title: `${office.label} — ${year}`,
    body: `<h1>${esc(office.label)}</h1>
<p class="note"><a href="${slug(office.office_key)}.html">← ${esc(office.label)}</a></p>

<h2>${esc(t.browse_by_year)}</h2>
${yearNav}

<h2>${esc(t.all_meetings)} · ${esc(year)}</h2>
${meetingTable({ t, lang, rows, link, id: 'meetings', pages, page, href, total, from })}`,
  });
}

/** parl.ca's own page for the bill — the place to actually read it. */
function legisinfoUrl(billId, lang) {
  const [session, number] = String(billId).split('/');
  if (!session || !number) return null;
  return `https://www.parl.ca/legisinfo/${lang === 'fr' ? 'fr' : 'en'}/bill/${session}/${String(number).toLowerCase()}`;
}

/** The one-paragraph answer to 'what is this bill', built only from fields. */
function billSummary({ lang, t, bill }) {
  const title = (lang === 'fr' ? bill.long_title_fr || bill.short_title_fr : null)
    || bill.long_title || bill.short_title || null;
  const kind = lang === 'fr' ? bill.bill_type_fr || bill.bill_type : bill.bill_type;
  const status = lang === 'fr' ? bill.status_fr || bill.status : bill.status;
  const bits = [];
  if (kind) bits.push(esc(kind));
  else if (bill.is_government === true) bits.push(esc(t.bill_government));
  else if (bill.is_government === false) bits.push(esc(t.bill_private));
  if (bill.parliament) bits.push(`${esc(String(bill.parliament))}-${esc(String(bill.session ?? ''))}`);
  if (bill.sponsor) bits.push(`${esc(t.bill_sponsor)} ${esc(bill.sponsor)}${bill.sponsor_title ? ` <span class="note">(${esc(bill.sponsor_title)})</span>` : ''}`);

  const outcome = bill.became_law
    ? `${esc(t.bill_became_law)}${bill.royal_assent_date ? ` ${date(bill.royal_assent_date)}` : ''}`
    : (status ? esc(status) : esc(t.bill_still_going));

  return `${title ? `<p class="lede">${esc(title)}</p>` : ''}
<div class="explainer">
  <h2>${esc(t.bill_summary)}</h2>
  <p>${bits.join(' · ')}</p>
  <p>${bill.first_event_date ? `${esc(t.bill_introduced)} ${date(bill.first_event_date)} · ` : ''}${outcome}</p>
  ${legisinfoUrl(bill.bill_id, lang) ? `<p><a href="${esc(legisinfoUrl(bill.bill_id, lang))}">${esc(t.bill_read_it)} →</a></p>` : ''}
</div>`;
}

function billsIndex({ lang, t, timelines, citations, generated }) {
  if (!timelines?.length) {
    return layout({ lang, t, generated, depth: 2, title: t.bills_title,
      body: `<h1>${esc(t.bills_title)}</h1><p class="lede">${esc(t.no_bills)}</p>` });
  }
  // Ordered in time. 'Most lobbied' was the old order, and it buried whatever
  // Parliament is doing right now under whatever it did in 2013.
  const sorted = [...timelines].sort((a, b) => String(b.last_event_date || b.first_event_date || '')
    .localeCompare(String(a.last_event_date || a.first_event_date || '')));
  const rows = sorted.map((b) => `<tr>
    <td><a href="${slug(b.bill_id)}.html">${esc(b.number)}</a></td>
    <td>${esc(b.short_title || b.long_title || '—')}</td>
    <td class="n">${esc(String(b.bill_id).split('/')[0])}</td>
    <td class="n">${date(b.last_event_date)}</td>
    <td>${b.became_law ? esc(t.bill_became_law) : esc((lang === 'fr' ? b.status_fr : b.status) || t.bill_still_going)}</td>
    <td class="n">${num(b.total_linked_communications, lang)}</td>
  </tr>`).join('\n');
  return layout({
    lang, t, generated, depth: 2, title: t.bills_title,
    body: `<h1>${esc(t.bills_title)}</h1>
<p class="lede">${esc(t.bills_intro)}</p>
<p class="note">${esc(t.bills_sorted)}</p>
${citations ? `<p class="note">${num(citations.links, lang)} · ${num(citations.distinct_bills, lang)}</p>` : ''}
${filterBox({ t, targetId: 'bills' })}
<table id="bills">
  <thead>
    <tr><th>${esc(t.bill_number)}</th><th>${esc(t.bill_title)}</th><th class="n">${esc(t.bill_session)}</th>
        <th class="n">${esc(t.bill_last_step)}</th><th>${esc(t.bill_status)}</th>
        <th class="n">${esc(t.office_meetings)}</th></tr>
  </thead>
  <tbody>
  ${rows}
  </tbody>
</table>`,
  });
}

function billPage({ lang, t, bill, links = [], areas = [], link, generated }) {
  const stages = bill.stages || [];
  // Every meeting, newest first — not a sample. The record is the point. The
  // rows are mapped into the shape every other meeting table on the site uses,
  // so the filter and the links behave identically here.
  const rows = [...links]
    .sort((a, b) => String(b.comm_date).localeCompare(String(a.comm_date)))
    .map((l) => ({
      date: l.comm_date,
      posted_date: l.posted_date,
      client: l.client_name,
      registrant: l.registrant_name,
      office_key: null,
      officials: (l.officials?.length ? l.officials : [{ name: l.official_label, title: null }])
        .filter((o) => o.name),
      crossed: stageReachedWhileUnpublished(l, stages),
    }));

  const stageBlocks = stages.map((s) => `<div class="stage${s.communications ? ' busy' : ''}">
  <h3>${esc(stageName(s.stage, lang))} — ${date(s.event_date)}</h3>
  <p class="note">${esc(t.bill_window.replace('{days}', num(s.window_days, lang)))}:
     ${num(s.communications, lang)} ${esc(t.office_meetings)}${s.median_filing_lag_days != null ? ` · ${esc(t.office_lag)} ${num(s.median_filing_lag_days, lang)} ${esc(t.days)}` : ''}</p>
  ${s.clients?.length ? `<table>
    <tr><th>${esc(t.bill_clients)}</th><th class="n">${esc(t.office_meetings)}</th></tr>
    ${s.clients.slice(0, 10).map((c) => `<tr>
      <td>${link?.client(c.client) ? `<a href="${link.client(c.client)}">${esc(c.client)}</a>` : esc(c.client)}${c.officials?.length ? `<div class="note">${esc(t.bill_officials)}: ${esc(c.officials.slice(0, 4).join('; '))}</div>` : ''}</td>
      <td class="n">${num(c.count, lang)}</td>
    </tr>`).join('\n')}
  </table>` : ''}
</div>`).join('\n');

  const areaRows = (areas || []).map((a) => `<tr>
    <td>${esc(lang === 'fr' ? a.fr : a.en)}</td><td class="n">${num(a.n, lang)}</td>
  </tr>`).join('\n');

  return layout({
    lang, t, generated, depth: 2, title: `${bill.number} ${bill.short_title || ''}`.trim(),
    body: `<h1>${esc(bill.number)}</h1>
${billSummary({ lang, t, bill })}

<div class="explainer">
  <h2>${esc(t.bill_why_here)}</h2>
  <p>${esc(t.bill_why_note
      .replace('{meetings}', num(bill.total_linked_communications, lang))
      .replace('{orgs}', num(bill.distinct_clients ?? 0, lang)))}</p>
</div>

${areaRows ? `<h2>${esc(t.bill_areas)}</h2>
<p class="note">${esc(t.bill_areas_note)}</p>
<table>
  <thead><tr><th>${esc(t.bill_areas)}</th><th class="n">${esc(t.office_meetings)}</th></tr></thead>
  <tbody>${areaRows}</tbody>
</table>` : ''}

${meetingsOverTime({ links, stages, t, lang })}

${stageBlocks || `<p class="note">—</p>`}

${rows.length ? `<h2>${esc(t.bill_all_meetings)}</h2>
<p class="note">${esc(t.meeting_all)} ${esc(UNTRANSLATED[lang])}</p>
${meetingTable({ t, lang, rows, link, id: 'billmeetings' })}` : ''}
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

export async function buildSite({ dataDir = 'data/out', outDir = 'site', maxOffices = 150, perPage = 500,
  peoplePerOffice = 10, minPersonMeetings = 25 } = {}) {
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
  const billAreas = await read(dataDir, 'bill-areas.json');
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

  // The organisations doing the asking, and their meeting logs.
  const clients = (await read(dataDir, 'client-access.json')) || [];
  const clientArchiveIndex = await read(dataDir, 'client-archive-index.json');
  const clientLogs = new Map();
  for (const entry of clientArchiveIndex?.clients || []) {
    const file = await read(`${dataDir}/client-meetings`, `${entry.slug}.json`);
    if (file?.meetings?.length) clientLogs.set(entry.client, file.meetings);
  }

  // People, derived from the office archives rather than stored again: a
  // person page is one office's meetings filtered to one name. Keyed by office
  // because the record carries no identifier for public servants — 'this name,
  // at this office' is the most the filings support.
  const people = new Map();          // `${officeSlug}--who--${nameSlug}` -> person
  for (const [officeKey, archive] of archives) {
    const byName = new Map();
    for (const year of archive.years) {
      for (const m of archive.byYear.get(year)) {
        for (const o of m.officials || []) {
          if (!o.name) continue;
          if (!byName.has(o.name)) byName.set(o.name, []);
          byName.get(o.name).push({ ...m, office_key: officeKey });
        }
      }
    }
    const label = offices.find((o) => o.office_key === officeKey)?.label || officeKey;
    const ranked = [...byName.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, peoplePerOffice);
    for (const [name, meetings] of ranked) {
      if (meetings.length < minPersonMeetings) continue;
      const titles = new Map();
      const clientCounts = new Map();
      let first = null; let last = null;
      for (const m of meetings) {
        for (const o of m.officials || []) if (o.name === name) titles.set(o.title || '', (titles.get(o.title || '') || 0) + 1);
        if (m.client) clientCounts.set(m.client, (clientCounts.get(m.client) || 0) + 1);
        if (m.date) {
          if (!first || m.date < first) first = m.date;
          if (!last || m.date > last) last = m.date;
        }
      }
      const id = `${slug(officeKey)}--who--${slug(name)}`;
      people.set(id, {
        slug: id,
        name,
        office_key: officeKey,
        office_label: label,
        total: meetings.length,
        first_date: first,
        last_date: last,
        titles: [...titles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
        clients: [...clientCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
        meetings: meetings.sort((a, b) => String(b.date).localeCompare(String(a.date))),
      });
    }
  }

  bytesWritten = 0;
  const shown = offices.slice(0, maxOffices);
  const shownOffices = new Set(shown.map((o) => o.office_key));
  const clientSlug = new Map(clients.map((c) => [c.client, c.slug]));

  // Every internal link on the site goes through here, and returns null when
  // the page does not exist. A dead link on a site about public records is a
  // small dishonesty; the test suite walks every href on disk to keep it so.
  // Paths are relative to a page one directory below the language root, which
  // is where offices, clients and bills all live.
  const linksFrom = (dir) => {
    const to = (d, file) => (d === dir ? file : `../${d}/${file}`);
    return {
      client: (name) => (name && clientSlug.has(name) ? to('clients', `${clientSlug.get(name)}.html`) : null),
      office: (key) => (key && shownOffices.has(key) ? to('offices', `${slug(key)}.html`) : null),
      person: (officeKey, name) => {
        if (!officeKey || !name) return null;
        const id = `${slug(officeKey)}--who--${slug(name)}`;
        return people.has(id) ? to('offices', `${id}.html`) : null;
      },
    };
  };
  const fromOffices = linksFrom('offices');
  const fromClients = linksFrom('clients');
  const fromBills = linksFrom('bills');

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
        officePage({ lang, t, office, holdings, archive, link: fromOffices, generated }));
      pages++;

      // Year pages, each cut into pages of `perPage`.
      for (const year of archive?.years || []) {
        const all = archive.byYear.get(year);
        const total = Math.max(Math.ceil(all.length / perPage), 1);
        for (let p = 1; p <= total; p++) {
          const rows = all.slice((p - 1) * perPage, p * perPage);
          await put(`${outDir}/${lang}/offices/${slug(office.office_key)}--${year}${p > 1 ? `-p${p}` : ''}.html`,
            officeMeetingsPage({ lang, t, office, year, years: archive.years, rows, page: p,
              pages: total, total: all.length, from: (p - 1) * perPage, link: fromOffices, generated }));
          pages++;
        }
      }
    }

    // One page per person, at the offices whose archive we hold.
    for (const person of people.values()) {
      const total = Math.max(Math.ceil(person.meetings.length / perPage), 1);
      for (let p = 1; p <= total; p++) {
        const rows = person.meetings.slice((p - 1) * perPage, p * perPage);
        await put(`${outDir}/${lang}/offices/${person.slug}${p > 1 ? `-p${p}` : ''}.html`,
          personPage({ lang, t, person, link: fromOffices, rows, page: p, pages: total,
            total: person.meetings.length, from: (p - 1) * perPage, generated }));
        pages++;
      }
    }

    // The organisations doing the asking.
    await put(`${outDir}/${lang}/clients/index.html`, clientsIndex({ lang, t, clients, generated }));
    pages++;
    for (const client of clients) {
      const log = clientLogs.get(client.client) || null;
      const total = log ? Math.max(Math.ceil(log.length / perPage), 1) : 1;
      for (let p = 1; p <= total; p++) {
        const rows = log ? log.slice((p - 1) * perPage, p * perPage) : null;
        await put(`${outDir}/${lang}/clients/${client.slug}${p > 1 ? `-p${p}` : ''}.html`,
          clientPage({ lang, t, client, link: fromClients, rows, page: p, pages: total,
            total: log?.length ?? 0, from: (p - 1) * perPage, generated }));
        pages++;
      }
    }

    await put(`${outDir}/${lang}/bills/index.html`, billsIndex({ lang, t, timelines, citations, generated }));
    pages++;
    for (const bill of timelines) {
      await put(`${outDir}/${lang}/bills/${slug(bill.bill_id)}.html`,
        billPage({ lang, t, bill, links: linksByBill.get(bill.bill_id) || [],
          areas: billAreas?.[bill.bill_id] || [], link: fromBills, generated }));
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

  return { pages, offices: shown.length, clients: clients.length, people: people.size,
    bills: timelines.length, megabytes: Math.round(bytesWritten / 1e6), generated };
}
