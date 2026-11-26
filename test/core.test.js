import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { tmpDir } from './helpers.js';
import { CredentialStore } from '../src/credentials.js';
import { SnapshotStore } from '../src/snapshot.js';
import { Poller } from '../src/poller.js';
import { ProviderError } from '../src/errors.js';
import { requestJson } from '../src/http.js';

const KEY = crypto.randomBytes(32).toString('base64');

// ---------- credentials ----------
test('credentials: 續期後重開機，用的是 volume 裡的新 token', async () => {
  const dir = tmpDir();
  const env = { CLAUDE_REFRESH_TOKEN: 'old', CLAUDE_ACCESS_TOKEN: 'a0' };
  const s1 = await new CredentialStore({ dataDir: dir, keyB64: KEY, env }).load();
  assert.equal(s1.get('claude').refreshToken, 'old');
  await s1.save('claude', { refreshToken: 'new', accessToken: 'a1' });

  const raw = fs.readFileSync(path.join(dir, 'credentials.enc'), 'utf8');
  assert.ok(!raw.includes('new'), '檔案是加密的');

  const s2 = await new CredentialStore({ dataDir: dir, keyB64: KEY, env }).load();
  assert.equal(s2.get('claude').refreshToken, 'new');
});

test('credentials: CREDENTIALS_RESET 以環境變數覆寫 volume', async () => {
  const dir = tmpDir();
  const s1 = await new CredentialStore({ dataDir: dir, keyB64: KEY, env: { CLAUDE_REFRESH_TOKEN: 'old' } }).load();
  await s1.save('claude', { refreshToken: 'rotated' });
  const s2 = await new CredentialStore({ dataDir: dir, keyB64: KEY, env: { CLAUDE_REFRESH_TOKEN: 'fresh' }, reset: ['claude'] }).load();
  assert.equal(s2.get('claude').refreshToken, 'fresh');
  const s3 = await new CredentialStore({ dataDir: dir, keyB64: KEY, env: { CLAUDE_REFRESH_TOKEN: 'fresh' } }).load();
  assert.equal(s3.get('claude').refreshToken, 'fresh');
});

test('credentials: 寫入失敗時不採用新值', async () => {
  const dir = tmpDir();
  const s = await new CredentialStore({ dataDir: dir, keyB64: KEY, env: { CLAUDE_REFRESH_TOKEN: 'old' } }).load();
  s.persist = async () => { throw new Error('disk full'); };
  await assert.rejects(s.save('claude', { refreshToken: 'new' }));
  assert.equal(s.get('claude').refreshToken, 'old');
});

test('credentials: 同一家續期共用同一個 Promise', async () => {
  const s = await new CredentialStore({ dataDir: tmpDir(), keyB64: KEY, env: {} }).load();
  let calls = 0;
  const fn = () => new Promise((r) => setTimeout(() => r(++calls), 20));
  const [a, b] = await Promise.all([s.withLock('claude', fn), s.withLock('claude', fn)]);
  assert.equal(calls, 1);
  assert.equal(a, b);
});

test('credentials: 換憑證時正在續期 → 等續期結束才換，新憑證不會被舊帳號蓋掉', async () => {
  const s = await new CredentialStore({ dataDir: tmpDir(), keyB64: KEY, env: { CLAUDE_REFRESH_TOKEN: 'old' } }).load();
  let release;
  const gate = new Promise((r) => { release = r; });
  const refreshing = s.withLock('claude', async () => {
    await gate;
    await s.save('claude', { accessToken: 'old-a', refreshToken: 'old-r2' });
  });
  const replacing = s.replace('claude', { refreshToken: 'new' });
  release();
  await Promise.all([refreshing, replacing]);
  assert.deepEqual(s.get('claude'), { refreshToken: 'new' });
  assert.equal(s.version('claude'), 2);
});

test('credentials: CLAUDE_PLAN 不放進憑證', async () => {
  const s = await new CredentialStore({ dataDir: tmpDir(), keyB64: KEY, env: { CLAUDE_REFRESH_TOKEN: 'r', CLAUDE_PLAN: 'Max' } }).load();
  assert.equal(s.get('claude').plan, undefined);
});

