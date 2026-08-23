import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBillRefs, linkSubjectToBills, sessionForDate } from '../src/match/bill-refs.mjs';
import { SESSIONS } from '../src/config/sources.mjs';

test('extracts English and French citations', () => {
  const refs = extractBillRefs('Re: Bill C-69 and Bill S-5, plus projet de loi C-11');
  assert.deepEqual(refs.map((x) => x.number), ['C-69', 'S-5', 'C-11']);
});

test('a bare letter-number with no bill cue is not a citation', () => {
  assert.deepEqual(extractBillRefs('under section C 12 of the schedule'), []);
});

test('the same bill number maps to different bills in different sessions', () => {
  const known = new Set(['44-1/C-69', '45-1/C-69']);
  assert.equal(linkSubjectToBills('Bill C-69', '2023-03-04', SESSIONS, known).links[0].bill_id, '44-1/C-69');
  assert.equal(linkSubjectToBills('Bill C-69', '2026-03-04', SESSIONS, known).links[0].bill_id, '45-1/C-69');
});

test('a citation with no matching bill is reported, not invented', () => {
  const res = linkSubjectToBills('Bill C-999', '2026-03-04', SESSIONS, new Set(['45-1/C-69']));
  assert.equal(res.links.length, 0);
  assert.equal(res.unmatched[0].reason, 'no-such-bill-in-session');
});

test('dates between sessions resolve to no session rather than the nearest one', () => {
  assert.equal(sessionForDate(SESSIONS, '2025-04-15'), null); // dissolution period
});
