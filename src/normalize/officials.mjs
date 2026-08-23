// Parses the DPOH field of a monthly communication report.
//
// The field is free-ish text and comes in several shapes:
//   'Doe, Jane, Member of Parliament, House of Commons'
//   'Jane Doe, Chief of Staff, Office of the Minister of Finance'
//   'The Honourable Jane Doe, Minister of Finance'
//   'Senior Policy Advisor, Office of the Prime Minister'   <- no person at all
//
// The last shape matters more than it looks: a large share of logged
// communications are with ministerial STAFF, who are DPOHs but not MPs. Those
// must be classified as 'staff', not thrown into the MP matcher where they
// would either fail loudly or, worse, false-match an MP with the same surname.

import { splitPersonName, normalizeName, foldDiacritics } from './names.mjs';

// All role matching runs on diacritic-folded text. JS \b is ASCII-only, so
// /\bd[ée]put[ée]\b/ never matches 'Député,' — the trailing 'é' is not a word
// character, so there is no boundary before the comma. Folding first sidesteps
// the whole class of bug rather than hand-writing lookarounds.
const fold = (s) => foldDiacritics(String(s || ''));

// Parliamentary secretaries ARE members of parliament. They must be tested
// before the staff patterns, which would otherwise claim them via 'secretary'.
const PARL_SEC_TITLES = [/\bparliamentary secretary\b/i, /\bsecretaire parlementaire\b/i];
const MP_TITLES = [/\bmember of parliament\b/i, /\bdepute?e?\b/i, /\bmp\b/i];
const SENATOR_TITLES = [/\bsenator\b/i, /\bsenat(eur|rice)\b/i];
const MINISTER_TITLES = [/\bminister\b/i, /\bministre\b/i, /\bsecretary of state\b/i];
const STAFF_TITLES = [
  /\bchief of staff\b/i, /\badvis[oe]r\b/i, /\bconseill[eè]r\b/i, /\bdirector\b/i,
  /\bassistant\b/i, /\bsecretary\b/i, /\bdeputy minister\b/i, /\bsous-ministre\b/i,
  /\bchef de cabinet\b/i, /\bpolicy\b/i, /\bpress\b/i,
];
// A trailing segment that is a role, not a name.
const ROLEISH = [...PARL_SEC_TITLES, ...MP_TITLES, ...SENATOR_TITLES, ...MINISTER_TITLES,
  ...STAFF_TITLES, /\boffice of\b/i, /\bcabinet\b/i, /\bhouse of commons\b/i,
  /\bchambre des communes\b/i, /\bsenate\b/i, /\bsenat\b/i];

const looksRoleish = (s) => ROLEISH.some((re) => re.test(fold(s)));

// Does this segment look like a person's name rather than a job title?
function looksLikePerson(seg) {
  if (!seg) return false;
  if (looksRoleish(seg)) return false;
  const words = seg.trim().split(/\s+/);
  return words.length <= 5 && /[A-Za-zÀ-ÿ]/.test(seg);
}

export function classifyRole(text) {
  const t = fold(text);
  if (!t.trim()) return 'unknown';
  if (PARL_SEC_TITLES.some((r) => r.test(t))) return 'parl_sec';
  if (MP_TITLES.some((r) => r.test(t))) return 'mp';
  if (SENATOR_TITLES.some((r) => r.test(t))) return 'senator';
  if (STAFF_TITLES.some((r) => r.test(t))) return 'staff';
  if (MINISTER_TITLES.some((r) => r.test(t))) return 'minister';
  return 'unknown';
}

// Roles whose holder sits in the House of Commons, and so should be matched
// against the MP roster. Ministers are included but flagged: a minister can be
// a senator, and the resolver must not force a Commons match.
const COMMONS_ROLES = new Set(['mp', 'parl_sec', 'minister', 'unknown']);
export const isCommonsRole = (roleClass) => COMMONS_ROLES.has(roleClass);

/**
 * @returns {{
 *   raw: string, kind: 'person'|'role_only',
 *   given: string, surname: string,
 *   role: string, roleClass: string, institution: string
 * }}
 */
// Single-word titles that can sit directly in front of a name, as French
// filings often do: 'Sénatrice Marie Dupont', 'Député Jean Tremblay'. Kept
// deliberately narrow — 'Deputy Minister' must NOT be read as a title + name.
const LEADING_PERSON_TITLES = /^(senator|senateur|senatrice|depute|deputee|mp)\b[\s.]*/i;

function stripLeadingPersonTitle(seg) {
  const folded = foldDiacritics(seg);
  const m = folded.match(LEADING_PERSON_TITLES);
  if (!m) return null;
  const rest = seg.slice(m[0].length).trim();
  return rest ? { title: seg.slice(0, m[0].length).trim(), rest } : null;
}

export function parseDpoh(raw, institutionHint = '') {
  const text = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!text) {
    return { raw: text, kind: 'role_only', given: '', surname: '', role: '', roleClass: 'unknown', institution: institutionHint };
  }

  // 'Doe, Jane, Minister of X' — comma-order names occupy the first TWO
  // segments, so only treat segment 2 as a role if it does not look like a
  // given name.
  const segs = text.split(',').map((s) => s.trim()).filter(Boolean);

  // 'Sénatrice Marie Dupont' -> title moves to the role, name stays a name.
  const lead = stripLeadingPersonTitle(segs[0] || '');
  const leadTitle = lead ? [lead.title] : [];
  if (lead) segs[0] = lead.rest;

  let nameText = '';
  let roleSegs = [];

  if (segs.length === 1) {
    nameText = looksLikePerson(segs[0]) ? segs[0] : '';
    roleSegs = nameText ? [] : [segs[0]];
  } else if (looksLikePerson(segs[0]) && looksLikePerson(segs[1])) {
    nameText = `${segs[0]}, ${segs[1]}`;   // surname, given
    roleSegs = segs.slice(2);
  } else if (looksLikePerson(segs[0])) {
    nameText = segs[0];                     // 'Jane Doe' then roles
    roleSegs = segs.slice(1);
  } else {
    roleSegs = segs;                        // pure role, no person named
  }

  const role = [...leadTitle, ...roleSegs].join(', ');
  const institution = institutionHint || roleSegs[roleSegs.length - 1] || '';
  const roleClass = classifyRole(`${role} ${institution}`);

  if (!nameText) {
    return { raw: text, kind: 'role_only', given: '', surname: '', role, roleClass, institution };
  }
  const { given, surname } = splitPersonName(nameText);
  if (!normalizeName(surname)) {
    return { raw: text, kind: 'role_only', given: '', surname: '', role, roleClass, institution };
  }
  return { raw: text, kind: 'person', given, surname, role, roleClass, institution };
}