test('credentials: 沒設金鑰時，續期的 log 說「只存在記憶體」', async () => {
  const lines = [];
  const orig = process.stdout.write;
  process.stdout.write = (s) => { lines.push(String(s)); return true; };
  try {
    const s = await new CredentialStore({ dataDir: tmpDir(), keyB64: '', env: { CLAUDE_REFRESH_TOKEN: 'r' } }).load();
    await s.save('claude', { refreshToken: 'r2' });
  } finally {
    process.stdout.write = orig;
  }
  const log = lines.join('');
  assert.ok(log.includes('只存在記憶體'));
  assert.ok(!log.includes('憑證已續期並寫入'));
});

test('credentials: 錯的金鑰長度直接報錯', () => {
  assert.throws(() => new CredentialStore({ dataDir: tmpDir(), keyB64: 'c2hvcnQ=', env: {} }));
});

// ---------- snapshot ----------
test('snapshot: 原子寫入後讀回；過 3 個間隔變 stale', async () => {
  const dir = tmpDir();
  const providers = [{ id: 'openrouter', name: 'OpenRouter' }];
  const s = new SnapshotStore({ dataDir: dir, pollIntervalSec: 60, providers });
  const t = Date.parse('2026-11-23T08:00:00Z');
  s.update('openrouter', { status: 'ok', fetchedAt: new Date(t).toISOString(), balance: { remaining: 1 } });
  await s.save();
  assert.ok(!fs.existsSync(path.join(dir, 'snapshot.json.tmp')));
  const s2 = await new SnapshotStore({ dataDir: dir, pollIntervalSec: 60, providers }).load();
  assert.equal(s2.view('openrouter', t + 60_000).status, 'ok');
  assert.equal(s2.view('openrouter', t + 181_000).status, 'stale');
  assert.equal(s2.snapshot(t).providers[0].balance.remaining, 1);
});

// ---------- poller ----------
function makePoller({ fetchImpl, now, creds = { p: { x: 1 } }, snapshotEntries = {} }) {
  const provider = {
    id: 'p',
    name: 'P',
    minIntervalSec: 60,
    isConfigured: (c) => Boolean(c.p),
    fetch: fetchImpl,
  };
  const store = {
    creds,
    all() { return structuredClone(this.creds); },
    version: () => 1,
    save: async () => {},
    withLock: (id, fn) => fn(),
  };
  const snapshot = new SnapshotStore({ dataDir: tmpDir(), pollIntervalSec: 60, providers: [provider] });
  for (const [k, v] of Object.entries(snapshotEntries)) snapshot.update('p', { [k]: v });
  const events = [];
  const poller = new Poller({
    providers: [provider],
    creds: store,
    snapshot,
    broadcast: (e, d) => events.push([e, d]),
    pollIntervalSec: 60,
    idleGraceSec: 90,
    now,
    random: () => 0,
  });
  return { poller, snapshot, events };
}

test('poller: 有觀看者才開始，成功後 60 秒再抓', async () => {
  let t = 1_000_000;
  let n = 0;
  const { poller, events } = makePoller({ now: () => t, fetchImpl: async () => { n += 1; return { plan: 'x', windows: [{ id: 'a', label: 'a', usedPct: 1 }] }; } });
  assert.equal(poller.running, false);
  poller.viewerJoined(1);
  assert.equal(poller.running, true);
  await poller.state.p.inflight;
  assert.equal(n, 1);
  assert.equal(events.at(-1)[1].status, 'ok');
  t += 30_000; poller.tick(); assert.equal(n, 1);
  t += 31_000; poller.tick(); await poller.state.p.inflight; assert.equal(n, 2);
  poller.stop();
});

test('poller: 觀看者歸 0 後 90 秒停止', async () => {
  let t = 1_000_000;
  const { poller } = makePoller({ now: () => t, fetchImpl: async () => ({ windows: [] }) });
  poller.viewerJoined(1);
  await poller.state.p.inflight;
  poller.viewerLeft(0);
  t += 80_000; poller.tick(); assert.equal(poller.running, true);
  t += 11_000; poller.tick(); assert.equal(poller.running, false);
});

test('poller: 冷啟動時快照不到 60 秒就不重抓', async () => {
  let t = Date.parse('2026-11-23T08:00:30Z');
  let n = 0;
  const { poller } = makePoller({
    now: () => t,
    fetchImpl: async () => { n += 1; return { windows: [] }; },
    snapshotEntries: { fetchedAt: '2026-11-23T08:00:00Z', status: 'ok' },
  });
  poller.state.p.lastAttemptAt = Date.parse('2026-11-23T08:00:00Z');
  poller.viewerJoined(1);
  assert.equal(n, 0);
  t += 31_000; poller.tick(); await poller.state.p.inflight;
  assert.equal(n, 1);
  poller.stop();
});

