#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { COMMUNICATION_COLUMNS, DPOH_COLUMNS, COMM_SUBJECT_DETAIL_COLUMNS, COMM_SUBJECT_CODE_COLUMNS,
  SUBJECT_CODE_LOOKUP_COLUMNS, SESSIONS } from './config/sources.mjs';
import { probeColumns, ingestCsv, isoDate, normalizeDpohRows } from './fetch/ingest-lobbying.mjs';
import { fetchMembers } from './fetch/fetch-members.mjs';
import { fetchBills } from './fetch/fetch-bills.mjs';
import { fetchLobbyingBulk } from './fetch/fetch-lobbying.mjs';
import { buildPersonIndex, resolveDpoh, summarize } from './match/resolve.mjs';
import { normalizeName as normalizeNameFor } from './normalize/names.mjs';
import { validateHoldings, buildOfficeIndex, summarizeOffices, EMPTY_OFFICE_INDEX } from './match/office.mjs';
import { deriveOfficeHoldings } from './match/derive-offices.mjs';
import { buildBillTimeline } from './match/timeline.mjs';
import { linkSubjectToBills } from './match/bill-refs.mjs';
import { dpohComposition, citationRate, citationRateByCommunication, filingLag, dpohRowShape } from './match/stats.mjs';

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const OUT = 'data/out';
const OFFICE_ROSTER = 'data/overrides/office-holders.json';

// Loads the hand-curated office roster. A missing or empty file is a supported
// state: role rows then report 'unmatched' and nothing is claimed about them.
const DERIVED_OFFICES = 'data/out/derived-offices.json';

async function loadOffices(path = OFFICE_ROSTER, { strict = false, derived = DERIVED_OFFICES } = {}) {
  let raw;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    if (strict) throw e;
    raw = { holdings: [], aliases: {} };
  }
  // Curated rows first: a real appointment date replaces an observed window
  // rather than competing with it, so any office a human has transcribed is
  // taken from the roster and its derived twin is dropped.
  let derivedHoldings = [];
  if (derived) {
    try {
      derivedHoldings = JSON.parse(await readFile(derived, 'utf8')).holdings || [];
    } catch { /* none derived yet */ }
  }
  const curatedKeys = new Set((raw.holdings || []).map((h) => `${h.title}`.toLowerCase()));
  const merged = [...(raw.holdings || []), ...derivedHoldings.filter((h) => !curatedKeys.has(`${h.title}`.toLowerCase()))];

  const { holdings, errors, overlaps } = validateHoldings(merged, raw.aliases || {});
  return {
    index: buildOfficeIndex(holdings, raw.aliases || {}),
    holdings, errors, overlaps,
    counts: { curated: (raw.holdings || []).length, derived: merged.length - (raw.holdings || []).length },
  };
}
// Which file is which was settled by `fetch-lobbying`, by reading headers.
// Every later command reuses that answer instead of guessing at filenames.
const identifiedFiles = async () => {
  try {
    return JSON.parse(await readFile(`${OUT}/download-manifest.json`, 'utf8')).identified || {};
  } catch { return {}; }
};
const write = async (name, obj) => {
  // mkdir on the file's own directory, not just OUT: `office-meetings/x.json`
  // used to throw ENOENT here, and because the pipeline runs this step with
  // continue-on-error the run went green while writing no report at all.
  await mkdir(dirname(`${OUT}/${name}`), { recursive: true });
  await writeFile(`${OUT}/${name}`, JSON.stringify(obj, null, 2));
  console.log(`wrote ${OUT}/${name}`);
};

