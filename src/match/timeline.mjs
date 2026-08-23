// The flagship view: for a bill, who was in the room before each stage.
//
// The interesting quantity is not 'how many meetings' but 'how many meetings
// in the window immediately before a decision point, and by whom'. A meeting
// six months before first reading is background; eleven meetings in the three
// weeks before clause-by-clause is a story.

const DAY = 86400000;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

export const DEFAULT_WINDOWS = { first_reading: 60, second_reading: 30, committee_referral: 30, committee_report: 30, third_reading: 30, royal_assent: 30 };

/**
 * @param {object} bill            { bill_id, number, short_title }
 * @param {Array}  events          bill_event rows for this bill
 * @param {Array}  comms           communications already linked to this bill
 * @param {object} opts            { windows, resolveName }
 */
export function buildBillTimeline(bill, events, comms, opts = {}) {
  const windows = { ...DEFAULT_WINDOWS, ...(opts.windows || {}) };
  const sorted = [...events].sort((a, b) => a.event_date.localeCompare(b.event_date));

  const stages = sorted.map((ev) => {
    const window = windows[ev.stage] ?? 30;
    const inWindow = comms.filter((c) => {
      const d = days(c.comm_date, ev.event_date);
      return d >= 0 && d <= window;
    });

    const byClient = new Map();
    for (const c of inWindow) {
      const key = c.client_name || c.registrant_name || 'unknown';
      if (!byClient.has(key)) byClient.set(key, { client: key, count: 0, officials: new Set() });
      const e = byClient.get(key);
      e.count++;
      if (c.official_label) e.officials.add(c.official_label);
    }

    return {
      stage: ev.stage,
      event_date: ev.event_date,
      window_days: window,
      communications: inWindow.length,
      distinct_clients: byClient.size,
      // Filing lag: the public only learned about these meetings later. This is
      // the Canadian analogue of the disclosure-lag line in the US build.
      median_filing_lag_days: medianLag(inWindow),
      clients: [...byClient.values()]
        .map((e) => ({ ...e, officials: [...e.officials] }))
        .sort((a, b) => b.count - a.count),
    };
  });

  return {
    bill_id: bill.bill_id,
    number: bill.number,
    short_title: bill.short_title,
    total_linked_communications: comms.length,
    stages,
  };
}

function medianLag(comms) {
  const lags = comms
    .filter((c) => c.posted_date && c.comm_date)
    .map((c) => days(c.comm_date, c.posted_date))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  if (!lags.length) return null;
  const mid = Math.floor(lags.length / 2);
  return lags.length % 2 ? lags[mid] : Math.round((lags[mid - 1] + lags[mid]) / 2);
}