test('poller: 429 間隔加倍、保留舊數字並標示放慢', async () => {
  let t = 1_000_000;
  let mode = 'ok';
  const { poller, snapshot } = makePoller({
    now: () => t,
    fetchImpl: async () => {
      if (mode === 'ok') return { windows: [{ id: 'a', label: 'a', usedPct: 5 }] };
      throw new ProviderError('rate_limit', '429', { httpStatus: 429 });
    },
  });
  poller.viewerJoined(1);
  await poller.state.p.inflight;
  mode = '429';
  t += 60_000; poller.tick(); await poller.state.p.inflight;
  let v = snapshot.view('p', t);
  assert.equal(v.status, 'ok');
  assert.equal(v.slowed, true);
  assert.equal(v.windows[0].usedPct, 5);
  assert.equal(poller.state.p.nextAt - t, 120_000);
  t += 120_000; poller.tick(); await poller.state.p.inflight;
  assert.equal(poller.state.p.nextAt - t, 240_000);
  mode = 'ok';
  t += 240_000; poller.tick(); await poller.state.p.inflight;
  v = snapshot.view('p', t);
  assert.equal(v.slowed, false);
  assert.equal(poller.state.p.nextAt - t, 60_000);
  poller.stop();
});

test('poller: auth 後停止這一家，直到換憑證', async () => {
  let t = 1_000_000;
  let n = 0;
  const { poller, snapshot } = makePoller({ now: () => t, fetchImpl: async () => { n += 1; throw new ProviderError('auth', 'x'); } });
  poller.viewerJoined(1);
  await poller.state.p.inflight;
  assert.equal(snapshot.view('p').status, 'auth');
  t += 120_000; poller.tick(); await poller.state.p.inflight;
  assert.equal(n, 1);
  poller.creds.version = () => 2;
  poller.credentialsChanged('p');
  await poller.state.p.inflight;
  assert.equal(n, 2);
  poller.stop();
});

test('poller: 403 這次觀看期間不再試', async () => {
  let t = 1_000_000;
  let n = 0;
  const { poller } = makePoller({ now: () => t, fetchImpl: async () => { n += 1; throw new ProviderError('forbidden', '被 Cloudflare 擋下'); } });
  poller.viewerJoined(1);
  await poller.state.p.inflight;
  t += 600_000; poller.tick();
  assert.equal(n, 1);
  poller.stop();
  poller.start();
  await poller.state.p.inflight;
  assert.equal(n, 2);
  poller.stop();
});

test('poller: 排程喚醒（沒人在看）時 403 下一次喚醒再試', async () => {
  let t = 1_000_000;
  let n = 0;
  const { poller } = makePoller({ now: () => t, fetchImpl: async () => { n += 1; throw new ProviderError('forbidden', '被 Cloudflare 擋下'); } });
  await poller.pollOnce();
  assert.equal(n, 1);
  t += 15 * 60_000;
  await poller.pollOnce();
  assert.equal(n, 2);
});

test('poller: adapter 的程式錯誤記下種類與位置，不記訊息', async () => {
  const lines = [];
  const orig = process.stdout.write;
  process.stdout.write = (s) => { lines.push(String(s)); return true; };
  try {
    const { poller, snapshot } = makePoller({ now: () => 1_000_000, fetchImpl: async () => { throw new TypeError('secret-token-xyz'); } });
    await poller.pollOnce();
    assert.equal(snapshot.view('p').error, '處理回傳時出錯');
  } finally {
    process.stdout.write = orig;
  }
  const warn = lines.map((l) => JSON.parse(l)).find((l) => l.msg === 'adapter 例外');
  assert.equal(warn.err, 'TypeError');
  assert.ok(!lines.join('').includes('secret-token-xyz'));
});

test('poller: 沒設定憑證 → disabled，不呼叫 adapter', async () => {
  let n = 0;
  const { poller, snapshot } = makePoller({ now: () => 1_000_000, creds: {}, fetchImpl: async () => { n += 1; } });
  snapshot.update('p', { status: 'ok' });
  poller.viewerJoined(1);
  await poller.state.p.inflight;
  assert.equal(n, 0);
  assert.equal(snapshot.view('p').status, 'disabled');
  poller.stop();
});

