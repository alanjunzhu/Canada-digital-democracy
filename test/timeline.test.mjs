import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBillTimeline } from '../src/match/timeline.mjs';

const bill = { bill_id: '45-1/C-14', number: 'C-14', short_title: 'Test Act' };
const events = [
  { bill_id: '45-1/C-14', stage: 'second_reading', event_date: '2026-03-01' },
  { bill_id: '45-1/C-14', stage: 'first_reading', event_date: '2026-01-15' },
];
const comms = [
  { comm_date: '2026-02-10', posted_date: '2026-03-14', client_name: 'Northern Pipelines Inc.', official_label: 'Thériault' },
  { comm_date: '2026-02-18', posted_date: '2026-03-14', client_name: 'Northern Pipelines Inc.', official_label: 'van Koeverden' },
  { comm_date: '2025-09-01', posted_date: '2025-10-01', client_name: 'Old Corp', official_label: 'X' },
];

test('only communications inside the pre-stage window are counted', () => {
  const t = buildBillTimeline(bill, events, comms);
  const second = t.stages.find((s) => s.stage === 'second_reading');
  assert.equal(second.communications, 2);        // both February meetings
  assert.equal(second.distinct_clients, 1);
  const first = t.stages.find((s) => s.stage === 'first_reading');
  assert.equal(first.communications, 0);         // Sept 2025 is outside 60 days
});

test('stages come back in chronological order', () => {
  const t = buildBillTimeline(bill, events, comms);
  assert.deepEqual(t.stages.map((s) => s.stage), ['first_reading', 'second_reading']);
});

test('filing lag is reported: the public learned later than the meeting', () => {
  const t = buildBillTimeline(bill, events, comms);
  assert.equal(t.stages.find((s) => s.stage === 'second_reading').median_filing_lag_days, 28);
});
