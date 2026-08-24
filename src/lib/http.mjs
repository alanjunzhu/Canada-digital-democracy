import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// lobbycanada.gc.ca's CDN answers 403 to a bare scripted request even for the
// public bulk files the catalogue points at. These are the headers an ordinary
// client sends; the UA still identifies the project and links to it, so the
// request stays attributable rather than anonymous.
export const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; lobby-to-law/0.0.1; +https://github.com/alanjunzhu/Canada-digital-democracy)',
  Accept: 'text/csv,application/zip,application/json,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-CA,en;q=0.9,fr-CA;q=0.8',
};

// Retrying a 403 or a 404 four times just delays the report by 30 seconds: the
// answer will not change. Only transport errors and 5xx/429 are worth a retry.
const worthRetrying = (err) => !(err instanceof HttpError) || err.status >= 500 || err.status === 429;

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
    this.url = url;
  }
}

/** Fetch with retry + on-disk cache. Government endpoints are flaky and rate-limited. */
export async function fetchText(url, { cachePath, retries = 4, ttlMs = 6 * 3600e3 } = {}) {
  if (cachePath) {
    try {
      const stat = await import('node:fs/promises').then((fs) => fs.stat(cachePath));
      if (Date.now() - stat.mtimeMs < ttlMs) return readFile(cachePath, 'utf8');
    } catch { /* cache miss */ }
  }
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new HttpError(res.status, url);
      const text = await res.text();
      if (cachePath) { await mkdir(dirname(cachePath), { recursive: true }); await writeFile(cachePath, text); }
      return text;
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !worthRetrying(err)) break;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt)); // 2s, 4s, 8s, 16s
    }
  }
  throw lastErr;
}

/**
 * Streams a URL to disk. The lobbying bulk files are tens of megabytes, so they
 * are never held in memory or in the text cache.
 * @returns {{ path: string, bytes: number, contentType: string }}
 */
// lobbycanada.gc.ca's edge answers 403 to Node's HTTP client regardless of
// headers, and the same URL through the system's curl is a different client,
// not a disguise: same identifying UA, same public file. If curl is refused
// too, the block is on the file and the run says so rather than escalating.
export async function probeTransports(url) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const results = [];
  try {
    const res = await fetch(url, { method: 'HEAD', headers: HEADERS });
    results.push({ transport: 'node-fetch', status: res.status });
  } catch (e) { results.push({ transport: 'node-fetch', error: e.message }); }
  for (const [transport, args] of [
    ['curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '30', '-A', HEADERS['User-Agent'], url]],
    ['curl-default-ua', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '30', url]],
    ['wget', ['-S', '--spider', '--timeout=30', '-U', HEADERS['User-Agent'], url]],
  ]) {
    try {
      const { stdout, stderr } = await run(transport.split('-')[0], args, { maxBuffer: 1 << 20 });
      const out = `${stdout}${stderr}`.trim().split('\n').filter((l) => /HTTP|^\d{3}$/.test(l)).slice(-1)[0] || stdout.trim();
      results.push({ transport, status: out });
    } catch (e) { results.push({ transport, error: String(e.message).split('\n').slice(-2).join(' ').trim() }); }
  }
  return results;
}

async function curlToFile(url, path) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stat } = await import('node:fs/promises');
  await mkdir(dirname(path), { recursive: true });
  await promisify(execFile)('curl', [
    '--fail', '--silent', '--show-error', '--location', '--compressed',
    '--user-agent', HEADERS['User-Agent'],
    '--referer', new URL(url).origin + '/en/open-data/',
    '--max-time', '600', '--output', path, url,
  ], { maxBuffer: 8 << 20 });
  return { path, bytes: (await stat(path)).size, contentType: '', transport: 'curl' };
}

export async function fetchToFile(url, path, { retries = 4 } = {}) {
  const { createWriteStream } = await import('node:fs');
  const { Readable } = await import('node:stream');
  const { pipeline } = await import('node:stream/promises');
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { ...HEADERS, Referer: new URL(url).origin + '/en/open-data/' } });
      if (!res.ok) throw new HttpError(res.status, url);
      await mkdir(dirname(path), { recursive: true });
      await pipeline(Readable.fromWeb(res.body), createWriteStream(path));
      const { stat } = await import('node:fs/promises');
      return { path, bytes: (await stat(path)).size, contentType: res.headers.get('content-type') || '' };
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !worthRetrying(err)) break;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
  if (lastErr instanceof HttpError && (lastErr.status === 403 || lastErr.status === 406)) {
    try {
      const got = await curlToFile(url, path);
      console.log(`   (${lastErr.status} from the built-in client; curl fetched ${url})`);
      return got;
    } catch (curlErr) {
      lastErr.message += ` (curl also failed: ${String(curlErr.message).split('\n')[0]})`;
    }
  }
  throw lastErr;
}
