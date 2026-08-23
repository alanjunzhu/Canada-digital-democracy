// Extracts bill citations from lobbying registration subject text.
//
// This is the high-precision half of the join: when a registration says
// 'Bill C-69', that is a lobbyist declaring, under the Lobbying Act, which
// legislation they are working on.
//
// The trap: bill numbers RESET every session. 'C-69' is the 2018 environmental
// assessment act in 42-1 and something entirely unrelated in 45-1. A citation
// is therefore meaningless until it is scoped to a session, which we infer
// from the date of the communication (or the registration's effective date).
// Getting this wrong produces confident, sourced, completely false claims.

const BILL_RE = /\b(?:bill|projet\s+de\s+loi|p\.?l\.?)?\s*\b([CS])[-–—\s]?(\d{1,3})\b/gi;

/** Sessions must be supplied as [{ parliament, session, start_date, end_date }]. */
export function sessionForDate(sessions, date) {
  date = String(date || '').trim();
  if (!date) return null;
  return sessions.find((s) =>
    (!s.start_date || s.start_date <= date) && (!s.end_date || s.end_date >= date)) || null;
}

/**
 * @returns {Array<{ number: string, chamber: 'Commons'|'Senate', raw: string }>}
 */
export function extractBillRefs(text) {
  const out = new Map();
  if (!text) return [];
  for (const m of String(text).matchAll(BILL_RE)) {
    const letter = m[1].toUpperCase();
    const num = String(parseInt(m[2], 10));
    // A bare 'C 12' with no 'bill' cue is too weak; require the cue or a dash.
    const hasCue = /bill|projet|p\.?l\.?/i.test(m[0]) || /[-–—]/.test(m[0]);
    if (!hasCue) continue;
    const number = `${letter}-${num}`;
    if (!out.has(number)) {
      out.set(number, { number, chamber: letter === 'C' ? 'Commons' : 'Senate', raw: m[0].trim() });
    }
  }
  return [...out.values()];
}

/**
 * Links one registration's subject text to session-scoped bill ids.
 * `knownBillIds` is a Set of '45-1/C-69' strings; a citation that does not
 * correspond to a real bill in that session is reported, not invented.
 */
export function linkSubjectToBills(subjectText, date, sessions, knownBillIds) {
  const session = sessionForDate(sessions, date);
  const refs = extractBillRefs(subjectText);
  const links = [];
  const unmatched = [];
  for (const ref of refs) {
    if (!session) { unmatched.push({ ...ref, reason: 'no-session-for-date' }); continue; }
    const billId = `${session.parliament}-${session.session}/${ref.number}`;
    if (knownBillIds.has(billId)) {
      links.push({ bill_id: billId, method: 'citation', confidence: 0.95, raw: ref.raw });
    } else {
      unmatched.push({ ...ref, bill_id: billId, reason: 'no-such-bill-in-session' });
    }
  }
  return { links, unmatched, session };
}
