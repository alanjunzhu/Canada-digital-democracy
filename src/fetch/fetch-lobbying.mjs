// Downloads the OCL Monthly Communication Reports bulk files.
//
// Why via CKAN rather than the OCL portal: the portal's download links are
// hash-pathed and rotate every publication, so hard-coding one guarantees a
// 404 within the month. The Open Government catalogue exposes the same
// dataset through a stable package id, and `package_show` returns whatever the
// current resource URLs are. One indirection, no scraping.
//
// The resource NAMES in that response are not verified here (this build
// environment has no egress to open.canada.ca), so the picker is written the
// same way as the column mapping: tolerant patterns, and every resource is
// printed so a wrong guess is visible immediately instead of silently
// downloading the wrong file.

import { COMMUNICATION_COLUMNS, DPOH_COLUMNS, COMM_SUBJECT_DETAIL_COLUMNS } from '../config/sources.mjs';
import { parseCsvRecords, mapColumns, decodeCsv } from '../lib/csv.mjs';
import { fetchText, fetchToFile, probeTransports } from '../lib/http.mjs';

const CKAN_PACKAGE = 'a34eb330-7136-4f5e-9f5f-3ba41df58b06';   // Monthly Communication Reports
export const ckanUrl = (id = CKAN_PACKAGE) => `https://open.canada.ca/data/api/3/action/package_show?id=${id}`;

const isDownloadable = (r) => /^(csv|zip)$/i.test(String(r.format || '').trim())
  || /\.(csv|zip)(\?|$)/i.test(String(r.url || ''));

// A resource is identified by what it is FOR, not by its position in the list:
// the catalogue reorders resources between publications.
const DPOH = /\b(dpoh|public office holder|titulaire d.une charge publique|tcpd|tpcd)\b/i;
const COMM = /\b(communication|communications?)\b/i;
const DICT = /(dictionar|dictionnaire)/i;   // 'Dictionary' / 'dictionnaire': no trailing \b, the suffix varies
const FRENCH = /(_fr\b|\bfr\.|français|francais)/i;

const label = (r) => `${r.name || ''} ${r.name_translated?.en || ''} ${r.description || ''} ${r.url || ''}`;

/**
 * Sorts a CKAN resource list into the two files the pipeline needs.
 * Returns nulls rather than guessing when nothing matches — the caller prints
 * the full list so a human can name the right resource explicitly.
 */
export function pickResources(resources = []) {
  const usable = resources.filter(isDownloadable);
  const prefer = (list) => list.find((r) => !FRENCH.test(label(r))) || list[0] || null;

  const dpoh = prefer(usable.filter((r) => DPOH.test(label(r)) && !DICT.test(label(r))));
  const communications = prefer(usable.filter((r) =>
    COMM.test(label(r)) && !DPOH.test(label(r)) && !DICT.test(label(r))));
  const dictionary = prefer(resources.filter((r) => DICT.test(label(r))));

  return {
    communications,
    dpoh,
    dictionary,
    all: resources.map((r) => ({ name: r.name || '(unnamed)', format: r.format || '', url: r.url || '' })),
  };
}

/**
 * Which file inside the archive is which.
 *
 * The two OCL bulk downloads unpack to eighteen CSVs between them, sharing
 * column names freely: several registration files also have a 'Name' column,
 * and a registration primary file looks a lot like a communication primary
 * file if you squint. So identification is gated on the COMMUNICATION key
 * first — a file without COMLOG_ID is not a communications file, whatever else
 * it looks like — and only then on what distinguishes the three:
 *
 *   dpoh           COMLOG_ID + a public-office-holder name
 *   communications COMLOG_ID + a communication date
 *   subjects       COMLOG_ID + free-text subject details
 *
 * @returns 'dpoh' | 'communications' | 'subjects' | null
 */
export function classifyCsvHeaders(headers) {
  const comm = mapColumns(headers, COMMUNICATION_COLUMNS);
  const dpoh = mapColumns(headers, DPOH_COLUMNS);
  const subj = mapColumns(headers, COMM_SUBJECT_DETAIL_COLUMNS);

  const hasCommId = Boolean(comm.mapping.communication_id || dpoh.mapping.communication_id || subj.mapping.communication_id);
  if (!hasCommId) return null;                       // a registration file, or something else entirely

  if (dpoh.mapping.dpoh_raw) return 'dpoh';
  if (comm.mapping.comm_date) return 'communications';
  if (subj.mapping.details) return 'subjects';
  return null;
}

