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

/**
 * One typo apart: a single substitution, insertion, deletion, OR a transposed
 * pair of adjacent letters.
 *
 * The transposition case is not an embellishment — it is the motivating one.
 * 'Hadju' for 'Hajdu' appears 119 times in the real file, and under plain
 * Levenshtein a swapped pair costs TWO edits, so a distance-1 rule would miss
 * exactly the error people actually make while typing.
 */
export function withinOneTypo(a, b) {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long.length - short.length > 1) return false;

  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  if (i === short.length) return long.length === short.length + 1;   // one trailing insert

  if (a.length === b.length) {
    // Substitution: the rest must match exactly.
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    // Transposition of the pair at i.
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  // Insertion or deletion at i.
  return short.slice(i) === long.slice(i + 1);
}

/**
 * The one surname in `keys` within a single edit of `surname` — or null.
 *
 * 'Hadju, Patty' appears 119 times in the real file and is Patty Hajdu, a
 * sitting minister. One transposed letter should not cost a person their
 * identity. But this only answers when the answer is unambiguous: a typo that
 * is within one edit of TWO different members is not a typo we can fix, it is
 * a coin flip, and it returns null.
 */
export function uniqueNearSurname(surname, keys, { minLength = 5 } = {}) {
  const n = normalizeName(surname).replace(/ /g, '');
  if (n.length < minLength) return null;
  let hit = null;
  for (const key of keys) {
    if (Math.abs(key.length - n.length) > 1) continue;
    if (withinOneTypo(n, key)) {
      if (hit && hit !== key) return null;              // two candidates: not a typo, a guess
      hit = key;
    }
  }
  return hit;
}
