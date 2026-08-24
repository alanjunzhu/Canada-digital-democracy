// CSV parsing for the OCL bulk exports.
//
// Encoding is not a detail here. Verified against the real
// Communication_SubjectMatterDetailsExport.csv: the OCL exports are
// **Windows-1252**, not UTF-8. Decoding them as UTF-8 does not throw — it
// quietly replaces every accented character, so 'Thériault' arrives as
// 'Th\uFFFDriault' and never matches the member roster again. Accents are load
// bearing in this pipeline, so the decode is explicit and reported.

/**
 * @returns {{ text: string, encoding: 'utf-8'|'windows-1252' }}
 */
export function decodeCsv(buf) {
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  // A BOM settles it outright.
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    // Not valid UTF-8: cp1252 decodes every byte, so this cannot fail, and it
    // is what the OCL actually ships.
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

// Minimal RFC 4180 parser. The OCL files contain quoted fields with embedded
// commas and newlines (subject-matter free text especially), so a split(',')
// shortcut silently corrupts rows — which would look like bad data later.

export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { quoted = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Returns { headers, records } where each record is a plain object.
export function parseCsvRecords(text) {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''));
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim());
  const records = rows.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, idx) => { o[h] = (r[idx] ?? '').trim(); });
    return o;
  });
  return { headers, records };
}

// Column mapping is kept declarative because the OCL header names are the one
// thing here that cannot be verified without the live file. `spec` maps a
// canonical key to a list of acceptable header names (case/space insensitive).
export function mapColumns(headers, spec) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const index = new Map(headers.map((h) => [norm(h), h]));
  const mapping = {};
  const missing = [];
  for (const [key, aliases] of Object.entries(spec)) {
    const hit = aliases.map(norm).find((a) => index.has(a));
    if (hit) mapping[key] = index.get(hit);
    else missing.push(key);
  }
  return { mapping, missing };
}
