import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

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
      const res = await fetch(url, { headers: { 'User-Agent': 'lobby-to-law/0.0.1 (open data research)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const text = await res.text();
      if (cachePath) { await mkdir(dirname(cachePath), { recursive: true }); await writeFile(cachePath, text); }
      return text;
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
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
      const res = await fetch(url, { headers: { 'User-Agent': 'lobby-to-law/0.0.1 (open data research)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      await mkdir(dirname(path), { recursive: true });
      await pipeline(Readable.fromWeb(res.body), createWriteStream(path));
      const { stat } = await import('node:fs/promises');
      return { path, bytes: (await stat(path)).size, contentType: res.headers.get('content-type') || '' };
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
  throw lastErr;
}
