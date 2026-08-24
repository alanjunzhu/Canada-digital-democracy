// Derives an office roster from the lobbying record itself.
//
// The roster this project needs — who held which portfolio, between which
// dates — is not published as a bulk file. But the lobbying file already
// contains 35,293 rows that name a minister, each with a person, a portfolio
// title and a date. Those are observations of someone sitting in a chair, and
// enough of them describe the chair's occupancy over time.
//
// What this is NOT: an appointment record. A derived holding says 'this person
// was named as Minister of X in filings dated between A and B'. It does not say
// they took office on A or left on B — the true boundaries sit somewhere in the
// gaps, and inventing them would be exactly the kind of confident-and-wrong
// output this project refuses to produce. Every holding is stamped
// `source: 'observed'` so a UI can never render it as an appointment date.
//
// Curated roster rows always win over derived ones: real appointment dates,
// when someone transcribes them, replace these rather than competing with them.

import { canonicalRole } from '../normalize/roles.mjs';
import { normalizeName } from '../normalize/names.mjs';

// A portfolio, as opposed to a description of one. The title column is typed
// by hand, so it produces things like 'ACOA Minister', 'Acting Minister',
// 'Advance Prime Minister's Office' and 'agent bureau ministre Joly' — all of
// which canonicalize to something, and none of which name a chair anyone holds.
// A derived holding is only created for a key that reads as a real portfolio.
const PORTFOLIO_SHAPE = /^(?:prime minister|minister (?:of|for) \S.*|ministre (?:de|des|du|d) \S.*|secretary of state for \S.*|president of the treasury board|leader of the government in the house.*)$/;

// 'Acting Minister of Fisheries and Oceans' is a person in the chair; the word
// 'acting' describes the appointment, not a different office.
const stripActing = (key) => key.replace(/^(?:acting|interim|associate)\s+/, '');

export const isPortfolioKey = (key) => PORTFOLIO_SHAPE.test(stripActing(String(key || '')));

/**
 * @param observations [{ person_name, person_id?, title, institution?, date }]
 * @param opts.minObservations   a run this small inside someone else's tenure
 *                               is treated as a misfiling, not a handover
 * @param opts.minShare          ...and likewise if it is this small a share of
 *                               the incumbent's observations
 */
