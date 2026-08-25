// LEGISinfo -> bill + bill_event rows.
import { SOURCES } from '../config/sources.mjs';
import { fetchText } from '../lib/http.mjs';

const STAGE_MAP = [
  [/first reading|première lecture/i, 'first_reading'],
  [/second reading|deuxième lecture/i, 'second_reading'],
  [/referred to committee|renvoy[ée] au comité/i, 'committee_referral'],
  [/committee report|rapport du comité|reported/i, 'committee_report'],
  [/third reading|troisième lecture/i, 'third_reading'],
  [/royal assent|sanction royale/i, 'royal_assent'],
];

export function normalizeStage(label) {
  for (const [re, stage] of STAGE_MAP) if (re.test(label || '')) return stage;
  return null;
}

// 'PassedHouseFirstReadingDateTime' -> 'Passed House First Reading Date Time'.
// LEGISinfo carries some stages as scalar fields whose KEY is the label, so the
// key has to be readable by the same matcher as a stage name.
const unCamel = (k) => String(k || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');

const isDateish = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
/** First non-empty value among the aliases; null when LEGISinfo has none of them. */
const pick = (o, keys) => {
  for (const k of keys) {
    const v = o?.[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
};
const day = (v) => (isDateish(v) ? String(v).slice(0, 10) : null);
const chamberFrom = (text) => (/senate|s[ée]nat/i.test(text) ? 'Senate' : /house|commons|communes/i.test(text) ? 'Commons' : null);

/**
 * Pulls stage events out of a bill record without assuming which shape
 * LEGISinfo is publishing this month. Two things are recognized:
 *   1. a scalar date field whose own key names a stage
 *      ('PassedHouseFirstReadingDateTime')
 *   2. a nested object carrying a stage NAME and a date, wherever it sits
 *      (BillStages.HouseBillStages[], .SenateBillStages[], and friends)
 * A candidate only becomes an event if its label matches one of the six stages
 * outright — 'looks like a date next to a string' is not enough.
 */
export function extractStageEvents(bill, bill_id) {
  const events = new Map();          // dedup: same stage on the same day in the same chamber
  const add = (stage, date, chamber, path) => {
    if (!stage || !date) return;
    const day = date.slice(0, 10);
    const key = `${stage}|${day}|${chamber || ''}`;
    if (!events.has(key)) {
      events.set(key, { bill_event_id: `${bill_id}/${stage}/${day}${chamber ? `/${chamber}` : ''}`, bill_id, stage, chamber, event_date: day, source_path: path });
    }
  };

  const walk = (node, path, depth) => {
    if (!node || typeof node !== 'object' || depth > 6) return;
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1));

    const entries = Object.entries(node);
    // A stage name and a date sitting in the same object.
    const nameKey = entries.find(([k, v]) => typeof v === 'string' && /(name|title|stage|state|label)/i.test(k) && normalizeStage(v));
    if (nameKey) {
      const dateEntry = entries.find(([k, v]) => isDateish(v) && /date|time/i.test(k));
      if (dateEntry) {
        const chamberEntry = entries.find(([k, v]) => typeof v === 'string' && /chamber|organization/i.test(k));
        add(normalizeStage(nameKey[1]), dateEntry[1], chamberFrom(chamberEntry?.[1] || path), `${path}.${dateEntry[0]}`);
      }
    }
    for (const [k, v] of entries) {
      // A date whose key is itself the stage label.
      if (isDateish(v)) add(normalizeStage(unCamel(k)), v, chamberFrom(unCamel(k)) || chamberFrom(path), `${path}.${k}`);
      else if (v && typeof v === 'object') walk(v, `${path}.${k}`, depth + 1);
    }
  };

  walk(bill, 'bill', 0);
  return [...events.values()];
}

/**
 * Describes the shape of a record so an unrecognized publication is diagnosable
 * from the CI log instead of guessed at locally. Values are replaced by their
 * types; only key structure is kept.
 */
export function describeShape(node, depth = 0) {
  if (Array.isArray(node)) return node.length ? [describeShape(node[0], depth + 1)] : [];
  if (node && typeof node === 'object') {
    if (depth > 3) return '{…}';
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, describeShape(v, depth + 1)]));
  }
  return isDateish(node) ? 'date' : node === null ? 'null' : typeof node;
}

export async function fetchBills(parlsession, { cacheDir = 'data/raw' } = {}) {
  const text = await fetchText(SOURCES.bills.json(parlsession), { cachePath: `${cacheDir}/bills-${parlsession}.json` });
  const raw = JSON.parse(text);
  const rows = Array.isArray(raw) ? raw : raw.bills || raw.Bills || [];
  const [parliament, session] = parlsession.split('-').map(Number);

  const bills = [];
  const events = [];
  for (const b of rows) {
    const number = b.NumberCode || b.BillNumberFormatted || b.number;
    if (!number) continue;
    const bill_id = `${parlsession}/${number}`;
    bills.push({
      bill_id, parliament, session, number,
      chamber: /^S-/i.test(number) ? 'Senate' : 'Commons',
      short_title: b.ShortTitleEn || b.ShortTitle || null,
      long_title: b.LongTitleEn || b.LongTitle || null,
      short_title_fr: pick(b, ['ShortTitleFr', 'ShortTitleFrench']),
      long_title_fr: pick(b, ['LongTitleFr', 'LongTitleFrench']),
      // Written with alias lists because LEGISinfo renames fields between
      // releases, and a run that finds none of them must produce a page that
      // simply says less — never the word 'undefined'.
      sponsor: pick(b, ['SponsorPersonName', 'SponsorPersonOfficialName', 'SponsorName']),
      sponsor_title: pick(b, ['SponsorAffiliationTitle', 'SponsorAffiliationRoleName', 'SponsorTitle']),
      bill_type: pick(b, ['BillDocumentTypeNameEn', 'BillDocumentTypeName', 'BillTypeNameEn']),
      bill_type_fr: pick(b, ['BillDocumentTypeNameFr', 'BillTypeNameFr']),
      status: pick(b, ['StatusNameEn', 'LatestCompletedMajorStageNameEn', 'StatusName', 'LatestCompletedMajorStageName']),
      status_fr: pick(b, ['StatusNameFr', 'LatestCompletedMajorStageNameFr']),
      latest_event: pick(b, ['LatestBillEventTypeNameEn', 'LatestBillEventTypeName', 'LatestActivityNameEn']),
      latest_event_fr: pick(b, ['LatestBillEventTypeNameFr', 'LatestActivityNameFr']),
      latest_event_date: day(pick(b, ['LatestBillEventDateTime', 'LatestActivityDateTime', 'LatestBillEventDate'])),
      royal_assent_date: day(pick(b, ['ReceivedRoyalAssentDateTime', 'RoyalAssentDateTime'])),
      is_government: pick(b, ['IsGovernmentBill', 'IsGovernment']),
    });
    events.push(...extractStageEvents(b, bill_id));
  }
  // The shape of the first record travels with the output: when a run produces
  // 185 bills and 0 stage events, this is what says why.
  const shape = rows.length ? describeShape(rows[0]) : null;
  return { bills, events, shape };
}
