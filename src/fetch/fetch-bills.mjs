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
    });
    // LEGISinfo exposes stage info under several shapes across versions; take
    // whichever array is present and normalize labels rather than assuming one.
    const stageRows = b.BillStages?.BillStage || b.Stages || b.stages || [];
    for (const s of [].concat(stageRows)) {
      const label = s.StageNameEn || s.Name || s.stage || '';
      const date = (s.StartDate || s.Date || s.date || '').slice(0, 10);
      const stage = normalizeStage(label);
      if (stage && date) {
        events.push({ bill_event_id: `${bill_id}/${stage}/${date}`, bill_id, stage, chamber: s.ChamberEn || null, event_date: date });
      }
    }
  }
  return { bills, events };
}
