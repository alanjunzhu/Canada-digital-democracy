import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCsv, parseCsvRecords } from '../src/lib/csv.mjs';

test('a Windows-1252 export keeps its accents', () => {
  // Verified against the real Communication_SubjectMatterDetailsExport.csv:
  // the OCL ships cp1252. Decoding it as UTF-8 replaces every accent, and
  // 'Thériault' stops matching the member roster.
  const bytes = Buffer.from([0x54, 0x68, 0xE9, 0x72, 0x69, 0x61, 0x75, 0x6C, 0x74]);  // Th<e9>riault
  const { text, encoding } = decodeCsv(bytes);
  assert.equal(encoding, 'windows-1252');
  assert.equal(text, 'Thériault');
});

test('valid UTF-8 is left alone', () => {
  const { text, encoding } = decodeCsv(Buffer.from('Thériault', 'utf8'));
  assert.equal(encoding, 'utf-8');
  assert.equal(text, 'Thériault');
});

test('a UTF-8 BOM is stripped rather than parsed into the first header', () => {
  const { text } = decodeCsv(Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('COMLOG_ID,X\n1,2\n')]));
  assert.deepEqual(parseCsvRecords(text).headers, ['COMLOG_ID', 'X']);
});