test('poller: 抓取中再觸發共用同一個 Promise', async () => {
  let n = 0;
  const { poller } = makePoller({ now: () => 1_000_000, fetchImpl: () => new Promise((r) => setTimeout(() => { n += 1; r({ windows: [] }); }, 20)) });
  const p = { ...poller.providers[0] };
  const a = poller.run(poller.providers[0]);
  const b = poller.run(poller.providers[0]);
  assert.equal(a, b);
  await a;
  assert.equal(n, 1);
  void p;
});

test('poller: drain 會等正在跑的抓取結束（關機時不丟掉續期結果）', async () => {
  let done = false;
  const { poller } = makePoller({ now: () => 1_000_000, fetchImpl: () => new Promise((r) => setTimeout(() => { done = true; r({ windows: [] }); }, 30)) });
  poller.run(poller.providers[0]);
  await poller.drain();
  assert.equal(done, true);
  await poller.drain(); // 沒有在跑的也不會卡住
});

test('http: Cloudflare 只認 HTML 挑戰頁或 cf-mitigated，JSON 的 403 照一般 403 處理', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('{"error":"cf-like text"}', { status: 403, headers: { 'content-type': 'application/json' } });
    await assert.rejects(requestJson('https://example.test/'), (e) => e.kind === 'forbidden' && e.message === '403 沒有權限');
    globalThis.fetch = async () => new Response('{}', { status: 403, headers: { 'content-type': 'application/json', 'cf-mitigated': 'challenge' } });
    await assert.rejects(requestJson('https://example.test/'), (e) => e.message === '被 Cloudflare 擋下');
  } finally {
    globalThis.fetch = original;
  }
});

test('poller: 還沒開始的額度（0%、重置時間＝現在＋整個週期）把重置時間拿掉', async () => {
  const { clearUnstartedResets } = await import('../src/poller.js');
  const now = Date.parse('2026-11-26T05:00:00Z');
  const at = (ms) => new Date(now + ms).toISOString();
  const out = clearUnstartedResets([
    { id: 'codex', usedPct: 0, periodSec: 30 * 86400, resetsAt: at(30 * 86400e3 - 60e3) }, // 還沒用：每次都是 30 天後
    { id: 'used', usedPct: 1, periodSec: 30 * 86400, resetsAt: at(30 * 86400e3 - 60e3) }, // 有用了：保留
    { id: 'copilot', usedPct: 0, periodSec: 30 * 86400, resetsAt: at(4 * 86400e3) }, // 每月 1 號固定重置：保留
    { id: 'gemini5h', usedPct: 0, periodSec: 18000, resetsAt: at(5 * 3600e3) },
    { id: 'noPeriod', usedPct: 0, resetsAt: at(5 * 3600e3) }, // 不知道週期：保留
  ], now);
  assert.deepEqual(out.map((w) => [w.id, w.resetsAt === null]), [['codex', true], ['used', false], ['copilot', false], ['gemini5h', true], ['noPeriod', false]]);
});

test('sse: 連線數到上限就回 503，不算觀看者', async () => {
  const { SseHub } = await import('../src/sse.js');
  let joins = 0;
  const hub = new SseHub({ maxClients: 1, onJoin: () => { joins += 1; } });
  const fakeRes = () => ({ status: 0, body: '', writeHead(s) { this.status = s; }, write(d) { this.body += d; }, end(d) { if (d) this.body += d; }, on() {} });
  const fakeReq = { on() {} };
  const a = fakeRes();
  assert.equal(hub.add(fakeReq, a, {}), true);
  const b = fakeRes();
  assert.equal(hub.add(fakeReq, b, {}), false);
  assert.equal(b.status, 503);
  assert.equal(joins, 1);
  hub.closeAll();
});

test('snapshot: intervalSec 存檔後讀得回來', async () => {
  const dir = tmpDir();
  const providers = [{ id: 'p', name: 'P' }];
  const s = new SnapshotStore({ dataDir: dir, pollIntervalSec: 60, providers });
  s.update('p', { status: 'ok', fetchedAt: new Date().toISOString(), intervalSec: 300 });
  await s.save();
  const s2 = await new SnapshotStore({ dataDir: dir, pollIntervalSec: 60, providers }).load();
  assert.equal(s2.view('p').intervalSec, 300);
});

test('http: 讀回應內容時出錯（例如逾時）算網路錯誤，不是「回傳不是 JSON」', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    new ReadableStream({ start(c) { c.error(new Error('boom')); } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
  try {
    await assert.rejects(requestJson('https://example.test/', { label: 'Codex ' }), (e) => e.kind === 'network' && e.message === 'Codex 讀取回應失敗');
  } finally {
    globalThis.fetch = original;
  }
});
