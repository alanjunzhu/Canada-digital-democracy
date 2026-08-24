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
export async function fetchToFile(url, path, { retries = 4 } = {}) {
  const { createWriteStream } = await import('node:fs');
  const { Readable } = await import('node:stream');
  const { pipeline } = await import('node:stream/promises');
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { ...HEADERS, Referer: new URL(url).origin + '/' } });
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
  throw lastErr;
}