export function deriveOfficeHoldings(observations, { minObservations = 3, minShare = 0.05 } = {}) {
  // office_key -> person_key -> { dates, titles, person_name, person_id }
  const byOffice = new Map();
  const byInstitution = new Map();    // department -> who led it, when
  const skipped = new Map();          // titles that name no real portfolio

  for (const o of observations) {
    if (!o.date || !o.person_name) continue;
    const role = canonicalRole(o.title, o.institution || '');

    // The institution layer. Most staff rows name a department rather than a
    // portfolio, so 'who led this department, when' is the mapping that
    // actually attaches them to a person. It is derived from the same
    // observations and kept separately from the portfolio layer.
    if (role.kind === 'principal' && o.institution) {
      const instKey = normalizeName(o.institution);
      if (instKey) {
        if (!byInstitution.has(instKey)) byInstitution.set(instKey, new Map());
        const ip = byInstitution.get(instKey);
        const pk = o.person_id || normalizeName(o.person_name);
        if (!ip.has(pk)) ip.set(pk, { person_key: pk, person_id: o.person_id || null, person_name: o.person_name, institution: o.institution, dates: [], titles: new Map() });
        const rec = ip.get(pk);
        rec.dates.push(o.date);
        rec.titles.set(o.title, (rec.titles.get(o.title) || 0) + 1);
      }
    }

    // Only the chair's own occupant tells us who holds it. A staffer's row
    // names the office but not the office HOLDER, so it is evidence of the
    // office existing, never of who sat in it.
    if (!role.key || role.kind !== 'principal' || role.via !== 'role') continue;
    if (!isPortfolioKey(role.key)) { skipped.set(role.key, (skipped.get(role.key) || 0) + 1); continue; }

    const key = stripActing(role.key);
    if (!byOffice.has(key)) byOffice.set(key, new Map());
    const people = byOffice.get(key);
    const personKey = o.person_id || normalizeName(o.person_name);
    if (!people.has(personKey)) {
      people.set(personKey, { person_key: personKey, person_id: o.person_id || null, person_name: o.person_name, dates: [], titles: new Map() });
    }
    const p = people.get(personKey);
    p.dates.push(o.date);
    p.titles.set(o.title, (p.titles.get(o.title) || 0) + 1);
  }

  const holdings = [];
  const contested = [];
  const excluded = [];

  for (const [officeKey, people] of byOffice) {
    const spans = [...people.values()].map((p) => {
      const dates = p.dates.sort();
      return {
        ...p,
        first_seen: dates[0],
        last_seen: dates[dates.length - 1],
        observations: dates.length,
        // The most frequent spelling of the title, kept verbatim: it is real
        // text from the filings, and it canonicalizes back to this office key.
        title: [...p.titles.entries()].sort((a, b) => b[1] - a[1])[0][0],
      };
    }).sort((a, b) => a.first_seen.localeCompare(b.first_seen) || b.observations - a.observations);

    const kept = [];
    for (const span of spans) {
      // A handful of rows naming someone inside another minister's clear
      // tenure is a filing error far more often than a two-week ministry.
      const swallower = kept.find((k) =>
        k.first_seen <= span.first_seen && k.last_seen >= span.last_seen
        && span.observations < Math.max(minObservations, k.observations * minShare));
      if (swallower) {
        excluded.push({ office_key: officeKey, person_name: span.person_name, observations: span.observations, inside: swallower.person_name, reason: 'few observations inside another tenure' });
        continue;
      }
      kept.push(span);
    }

    for (let i = 1; i < kept.length; i++) {
      const prev = kept[i - 1];
      const cur = kept[i];
      if (prev.last_seen >= cur.first_seen) {
        // Both were named in this window. The handover date is unknown, so the
        // window stays contested and the resolver reports it ambiguous.
        contested.push({
          office_key: officeKey, from: cur.first_seen, to: prev.last_seen,
          people: [prev.person_name, cur.person_name],
        });
      }
    }

    for (const span of kept) {
      holdings.push({
        holding_id: `observed:${officeKey}:${span.first_seen}`.replace(/\s+/g, '-'),
        person_id: span.person_id,
        person_name: span.person_name,
        title: span.title,
        office_key: officeKey,
        start_date: span.first_seen,
        end_date: span.last_seen,
        source: 'observed',
        observations: span.observations,
        // Said in full so no caller can mistake it for an appointment record.
        basis: `named as '${span.title}' in filings dated ${span.first_seen} to ${span.last_seen}`,
      });
    }
  }

  // The institution layer, same treatment: observation windows only.
  const institutionHoldings = [];
  for (const [instKey, people] of byInstitution) {
    for (const p of people.values()) {
      const dates = p.dates.sort();
      if (dates.length < minObservations) continue;    // one filing is not a tenure
      institutionHoldings.push({
        holding_id: `observed-inst:${instKey}:${dates[0]}`.replace(/\s+/g, '-'),
        person_id: p.person_id,
        person_name: p.person_name,
        title: [...p.titles.entries()].sort((a, b) => b[1] - a[1])[0][0],
        institution: p.institution,
        office_key: instKey,
        start_date: dates[0],
        end_date: dates[dates.length - 1],
        source: 'observed-institution',
        observations: dates.length,
        basis: `named as '${[...p.titles.keys()][0]}' at ${p.institution} in filings dated ${dates[0]} to ${dates[dates.length - 1]}`,
      });
    }
  }

  holdings.sort((a, b) => a.office_key.localeCompare(b.office_key) || a.start_date.localeCompare(b.start_date));
  return {
    holdings,
    institution_holdings: institutionHoldings,
    contested,
    excluded,
    offices: byOffice.size,
    // Reported, not silently dropped: if a real portfolio is being rejected by
    // the shape rule, it shows up here in frequency order.
    skipped_titles: [...skipped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([key, n]) => ({ key, n })),
  };
}
