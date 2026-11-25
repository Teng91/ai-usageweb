// 靜態檔（public/）：擋路徑穿越；HTML／JS／CSS 一律 no-cache，離線與速度交給 service worker
import fs from 'node:fs/promises';
import path from 'node:path';
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

export async function serveStatic(req, res, pathname, publicDir) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(publicDir, rel));
  if (!file.startsWith(publicDir + path.sep)) return sendJson(res, 404, { error: 'not found' });
  let data;
  try {
    data = await fs.readFile(file);
  } catch {
    return sendJson(res, 404, { error: 'not found' });
  }
  const ext = path.extname(file);
  // 否則新版本最多要等快取過期才出得來；只有圖示可以長期快取
  const cache = rel.startsWith('/icons/') ? 'public, max-age=86400' : 'no-cache';
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': cache,
    'Content-Length': data.length,
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}
