// Name normalization for Canadian parliamentary data.
//
// The hard cases, in the order they bite:
//   1. Diacritics      — Thériault / Theriault, Bérubé, Lebouthillier, Côté
//   2. Compound names  — St-Onge, Michaud-Shields, Blanchette-Joncas, O'Connell
//   3. Particles       — de Burgh, van Koeverden, Van Bynen (capitalization varies)
//   4. Order           — 'Doe, Jane' vs 'Jane Doe'
//   5. Given-name form — Robert / Bob / R.
//   6. Honorifics      — Hon., Right Hon., Dr., M., Mme
// Folding is only ever used for COMPARISON. Display always keeps the original,
// because stripping accents from a francophone MP's name in the UI is its own
// small act of erasure.

export function foldDiacritics(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const HONORIFICS = new Set([
  'hon', 'honourable', 'honorable', 'right', 'rt', 'dr', 'mr', 'mrs', 'ms',
  'mme', 'm', 'me', 'sir', 'the',
]);

export function stripHonorifics(s) {
  const parts = s.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < parts.length) {
    const token = foldDiacritics(parts[i]).toLowerCase().replace(/\.$/, '');
    if (HONORIFICS.has(token)) i++;
    else break;
  }
  return parts.slice(i).join(' ');
}

// Comparison key: fold, lowercase, collapse punctuation to spaces.
export function normalizeName(s) {
  return foldDiacritics(String(s || ''))
    .toLowerCase()
    .replace(/['’]/g, '')          // O'Connell -> oconnell
    .replace(/[^a-z0-9]+/g, ' ')   // hyphens/periods -> space
    .trim()
    .replace(/\s+/g, ' ');
}

const PARTICLES = new Set(['de', 'du', 'des', 'la', 'le', 'van', 'von', 'der', 'den', 'st', 'ste', 'mac', 'mc']);

// Index keys for a surname. A hyphenated or particled surname is indexed under
// the whole thing AND under each meaningful part, because filings are
// inconsistent about which half they keep.
export function surnameKeys(surname) {
  const n = normalizeName(surname);
  if (!n) return [];
  const keys = new Set([n, n.replace(/ /g, '')]);
  const parts = n.split(' ').filter((p) => p && !PARTICLES.has(p));
  if (parts.length > 1) for (const p of parts) if (p.length > 2) keys.add(p);
  return [...keys];
}

const NICKNAMES = [
  ['robert', 'bob', 'rob', 'bobby'], ['william', 'bill', 'will', 'billy'],
  ['richard', 'rick', 'dick', 'rich'], ['michael', 'mike'], ['james', 'jim', 'jamie'],
  ['john', 'jack', 'johnny'], ['joseph', 'joe'], ['charles', 'charlie', 'chuck'],
  ['thomas', 'tom'], ['edward', 'ed', 'ted', 'eddie'], ['anthony', 'tony'],
  ['daniel', 'dan', 'danny'], ['david', 'dave'], ['christopher', 'chris'],
  ['patrick', 'pat'], ['elizabeth', 'liz', 'beth', 'betty'], ['katherine', 'kathryn', 'kate', 'kathy', 'cathy'],
  ['margaret', 'peggy', 'maggie'], ['jennifer', 'jen', 'jenny'], ['susan', 'sue'],
  ['deborah', 'deb', 'debbie'], ['pamela', 'pam'], ['stephen', 'steven', 'steve'],
  ['andrew', 'andy', 'drew'], ['matthew', 'matt'], ['nicholas', 'nick'],
  ['alexandre', 'alex', 'alexander'], ['francois', 'frank'], ['jean', 'john'],
  ['genevieve', 'gen'], ['veronique', 'vero'], ['gabriel', 'gabe'],
];
const NICK_INDEX = new Map();
for (const group of NICKNAMES) for (const n of group) NICK_INDEX.set(n, group[0]);

export function canonicalGiven(given) {
  const n = normalizeName(given).split(' ')[0] || '';
  return NICK_INDEX.get(n) || n;
}

// 'exact' | 'nickname' | 'initial' | 'none'
export function givenNameMatch(a, b) {
  const na = normalizeName(a).split(' ').filter(Boolean);
  const nb = normalizeName(b).split(' ').filter(Boolean);
  if (!na.length || !nb.length) return 'none';
  const [fa, fb] = [na[0], nb[0]];
  if (fa === fb) return 'exact';
  if (canonicalGiven(fa) === canonicalGiven(fb)) return 'nickname';
  // Initial match: 'j' vs 'jane', but also 'j p' vs 'jean pierre'
  if (fa.length === 1 && fb.startsWith(fa)) return 'initial';
  if (fb.length === 1 && fa.startsWith(fb)) return 'initial';
  // Compound given names: 'jean pierre' vs 'jeanpierre' vs 'jean'
  if (na.join('') === nb.join('')) return 'exact';
  if (na.includes(fb) || nb.includes(fa)) return 'nickname';
  return 'none';
}

// 'exact' | 'part' | 'none'
export function surnameMatch(a, b) {
  const ka = new Set(surnameKeys(a));
  const kb = surnameKeys(b);
  if (!ka.size || !kb.length) return 'none';
  if (normalizeName(a).replace(/ /g, '') === normalizeName(b).replace(/ /g, '')) return 'exact';
  return kb.some((k) => ka.has(k)) ? 'part' : 'none';
}

// Splits 'Doe, Jane Marie' or 'Jane Marie Doe' into parts. `assumeCommaOrder`
// is trusted when present because it is unambiguous; otherwise the LAST token
// is taken as the surname, with compound surnames rejoined via particles.
export function splitPersonName(raw) {
  const cleaned = stripHonorifics(String(raw || '').trim().replace(/\s+/g, ' '));
  if (!cleaned) return { given: '', surname: '' };

  if (cleaned.includes(',')) {
    const [last, first = ''] = cleaned.split(',').map((s) => s.trim());
    return { given: first, surname: last };
  }
  const parts = cleaned.split(' ');
  if (parts.length === 1) return { given: '', surname: parts[0] };

  // Walk back over particles so 'Adam van Koeverden' keeps 'van Koeverden'.
  let cut = parts.length - 1;
  while (cut > 1 && PARTICLES.has(normalizeName(parts[cut - 1]))) cut--;
  return { given: parts.slice(0, cut).join(' '), surname: parts.slice(cut).join(' ') };
}
