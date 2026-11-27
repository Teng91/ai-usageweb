// 靜態檔（public/）：擋路徑穿越；文字檔先壓好（br／gzip）放在記憶體，帶 ETag（沒改就回 304）
// 檔案改了（大小或修改時間變了）才重讀，本機開發改 public/ 不必重開伺服器。
// HTML／JS／CSS 一律 no-cache（每次都問一下），離線與速度交給 service worker
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { sendJson } from './respond.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// 壓縮有用的文字檔；太小的不壓（省不了多少，還要多一個標頭）
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.txt']);
const MIN_COMPRESS_BYTES = 512;
const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

const cache = new Map(); // 檔案路徑 → { mtimeMs, size, entry: Promise<{ raw, br, gzip, hash }> }

async function build(file, raw) {
  const entry = { raw, hash: crypto.createHash('sha1').update(raw).digest('base64url').slice(0, 20) };
  if (COMPRESSIBLE.has(path.extname(file)) && raw.length >= MIN_COMPRESS_BYTES) {
    [entry.br, entry.gzip] = await Promise.all([
      brotli(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }),
      gzip(raw, { level: 9 }),
    ]);
  }
  return entry;
}

/** 讀檔（有快取就用快取）；不存在或不是檔案丟錯 */
async function load(file) {
  const st = await fs.stat(file);
  if (!st.isFile()) throw new Error('not a file');
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.entry;
  const entry = fs.readFile(file).then((raw) => build(file, raw));
  cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, entry });
  entry.catch(() => cache.delete(file));
  return entry;
}

/** Accept-Encoding 有沒有接受這種壓縮（q=0 算不接受） */
export function acceptsEncoding(header, enc) {
  return String(header || '').split(',').some((part) => {
    const [name, ...params] = part.trim().toLowerCase().split(';').map((s) => s.trim());
    if (name !== enc) return false;
    const q = params.find((x) => x.startsWith('q='));
    return !q || Number(q.slice(2)) > 0;
  });
}

export async function serveStatic(req, res, pathname, publicDir) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return sendJson(res, 400, { error: 'bad path' }); // 例如 /%E0：不該變成 500
  }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(publicDir, rel));
  if (!file.startsWith(publicDir + path.sep)) return sendJson(res, 404, { error: 'not found' });
  let entry;
  try {
    entry = await load(file);
  } catch {
    return sendJson(res, 404, { error: 'not found' });
  }

  const ae = req.headers['accept-encoding'];
  const enc = entry.br && acceptsEncoding(ae, 'br') ? 'br' : entry.gzip && acceptsEncoding(ae, 'gzip') ? 'gzip' : null;
  // 不同壓縮是不同的內容，ETag 也要不同
  const etag = `"${entry.hash}${enc ? `-${enc}` : ''}"`;
  // 否則新版本最多要等快取過期才出得來；只有圖示可以長期快取
  const headers = {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': rel.startsWith('/icons/') ? 'public, max-age=86400' : 'no-cache',
    ETag: etag,
  };
  if (entry.br) headers.Vary = 'Accept-Encoding';

  const inm = String(req.headers['if-none-match'] || '');
  if (inm && inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) {
    res.writeHead(304, headers);
    return res.end();
  }
  const body = enc ? entry[enc] : entry.raw;
  if (enc) headers['Content-Encoding'] = enc;
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}