switch (cmd) {
  case 'probe': {
    const comms = flag('comms', 'data/raw/communications.csv');
    const dpoh = flag('dpoh', 'data/raw/communication_dpoh.csv');
    for (const [path, spec, label] of [[comms, COMMUNICATION_COLUMNS, 'communications'], [dpoh, DPOH_COLUMNS, 'dpoh']]) {
      try {
        const r = await probeColumns(path, spec);
        console.log(`\n== ${label} (${path})`);
        console.log('   headers:', r.headers.join(' | '));
        console.log('   mapped :', JSON.stringify(r.mapping, null, 2).replace(/\n/g, '\n   '));
        console.log(`   encoding: ${r.encoding}`);
        console.log(r.missing.length ? `   MISSING: ${r.missing.join(', ')}` : '   all expected columns found');
      } catch (e) { console.log(`\n== ${label} (${path})\n   ${e.message}`); }
    }
    break;
  }
  case 'fetch-lobbying': {
    // Downloads the OCL bulk files through the Open Government catalogue.
    // Prints every resource the catalogue offers, so a wrong pick is visible
    // before any number is computed on the wrong file.
    const dir = flag('dir', 'data/raw');
    const overrides = {};
    if (process.env.OCL_ZIP_URL) overrides.communications = process.env.OCL_ZIP_URL;
    if (process.env.OCL_DICTIONARY_URL) overrides.dictionary = process.env.OCL_DICTIONARY_URL;
    const { picked, downloaded, failures, identified, contents, dataset_title, modified } = await fetchLobbyingBulk({ dir, overrides });
    console.log(`\n== ${dataset_title || 'dataset'} (catalogue updated ${modified || 'unknown'})`);
    console.log('   resources offered:');
    for (const r of picked.all) console.log(`      [${String(r.format).padEnd(5)}] ${r.name}`);
    for (const [key, got] of Object.entries(downloaded)) {
      console.log(`   ${key}: ${got.name} -> ${got.files.join(', ') || got.path} (${(got.bytes / 1e6).toFixed(1)} MB)`);
    }
    for (const f of failures) {
      console.log(`   FAILED  ${f.key}: ${f.error}`);
      for (const t of f.transports || []) console.log(`             ${t.transport.padEnd(16)} ${t.status ?? t.error}`);
    }
    if (contents.length) {
      console.log('   archive contents, identified by their headers:');
      for (const c of contents) console.log(`      ${c.kind || '(unrecognized)'}  ${c.file}\n         ${c.headers.join(' | ')}`);
    }
    for (const key of ['communications', 'dpoh']) {
      if (!identified[key]) console.log(`   NOT FOUND: nothing in the download looks like the '${key}' file.`);
    }
    await write('download-manifest.json', { dataset_title, modified, picked: picked.all, downloaded, failures, identified, contents });
    // A missing primary file is fatal to every number downstream, so it fails
    // the step — but only after the full picture has been printed.
    if (!identified.communications || !identified.dpoh) process.exitCode = 1;
    break;
  }
  case 'probe-members': {
    // Which roster endpoint actually knows about members who left mid-term?
    // Rather than assert who those are, this asks the lobbying data: take the
    // surnames that failed to resolve on rows whose title says 'MP', and see
    // which candidate roster contains them.
    const parliament = Number(flag('parliament', '42'));
    const { SOURCES } = await import('./config/sources.mjs');
    const { parseMembersXml } = await import('./fetch/fetch-members.mjs');
    const { fetchText } = await import('./lib/http.mjs');

    let wanted = [];
    try {
      const report = JSON.parse(await readFile(`${OUT}/resolution-report.json`, 'utf8'));
      wanted = (report.top_problem_strings || []).map((t) => t.raw.split(',')[0].trim()).filter(Boolean);
    } catch { /* no report yet */ }
    console.log(`\n== roster candidates for parliament ${parliament}`);
    console.log(`   checking for ${wanted.length} surnames that failed to resolve: ${wanted.slice(0, 8).join(', ')}`);

    for (const c of SOURCES.members.candidates(parliament)) {
      try {
        const xml = await fetchText(c.url, { cachePath: null });
        const { persons } = parseMembersXml(xml, parliament);
        const surnames = new Set(persons.map((p) => normalizeNameFor(p.surname)));
        const found = wanted.filter((w) => surnames.has(normalizeNameFor(w)));
        console.log(`   ${String(persons.length).padStart(5)} members  ${found.length}/${wanted.length} of the missing surnames  ${c.label}`);
      } catch (err) {
        console.log(`   FAILED  ${c.label}: ${err.message}`);
      }
    }
    break;
  }
  case 'fetch-members': {
    // The lobbying file spans 2008 to today, so resolving against one
    // Parliament's roster leaves seventeen years of communications with nobody
    // to match — they come back 'unresolved' and look like a matching failure
    // when they are really a missing roster. Fetch every Parliament the data
    // covers and let the temporal filter do its job.
    const list = (flag('parliaments', null) || flag('parliament', '45'))
      .split(/[,\s]+/).filter(Boolean).map(Number);

    const persons = new Map();
    const terms = [];
    const seenRosters = new Map();
    for (const parliament of list) {
      const r = await fetchMembers(parliament);
      await write(`members-${parliament}.json`, r);
      console.log(`   parliament ${parliament}: ${r.persons.length} persons, ${r.terms.length} terms`);

      // If two Parliaments come back with an identical roster, the endpoint is
      // ignoring the parameter and every 'historical' answer would be today's
      // House wearing a different date. Say so rather than publishing it.
      const fingerprint = r.persons.map((p) => p.person_id).sort().join('|');
      if (seenRosters.has(fingerprint)) {
        console.log(`   WARNING: parliament ${parliament} returned the same roster as ${seenRosters.get(fingerprint)} — the source may be ignoring the parliament parameter.`);
      } else {
        seenRosters.set(fingerprint, parliament);
      }
      for (const p of r.persons) persons.set(p.person_id, p);
      terms.push(...r.terms);
    }
    await write('members-all.json', { persons: [...persons.values()], terms });
    console.log(`${persons.size} distinct persons, ${terms.length} terms across ${list.length} parliament(s)`);
    break;
  }
  case 'fetch-bills': {
    // The lobbying record spans seven Parliaments, and a bill number means a
    // different bill in each session, so citations can only be scoped if every
    // session the data covers is loaded.
    const sessions = (flag('sessions', null) || flag('session', '45-1')).split(/[,\s]+/).filter(Boolean);
    const allBills = [];
    const allEvents = [];
    const ranges = [];
    let shape = null;

    for (const ps of sessions) {
      let r;
      try {
        r = await fetchBills(ps);
      } catch (err) {
        console.log(`   session ${ps}: FAILED ${err.message}`);
        continue;
      }
      await write(`bills-${ps}.json`, { bills: r.bills, events: r.events });
      console.log(`   session ${ps}: ${r.bills.length} bills, ${r.events.length} stage events`);
      shape = shape || (r.events.length ? null : r.shape);
      allBills.push(...r.bills);
      allEvents.push(...r.events);

      const [parliament, session] = ps.split('-').map(Number);
      const configured = SESSIONS.find((x) => x.parliament === parliament && x.session === session);
      const dates = r.events.map((e) => e.event_date).sort();
      ranges.push({
        parliament, session,
        start_date: configured?.start_date || dates[0] || null,
        end_date: configured?.end_date ?? dates[dates.length - 1] ?? null,
        // Says which dates are real and which were inferred from bill activity.
        dates_from: configured ? 'config' : 'derived-from-bill-events',
      });
    }

    // Contiguous, non-overlapping ranges: a derived range starts where the
    // previous session ends, because a session's first bill event is later
    // than the session itself began, and a citation near a boundary must not
    // land in two sessions at once.
    ranges.sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i - 1].end_date && ranges[i].start_date && ranges[i - 1].end_date >= ranges[i].start_date) {
        ranges[i - 1].end_date = ranges[i].start_date;
        ranges[i - 1].end_adjusted = true;
      }
    }

    await write('bills-all.json', { bills: allBills, events: allEvents, sessions: ranges });
    const bills = allBills;
    const events = allEvents;
    console.log(`${bills.length} bills, ${events.length} stage events across ${ranges.length} session(s)`);
    if (!events.length && shape) {
      // Do not let this pass quietly: a timeline with no stage dates is not a
      // timeline. Dump what LEGISinfo actually published so the extractor can
      // be fixed against the real shape rather than a guess.
      await write(`legisinfo-shape-${ps}.json`, shape);
      console.log('   NO STAGE EVENTS — see data/out/legisinfo-shape-' + ps + '.json for the published shape.');
      console.log('   top-level keys: ' + Object.keys(shape).join(', '));
    }
    break;
  }
  case 'resolve': {
    const identified = await identifiedFiles();
    // Prefer the merged roster; a single-Parliament file only ever covers a
    // slice of the lobbying record.
    const membersPath = flag('members', null)
      || (await readFile(`${OUT}/members-all.json`, 'utf8').then(() => `${OUT}/members-all.json`).catch(() => `${OUT}/members-45.json`));
    const dpohPath = flag('dpoh', null) || identified.dpoh || 'data/raw/communication_dpoh.csv';
    const commsPath = flag('comms', null) || identified.communications || 'data/raw/communications.csv';

    const { terms } = JSON.parse(await readFile(membersPath, 'utf8'));
    const overrides = JSON.parse(await readFile('data/overrides/dpoh-aliases.json', 'utf8')).aliases || {};
    const index = buildPersonIndex(terms);
    const { index: offices, errors: officeErrors, overlaps } = await loadOffices(flag('roster', OFFICE_ROSTER));
    for (const e of [...officeErrors, ...overlaps]) console.log(`office roster: ${e}`);

    const { rows: commRows } = await ingestCsv(commsPath, COMMUNICATION_COLUMNS);
    const dateById = new Map(commRows.map((r) => [r.communication_id, isoDate(r.comm_date)]));
    const commById = new Map(commRows.map((r) => [r.communication_id, r]));
    const { rows: dpohRaw } = await ingestCsv(dpohPath, DPOH_COLUMNS);
    const dpohRows = normalizeDpohRows(dpohRaw);

    const results = dpohRows.map((r) =>
      resolveDpoh(r.dpoh_raw, dateById.get(r.communication_id) || null, index, { institution: r.institution || '', title: r.dpoh_title_raw || '', overrides, offices }));

    // Per-office aggregates for the site. Built here because this is the only
    // place the DPOH rows, the resolver's answer and the communication's client
    // and dates are all in memory at once.
    const officeAgg = new Map();
    results.forEach((res, i) => {
      const key = res.office_key;
      if (!key) return;
      const commId = dpohRows[i].communication_id;
      const comm = commById.get(commId);
      if (!officeAgg.has(key)) {
        officeAgg.set(key, {
          office_key: key,
          // The label is the office's own name as the filings write it, not a
          // holder's job title: a minister whose institution is recorded as
          // 'House of Commons' must not relabel the House as their portfolio.
          labels: new Map(),
          rows: 0,
          communications: new Set(),
          clients: new Map(),
          people: new Map(),
          meetings: new Map(),
          years: new Map(),
          first_date: null,
          last_date: null,
          lags: [],
        });
      }
      const o = officeAgg.get(key);
      const row = dpohRows[i];
      const label = row.institution || res.office_title || key;
      o.labels.set(label, (o.labels.get(label) || 0) + 1);
      o.rows++;

      // The people named at this office, with the position as filed. An
      // office page that lists only the lobbying side answers half the
      // question: who at the office was being met matters as much as who was
      // asking.
      const who = row.dpoh_raw && row.dpoh_raw.trim();
      if (who) {
        const pk = who;
        if (!o.people.has(pk)) {
          o.people.set(pk, {
            name: who,
            titles: new Map(),
            title: row.dpoh_title_raw || null,
            branch: row.branch || null,
            person_id: res.person_id || null,
            status: res.status,
            meetings: 0,
            clients: new Map(),
            first_date: null,
            last_date: null,
          });
        }
        const person = o.people.get(pk);
        person.meetings++;
        const rawTitle = row.dpoh_title_raw || '';
        person.titles.set(rawTitle, (person.titles.get(rawTitle) || 0) + 1);
        if (!person.person_id && res.person_id) person.person_id = res.person_id;
        const cname = commById.get(dpohRows[i].communication_id)?.client_name;
        if (cname) person.clients.set(cname, (person.clients.get(cname) || 0) + 1);
        const pd = dateById.get(dpohRows[i].communication_id);
        if (pd) {
          if (!person.first_date || pd < person.first_date) person.first_date = pd;
          if (!person.last_date || pd > person.last_date) person.last_date = pd;
        }
      }

      // One entry per communication, carrying everyone named on it.
      if (!o.meetings.has(commId)) {
        const c = commById.get(commId);
        o.meetings.set(commId, {
          communication_id: commId,
          date: dateById.get(commId) || null,
          posted_date: isoDate(c?.posted_date),
          client: c?.client_name || null,
          registrant: [c?.registrant_surname, c?.registrant_given].filter(Boolean).join(', ') || null,
          officials: [],
        });
      }
      if (who) {
        o.meetings.get(commId).officials.push({
          name: who, title: row.dpoh_title_raw || null, branch: row.branch || null,
        });
      }
      o.communications.add(commId);
      const client = comm?.client_name || null;
      if (client) o.clients.set(client, (o.clients.get(client) || 0) + 1);
      if (res.person_id) o.people.set(res.person_id, (o.people.get(res.person_id) || 0) + 1);
      const d = dateById.get(commId);
      if (d) {
        const year = d.slice(0, 4);
        o.years.set(year, (o.years.get(year) || 0) + 1);
        if (!o.first_date || d < o.first_date) o.first_date = d;
        if (!o.last_date || d > o.last_date) o.last_date = d;
        const posted = isoDate(comm?.posted_date);
        if (posted) {
          const lag = Math.round((Date.parse(posted) - Date.parse(d)) / 86400000);
          if (lag >= 0) o.lags.push(lag);
        }
      }
    });
    const medianOf = (xs) => {
      if (!xs.length) return null;
      const s2 = [...xs].sort((a, b) => a - b);
      return s2[Math.floor(s2.length / 2)];
    };
    const officeAccess = [...officeAgg.values()]
      .map((o) => ({
        office_key: o.office_key,
        label: [...o.labels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || o.office_key,
        rows: o.rows,
        communications: o.communications.size,
        first_date: o.first_date,
        last_date: o.last_date,
        median_filing_lag_days: medianOf(o.lags),
        by_year: Object.fromEntries([...o.years.entries()].sort()),
        top_clients: [...o.clients.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([client, n]) => ({ client, n })),
        people: [...o.people.values()]
          .sort((a, b) => b.meetings - a.meetings)
          .slice(0, 40)
          .map((pp) => ({
            ...pp,
            clients: undefined,
            titles: undefined,
            title: [...pp.titles.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
            other_titles: pp.titles.size - 1,
            top_clients: [...pp.clients.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([client, n]) => ({ client, n })),
          })),
        recent_meetings: [...o.meetings.values()]
          .sort((a, b) => String(b.date).localeCompare(String(a.date)))
          .slice(0, 80),
      }))
      .sort((a, b) => b.communications - a.communications);
    // Detail is written only for the offices the site renders; the long tail
    // keeps its counts without carrying eighty meetings each.
    await write('office-access.json', officeAccess.slice(0, 300).map((o, i) => (i < 150 ? o
      : { ...o, people: o.people.slice(0, 10), recent_meetings: [] })));

    // The full archive, one file per office, for the offices that hold most of
    // the record. 581,694 rows cannot all become HTML — the top 50 offices are
    // 87% of every meeting, and the site says plainly where the line is drawn.
    const ARCHIVE_OFFICES = Number(flag('archive-offices', '50'));
    const slugFor = (k) => String(k).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
    const archived = [];
    for (const o of officeAccess.slice(0, ARCHIVE_OFFICES)) {
      const agg = officeAgg.get(o.office_key);
      const meetings = [...agg.meetings.values()]
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      await write(`office-meetings/${slugFor(o.office_key)}.json`, {
        office_key: o.office_key, label: o.label, meetings,
      });
      archived.push({ office_key: o.office_key, slug: slugFor(o.office_key), meetings: meetings.length });
    }
    await write('office-archive-index.json', {
      archived_offices: archived.length,
      archived_meetings: archived.reduce((a, b) => a + b.meetings, 0),
      total_offices: officeAccess.length,
      offices: archived,
    });

    // --- who was doing the asking -----------------------------------------
    // The office pages answer 'who came to see this office'. The other half of
    // the question is 'this organisation — who do they actually see?', and it
    // is the half a reader asks first. Counting is done twice on purpose: a
    // cheap pass over the communications to find which organisations are big
    // enough to publish, then a detailed pass that keeps meetings only for
    // those. Keeping every meeting for all 25,000 client names at once is what
    // would put this process into swap.
    // Two office keys can carry the same label — a department and its deputy
    // minister's office both file as 'Natural Resources Canada (NRCan)'. Two
    // identical rows with different counts read as a bug, so the part of the
    // key that is not in the label is spelled out.
    const disambiguate = (list, field = 'label') => {
      const keysPerLabel = new Map();
      for (const o of list) {
        if (!keysPerLabel.has(o[field])) keysPerLabel.set(o[field], new Set());
        keysPerLabel.get(o[field]).add(o.office_key);
      }
      return list.map((o) => {
        if ((keysPerLabel.get(o[field])?.size || 0) < 2) return o;
        const labelWords = new Set(String(o[field]).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean));
        const extra = String(o.office_key || '').split(/\s+/).filter((w) => !labelWords.has(w))
          .join(' ')
          // 'deputy minister of' reads as an unfinished sentence; the words
          // that only ever join two others are dropped from the ends.
          .replace(/^(?:of|the|de|du|des|la|le)\s+/, '')
          .replace(/\s+(?:of|the|de|du|des|la|le)$/, '')
          .replace(/\b[a-z]/g, (ch) => ch.toUpperCase())
          .trim();
        return extra ? { ...o, [field]: `${o[field]} — ${extra}` } : o;
      });
    };
    const TOP_CLIENTS = Number(flag('clients', '300'));
    const ARCHIVE_CLIENTS = Number(flag('archive-clients', '120'));
    const clientTotals = new Map();
    for (const r of commRows) {
      const name = r.client_name;
      if (!name) continue;
      const d = isoDate(r.comm_date);
      const c = clientTotals.get(name) || { client: name, communications: 0, first_date: null, last_date: null };
      c.communications++;
      if (d) {
        if (!c.first_date || d < c.first_date) c.first_date = d;
        if (!c.last_date || d > c.last_date) c.last_date = d;
      }
      clientTotals.set(name, c);
    }
    const topClients = [...clientTotals.values()]
      .sort((a, b) => b.communications - a.communications)
      .slice(0, TOP_CLIENTS);
    const wanted = new Map(topClients.map((c) => [c.client, {
      ...c,
      rows: 0,
      people: new Map(),
      offices: new Map(),
      registrants: new Map(),
      meetings: new Map(),
    }]));

    results.forEach((res, i) => {
      const row = dpohRows[i];
      const comm = commById.get(row.communication_id);
      const c = comm?.client_name && wanted.get(comm.client_name);
      if (!c) return;
      c.rows++;
      const officeKey = res.office_key || null;
      const officeLabel = row.institution || res.office_title || officeKey;
      if (officeKey) {
        const o = c.offices.get(officeKey) || { office_key: officeKey, label: officeLabel, n: 0 };
        o.n++;
        c.offices.set(officeKey, o);
      }
      const who = row.dpoh_raw && row.dpoh_raw.trim();
      if (who) {
        // Keyed by office as well as name: two people can share a surname and
        // an initial, and the record gives us nothing to tell them apart
        // across departments. Saying 'this name, at this office' is a claim
        // the filings support.
        const pk = `${who}|${officeKey || ''}`;
        const p2 = c.people.get(pk) || {
          name: who,
          // Titles are rolled up rather than split: the same person filed as
          // 'Assistant Deputy Minister' and 'ADM' is one person meeting this
          // organisation, and listing them twice understated both counts.
          titles: new Map(),
          office_key: officeKey,
          office_label: officeLabel,
          person_id: res.person_id || null,
          status: res.status,
          n: 0,
          first_date: null,
          last_date: null,
        };
        p2.n++;
        const rawTitle = row.dpoh_title_raw || '';
        p2.titles.set(rawTitle, (p2.titles.get(rawTitle) || 0) + 1);
        if (!p2.person_id && res.person_id) p2.person_id = res.person_id;
        const d = dateById.get(row.communication_id);
        if (d) {
          if (!p2.first_date || d < p2.first_date) p2.first_date = d;
          if (!p2.last_date || d > p2.last_date) p2.last_date = d;
        }
        c.people.set(pk, p2);
      }
      const reg = [comm?.registrant_surname, comm?.registrant_given].filter(Boolean).join(', ');
      if (reg) c.registrants.set(reg, (c.registrants.get(reg) || 0) + 1);

      if (!c.meetings.has(row.communication_id)) {
        c.meetings.set(row.communication_id, {
          communication_id: row.communication_id,
          date: dateById.get(row.communication_id) || null,
          posted_date: isoDate(comm?.posted_date),
          client: comm?.client_name || null,
          registrant: reg || null,
          office_key: officeKey,
          office_label: officeLabel,
          officials: [],
        });
      }
      if (who) {
        c.meetings.get(row.communication_id).officials.push({
          name: who, title: row.dpoh_title_raw || null, branch: row.branch || null,
        });
      }
    });

    const clientAccess = [...wanted.values()]
      .sort((a, b) => b.communications - a.communications)
      .map((c) => ({
        client: c.client,
        slug: slugFor(c.client),
        communications: c.communications,
        rows: c.rows,
        first_date: c.first_date,
        last_date: c.last_date,
        // The answer to 'who do they actually see', ranked.
        top_people: disambiguate([...c.people.values()].sort((a, b) => b.n - a.n).slice(0, 25), 'office_label').map((p2) => ({
          ...p2,
          titles: undefined,
          title: [...p2.titles.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
          other_titles: p2.titles.size - 1,
        })),
        top_offices: disambiguate([...c.offices.values()].sort((a, b) => b.n - a.n).slice(0, 15)),
        top_registrants: [...c.registrants.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
          .map(([registrant, n]) => ({ registrant, n })),
        archived_meetings: 0,
      }));
    const archivedClients = [];
    for (const c of clientAccess.slice(0, ARCHIVE_CLIENTS)) {
      const meetings = [...wanted.get(c.client).meetings.values()]
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      c.archived_meetings = meetings.length;
      await write(`client-meetings/${c.slug}.json`, { client: c.client, meetings });
      archivedClients.push({ client: c.client, slug: c.slug, meetings: meetings.length });
    }
    await write('client-access.json', clientAccess);
    await write('client-archive-index.json', {
      archived_clients: archivedClients.length,
      archived_meetings: archivedClients.reduce((a, b) => a + b.meetings, 0),
      total_clients: clientTotals.size,
      published_clients: clientAccess.length,
      clients: archivedClients,
    });

    const report = summarize(results);
    // Offices get their own coverage report: 'which chairs did we fail to
    // recognize' is a different question from 'which people did we fail to
    // identify', and the fix for each is different (an alias vs. a roster row).
    report.offices = summarizeOffices(results
      .filter((r) => r.parsed.kind === 'role_only' || r.office_key)
      .map((r) => ({
        // 'resolved' means a person is attached; 'office' means the chair is
        // known and the individual is not. An office_key with no holding is
        // still an office.
        status: r.status === 'ambiguous_office' ? 'ambiguous'
          : r.holding_id && r.person_id ? 'resolved'
            : r.office_key ? 'office' : 'unmatched',
        office_key: r.office_key || '',
      })));
    await write('resolution-report.json', report);
    await write('dpoh-links.json', results.map((r) => ({
      dpoh_raw: r.dpoh_raw, status: r.status, method: r.method, confidence: r.confidence,
      person_id: r.person_id, holding_id: r.holding_id ?? null, office_key: r.office_key ?? null,
      principal_person_id: r.principal_person_id ?? null,
    })));
    console.table([{ total: report.total, resolved: report.resolved, ambiguous: report.ambiguous, unresolved: report.unresolved, not_a_person: report.not_a_person, office: report.office, pct_named: report.pct_resolved_of_named_persons, pct_attributed: report.pct_attributed }]);
    if (report.offices.total) {
      console.log(`
Office attribution: ${report.offices.pct_attributed_to_an_office}% of ${report.offices.total} role rows land on a chair.
Top unmatched office keys (add an alias or a roster row for each):`);
      for (const { key, n } of report.offices.top_unmatched_office_keys.slice(0, 10)) console.log(`   ${String(n).padStart(6)}  ${key}`);
    }
    break;
  }
  case 'offices': {
    // Validates the roster BEFORE it is used to attribute anything. A roster
    // with overlapping intervals silently turns real access into 'ambiguous',
    // so it is checked loudly and early.
    const path = flag('roster', OFFICE_ROSTER);
    const { index, holdings, errors, overlaps } = await loadOffices(path, { strict: true });
    console.log(`\n== office roster (${path}): ${holdings.length} holdings, ${index.byKey.size} distinct offices`);
    for (const e of errors) console.log(`   ERROR   ${e}`);
    for (const o of overlaps) console.log(`   OVERLAP ${o}`);
    if (!holdings.length) {
      console.log(`   roster is empty — role rows will report 'unmatched' and nothing will be attributed.
   See the _readme in ${path} for what to transcribe and from where.`);
    }
    const unfilled = holdings.filter((h) => !h.person_id);
    if (unfilled.length) console.log(`   ${unfilled.length} holding(s) name a chair with no person_id — those resolve to the office only.`);
    for (const [key, hs] of [...index.byKey].sort()) {
      console.log(`   ${key}`);
      for (const h of hs.sort((a, b) => a.start_date.localeCompare(b.start_date))) {
        console.log(`      ${h.start_date} .. ${h.end_date || 'open'}  ${h.person_id || '(no person recorded)'}`);
      }
    }
    if (errors.length) process.exitCode = 1;
    break;
  }
  case 'derive-offices': {
    // Builds the office roster out of the filings themselves. See
    // match/derive-offices.mjs for what this is and is not: observation
    // windows, never appointment dates.
    const identified = await identifiedFiles();
    const commsPath = flag('comms', null) || identified.communications;
    const dpohPath = flag('dpoh', null) || identified.dpoh;
    if (!commsPath || !dpohPath) throw new Error('need the communications and DPOH files — run fetch:lobbying first');

    const { rows: commRows } = await ingestCsv(commsPath, COMMUNICATION_COLUMNS);
    const dateById = new Map(commRows.map((r) => [r.communication_id, isoDate(r.comm_date)]));
    const dpohRows = normalizeDpohRows((await ingestCsv(dpohPath, DPOH_COLUMNS)).rows);

    const observations = dpohRows.map((r) => ({
      person_name: [r.dpoh_surname, r.dpoh_given].filter(Boolean).join(', '),
      title: r.dpoh_title_raw || '',
      institution: r.institution || '',
      date: dateById.get(r.communication_id) || null,
    }));

    const { holdings, institution_holdings, contested, excluded, offices, skipped_titles } = deriveOfficeHoldings(observations);
    await write('derived-offices.json', {
      generated_at: new Date().toISOString().slice(0, 10),
      source: 'observed',
      // Both layers ship in one file; the institution layer is the one most
      // staff rows actually attach to.
      holdings: [...holdings, ...institution_holdings],
      contested, excluded, skipped_titles,
    });

    console.log(`
Derived ${holdings.length} portfolio holdings across ${offices} portfolios, and
${institution_holdings.length} institution holdings (who led which department, when) from the filings.
   contested windows (two people named in the same office at once): ${contested.length}
   excluded as likely misfilings: ${excluded.length}

These are OBSERVATION WINDOWS, not appointment dates. Sample:`);
    for (const h of holdings.slice(0, 8)) console.log(`   ${h.office_key.padEnd(38)} ${h.person_name.padEnd(28)} ${h.start_date} .. ${h.end_date}  (${h.observations} filings)`);
    console.log('\n   titles that name no portfolio (check none of these should have counted):');
    for (const t of skipped_titles.slice(0, 8)) console.log(`   ${String(t.n).padStart(7)}  ${t.key}`);
    break;
  }
  case 'stats': {
    // Answers the four questions in NOTES.md in one pass. Run this FIRST on
    // real data — the numbers decide what is worth building.
    const identified = await identifiedFiles();
    const commsPath = flag('comms', null) || identified.communications || 'data/raw/communications.csv';
    const dpohPath = flag('dpoh', null) || identified.dpoh || 'data/raw/communication_dpoh.csv';

    const { rows: commRows } = await ingestCsv(commsPath, COMMUNICATION_COLUMNS);
    const dpohRows = normalizeDpohRows((await ingestCsv(dpohPath, DPOH_COLUMNS)).rows);
    for (const r of commRows) {
      r.comm_date = isoDate(r.comm_date);
      r.posted_date = isoDate(r.posted_date);
    }

    // Q2 prefers the per-communication subject-details export when it is
    // present: it is the file that actually carries the free text, and it ties
    // that text to a communication rather than to a registration.
    const subjectsPath = flag('subjects', null) || identified.subjects || 'data/raw/communication_subject_details.csv';
    let q2;
    try {
      const { rows: subjectRows } = await ingestCsv(subjectsPath, COMM_SUBJECT_DETAIL_COLUMNS);
      // The denominator matters more than the rate. Only ~19% of
      // communications carry any subject text at all, so 'x% of communications
      // with text' and 'x% of communications' are different claims and both
      // get reported.
      const r = citationRateByCommunication(subjectRows);
      q2 = {
        source: subjectsPath,
        ...r,
        communications_in_dataset: commRows.length,
        pct_of_all_communications: commRows.length
          ? +(100 * r.communications_with_citation / commRows.length).toFixed(2) : null,
        pct_of_communications_carrying_subject_text: r.pct_with_citation,
      };
    } catch {
      q2 = { source: commsPath, ...citationRate(commRows, 'subject_raw') };
    }

    const report = {
      generated_at: new Date().toISOString().slice(0, 10),
      source_files: { communications: commsPath, dpoh: dpohPath, subjects: q2.source },
      q1_who_is_named: dpohComposition(dpohRows),
      q2_citation_rate: q2,
      q3_filing_lag: filingLag(commRows),
      q4_row_shape: dpohRowShape(dpohRows),
    };
    await write('ratio-report.json', report);

    const q1 = report.q1_who_is_named;
    const q3 = report.q3_filing_lag;
    console.log(`
Q1  Who is named on ${q1.total_dpoh_rows.toLocaleString()} DPOH rows?
      names a person            ${q1.pct_naming_a_person}%
      names a sitting member    ${q1.pct_naming_a_sitting_member}%   <- caps how member-centric the product can be
      role only (no person)     ${q1.role_only.toLocaleString()} rows
    top classes: ${Object.entries(q1.breakdown).slice(0, 5).map(([k, n]) => `${k}=${n}`).join('  ')}

Q2  Explicit bill citations
      ${(q2.communications_examined ?? q2.rows_examined).toLocaleString()} of ${(q2.communications_in_dataset ?? 0).toLocaleString()} communications carry any subject text
      cite a bill, of those     ${q2.pct_with_citation}%   <- below ~5% means the citation join is thin
      cite a bill, of ALL       ${q2.pct_of_all_communications ?? 'n/a'}%
      distinct bills cited      ${q2.distinct_bills_cited}
      most cited                ${(q2.top_bills_cited || []).slice(0, 6).map((b) => `${b.number}(${b.n})`).join(' ')}

Q3  Filing lag (meeting -> public)
      median ${q3.median_days} days | p75 ${q3.p75_days} | p90 ${q3.p90_days} | max ${q3.max_days}

Q4  DPOH row shape
      ${report.q4_row_shape.mean_dpoh_rows_per_communication} rows per communication (max ${report.q4_row_shape.max_dpoh_rows_per_communication})
      ${report.q4_row_shape.verdict}
`);
    break;
  }
  case 'link': {
    // The citation join: bill numbers written in a communication's subject
    // text, scoped to the session the communication happened in.
    const identified = await identifiedFiles();
    const billsPath = flag('bills', `${OUT}/bills-all.json`);
    const subjectsPath = flag('subjects', null) || identified.subjects;
    const commsPath = flag('comms', null) || identified.communications;
    const dpohPath = flag('dpoh', null) || identified.dpoh;

    const { bills, sessions } = JSON.parse(await readFile(billsPath, 'utf8'));
    const knownBillIds = new Set(bills.map((b) => b.bill_id));
    const billById = new Map(bills.map((b) => [b.bill_id, b]));

    const { rows: commRows } = await ingestCsv(commsPath, COMMUNICATION_COLUMNS);
    const commById = new Map(commRows.map((r) => [r.communication_id, r]));
    const { rows: subjectRows } = await ingestCsv(subjectsPath, COMM_SUBJECT_DETAIL_COLUMNS);

    const textByComm = new Map();
    for (const r of subjectRows) {
      if (!textByComm.has(r.communication_id)) textByComm.set(r.communication_id, []);
      textByComm.get(r.communication_id).push(r.details || '');
    }

    const links = [];
    const unmatched = new Map();
    for (const [commId, texts] of textByComm) {
      const comm = commById.get(commId);
      const date = isoDate(comm?.comm_date);
      const r = linkSubjectToBills(texts.join(' \n '), date, sessions, knownBillIds);
      for (const l of r.links) {
        links.push({
          communication_id: commId,
          bill_id: l.bill_id,
          method: l.method,
          confidence: l.confidence,
          comm_date: date,
          posted_date: isoDate(comm?.posted_date),
          client_name: comm?.client_name || null,
          registrant_name: [comm?.registrant_surname, comm?.registrant_given].filter(Boolean).join(', ') || null,
        });
      }
      // A citation we cannot place is kept and counted: it is either a bill
      // outside the sessions we loaded, or a number that never existed.
      for (const u of r.unmatched) {
        const key = `${u.bill_id || u.number} (${u.reason})`;
        unmatched.set(key, (unmatched.get(key) || 0) + 1);
      }
    }

    // Who was in the room, for the communications that made it through. Only
    // the linked ones, so this stays a small join rather than a 581k-row one.
    const linkedComms = new Set(links.map((l) => l.communication_id));
    const dpohRows = normalizeDpohRows((await ingestCsv(dpohPath, DPOH_COLUMNS)).rows)
      .filter((r) => linkedComms.has(r.communication_id));
    const officialsByComm = new Map();
    for (const r of dpohRows) {
      if (!officialsByComm.has(r.communication_id)) officialsByComm.set(r.communication_id, []);
      // Structured, not flattened into one string: the page shows the name and
      // the position separately, and 'who they met' is the question the whole
      // join exists to answer.
      officialsByComm.get(r.communication_id).push({
        name: r.dpoh_raw || null,
        title: r.dpoh_title_raw || null,
        institution: r.institution || null,
        branch: r.branch || null,
      });
    }
    for (const l of links) {
      l.officials = officialsByComm.get(l.communication_id) || [];
      l.official_label = l.officials.map((o) => [o.name, o.title].filter(Boolean).join(' — ')).join(' | ') || null;
    }

    const byBill = new Map();
    for (const l of links) byBill.set(l.bill_id, (byBill.get(l.bill_id) || 0) + 1);

    // What the meetings about each bill were filed as being ABOUT. The OCL
    // publishes a fixed list of subject categories per communication; joining
    // it here gives a bill page something concrete to say beyond the count,
    // and it is the registrants' own categorisation, not ours.
    const codesPath = flag('subject-codes', null) || identified.subject_codes;
    const lookupPath = flag('subject-lookup', null) || identified.subject_codes_lookup;
    const areasByBill = new Map();
    if (codesPath && lookupPath) {
      const { rows: lookupRows } = await ingestCsv(lookupPath, SUBJECT_CODE_LOOKUP_COLUMNS);
      const labels = new Map(lookupRows.map((r) => [r.subject_code, { en: r.label_en, fr: r.label_fr }]));
      const { rows: codeRows } = await ingestCsv(codesPath, COMM_SUBJECT_CODE_COLUMNS);
      const codesByComm = new Map();
      for (const r of codeRows) {
        if (!linkedComms.has(r.communication_id)) continue;
        if (!codesByComm.has(r.communication_id)) codesByComm.set(r.communication_id, []);
        codesByComm.get(r.communication_id).push(r.subject_code);
      }
      for (const l of links) {
        for (const code of codesByComm.get(l.communication_id) || []) {
          if (!areasByBill.has(l.bill_id)) areasByBill.set(l.bill_id, new Map());
          const m = areasByBill.get(l.bill_id);
          m.set(code, (m.get(code) || 0) + 1);
        }
      }
      await write('bill-areas.json', Object.fromEntries([...areasByBill.entries()].map(([bill_id, m]) => [
        bill_id,
        [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([code, n]) => ({
          code, n, en: labels.get(code)?.en || code, fr: labels.get(code)?.fr || code,
        })),
      ])));
    } else {
      console.log('no subject-code files identified: skipping the areas join');
    }

    await write('comm-bill-links.json', links);
    await write('citation-report.json', {
      communications_with_subject_text: textByComm.size,
      links: links.length,
      distinct_bills: byBill.size,
      top_bills: [...byBill.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
        .map(([bill_id, n]) => ({ bill_id, n, short_title: billById.get(bill_id)?.short_title || null })),
      unplaced_citations: [...unmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([ref, n]) => ({ ref, n })),
    });
    console.log(`${links.length} citation links across ${byBill.size} bills`
      + `; subject categories for ${areasByBill.size} of them`);
    break;
  }
  case 'site': {
    const { buildSite } = await import('./site/build.mjs');
    const r = await buildSite({ dataDir: OUT, outDir: flag('out', 'site') });
    console.log(`built ${r.pages} pages, ${r.megabytes} MB (${r.offices} offices, ${r.clients} organisations, `
      + `${r.people} people, ${r.bills} bills, EN + FR) from data generated ${r.generated}`);
    break;
  }
  case 'timeline': {
    const billsPath = flag('bills', `${OUT}/bills-all.json`);
    const linksPath = flag('links', `${OUT}/comm-bill-links.json`);
    const { bills, events } = JSON.parse(await readFile(billsPath, 'utf8'));
    const links = JSON.parse(await readFile(linksPath, 'utf8'));
    const out = bills.map((b) => buildBillTimeline(
      b, events.filter((e) => e.bill_id === b.bill_id), links.filter((l) => l.bill_id === b.bill_id)))
      .filter((t) => t.total_linked_communications > 0)
      .sort((a, b) => b.total_linked_communications - a.total_linked_communications);
    await write('timelines.json', out);
    console.log(`${out.length} bills with linked lobbying activity`);
    break;
  }
  default:
    console.log(`lobby-to-law
  npm run probe            -- --comms <csv> --dpoh <csv>   inspect real headers vs expected
  npm run fetch:lobbying                                    download the OCL bulk files (CI does this)
  npm run probe:members    -- --parliament 42               which roster endpoint knows former members
  npm run fetch:members    -- --parliaments 39,40,41,42,43,44,45
  npm run fetch:bills      -- --session 45-1
  npm run stats            -- --comms <csv> --dpoh <csv>   the four questions in NOTES.md
  npm run offices          -- [--roster <json>]             validate the ministerial roster
  npm run derive:offices                                    build an office roster from the filings
  npm run resolve          -- --dpoh <csv> --comms <csv>   entity resolution + coverage report
  npm run link             -- [--bills <json>]              citations -> session-scoped bills
  npm run timeline         -- --bills <json> --links <json>
  npm run site             -- [--out site]                  build the static site (EN/FR)
Sessions configured: ${SESSIONS.map((s) => `${s.parliament}-${s.session}`).join(', ')}`);
}
