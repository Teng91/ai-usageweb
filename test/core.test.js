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
