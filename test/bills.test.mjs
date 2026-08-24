import test from 'node:test';
import assert from 'node:assert/strict';
import { extractStageEvents, normalizeStage, describeShape } from '../src/fetch/fetch-bills.mjs';

const stages = (bill) => extractStageEvents(bill, '45-1/C-2').map((e) => `${e.stage}@${e.event_date}${e.chamber ? `/${e.chamber}` : ''}`).sort();

test('a date field whose KEY names the stage is an event', () => {
  // Verified live: LEGISinfo publishes these as scalar fields on the bill.
  const found = stages({
    PassedHouseFirstReadingDateTime: '2025-06-05T00:00:00',
    PassedSenateFirstReadingDateTime: '2025-09-18T00:00:00',
  });
  assert.deepEqual(found, ['first_reading@2025-06-05/Commons', 'first_reading@2025-09-18/Senate']);
});

test('a nested stage object with a name and a date is an event', () => {
  const found = stages({
    BillStages: {
      HouseBillStages: [
        { StateName: 'Second reading', StartDate: '2025-06-16' },
        { StateName: 'Report stage', StartDate: '2025-09-01' },   // not one of the six
      ],
      SenateBillStages: [{ StateName: 'Third reading', StartDate: '2025-10-02' }],
    },
  });
  assert.deepEqual(found, ['second_reading@2025-06-16/Commons', 'third_reading@2025-10-02/Senate']);
});

test('a date next to an unrecognized label is NOT an event', () => {
  // The extractor walks the whole record, so its only guard against inventing
  // stages is that the label must actually name one.
  assert.deepEqual(stages({ LatestBillEventDateTime: '2025-11-01', StatusName: 'At consideration in committee' }), []);
  assert.equal(normalizeStage('At consideration in committee'), null);
});

test('the same stage on the same day in the same chamber appears once', () => {
  const found = stages({
    PassedHouseFirstReadingDateTime: '2025-06-05',
    BillStages: { HouseBillStages: [{ StateName: 'First reading', StartDate: '2025-06-05' }] },
  });
  assert.equal(found.length, 1);
});

test('royal assent is picked up wherever it sits', () => {
  assert.deepEqual(stages({ ReceivedRoyalAssentDateTime: '2025-12-12' }), ['royal_assent@2025-12-12']);
});

test('the shape report keeps keys and drops values', () => {
  const shape = describeShape({ Id: 5, NumberCode: 'C-2', PassedHouseFirstReadingDateTime: '2025-06-05', BillStages: { HouseBillStages: [{ StateName: 'First reading' }] } });
  assert.equal(shape.Id, 'number');
  assert.equal(shape.NumberCode, 'string');
  assert.equal(shape.PassedHouseFirstReadingDateTime, 'date');
  assert.deepEqual(shape.BillStages.HouseBillStages, [{ StateName: 'string' }]);
});
