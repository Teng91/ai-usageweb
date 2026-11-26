import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { tmpDir, mockFetch, fixture } from './helpers.js';

process.env.OPENROUTER_API_KEY = 'test-key';
const { createApp } = await import('../server.js');

let app;
let base;
let mock;
const ADMIN = 'admin-secret';

before(async () => {
  mock = mockFetch([['openrouter.ai/api/v1/credits', () => ({ json: fixture('openrouter-credits.json') })]]);
  app = await createApp({
    dataDir: tmpDir(),
    credentialsKey: crypto.randomBytes(32).toString('base64'),
    adminToken: ADMIN,
    enabledProviders: ['openrouter', 'copilot'],
    accessKey: '',
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

after(async () => {
  await app.shutdown();
  mock.restore();
});

// mock 只攔外部網址，打本機伺服器的請求會照常送出
const realFetch = (url, init) => fetch(url, init);

test('GET /healthz 不觸發輪詢', async () => {
  const res = await realFetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ok');
  assert.equal(app.poller.running, false);
});

test('GET / 回 PWA 頁面', async () => {
  const res = await realFetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /AI 用量/);
});

test('路徑穿越被擋', async () => {
  const res = await realFetch(`${base}/..%2fserver.js`);
  assert.equal(res.status, 404);
});

test('壞掉的 URL 編碼回 400，不是 500', async () => {
  const res = await realFetch(`${base}/%E0`);
  assert.equal(res.status, 400);
});

test('parseCookies：壞掉的 cookie 值不會丟錯', async () => {
  const { parseCookies } = await import('../src/respond.js');
  assert.deepEqual(parseCookies('a=%E0; k=x%20y'), { a: '%E0', k: 'x y' });
});

test('GET /api/usage 回快照，並喚醒輪詢；未設定的服務標 disabled', async () => {
  const res = await realFetch(`${base}/api/usage`);
  const snap = await res.json();
  assert.equal(snap.version, 1);
  assert.deepEqual(snap.providers.map((p) => p.id), ['copilot', 'openrouter']);
  assert.equal(snap.providers[0].status, 'disabled');
  assert.equal(app.poller.running, true);
  // 第一次抓取有 0–2 秒隨機延遲
  const deadline = Date.now() + 5000;
  while (app.snapshot.view('openrouter').status !== 'ok' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const after = app.snapshot.view('openrouter');
  assert.equal(after.status, 'ok');
  assert.equal(after.balance.remaining, 7.42);
});

test('GET /api/stream 先送 snapshot', async () => {
  const ctrl = new AbortController();
  const res = await realFetch(`${base}/api/stream`, { signal: ctrl.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const reader = res.body.getReader();
  let text = '';
  while (!text.includes('event: snapshot')) {
    const { value } = await reader.read();
    text += Buffer.from(value).toString('utf8');
  }
  assert.match(text, /retry: 5000/);
  assert.equal(app.hub.count, 1);
  ctrl.abort();
});

test('admin 需要 token', async () => {
  let res = await realFetch(`${base}/admin/status`);
  assert.equal(res.status, 401);
  res = await realFetch(`${base}/admin/status`, { headers: { Authorization: `Bearer ${ADMIN}` } });
  assert.equal(res.status, 200);
  const st = await res.json();
  assert.equal(st.providers.openrouter.configured, true);
  assert.ok(!JSON.stringify(st).includes('test-key'), '不洩漏 token');
});

test('PUT /admin/credentials/:provider 替換憑證', async () => {
  const res = await realFetch(`${base}/admin/credentials/copilot`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'gho_new' }),
  });
  assert.equal(res.status, 200);
  assert.equal(app.creds.get('copilot').token, 'gho_new');
  const put = (body) => realFetch(`${base}/admin/credentials/copilot`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // 打錯欄位名稱：回 400 並列出可用欄位，原本的憑證不動
  const typo = await put({ tokn: 'gho_typo' });
  assert.equal(typo.status, 400);
  assert.deepEqual((await typo.json()).allowed, ['token']);
  assert.equal(app.creds.get('copilot').token, 'gho_new');
  assert.equal((await put({})).status, 400, '缺少必要欄位');
  assert.equal((await put({ token: { x: 1 } })).status, 400, '值不是字串或數字');
  const bad = await realFetch(`${base}/admin/credentials/nope`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${ADMIN}` },
    body: '{}',
  });
  assert.equal(bad.status, 404);
});
