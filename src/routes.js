// 路由：公開 API、SSE、管理 API、ACCESS_KEY 檢查；其餘 GET 交給靜態檔
import { logInfo } from './log.js';
import { serveStatic } from './static.js';
import { validSubscription } from './push.js';
import { sendJson, setSecurityHeaders, readBody, safeEqual, checkBearer, parseCookies } from './respond.js';

/** 依 app 的各元件建立 request handler（async，錯誤由呼叫端處理） */
export function createHandler({ cfg, poller, hub, snapshot, creds, providers, rankings, push, publicDir }) {
  let lastTestAt = 0;

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

    // 排程喚醒：抓一輪、判斷要不要推播；有自己的 token，不經 ACCESS_KEY，也不算「有人在看」
    if (p === '/api/push/tick' && req.method === 'POST') {
      if (!cfg.pushTickToken || !checkBearer(req.headers.authorization, cfg.pushTickToken)) {
        return sendJson(res, 401, { error: 'unauthorized' });
      }
      await poller.pollOnce();
      const sent = await push.evaluate();
      return sendJson(res, 200, { ok: true, sent });
    }

    if (cfg.accessKey && !checkAccess(req, res, url)) return;

    if (p === '/api/usage' && req.method === 'GET') {
      poller.touch();
      return sendJson(res, 200, snapshot.snapshot(), { 'Cache-Control': 'no-store' });
    }

    if (p === '/api/rankings' && req.method === 'GET') {
      // OpenRouter 全站模型排行（公開資料，每小時最多抓一次）
      return sendJson(res, 200, (await rankings.get()) || { updatedAt: null, views: null }, { 'Cache-Control': 'no-store' });
    }

    if (p.startsWith('/api/push/')) return handlePush(req, res, p);

    if (p === '/api/stream' && req.method === 'GET') {
      return hub.add(req, res, snapshot.snapshot());
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, p, publicDir);

    sendJson(res, 405, { error: 'method not allowed' });
  }

  async function handlePush(req, res, p) {
    if (p === '/api/push/config' && req.method === 'GET') {
      return sendJson(res, 200, { enabled: push.enabled, publicKey: push.enabled ? cfg.vapidPublicKey : null }, { 'Cache-Control': 'no-store' });
    }
    if (!push.enabled) return sendJson(res, 404, { error: '推播未啟用' });
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
    let body;
    try {
      body = JSON.parse(await readBody(req, 4096));
    } catch {
      return sendJson(res, 400, { error: 'body 必須是 JSON 物件' });
    }
    if (!body || typeof body !== 'object') return sendJson(res, 400, { error: 'body 必須是 JSON 物件' });

    if (p === '/api/push/subscribe') {
      // 訂閱或改設定要推播密碼；其餘操作只要知道自己的 endpoint（無法猜到）
      if (!checkBearer(req.headers.authorization, cfg.pushKey)) return sendJson(res, 403, { error: '推播密碼不對' });
      const sub = validSubscription(body.subscription);
      if (!sub) return sendJson(res, 400, { error: '訂閱資料格式不對' });
      const prefs = push.subscribe(sub, body.prefs);
      logInfo('push subscribed');
      return sendJson(res, 200, { ok: true, prefs });
    }
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
    if (p === '/api/push/status') {
      const prefs = push.prefs(endpoint);
      return sendJson(res, 200, { subscribed: Boolean(prefs), prefs });
    }
    if (p === '/api/push/unsubscribe') {
      push.unsubscribe(endpoint);
      return sendJson(res, 200, { ok: true });
    }
    if (p === '/api/push/test') {
      if (Date.now() - lastTestAt < 30_000) return sendJson(res, 429, { error: '測試通知 30 秒內只能送一次' });
      lastTestAt = Date.now();
      const ok = await push.test(endpoint);
      return sendJson(res, ok ? 200 : 502, ok ? { ok: true } : { error: '送不出去，可能要重新訂閱' });
    }
    sendJson(res, 404, { error: 'not found' });
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

  return handle;
}
