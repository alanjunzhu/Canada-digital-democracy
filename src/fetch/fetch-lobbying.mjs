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

import { COMMUNICATION_COLUMNS, DPOH_COLUMNS } from '../config/sources.mjs';
import { parseCsvRecords, mapColumns } from '../lib/csv.mjs';
import { fetchText, fetchToFile } from '../lib/http.mjs';

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
 * Verified live: the catalogue publishes ONE resource for this dataset — a zip
 * holding both the primary and the DPOH secondary file — so the two cannot be
 * told apart by resource name. They are identified by their headers instead,
 * which is the only property that actually distinguishes them, and which
 * doubles as a check that the column mapping still holds.
 *
 * @returns 'dpoh' | 'communications' | null   (null = neither, e.g. a readme)
 */
export function classifyCsvHeaders(headers) {
  const score = (spec) => Object.keys(spec).length - mapColumns(headers, spec).missing.length;
  const dpoh = mapColumns(headers, DPOH_COLUMNS);
  const comm = mapColumns(headers, COMMUNICATION_COLUMNS);
  // A DPOH file is the one carrying a public-office-holder name column; nothing
  // else in the dataset has one.
  if (dpoh.mapping.dpoh_raw) return 'dpoh';
  if (comm.mapping.comm_date || score(COMMUNICATION_COLUMNS) >= 3) return 'communications';
  return score(DPOH_COLUMNS) >= 3 ? 'dpoh' : null;
}

/** Reads just the header line of a CSV — these files are tens of megabytes. */
export async function sniffHeaders(path) {
  const { open } = await import('node:fs/promises');
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const firstLine = buf.subarray(0, bytesRead).toString('utf8').split(/\r?\n/)[0] || '';
    return parseCsvRecords(firstLine).headers;
  } finally {
    await fh.close();
  }
}

/** Unzips in place with the system `unzip`; CSVs are passed through untouched. */
async function expand(path, dir) {
  if (!/\.zip$/i.test(path)) return [path];
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { readdir } = await import('node:fs/promises');
  await promisify(execFile)('unzip', ['-o', '-q', path, '-d', dir]);
  const names = await readdir(dir);
  return names.filter((n) => /\.csv$/i.test(n)).map((n) => `${dir}/${n}`);
}

export async function fetchLobbyingBulk({ dir = 'data/raw', packageId = CKAN_PACKAGE } = {}) {
  const pkg = JSON.parse(await fetchText(ckanUrl(packageId), { cachePath: `${dir}/ckan-package.json`, ttlMs: 3600e3 }));
  if (!pkg.success) throw new Error(`CKAN package_show failed for ${packageId}`);
  const picked = pickResources(pkg.result?.resources || []);

  // One resource failing must not hide the others: a 403 on the primary file
  // is itself a finding, and the dictionary is worth having either way.
  const downloaded = {};
  const failures = [];
  for (const key of ['communications', 'dpoh', 'dictionary']) {
    const res = picked[key];
    if (!res) continue;
    const ext = /\.zip(\?|$)/i.test(res.url) ? 'zip' : /\.(xlsx?|ods)(\?|$)/i.test(res.url) ? 'xlsx' : 'csv';
    const target = `${dir}/${key}.${ext}`;
    try {
      const got = await fetchToFile(res.url, target);
      downloaded[key] = { ...got, name: res.name, source_url: res.url, files: await expand(target, dir) };
    } catch (err) {
      failures.push({ key, url: res.url, error: err.message, status: err.status ?? null });
    }
  }
  // The zip's members are named by whoever packed it, so every extracted CSV
  // is identified by its own headers rather than by its filename.
  const identified = {};
  const contents = [];
  for (const got of Object.values(downloaded)) {
    for (const file of got.files || []) {
      if (!/\.csv$/i.test(file)) continue;
      const headers = await sniffHeaders(file);
      const kind = classifyCsvHeaders(headers);
      contents.push({ file, kind, headers });
      if (kind && !identified[kind]) identified[kind] = file;
    }
  }

  return {
    picked, downloaded, failures, identified, contents,
    dataset_title: pkg.result?.title || '', modified: pkg.result?.metadata_modified || '',
  };
}
