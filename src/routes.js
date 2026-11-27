// 路由：公開 API、SSE、管理 API、ACCESS_KEY 檢查；推播 API 在 push-routes.js；其餘 GET 交給靜態檔
import { logInfo } from './log.js';
import { serveStatic } from './static.js';
import { createPushRoutes } from './push-routes.js';
import { sendJson, setSecurityHeaders, readJsonBody, safeEqual, checkBearer, parseCookies } from './respond.js';

/** 依 app 的各元件建立 request handler（async，錯誤由呼叫端處理） */
export function createHandler({ cfg, poller, hub, snapshot, creds, providers, rankings, push, publicDir }) {
  const pushRoutes = createPushRoutes({ cfg, poller, push });

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

    // 排程喚醒有自己的 token，不經 ACCESS_KEY
    if (p === '/api/push/tick' && req.method === 'POST') return pushRoutes.tick(req, res);

    if (cfg.accessKey && !checkAccess(req, res, url)) return;

    if (p === '/api/usage' && req.method === 'GET') {
      poller.touch();
      return sendJson(res, 200, snapshot.snapshot(), { 'Cache-Control': 'no-store' });
    }

    if (p === '/api/rankings' && req.method === 'GET') {
      // OpenRouter 全站模型排行（公開資料，每小時最多抓一次）
      const data = await rankings.get();
      // 還沒有資料（OpenRouter 暫時連不上）回 503：service worker 不存非 200，上次存下的排行不會被蓋掉
      if (!data) return sendJson(res, 503, { error: '排行榜暫時拿不到' }, { 'Cache-Control': 'no-store' });
      return sendJson(res, 200, data, { 'Cache-Control': 'no-store' });
    }

    if (p.startsWith('/api/push/')) return pushRoutes.handle(req, res, p);

    if (p === '/api/stream' && req.method === 'GET') {
      return hub.add(req, res, snapshot.snapshot());
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, p, publicDir);

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
      const prov = providers.find((x) => x.id === id);
      if (!prov) return sendJson(res, 404, { error: 'unknown provider' });
      const body = await readJsonBody(req, 64 * 1024);
      if (!body) return sendJson(res, 400, { error: 'body 必須是 JSON 物件' });
      const problem = checkCredentialBody(prov, body);
      if (problem) return sendJson(res, 400, problem);
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

/**
 * 管理 API 換憑證：只接受這家認得的欄位（值要是字串或數字），而且換完要能用。
 * 打錯欄位名稱（例如 refresh_token）會直接回 400，不會默默把那一家變成未設定。不回傳任何值。
 */
export function checkCredentialBody(prov, body) {
  const allowed = prov.credentialFields || [];
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length) return { error: `不認得的欄位：${unknown.join(', ')}`, allowed };
  const badType = Object.keys(body).filter((k) => !['string', 'number'].includes(typeof body[k]));
  if (badType.length) return { error: `欄位的值要是字串或數字：${badType.join(', ')}`, allowed };
  if (!prov.isConfigured({ [prov.id]: body })) return { error: '缺少必要欄位，換上去也不能用', allowed };
  return null;
}
