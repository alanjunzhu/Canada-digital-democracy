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

  // What a reader needs before any of the above means anything: what the bill
  // is, who moved it, how far it got, and when it last did anything. All of it
  // is copied from LEGISinfo or counted here — none of it is a judgement.
  const clients = new Set(comms.map((c) => c.client_name).filter(Boolean));
  const officials = new Set();
  for (const c of comms) for (const o of c.officials || []) if (o.institution) officials.add(o.institution);
  const dates = sorted.map((e) => e.event_date).filter(Boolean);
  const royal = sorted.find((e) => e.stage === 'royal_assent');

  return {
    bill_id: bill.bill_id,
    number: bill.number,
    parliament: bill.parliament ?? null,
    session: bill.session ?? null,
    chamber: bill.chamber || null,
    short_title: bill.short_title,
    long_title: bill.long_title || null,
    short_title_fr: bill.short_title_fr || null,
    long_title_fr: bill.long_title_fr || null,
    sponsor: bill.sponsor || null,
    sponsor_title: bill.sponsor_title || null,
    bill_type: bill.bill_type || null,
    bill_type_fr: bill.bill_type_fr || null,
    status: bill.status || null,
    status_fr: bill.status_fr || null,
    latest_event: bill.latest_event || null,
    latest_event_fr: bill.latest_event_fr || null,
    became_law: Boolean(royal || bill.royal_assent_date),
    royal_assent_date: royal?.event_date || bill.royal_assent_date || null,
    first_event_date: dates[0] || null,
    last_event_date: bill.latest_event_date || dates[dates.length - 1] || null,
    total_linked_communications: comms.length,
    distinct_clients: clients.size,
    distinct_institutions: officials.size,
    top_clients: [...comms.reduce((m, c) => {
      if (c.client_name) m.set(c.client_name, (m.get(c.client_name) || 0) + 1);
      return m;
    }, new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([client, n]) => ({ client, n })),
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