/** Reads just the header line of a CSV — these files are tens of megabytes. */
export async function sniffHeaders(path) {
  const { open } = await import('node:fs/promises');
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const { text } = decodeCsv(buf.subarray(0, bytesRead));
    const firstLine = text.split(/\r?\n/)[0] || '';
    return parseCsvRecords(firstLine).headers;
  } finally {
    await fh.close();
  }
}

/**
 * Unzips into a directory of the archive's own name; CSVs pass through
 * untouched. Per-archive directories matter once there is more than one zip:
 * the communications and registrations downloads both contain files called
 * `Codes_SubjectMatterTypesExport.csv`, and flattening them would leave
 * whichever unzipped last.
 */
async function expand(path, dir) {
  if (!/\.zip$/i.test(path)) return [path];
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { readdir } = await import('node:fs/promises');
  const base = path.split('/').pop().replace(/\.zip$/i, '');
  const outDir = `${dir}/${base}`;
  await promisify(execFile)('unzip', ['-o', '-q', path, '-d', outDir]);
  const names = await readdir(outDir, { recursive: true });
  return names.filter((n) => /\.csv$/i.test(n)).map((n) => `${outDir}/${n}`);
}

/**
 * Expands every archive already sitting in the directory.
 *
 * Verified live: lobbycanada.gc.ca refuses a GitHub runner outright — node
 * fetch, curl with either user agent, and wget all get 403 — so the download
 * cannot be made to work from CI by changing headers. The supported way
 * through is to put the published zip somewhere the runner can reach (a
 * release asset on this repo) and drop it in `dir` before this runs. A file
 * already present is therefore not an error case, it is the mirror path.
 */
async function expandExisting(dir) {
  const { readdir } = await import('node:fs/promises');
  let names = [];
  try { names = await readdir(dir); } catch { return []; }
  const out = [];
  for (const n of names.filter((n) => /\.zip$/i.test(n))) out.push(...await expand(`${dir}/${n}`, dir));
  return out;
}

/**
 * @param overrides  { communications?: url, dpoh?: url, dictionary?: url }
 *   lobbycanada.gc.ca's edge refuses some clients outright. When it refuses the
 *   runner, the file can be put somewhere the runner CAN reach — a release
 *   asset on this repo is the obvious place — and named here (the workflow
 *   passes OCL_ZIP_URL through). The catalogue stays the default so the
 *   override does not quietly go stale.
 */
export async function fetchLobbyingBulk({ dir = 'data/raw', packageId = CKAN_PACKAGE, overrides = {} } = {}) {
  const pkg = JSON.parse(await fetchText(ckanUrl(packageId), { cachePath: `${dir}/ckan-package.json`, ttlMs: 3600e3 }));
  if (!pkg.success) throw new Error(`CKAN package_show failed for ${packageId}`);
  const picked = pickResources(pkg.result?.resources || []);

  // One resource failing must not hide the others: a 403 on the primary file
  // is itself a finding, and the dictionary is worth having either way.
  const downloaded = {};
  const failures = [];
  for (const key of ['communications', 'dpoh', 'dictionary']) {
    const res = overrides[key] ? { name: `override (${key})`, url: overrides[key] } : picked[key];
    if (!res) continue;
    const ext = /\.zip(\?|$)/i.test(res.url) ? 'zip' : /\.(xlsx?|ods)(\?|$)/i.test(res.url) ? 'xlsx' : 'csv';
    const target = `${dir}/${key}.${ext}`;
    try {
      const got = await fetchToFile(res.url, target);
      downloaded[key] = { ...got, name: res.name, source_url: res.url, files: await expand(target, dir) };
    } catch (err) {
      // When a download is refused, record WHICH clients are refused. That is
      // the difference between 'our request looked wrong' and 'this host does
      // not serve runners', and only one of those is fixable in code.
      failures.push({
        key, url: res.url, error: err.message, status: err.status ?? null,
        transports: await probeTransports(res.url).catch(() => []),
      });
    }
  }
  // The zip's members are named by whoever packed it, so every extracted CSV
  // is identified by its own headers rather than by its filename. Archives
  // already in the directory (the mirror path) are expanded and read the same
  // way as anything downloaded here — there is one code path, not two.
  const candidates = new Set([
    ...Object.values(downloaded).flatMap((got) => got.files || []),
    ...await expandExisting(dir),
  ]);
  const identified = {};
  const contents = [];
  for (const file of candidates) {
    if (!/\.csv$/i.test(file)) continue;
    const headers = await sniffHeaders(file);
    const kind = classifyCsvHeaders(headers);
    contents.push({ file, kind, headers });
    if (kind && !identified[kind]) identified[kind] = file;
  }

  return {
    picked, downloaded, failures, identified, contents,
    dataset_title: pkg.result?.title || '', modified: pkg.result?.metadata_modified || '',
  };
}
