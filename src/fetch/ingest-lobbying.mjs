// Ingests OCL bulk CSVs into normalized rows.
//
// Runs against a LOCAL file by design. The OCL media URLs are hash-pathed and
// rotate; a pipeline that hard-codes them breaks silently a month later. The
// operator downloads the zip, we ingest the CSV, and the file is checked for
// shape before a single row is trusted.

import { readFile } from 'node:fs/promises';
import { parseCsvRecords, mapColumns } from '../lib/csv.mjs';

export async function probeColumns(path, spec) {
  const { headers } = parseCsvRecords(await readFile(path, 'utf8'));
  const { mapping, missing } = mapColumns(headers, spec);
  return { path, headers, mapping, missing };
}

/**
 * @throws if any expected column is missing — better a hard stop than a table
 *         of undefined values that looks like sparse data.
 */
export async function ingestCsv(path, spec, { strict = true } = {}) {
  const text = await readFile(path, 'utf8');
  const { headers, records } = parseCsvRecords(text);
  const { mapping, missing } = mapColumns(headers, spec);
  if (missing.length && strict) {
    throw new Error(
      `Column mapping failed for ${path}.\n` +
      `  missing canonical keys: ${missing.join(', ')}\n` +
      `  actual headers: ${headers.join(' | ')}\n` +
      `  Fix: add the real header names to the alias lists in src/config/sources.mjs`,
    );
  }
  const rows = records.map((r) => {
    const o = {};
    for (const [key, header] of Object.entries(mapping)) o[key] = r[header] ?? null;
    return o;
  });
  return { rows, mapping, missing, headers };
}

export const isoDate = (s) => {
  if (!s) return null;
  const t = String(s).trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);          // dd/mm/yyyy or mm/dd/yyyy
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(t);
  return Number.isNaN(+d) ? null : d.toISOString().slice(0, 10);
};
