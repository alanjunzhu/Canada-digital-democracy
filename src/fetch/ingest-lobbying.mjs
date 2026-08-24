// Ingests OCL bulk CSVs into normalized rows.
//
// Runs against a LOCAL file by design. The OCL media URLs are hash-pathed and
// rotate; a pipeline that hard-codes them breaks silently a month later. The
// operator downloads the zip, we ingest the CSV, and the file is checked for
// shape before a single row is trusted.

import { readFile } from 'node:fs/promises';
import { parseCsvRecords, mapColumns, decodeCsv } from '../lib/csv.mjs';

/** Reads a bulk CSV as bytes and decodes it as what it actually is. */
export async function readCsvText(path) {
  return decodeCsv(await readFile(path));
}

export async function probeColumns(path, spec) {
  const { text, encoding } = await readCsvText(path);
  const { headers } = parseCsvRecords(text);
  const { mapping, missing } = mapColumns(headers, spec);
  return { path, headers, mapping, missing, encoding };
}

/**
 * @throws if any expected column is missing — better a hard stop than a table
 *         of undefined values that looks like sparse data.
 */
export async function ingestCsv(path, spec, { strict = true } = {}) {
  const { text, encoding } = await readCsvText(path);
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
    for (const [key, header] of Object.entries(mapping)) o[key] = emptyToNull(r[header]);
    return o;
  });
  return { rows, mapping, missing, headers, encoding };
}

/**
 * The export writes missing values as the four characters 'null', not as an
 * empty cell — 1,712 communications have a client named 'null'. Left alone it
 * becomes the busiest lobbying client in Canada.
 */
export const emptyToNull = (v) => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === '' || /^(null|n\/a)$/i.test(t) ? null : t;
};

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

/**
 * The DPOH export gives the official's name in separate surname / given
 * columns, so `dpoh_raw` — the verbatim evidence string the rest of the
 * pipeline stores and resolves — is composed here, in 'Surname, Given' order.
 *
 * That order is not cosmetic: `parseDpoh` treats a comma as an unambiguous
 * signal of surname-first, which is exactly what these columns mean. Composing
 * 'Given Surname' instead would throw away the one thing the file tells us for
 * certain.
 *
 * Rows that already carry a free-text name (the registration-side files) are
 * passed through untouched.
 */
export function normalizeDpohRows(rows) {
  return rows.map((r) => {
    if (r.dpoh_raw) return r;
    const surname = (r.dpoh_surname || '').trim();
    const given = (r.dpoh_given || '').trim();
    const dpoh_raw = surname && given ? `${surname}, ${given}` : surname || given || '';
    // An official with no name at all is a role-only row, and the title column
    // is what carries the role. Both are preserved verbatim.
    return { ...r, dpoh_raw };
  });
}
