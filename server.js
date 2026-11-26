// 進入點：組裝各元件（憑證、快照、輪詢、SSE、排行、路由）並啟動 HTTP 伺服器
// 路由在 src/routes.js、靜態檔在 src/static.js、回應小工具在 src/respond.js
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './src/config.js';
import { CredentialStore } from './src/credentials.js';
import { SnapshotStore } from './src/snapshot.js';
import { SseHub } from './src/sse.js';
import { Poller } from './src/poller.js';
import { loadProviders } from './src/providers/index.js';
import { RankingsService } from './src/rankings.js';
import { PushService } from './src/push.js';
import { parseQuiet } from './src/alerts.js';
import { createHandler } from './src/routes.js';
import { sendJson, safePath } from './src/respond.js';
import { logInfo, logWarn } from './src/log.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');

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
  const rankings = await new RankingsService({ dataDir: cfg.dataDir }).load();

  // 啟動時先把沒設定憑證的標成 disabled，前端就不會顯示空卡片
  for (const p of providers) {
    if (!p.isConfigured(creds.all())) snapshot.update(p.id, { status: 'disabled', error: null });
  }

  let poller;
  const push = await new PushService({
    dataDir: cfg.dataDir,
    vapid: cfg.pushKey ? { publicKey: cfg.vapidPublicKey, privateKey: cfg.vapidPrivateKey, subject: cfg.vapidSubject } : null,
    tz: cfg.pushTz,
    quiet: parseQuiet(cfg.pushQuiet),
    snapshot,
    viewers: () => poller.viewers,
  }).load();
  const hub = new SseHub({
    pingSec: cfg.ssePingSec,
    maxAgeSec: cfg.sseMaxAgeSec,
    maxClients: cfg.sseMaxClients,
    onJoin: (n) => poller.viewerJoined(n),
    onLeave: (n) => poller.viewerLeft(n),
  });
  poller = new Poller({
    providers,
    creds,
    snapshot,
    broadcast: (event, data) => {
      hub.broadcast(event, data);
      if (event === 'provider') push.observe(data);
    },
    pollIntervalSec: cfg.pollIntervalSec,
    idleGraceSec: cfg.idleGraceSec,
  });

  const handle = createHandler({ cfg, poller, hub, snapshot, creds, providers, rankings, push, publicDir: PUBLIC_DIR });
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      logWarn('request failed', { path: safePath(req.url), err: err?.code || err?.name || 'error' });
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
      else res.end();
    });
  });

  async function shutdown() {
    poller.stop();
    hub.closeAll();
    // 正在抓的等它結束：Claude／Codex 續期拿到的新 refresh token 一定要寫進 volume，舊的已經失效
    await poller.drain();
    await snapshot.save();
    await snapshot.flush();
    await push.flush();
    await new Promise((r) => server.close(() => r()));
  }

  return { server, poller, hub, snapshot, creds, providers, push, shutdown };
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
    // 抓取最多約 10 秒逾時；fly.toml 的 kill_timeout 是 15 秒，這裡 12 秒後強制結束
    const force = setTimeout(() => process.exit(0), 12_000);
    force.unref();
    try { await app.shutdown(); } finally { process.exit(0); }
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}
