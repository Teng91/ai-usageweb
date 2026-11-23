import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from './src/config.js';
import { CredentialStore } from './src/credentials.js';
import { SnapshotStore } from './src/snapshot.js';
import { SseHub } from './src/sse.js';
import { Poller } from './src/poller.js';
import { loadProviders } from './src/providers/index.js';
import { logInfo, logWarn } from './src/log.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');

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

export async function createApp(opts = {}) {
  const cfg = { ...config, ...opts };
  const providers = loadProviders(cfg.enabledProviders);
  const creds = await new CredentialStore({
    dataDir: cfg.dataDir,
    keyB64: cfg.credentialsKey,
    reset: cfg.credentialsReset,
  }).load();
  const snapshot = await new SnapshotStore({
    dataDir: cfg.dataDir,
    pollIntervalSec: cfg.pollIntervalSec,
    providers,
  }).load();

  // 啟動時先把沒設定憑證的標成 disabled，前端就不會顯示空卡片
  for (const p of providers) {
    if (!p.isConfigured(creds.all())) snapshot.update(p.id, { status: 'disabled', error: null });
  }

  let poller;
  const hub = new SseHub({
    pingSec: cfg.ssePingSec,
    maxAgeSec: cfg.sseMaxAgeSec,
    onJoin: (n) => poller.viewerJoined(n),
    onLeave: (n) => poller.viewerLeft(n),
  });
  poller = new Poller({
    providers,
    creds,
    snapshot,
    broadcast: (event, data) => hub.broadcast(event, data),
    pollIntervalSec: cfg.pollIntervalSec,
    idleGraceSec: cfg.idleGraceSec,
  });

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      logWarn('request failed', { path: safePath(req.url), err: err?.code || err?.name || 'error' });
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
      else res.end();
    });
  });

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    setSecurityHeaders(res);

    if (p === '/healthz') {
      // 健康檢查不算「有人在看」
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('ok');
    }

    if (p.startsWith('/admin/')) return handleAdmin(req, res, url);

    if (cfg.accessKey && !checkAccess(req, res, url)) return;

    if (p === '/api/usage' && req.method === 'GET') {
      poller.touch();
      return sendJson(res, 200, snapshot.snapshot(), { 'Cache-Control': 'no-store' });
    }

    if (p === '/api/stream' && req.method === 'GET') {
      return hub.add(req, res, snapshot.snapshot());
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, p);

    sendJson(res, 405, { error: 'method not allowed' });
  }

  async function handleAdmin(req, res, url) {
    if (!cfg.adminToken || !checkBearer(req.headers.authorization, cfg.adminToken)) {
      return sendJson(res, 401, { error: 'unauthorized' });
    }
    const p = url.pathname;
    if (p === '/admin/refresh' && req.method === 'POST') {
      poller.refreshNow();
      return sendJson(res, 202, { ok: true });
    }
    if (p === '/admin/status' && req.method === 'GET') {
      const st = poller.status();
      for (const prov of providers) {
        const c = creds.get(prov.id);
        st.providers[prov.id].tokenExpiresAt = c?.expiresAt ? new Date(Number(c.expiresAt)).toISOString() : null;
        st.providers[prov.id].hasRefreshToken = Boolean(c?.refreshToken);
      }
      return sendJson(res, 200, st);
    }
    const m = p.match(/^\/admin\/credentials\/([a-z]+)$/);
    if (m && req.method === 'PUT') {
      const id = m[1];
      if (!providers.some((x) => x.id === id)) return sendJson(res, 404, { error: 'unknown provider' });
      let body;
      try {
        body = JSON.parse(await readBody(req, 64 * 1024));
      } catch {
        return sendJson(res, 400, { error: 'body 必須是 JSON 物件' });
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return sendJson(res, 400, { error: 'body 必須是 JSON 物件' });
      }
      await creds.replace(id, body);
      poller.credentialsChanged(id);
      logInfo('credentials replaced', { provider: id });
      return sendJson(res, 200, { ok: true, provider: id });
    }
    sendJson(res, 404, { error: 'not found' });
  }

  function checkAccess(req, res, url) {
    const cookieKey = parseCookies(req.headers.cookie).k;
    const queryKey = url.searchParams.get('k');
    if (queryKey && safeEqual(queryKey, cfg.accessKey)) {
      res.setHeader('Set-Cookie', `k=${encodeURIComponent(queryKey)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`);
      return true;
    }
    if (cookieKey && safeEqual(cookieKey, cfg.accessKey)) return true;
    // 靜態外殼與 icon 不擋，PWA 才能安裝；資料 API 一律要 key
    if (!url.pathname.startsWith('/api/')) return true;
    sendJson(res, 403, { error: '需要存取碼' });
    return false;
  }

  async function shutdown() {
    poller.stop();
    hub.closeAll();
    await snapshot.save();
    await snapshot.flush();
    await new Promise((r) => server.close(() => r()));
  }

  return { server, poller, hub, snapshot, creds, providers, shutdown };
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 404, { error: 'not found' });
  let data;
  try {
    data = await fs.readFile(file);
  } catch {
    return sendJson(res, 404, { error: 'not found' });
  }
  const ext = path.extname(file);
  const base = path.basename(file);
  // sw.js、HTML、manifest 不能長期快取，否則新版本出不來；其他交給 service worker 的版本號
  const cache = ['sw.js', 'index.html', 'manifest.webmanifest'].includes(base)
    ? 'no-cache'
    : 'public, max-age=3600';
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': cache,
    'Content-Length': data.length,
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; manifest-src 'self'",
  );
}

function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function checkBearer(header, token) {
  if (!header || !token) return false;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return Boolean(m) && safeEqual(m[1].trim(), token);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function safePath(u = '') {
  return String(u).split('?')[0];
}

// ---- 直接執行時啟動 ----
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const app = await createApp();
  app.server.listen(config.port, '0.0.0.0', () => {
    logInfo('listening', {
      port: config.port,
      providers: app.providers.map((p) => p.id),
      configured: app.providers.filter((p) => p.isConfigured(app.creds.all())).map((p) => p.id),
    });
  });
  let closing = false;
  const onSignal = async (sig) => {
    if (closing) return;
    closing = true;
    logInfo('shutting down', { signal: sig });
    const force = setTimeout(() => process.exit(0), 8000);
    force.unref();
    try { await app.shutdown(); } finally { process.exit(0); }
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}
