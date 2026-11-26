import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { encryptPayload, vapidAuthorization, generateVapidKeys } from '../src/webpush.js';
import { evaluateAlerts, mergeAlerts, recordSample, parseQuiet, quietState, formatWhen, formatDuration, localParts } from '../src/alerts.js';
import { PushService, validSubscription } from '../src/push.js';
import { tmpDir } from './helpers.js';

const TZ = 'Asia/Taipei';
const QUIET = parseQuiet('00-08');
const MIN = 60_000;
const HOUR = 60 * MIN;
// 台北時間 2026-11-25 12:00
const NOON = Date.UTC(2026, 10, 25, 4, 0);

// ---------- 加密與簽名 ----------

test('內容加密符合 RFC 8291 附錄 A 的範例', () => {
  const out = encryptPayload('When I grow up, I want to be a watermelon', {
    p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  }, { senderPrivateKey: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', salt: 'DGv6ra1nlYgDCS1FRnbzlw' });
  assert.equal(out.toString('base64url'),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

test('VAPID JWT 可以用公鑰驗證，aud 是推播服務的 origin', () => {
  const keys = generateVapidKeys();
  const h = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', { ...keys, subject: 'https://example.test' }, NOON);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h);
  assert.ok(m);
  assert.equal(m[4], keys.publicKey);
  const claims = JSON.parse(Buffer.from(m[2], 'base64url'));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.exp, NOON / 1000 + 12 * 3600);
  const pub = Buffer.from(keys.publicKey, 'base64url');
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')));
});

// ---------- 規則 ----------

const prov = (windows, extra = {}) => ({ id: 'claude', name: 'Claude', status: 'ok', windows, ...extra });
const win = (usedPct, resetInMs, now, extra = {}) => ({ id: '5h', label: '5 小時', usedPct, resetsAt: new Date(now + resetInMs).toISOString(), periodSec: 18000, ...extra });

/** 依序餵樣本：points = [[距離 now 的毫秒, pct], ...]，最後一筆是現在 */
function run(points, { resetAt, now = NOON, sent = {}, w = {} } = {}) {
  const history = {};
  let last;
  for (const [dt, pct] of points) {
    const t = now + dt;
    last = { id: '5h', label: '5 小時', usedPct: pct, resetsAt: new Date(resetAt).toISOString(), periodSec: 18000, ...w };
    recordSample(history, `claude:${last.id}`, last, t);
  }
  return evaluateAlerts({ providers: [prov([last])], history, sent, now, tz: TZ, quiet: QUIET });
}

test('A：照目前速度會在重置前用完 → 預警', () => {
  // 30 分鐘漲 10 個百分點，剩 30% 約 90 分鐘用完，3 小時後才重置
  const a = run([[-30 * MIN, 60], [-15 * MIN, 65], [0, 70]], { resetAt: NOON + 3 * HOUR });
  assert.equal(a.length, 1);
  assert.equal(a[0].kind, 'usage');
  assert.equal(a[0].title, '⚠️ Claude 5 小時 已用 70%');
  assert.match(a[0].body, /照目前速度約 1 小時 30 分 用完，15:00 才重置/);
});

test('A：重置前用不完、或用量沒在漲、或還不到 50% → 不發', () => {
  assert.equal(run([[-30 * MIN, 60], [0, 70]], { resetAt: NOON + 60 * MIN }).length, 0, '重置前用不完');
  assert.equal(run([[-30 * MIN, 70], [0, 70]], { resetAt: NOON + 3 * HOUR }).length, 0, '沒在用');
  assert.equal(run([[-30 * MIN, 30], [0, 45]], { resetAt: NOON + 3 * HOUR }).length, 0, '還不到 50%');
  assert.equal(run([[-5 * MIN, 60], [0, 70]], { resetAt: NOON + 3 * HOUR }).length, 0, '樣本太短估不準');
});

test('A：95% 一定發，同一週期只發一次', () => {
  const a = run([[0, 96]], { resetAt: NOON + 2 * HOUR });
  assert.equal(a.length, 1);
  assert.match(a[0].body, /14:00 才重置/);
  const sent = Object.fromEntries(a[0].keys.map((k) => [k, 1]));
  assert.equal(run([[0, 97]], { resetAt: NOON + 2 * HOUR, sent }).length, 0);
});

test('A：重置時間每次差幾秒仍算同一週期', () => {
  const history = {};
  const h1 = recordSample(history, 'k', { usedPct: 10, resetsAt: new Date(NOON + HOUR).toISOString() }, NOON);
  const h2 = recordSample(history, 'k', { usedPct: 12, resetsAt: new Date(NOON + HOUR + 3000).toISOString() }, NOON + 2 * MIN);
  assert.equal(h1.cycle, h2.cycle);
  assert.equal(h2.samples.length, 2);
  const h3 = recordSample(history, 'k', { usedPct: 0, resetsAt: new Date(NOON + 6 * HOUR).toISOString() }, NOON + 2 * HOUR);
  assert.notEqual(h3.cycle, h1.cycle, '重置後換新週期');
  assert.equal(h3.samples.length, 1);
});

const weekly = { id: '7d', label: '每週', periodSec: 604800 };
// 單獨測「快重置」時，先把 80%／90% 門檻標成已發
const thresholdsSent = (resetAt) => ({ [`usage:claude:7d:${resetAt}:t80`]: 1, [`usage:claude:7d:${resetAt}:t90`]: 1 });

test('A：週／月額度到 80%、90% 各發一次（不看速度）', () => {
  const at = (pct, sent) => run([[-HOUR, pct], [0, pct]], { resetAt: NOON + 4 * 24 * HOUR, w: weekly, sent });
  const a = at(81);
  assert.equal(a.length, 1);
  assert.equal(a[0].kind, 'usage');
  assert.equal(a[0].title, '⚠️ Claude 每週 已用 81%');
  assert.match(a[0].body, /重置（還有 4 天）/);
  assert.ok(a[0].keys[0].endsWith(':t80'));
  const s80 = Object.fromEntries(a[0].keys.map((k) => [k, 1]));
  assert.equal(at(85, s80).length, 0, '80% 發過就不再發');
  const b = at(91, s80);
  assert.equal(b.length, 1, '90% 再發一次');
  assert.ok(b[0].keys[0].endsWith(':t90'));
  // 直接跳到 91%：只發 90% 那則，80% 一起記下
  const c = at(91);
  assert.deepEqual(c[0].keys.map((k) => k.split(':').pop()), ['t90', 't80']);
  // 95% 保底發過之後，不會再補 90%／80%
  const hard = Object.fromEntries(at(96)[0].keys.map((k) => [k, 1]));
  assert.equal(at(97, hard).length, 0);
  assert.equal(at(79).length, 0, '還不到 80%');
  assert.equal(run([[-HOUR, 81], [0, 81]], { resetAt: NOON + 3 * HOUR }).length, 0, '5 小時額度不用固定門檻');
});

test('B：24h 剩 ≥40%、12h 剩 ≥20%、6h 剩 ≥10%', () => {
  const at = (hoursLeft, pct, sent = {}) => {
    const resetAt = NOON + hoursLeft * HOUR;
    return run([[-HOUR, pct], [0, pct]], { resetAt, w: weekly, sent: { ...thresholdsSent(resetAt), ...sent } });
  };
  const a = at(20, 50);
  assert.equal(a.length, 1);
  assert.equal(a[0].kind, 'reset');
  assert.equal(a[0].title, '💡 Claude 每週 還剩 50%');
  assert.match(a[0].body, /明天 08:00 重置（還有 20 小時）/);
  assert.equal(at(20, 65).length, 0, '24h 內只剩 35% → 不發');
  assert.equal(at(30, 10).length, 0, '還不到 24h');
  assert.equal(at(10, 75).length, 1, '12h 剩 25%');
  assert.equal(at(10, 85).length, 0, '12h 剩 15%');
  assert.equal(at(5, 88).length, 1, '6h 剩 12%');
  // 發了 12h 之後，24h 那階也算發過，不會倒回去
  const sent = Object.fromEntries(at(10, 70)[0].keys.map((k) => [k, 1]));
  assert.ok(Object.keys(sent).some((k) => k.endsWith(':24h')));
  assert.equal(at(10, 70, sent).length, 0);
  assert.equal(at(5, 70, sent).length, 1, '下一階 6h 照發');
});

test('B：正在用（最近一小時有漲）或短週期 → 不發', () => {
  assert.equal(run([[-30 * MIN, 40], [0, 45]], { resetAt: NOON + 10 * HOUR, w: weekly }).length, 0, '正在用');
  assert.equal(run([[-HOUR, 10], [0, 10]], { resetAt: NOON + 4 * HOUR }).length, 0, '5 小時窗口');
  assert.equal(run([[-HOUR, 10], [0, 10]], { resetAt: NOON + 4 * HOUR, w: { id: 'x', periodSec: undefined } }).length, 0, '週期不明');
});

test('勿擾：00–08 不發；22–24 時把勿擾期間會遇到的提醒提前發', () => {
  const night = Date.UTC(2026, 10, 25, 18, 0); // 台北 02:00
  assert.equal(quietState(night, TZ, QUIET).quiet, true);
  assert.equal(run([[0, 99]], { now: night, resetAt: night + HOUR }).length, 0, '勿擾時段連 95% 也不發');

  const ten = Date.UTC(2026, 10, 25, 14, 0); // 台北 22:00
  const q = quietState(ten, TZ, QUIET);
  assert.equal(q.preQuiet, true);
  assert.equal(q.quietEndsAt, Date.UTC(2026, 10, 26, 0, 0)); // 隔天 08:00
  // 隔天 09:00 重置（距 22:00 有 11 小時）：6h 那階會落在勿擾期間（03:00）→ 現在先發
  const a = run([[-HOUR, 85], [0, 85]], { now: ten, resetAt: ten + 11 * HOUR, w: weekly, sent: thresholdsSent(ten + 11 * HOUR) });
  assert.equal(a.length, 1);
  assert.ok(a[0].keys[0].endsWith(':6h'));
  assert.match(a[0].body, /明天 09:00 重置/);
});

test('時間與長度的寫法', () => {
  assert.equal(formatWhen(NOON + 3 * HOUR, NOON, TZ), '15:00');
  assert.equal(formatWhen(NOON + 20 * HOUR, NOON, TZ), '明天 08:00');
  assert.equal(formatWhen(NOON + 3 * 86400_000, NOON, TZ), '11/28（六）12:00');
  assert.equal(formatDuration(35 * MIN), '35 分鐘');
  assert.equal(formatDuration(130 * MIN), '2 小時 10 分');
  assert.equal(formatDuration(20 * HOUR), '20 小時');
  assert.equal(formatDuration(3 * 86400_000), '3 天');
  assert.equal(parseQuiet('off'), null);
});

test('同一類的通知合成一則', () => {
  const m = mergeAlerts([
    { kind: 'usage', title: '⚠️ Claude 5 小時 已用 96%', body: '15:00 才重置' },
    { kind: 'usage', title: '⚠️ Codex 5 小時 已用 97%', body: '16:00 才重置' },
    { kind: 'reset', title: '💡 Copilot Chat 還剩 50%', body: '明天重置' },
  ]);
  assert.equal(m.length, 2);
  assert.equal(m[0].title, '⚠️ 額度警告（2 項）');
  assert.equal(m[0].body, 'Claude 5 小時 已用 96%：15:00 才重置\nCodex 5 小時 已用 97%：16:00 才重置');
  assert.equal(m[1].title, '💡 Copilot Chat 還剩 50%');
});

// ---------- 服務 ----------

const SUB = { endpoint: 'https://push.example.test/abc', keys: { p256dh: 'B'.padEnd(87, 'A'), auth: 'A'.repeat(22) } };

function service({ viewers = 0, send } = {}) {
  const viewersFn = typeof viewers === 'function' ? viewers : () => viewers;
  let now = NOON;
  const views = [];
  const snapshot = { snapshot: () => ({ providers: views }) };
  const calls = [];
  const svc = new PushService({
    dataDir: tmpDir(),
    vapid: { publicKey: 'x', privateKey: 'y', subject: 'https://example.test' },
    tz: TZ,
    quiet: QUIET,
    snapshot,
    viewers: viewersFn,
    now: () => now,
    send: send || (async (sub, payload) => { calls.push({ sub: sub.endpoint, payload }); return { ok: true, status: 201 }; }),
  });
  const feed = (pct, resetIn = 2 * HOUR) => {
    const v = { id: 'claude', name: 'Claude', status: 'ok', fetchedAt: new Date(now).toISOString(), windows: [win(pct, resetIn, now)] };
    views.length = 0;
    views.push(v);
    svc.observe(v);
  };
  return { svc, calls, feed, advance: (ms) => { now += ms; } };
}

test('PushService：送出、去重、prefs 關掉就不送', async () => {
  const { svc, calls, feed, advance } = service();
  svc.subscribe(SUB, { reset: false });
  feed(96);
  assert.equal(await svc.evaluate(), 1);
  assert.equal(calls[0].payload.tag, 'usage');
  assert.equal(calls[0].payload.title, '⚠️ Claude 5 小時 已用 96%');
  advance(2 * MIN);
  feed(97);
  assert.equal(await svc.evaluate(), 0, '同一週期不重發');
  svc.subscribe(SUB, { usage: false });
  assert.deepEqual(svc.prefs(SUB.endpoint), { usage: false, reset: false });
});

test('PushService：網頁開著時先不推也不記下，關掉後照樣推播', async () => {
  let viewers = 1;
  const { svc, calls, feed } = service({ viewers: () => viewers });
  svc.subscribe(SUB);
  feed(96);
  assert.equal(await svc.evaluate(), 0);
  assert.equal(calls.length, 0);
  assert.equal(Object.keys(svc.state.sent).length, 0);
  viewers = 0;
  assert.equal(await svc.evaluate(), 1);
  assert.equal(calls.length, 1);
});

test('PushService：訂閱失效（410）就刪掉', async () => {
  const { svc, feed } = service({ send: async () => ({ ok: false, gone: true, status: 410 }) });
  svc.subscribe(SUB);
  feed(96);
  await svc.evaluate();
  assert.equal(svc.state.subs.length, 0);
});

test('PushService：每家每天最多 4 則', async () => {
  const { svc, calls, feed, advance } = service();
  svc.subscribe(SUB);
  for (let i = 0; i < 6; i++) {
    feed(96, 2 * HOUR); // 每輪都是新週期（重置時間差很多）
    await svc.evaluate();
    advance(150 * MIN); // 12:00 到 22:00 有 5 輪不在勿擾時段
  }
  assert.equal(calls.length, 4);
});

test('PushService：被每日上限擋下的不算發過，隔天還會再判斷', async () => {
  const { svc, calls, feed, advance } = service();
  svc.subscribe(SUB);
  const day = localParts(NOON, TZ).dateKey;
  svc.state.daily.claude = { day, count: 4 };
  feed(96, 30 * HOUR);
  assert.equal(await svc.evaluate(), 0);
  assert.equal(Object.keys(svc.state.sent).length, 0, '沒送出就不記下');
  advance(20 * HOUR); // 隔天 08:00，勿擾結束
  feed(97, 10 * HOUR);
  assert.equal(await svc.evaluate(), 1);
  assert.equal(calls.length, 1);
});

test('PushService：送失敗不算發過也不算次數，下次再試', async () => {
  let fail = true;
  const sent = [];
  const { svc, feed, advance } = service({ send: async (sub, payload) => (fail ? { ok: false, gone: false, status: 500 } : (sent.push(payload), { ok: true, status: 201 })) });
  svc.subscribe(SUB);
  feed(96);
  assert.equal(await svc.evaluate(), 0);
  assert.equal(svc.state.daily.claude, undefined);
  fail = false;
  advance(2 * MIN);
  feed(96);
  assert.equal(await svc.evaluate(), 1);
  assert.equal(sent.length, 1);
  assert.equal(svc.state.daily.claude.count, 1);
});

test('PushService：沒有訂閱要這一類 → 記下但不算次數', async () => {
  const { svc, calls, feed } = service();
  svc.subscribe(SUB, { usage: false });
  feed(96);
  assert.equal(await svc.evaluate(), 0);
  assert.equal(calls.length, 0);
  assert.ok(Object.keys(svc.state.sent).length > 0);
  assert.equal(svc.state.daily.claude, undefined);
});

test('validSubscription 擋掉不合格的訂閱', () => {
  assert.ok(validSubscription(SUB));
  assert.equal(validSubscription({ ...SUB, endpoint: 'http://push.example.test/x' }), null);
  assert.equal(validSubscription({ ...SUB, keys: { p256dh: 'short', auth: 'x' } }), null);
  assert.equal(validSubscription(null), null);
});

// ---------- 路由 ----------

test('推播 API：訂閱要密碼、tick 要 token 且不算有人在看', async () => {
  const { createApp } = await import('../server.js');
  const keys = generateVapidKeys();
  const app = await createApp({
    dataDir: tmpDir(),
    credentialsKey: crypto.randomBytes(32).toString('base64'),
    enabledProviders: ['copilot'],
    accessKey: 'ak',
    vapidPublicKey: keys.publicKey,
    vapidPrivateKey: keys.privateKey,
    pushKey: 'pk',
    pushTickToken: 'tt',
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = (p, body, auth) => fetch(`${base}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'k=ak', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(body),
  });
  try {
    const cfg = await (await fetch(`${base}/api/push/config`, { headers: { Cookie: 'k=ak' } })).json();
    assert.deepEqual(cfg, { enabled: true, publicKey: keys.publicKey });
    assert.equal((await fetch(`${base}/api/push/config`)).status, 403, '沒有存取碼');

    assert.equal((await post('/api/push/subscribe', { subscription: SUB }, 'wrong')).status, 403);
    assert.equal((await post('/api/push/subscribe', { subscription: { endpoint: 'x' } }, 'pk')).status, 400);
    const ok = await post('/api/push/subscribe', { subscription: SUB, prefs: { reset: false } }, 'pk');
    assert.equal(ok.status, 200);
    assert.deepEqual((await ok.json()).prefs, { usage: true, reset: false });
    assert.deepEqual(await (await post('/api/push/status', { endpoint: SUB.endpoint })).json(), { subscribed: true, prefs: { usage: true, reset: false } });
    // 改通知種類不需要密碼，但只能改已訂閱的
    const pr = await post('/api/push/prefs', { endpoint: SUB.endpoint, prefs: { usage: false } });
    assert.equal(pr.status, 200);
    assert.deepEqual((await pr.json()).prefs, { usage: false, reset: false });
    assert.equal((await post('/api/push/prefs', { endpoint: 'https://push.example.test/nope', prefs: { usage: false } })).status, 404);
    await post('/api/push/unsubscribe', { endpoint: SUB.endpoint });
    assert.equal((await (await post('/api/push/status', { endpoint: SUB.endpoint })).json()).subscribed, false);

    // tick 不經 ACCESS_KEY，用自己的 token
    const noTok = await fetch(`${base}/api/push/tick`, { method: 'POST' });
    assert.equal(noTok.status, 401);
    const tick = await fetch(`${base}/api/push/tick`, { method: 'POST', headers: { Authorization: 'Bearer tt' } });
    assert.equal(tick.status, 200);
    assert.deepEqual(await tick.json(), { ok: true, sent: 0 });
    assert.equal(app.poller.running, false, 'tick 不啟動輪詢迴圈');
  } finally {
    await app.shutdown();
  }
});

test('沒設定 VAPID／PUSH_KEY 時推播關閉', async () => {
  const { createApp } = await import('../server.js');
  const app = await createApp({ dataDir: tmpDir(), credentialsKey: crypto.randomBytes(32).toString('base64'), enabledProviders: ['copilot'], accessKey: '', pushKey: '' });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    assert.deepEqual(await (await fetch(`${base}/api/push/config`)).json(), { enabled: false, publicKey: null });
    assert.equal((await fetch(`${base}/api/push/subscribe`, { method: 'POST', body: '{}' })).status, 404);
    assert.equal((await fetch(`${base}/api/push/tick`, { method: 'POST', headers: { Authorization: 'Bearer x' } })).status, 401);
  } finally {
    await app.shutdown();
  }
});
