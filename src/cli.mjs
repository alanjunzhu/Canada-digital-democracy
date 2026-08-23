#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { COMMUNICATION_COLUMNS, DPOH_COLUMNS, SESSIONS } from './config/sources.mjs';
import { probeColumns, ingestCsv, isoDate } from './fetch/ingest-lobbying.mjs';
import { fetchMembers } from './fetch/fetch-members.mjs';
import { fetchBills } from './fetch/fetch-bills.mjs';
import { buildPersonIndex, resolveDpoh, summarize } from './match/resolve.mjs';
import { buildBillTimeline } from './match/timeline.mjs';

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const OUT = 'data/out';
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
  case 'fetch-members': {
    const parliament = Number(flag('parliament', '45'));
    const { persons, terms } = await fetchMembers(parliament);
    await write(`members-${parliament}.json`, { persons, terms });
    console.log(`${persons.length} persons, ${terms.length} terms`);
    break;
  }
  case 'fetch-bills': {
    const ps = flag('session', '45-1');
    const { bills, events } = await fetchBills(ps);
    await write(`bills-${ps}.json`, { bills, events });
    console.log(`${bills.length} bills, ${events.length} stage events`);
    break;
  }
  case 'resolve': {
    const membersPath = flag('members', 'data/out/members-45.json');
    const dpohPath = flag('dpoh', 'data/raw/communication_dpoh.csv');
    const commsPath = flag('comms', 'data/raw/communications.csv');

    const { terms } = JSON.parse(await readFile(membersPath, 'utf8'));
    const overrides = JSON.parse(await readFile('data/overrides/dpoh-aliases.json', 'utf8')).aliases || {};
    const index = buildPersonIndex(terms);

    const { rows: commRows } = await ingestCsv(commsPath, COMMUNICATION_COLUMNS);
    const dateById = new Map(commRows.map((r) => [r.communication_id, isoDate(r.comm_date)]));
    const { rows: dpohRows } = await ingestCsv(dpohPath, DPOH_COLUMNS);

    const results = dpohRows.map((r) =>
      resolveDpoh(r.dpoh_raw, dateById.get(r.communication_id) || null, index, { institution: r.institution || '', overrides }));

    const report = summarize(results);
    await write('resolution-report.json', report);
    await write('dpoh-links.json', results.map((r) => ({
      dpoh_raw: r.dpoh_raw, status: r.status, method: r.method, confidence: r.confidence, person_id: r.person_id,
    })));
    console.table([{ total: report.total, resolved: report.resolved, ambiguous: report.ambiguous, unresolved: report.unresolved, not_a_person: report.not_a_person, pct_named: report.pct_resolved_of_named_persons }]);
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
  npm run fetch:members    -- --parliament 45
  npm run fetch:bills      -- --session 45-1
  npm run resolve          -- --dpoh <csv> --comms <csv>   entity resolution + coverage report
  npm run timeline         -- --bills <json> --links <json>
Sessions configured: ${SESSIONS.map((s) => `${s.parliament}-${s.session}`).join(', ')}`);
}
