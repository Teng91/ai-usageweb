// 推播 API：/api/push/tick（排程喚醒）與 /api/push/*（裝置訂閱、設定、測試）；由 routes.js 轉過來
import { logInfo } from './log.js';
import { validSubscription } from './push-store.js';
import { sendJson, readJsonBody, checkBearer } from './respond.js';

export function createPushRoutes({ cfg, poller, push }) {
  let lastTestAt = 0;

  /** 排程喚醒：抓一輪、判斷要不要推播；有自己的 token，不經 ACCESS_KEY，也不算「有人在看」 */
  async function tick(req, res) {
    if (!cfg.pushTickToken || !checkBearer(req.headers.authorization, cfg.pushTickToken)) {
      return sendJson(res, 401, { error: 'unauthorized' });
    }
    await poller.pollOnce();
    const sent = await push.evaluate();
    return sendJson(res, 200, { ok: true, sent });
  }

  async function handle(req, res, p) {
    if (p === '/api/push/config' && req.method === 'GET') {
      return sendJson(res, 200, { enabled: push.enabled, publicKey: push.enabled ? cfg.vapidPublicKey : null }, { 'Cache-Control': 'no-store' });
    }
    if (!push.enabled) return sendJson(res, 404, { error: '推播未啟用' });
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
    const body = await readJsonBody(req, 4096);
    if (!body) return sendJson(res, 400, { error: 'body 必須是 JSON 物件' });

    if (p === '/api/push/subscribe') {
      // 新增訂閱要推播密碼；查狀態、改通知種類、退訂、測試只要知道自己的 endpoint（無法猜到）
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
      // 設定只給已訂閱的裝置看
      return sendJson(res, 200, prefs ? { subscribed: true, prefs, settings: push.settings() } : { subscribed: false, prefs: null });
    }
    if (p === '/api/push/settings') {
      // 勿擾時段與週／月門檻（全站共用）；只有已訂閱的裝置能改
      if (!push.prefs(endpoint)) return sendJson(res, 404, { error: '這台裝置沒有訂閱' });
      const settings = push.updateSettings(body.settings);
      return settings ? sendJson(res, 200, { ok: true, settings }) : sendJson(res, 400, { error: '設定格式不對' });
    }
    if (p === '/api/push/prefs') {
      const prefs = push.updatePrefs(endpoint, body.prefs);
      return prefs ? sendJson(res, 200, { ok: true, prefs }) : sendJson(res, 404, { error: '這台裝置沒有訂閱' });
    }
    if (p === '/api/push/unsubscribe') {
      push.unsubscribe(endpoint);
      return sendJson(res, 200, { ok: true });
    }
    if (p === '/api/push/test') {
      // 沒訂閱的 endpoint 不佔用 30 秒的冷卻，免得別人亂送就讓自己的測試被擋
      if (!push.prefs(endpoint)) return sendJson(res, 404, { error: '這台裝置沒有訂閱' });
      if (push.now() - lastTestAt < 30_000) return sendJson(res, 429, { error: '測試通知 30 秒內只能送一次' });
      lastTestAt = push.now();
      const ok = await push.test(endpoint);
      return sendJson(res, ok ? 200 : 502, ok ? { ok: true } : { error: '送不出去，可能要重新訂閱' });
    }
    sendJson(res, 404, { error: 'not found' });
  }

  return { tick, handle };
}
