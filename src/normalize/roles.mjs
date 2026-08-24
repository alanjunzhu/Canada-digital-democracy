// Canonicalizes a role string into an OFFICE key.
//
// Why this file exists: a large share of logged communications name no person
// at all. They name a chair — 'Chief of Staff, Office of the Minister of
// Finance'. `officials.mjs` already tells us such a row is staff and carries no
// name; that is where attribution used to stop, and every one of those rows
// fell out of the product. But the OFFICE is identifiable, and an office has a
// timeline (`office_holding`), so the access can be attributed to a portfolio
// even when the individual in the room stays unnamed.
//
// The output is a key, not a person. Turning a key into a person is
// `match/office.mjs`'s job, and only ever through a dated holding.
//
// Two rules carry over unchanged from the resolver:
//   * A staff row is NEVER attributed to the minister as if they were in the
//     room. It resolves to their office, with the principal recorded
//     separately, because 'the Minister's chief of staff met X' and 'the
//     Minister met X' are different facts.
//   * A portfolio phrase we cannot canonicalize returns an empty key and is
//     reported, not guessed at. French filings against an English office roster
//     are the common case here, and the fix is an alias, not a fuzzy match.

import { foldDiacritics } from './names.mjs';

const clean = (s) => foldDiacritics(String(s || ''))
  .toLowerCase()
  .replace(/['’]/g, ' ')
  .replace(/[^a-z0-9,]+/g, ' ')
  .replace(/\s*,\s*/g, ',')
  .replace(/\s+/g, ' ')
  .trim();

const PARL_SEC = /\b(parliamentary secretary|secretaire parlementaire)\b/;
const DEPUTY = /\b(deputy minister|associate deputy minister|sous ministre)\b/;
const STAFF = /\b(chief of staff|chef de cabinet|advis[oe]r|conseill?er|conseillere|director|directeur|directrice|assistant|adjoint|adjointe|press secretary|attache de presse|policy|politique|analyst|analyste)\b/;
const PRINCIPAL = /\b(prime minister|premier ministre|premiere ministre|minister|ministre|secretary of state|secretaire d etat)\b/;

// Phrases that introduce a portfolio the named person works FOR rather than
// holds. Everything after them is the office.
const OFFICE_OF = /\b(?:office of the|office of|cabinet de la|cabinet du|cabinet de l|cabinet de|bureau de la|bureau du|bureau de l|bureau de)\b\s*(.+)$/;
const PARL_SEC_TO = /\b(?:parliamentary secretary|secretaire parlementaire)\b\s*(?:to the|to|au|a la|aupres de la|aupres du|de la|du)?\s*(.*)$/;
const DEPUTY_OF = /\b(?:associate deputy minister|deputy minister|sous ministre)\b\s*(?:of the|of|delegue|des|de la|du|de)?\s*(.*)$/;

// French portfolio names cannot be machine-translated into the English roster,
// so the common ones are listed. An unlisted one returns an empty key and shows
// up in the unmatched report — which is the signal to add it here, not to
// widen the matching.
export const PORTFOLIO_ALIASES = {
  'premier ministre': 'prime minister',
  'premiere ministre': 'prime minister',
  'ministre des finances': 'minister of finance',
  'ministre de la sante': 'minister of health',
  'ministre de l environnement et du changement climatique': 'minister of environment and climate change',
  'ministre de l innovation des sciences et de l industrie': 'minister of innovation science and industry',
  'ministre de la justice': 'minister of justice',
  'ministre des transports': 'minister of transport',
  'ministre du commerce international': 'minister of international trade',
  'ministre de la defense nationale': 'minister of national defence',
  'ministre de l emploi': 'minister of employment',
  'ministre du revenu national': 'minister of national revenue',
};

// Leading noise on a portfolio phrase: articles, honorifics, and the
// office-of wrapper when it survived the split.
const LEAD_NOISE = /^(?:the|l|la|le|les|de|du|des|honourable|honorable|hon|right honourable|rt hon|office of the|office of)\b\s*/;

function tidyPortfolio(s) {
  let p = String(s || '').split(',')[0].trim();
  let prev;
  do { prev = p; p = p.replace(LEAD_NOISE, '').trim(); } while (p !== prev);
  // 'minister of finance canada' and 'department of finance canada' both name
  // the same chair in filings; the trailing country name never distinguishes.
  return p.replace(/\s+canada$/, '').trim();
}

/** kind of relationship between the named role and the office. */
export function classifyOfficeRole(text) {
  const t = clean(text).replace(/,/g, ' ');
  if (!t) return 'unknown';
  if (PARL_SEC.test(t)) return 'parl_sec';       // an MP in their own right
  if (DEPUTY.test(t)) return 'deputy';           // public service, not the political office
  if (STAFF.test(t)) return 'staff';             // exempt staff: the office, not the principal
  if (PRINCIPAL.test(t)) return 'principal';     // the office holder in person
  return 'unknown';
}

/**
 * @param roleText         the role/title text (from parseDpoh().role, or an
 *                         office_holding.title when indexing the roster)
 * @param institutionHint  institution column, used only when the role text
 *                         names no portfolio of its own
 * @param aliases          extra portfolio aliases, merged over the built-ins
 * @returns {{ key: string, kind: string, portfolio: string, via: string, raw: string }}
 *          `key` is '' when no portfolio could be identified — the caller must
 *          treat that as unmatched, never as a wildcard. `via` is 'role' when
 *          the key came from the title itself and 'institution' when it fell
 *          back to the institution column; an institution is a DEPARTMENT, not
 *          a minister's office, so a caller must not read a person out of it.
 */
export function canonicalRole(roleText, institutionHint = '', aliases = {}) {
  const raw = String(roleText || '').trim();
  const t = clean(roleText);
  const kind = classifyOfficeRole(t);
  const table = { ...PORTFOLIO_ALIASES, ...aliases };
  const alias = (s) => table[s] || s;

  const segments = t.split(',').map((s) => s.trim()).filter(Boolean);
  const findSeg = (re) => segments.find((s) => re.test(s)) || '';

  let portfolio = '';
  let via = 'role';
  if (kind === 'parl_sec') {
    // The portfolio a parliamentary secretary is attached to. They are a
    // distinct office holder, so the portfolio only qualifies their own title.
    const m = findSeg(PARL_SEC).match(PARL_SEC_TO);
    portfolio = tidyPortfolio(m ? m[1] : '');
    if (!portfolio) portfolio = tidyPortfolio(findSeg(PRINCIPAL));
  } else if (kind === 'deputy') {
    const m = findSeg(DEPUTY).match(DEPUTY_OF);
    portfolio = tidyPortfolio(m ? m[1] : '');
    // 'Deputy Minister, Innovation, Science and Economic Development Canada'
    // names the department in the segments AFTER the title, and that name is
    // itself full of commas, so it is rejoined before tidying.
    if (!portfolio) {
      const i = segments.findIndex((s) => DEPUTY.test(s));
      portfolio = tidyPortfolio(segments.slice(i + 1).join(' '));
    }
    if (!portfolio) { portfolio = tidyPortfolio(clean(institutionHint)); via = 'institution'; }
  } else {
    // Staff and principals alike: prefer an explicit 'Office of the ...',
    // otherwise the segment that names a minister.
    const officeSeg = segments.map((s) => s.match(OFFICE_OF)).find(Boolean);
    portfolio = tidyPortfolio(officeSeg ? officeSeg[1] : findSeg(PRINCIPAL));
    // No portfolio in the title? Then the institution IS the office being
    // named. This is the common case by a wide margin: 296,101 of 355,051
    // staff rows, every bare 'Minister' row, and every unclassifiable title
    // that still states which department the person works in.
    if (!portfolio) { portfolio = tidyPortfolio(clean(institutionHint)); via = 'institution'; }
  }

  portfolio = alias(portfolio);
  if (!portfolio) return { key: '', kind, portfolio: '', via, raw };

  const key = alias(
    kind === 'parl_sec' ? `parliamentary secretary to the ${portfolio}`
      : kind === 'deputy' ? (/^deputy minister/.test(portfolio) ? portfolio : `deputy minister of ${portfolio}`)
        : portfolio,
  );
  return { key, kind, portfolio, via, raw };
}
