import path from 'node:path';
import { SerialWriter, readFileOrNull } from './fsutil.js';
import { logWarn } from './log.js';

// 超過幾個更新週期沒新資料就算過期（快照的每家都附上算好的 staleAt，前端不必再寫一份規則）
export const STALE_INTERVALS = 3;

/**
 * 什麼時候算過期（毫秒）：最後一次成功抓取後 3 個週期；被限流還在等退避的，等到退避結束才算
 * （退避最多 15 分鐘，比 3 個週期長，不然還在等就先被判成過期）。沒有資料回 null。
 */
export function staleTime(e, intervalMs) {
  if (!e.fetchedAt) return null;
  const at = Date.parse(e.fetchedAt) + STALE_INTERVALS * intervalMs;
  const retry = Date.parse(e.nextFetchAt);
  return e.slowed && Number.isFinite(retry) ? Math.max(at, retry) : at;
}

/** 記憶體快照＋/data/snapshot.json（原子寫入） */
export class SnapshotStore {
  constructor({ dataDir, pollIntervalSec, providers }) {
    this.file = path.join(dataDir, 'snapshot.json');
    this.pollIntervalSec = pollIntervalSec;
    this.order = providers.map((p) => p.id);
    this.names = Object.fromEntries(providers.map((p) => [p.id, p.name]));
    this.entries = {};
    this.writer = new SerialWriter(this.file);
    for (const p of providers) this.entries[p.id] = blank(p);
  }

  async load() {
    const raw = await readFileOrNull(this.file);
    if (!raw) return this;
    try {
      const snap = JSON.parse(raw.toString('utf8'));
      for (const p of snap.providers || []) {
        if (!this.entries[p.id]) continue;
        this.entries[p.id] = { ...this.entries[p.id], ...pickStored(p) };
      }
    } catch {
      logWarn('snapshot.json 壞了，從空白開始');
    }
    return this;
  }

  entry(id) {
    return this.entries[id];
  }

  update(id, patch, now = Date.now()) {
    this.entries[id] = { ...this.entries[id], ...patch };
    return this.view(id, now);
  }

  /** 對外顯示用：依 fetchedAt 動態判斷 stale */
  view(id, now = Date.now()) {
    const e = this.entries[id];
    let status = e.status;
    const interval = (e.intervalSec || this.pollIntervalSec) * 1000;
    const staleAt = staleTime(e, interval);
    if (status === 'ok' && staleAt !== null && now > staleAt) status = 'stale';
    return {
      id: e.id,
      name: e.name,
      plan: e.plan,
      planExpiresAt: e.planExpiresAt || null,
      status,
      fetchedAt: e.fetchedAt,
      // 過了這個時間還沒新資料就算過期；前端只比對時間，規則只寫在這裡
      staleAt: staleAt === null ? null : new Date(staleAt).toISOString(),
      nextFetchAt: e.nextFetchAt,
      intervalSec: e.intervalSec || this.pollIntervalSec,
      slowed: Boolean(e.slowed),
      error: e.error,
      note: e.note || null,
      windows: e.windows || [],
      balance: e.balance || null,
    };
  }

  snapshot(now = Date.now()) {
    return {
      version: 1,
      generatedAt: new Date(now).toISOString(),
      pollIntervalSec: this.pollIntervalSec,
      providers: this.order.map((id) => this.view(id, now)),
    };
  }

  async save() {
    const data = JSON.stringify(this.snapshot(), null, 2);
    return this.writer.write(data).catch((err) => logWarn('寫入 snapshot.json 失敗', { code: err.code }));
  }

  flush() {
    return this.writer.flush();
  }
}

function blank(p) {
  return {
    id: p.id,
    name: p.name,
    plan: null,
    status: 'disabled',
    fetchedAt: null,
    nextFetchAt: null,
    intervalSec: null,
    slowed: false,
    error: null,
    note: null,
    windows: [],
    balance: null,
  };
}

function pickStored(p) {
  const out = {};
  for (const k of ['plan', 'planExpiresAt', 'status', 'fetchedAt', 'nextFetchAt', 'intervalSec', 'error', 'note', 'windows', 'balance', 'slowed']) {
    if (p[k] !== undefined) out[k] = p[k];
  }
  // 存檔時被判成 stale 的，載回來當 ok，再由 view() 依時間重新判斷
  if (out.status === 'stale') out.status = 'ok';
  return out;
}
