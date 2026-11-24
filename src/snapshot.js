import path from 'node:path';
import { writeFileAtomic, readFileOrNull } from './fsutil.js';
import { logWarn } from './log.js';

const STALE_INTERVALS = 3;

/** 記憶體快照＋/data/snapshot.json（原子寫入） */
export class SnapshotStore {
  constructor({ dataDir, pollIntervalSec, providers }) {
    this.file = path.join(dataDir, 'snapshot.json');
    this.pollIntervalSec = pollIntervalSec;
    this.order = providers.map((p) => p.id);
    this.names = Object.fromEntries(providers.map((p) => [p.id, p.name]));
    this.entries = {};
    this.writeChain = Promise.resolve();
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
    const age = e.fetchedAt ? now - Date.parse(e.fetchedAt) : Infinity;
    if (status === 'ok' && e.fetchedAt && age > STALE_INTERVALS * interval) status = 'stale';
    return {
      id: e.id,
      name: e.name,
      plan: e.plan,
      planExpiresAt: e.planExpiresAt || null,
      status,
      fetchedAt: e.fetchedAt,
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
    const job = this.writeChain.then(() => writeFileAtomic(this.file, data));
    this.writeChain = job.catch((err) => logWarn('寫入 snapshot.json 失敗', { code: err.code }));
    return this.writeChain;
  }

  flush() {
    return this.writeChain;
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
  for (const k of ['plan', 'planExpiresAt', 'status', 'fetchedAt', 'nextFetchAt', 'error', 'note', 'windows', 'balance', 'slowed']) {
    if (p[k] !== undefined) out[k] = p[k];
  }
  // 存檔時被判成 stale 的，載回來當 ok，再由 view() 依時間重新判斷
  if (out.status === 'stale') out.status = 'ok';
  return out;
}
