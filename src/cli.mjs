#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { COMMUNICATION_COLUMNS, DPOH_COLUMNS, SESSIONS } from './config/sources.mjs';
import { probeColumns, ingestCsv, isoDate } from './fetch/ingest-lobbying.mjs';
import { fetchMembers } from './fetch/fetch-members.mjs';
import { fetchBills } from './fetch/fetch-bills.mjs';
import { fetchLobbyingBulk } from './fetch/fetch-lobbying.mjs';
import { buildPersonIndex, resolveDpoh, summarize } from './match/resolve.mjs';
import { validateHoldings, buildOfficeIndex, summarizeOffices, EMPTY_OFFICE_INDEX } from './match/office.mjs';
import { buildBillTimeline } from './match/timeline.mjs';
import { dpohComposition, citationRate, filingLag, dpohRowShape } from './match/stats.mjs';

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
async function loadOffices(path = OFFICE_ROSTER, { strict = false } = {}) {
  let raw;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    if (strict) throw e;
    return { index: EMPTY_OFFICE_INDEX, errors: [], overlaps: [], holdings: [] };
  }
  const { holdings, errors, overlaps } = validateHoldings(raw.holdings || [], raw.aliases || {});
  return { index: buildOfficeIndex(holdings, raw.aliases || {}), holdings, errors, overlaps };
}
const write = async (name, obj) => {
  await mkdir(OUT, { recursive: true });
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
    const { picked, downloaded, failures, dataset_title, modified } = await fetchLobbyingBulk({ dir });
    console.log(`\n== ${dataset_title || 'dataset'} (catalogue updated ${modified || 'unknown'})`);
    console.log('   resources offered:');
    for (const r of picked.all) console.log(`      [${String(r.format).padEnd(5)}] ${r.name}`);
    for (const [key, got] of Object.entries(downloaded)) {
      console.log(`   ${key}: ${got.name} -> ${got.files.join(', ') || got.path} (${(got.bytes / 1e6).toFixed(1)} MB)`);
    }
    for (const f of failures) console.log(`   FAILED  ${f.key}: ${f.error}`);
    for (const key of ['communications', 'dpoh']) {
      if (!picked[key]) console.log(`   NOT FOUND: no resource matched '${key}'. Name it explicitly, or widen the pattern in src/fetch/fetch-lobbying.mjs.`);
    }
    await write('download-manifest.json', { dataset_title, modified, picked: picked.all, downloaded, failures });
    // A missing primary file is fatal to every number downstream, so it fails
    // the step — but only after the full picture has been printed.
    if (!downloaded.communications || !downloaded.dpoh) process.exitCode = 1;
    break;
  }
  case 'fetch-members': {
    const parliament = Number(flag('parliament', '45'));
    const { persons, terms } = await fetchMembers(parliament);
    await write(`members-${parliament}.json`, { persons, terms });
    console.log(`${persons.length} persons, ${terms.length} terms`);
    break;
  }
  case 'fetch-bills': {
    const ps = flag('session', '45-1');
    const { bills, events, shape } = await fetchBills(ps);
    await write(`bills-${ps}.json`, { bills, events });
    console.log(`${bills.length} bills, ${events.length} stage events`);
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
    const membersPath = flag('members', 'data/out/members-45.json');
    const dpohPath = flag('dpoh', 'data/raw/communication_dpoh.csv');
    const commsPath = flag('comms', 'data/raw/communications.csv');

    const { terms } = JSON.parse(await readFile(membersPath, 'utf8'));
    const overrides = JSON.parse(await readFile('data/overrides/dpoh-aliases.json', 'utf8')).aliases || {};
    const index = buildPersonIndex(terms);
    const { index: offices, errors: officeErrors, overlaps } = await loadOffices(flag('roster', OFFICE_ROSTER));
    for (const e of [...officeErrors, ...overlaps]) console.log(`office roster: ${e}`);

    const { rows: commRows } = await ingestCsv(commsPath, COMMUNICATION_COLUMNS);
    const dateById = new Map(commRows.map((r) => [r.communication_id, isoDate(r.comm_date)]));
    const { rows: dpohRows } = await ingestCsv(dpohPath, DPOH_COLUMNS);

    const results = dpohRows.map((r) =>
      resolveDpoh(r.dpoh_raw, dateById.get(r.communication_id) || null, index, { institution: r.institution || '', title: r.dpoh_title_raw || '', overrides, offices }));

    const report = summarize(results);
    // Offices get their own coverage report: 'which chairs did we fail to
    // recognize' is a different question from 'which people did we fail to
    // identify', and the fix for each is different (an alias vs. a roster row).
    report.offices = summarizeOffices(results
      .filter((r) => r.parsed.kind === 'role_only' || r.office_key)
      .map((r) => ({
        status: r.status === 'office' ? 'office'
          : r.status === 'ambiguous_office' ? 'ambiguous'
            : r.holding_id ? 'resolved' : 'unmatched',
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
  case 'stats': {
    // Answers the four questions in NOTES.md in one pass. Run this FIRST on
    // real data — the numbers decide what is worth building.
    const commsPath = flag('comms', 'data/raw/communications.csv');
    const dpohPath = flag('dpoh', 'data/raw/communication_dpoh.csv');

    const { rows: commRows } = await ingestCsv(commsPath, COMMUNICATION_COLUMNS);
    const { rows: dpohRows } = await ingestCsv(dpohPath, DPOH_COLUMNS);
    for (const r of commRows) {
      r.comm_date = isoDate(r.comm_date);
      r.posted_date = isoDate(r.posted_date);
    }

    const report = {
      generated_at: new Date().toISOString().slice(0, 10),
      source_files: { communications: commsPath, dpoh: dpohPath },
      q1_who_is_named: dpohComposition(dpohRows),
      q2_citation_rate: citationRate(commRows, 'subject_raw'),
      q3_filing_lag: filingLag(commRows),
      q4_row_shape: dpohRowShape(dpohRows),
    };
    await write('ratio-report.json', report);

    const q1 = report.q1_who_is_named;
    const q2 = report.q2_citation_rate;
    const q3 = report.q3_filing_lag;
    console.log(`
Q1  Who is named on ${q1.total_dpoh_rows.toLocaleString()} DPOH rows?
      names a person            ${q1.pct_naming_a_person}%
      names a sitting member    ${q1.pct_naming_a_sitting_member}%   <- caps how member-centric the product can be
      role only (no person)     ${q1.role_only.toLocaleString()} rows
    top classes: ${Object.entries(q1.breakdown).slice(0, 5).map(([k, n]) => `${k}=${n}`).join('  ')}

Q2  Explicit bill citations in ${q2.rows_examined.toLocaleString()} communications
      cite a bill number        ${q2.pct_with_citation}%   <- below ~5% means the citation join is thin
      distinct bills cited      ${q2.distinct_bills_cited}

Q3  Filing lag (meeting -> public)
      median ${q3.median_days} days | p75 ${q3.p75_days} | p90 ${q3.p90_days} | max ${q3.max_days}

Q4  DPOH row shape
      ${report.q4_row_shape.mean_dpoh_rows_per_communication} rows per communication (max ${report.q4_row_shape.max_dpoh_rows_per_communication})
      ${report.q4_row_shape.verdict}
`);
    break;
  }
  case 'timeline': {
    const billsPath = flag('bills', 'data/out/bills-45-1.json');
    const linksPath = flag('links', 'data/out/comm-bill-links.json');
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
  npm run fetch:members    -- --parliament 45
  npm run fetch:bills      -- --session 45-1
  npm run stats            -- --comms <csv> --dpoh <csv>   the four questions in NOTES.md
  npm run offices          -- [--roster <json>]             validate the ministerial roster
  npm run resolve          -- --dpoh <csv> --comms <csv>   entity resolution + coverage report
  npm run timeline         -- --bills <json> --links <json>
Sessions configured: ${SESSIONS.map((s) => `${s.parliament}-${s.session}`).join(', ')}`);
}
