// 推播的存檔（/data/push.json）：裝置訂閱、全站設定，以及判斷用的樣本與已發紀錄（由 push.js 讀寫 state）
import path from 'node:path';
import { writeFileAtomic, readFileOrNull } from './fsutil.js';
import { logWarn } from './log.js';
import { RULES } from './alerts.js';

// 存檔欄位改了就 +1，舊檔會被丟掉（只新增選填欄位時不要升，升了訂閱會一起丟掉）
const FORMAT_VERSION = 1;
const MAX_SUBS = 10;
const DEFAULT_PREFS = { usage: true, reset: true };

export class PushStore {
  constructor({ dataDir, quiet, now = Date.now }) {
    this.file = path.join(dataDir, 'push.json');
    this.quiet = quiet; // PUSH_QUIET：網頁上沒改過勿擾時段時用這個
    this.now = now;
    this.state = blankState();
    this.writeChain = Promise.resolve();
  }

  async load() {
    const raw = await readFileOrNull(this.file);
    if (!raw) return this;
    try {
      const s = JSON.parse(raw.toString('utf8'));
      if (s.version === FORMAT_VERSION) this.state = { ...blankState(), ...s };
    } catch {
      logWarn('push.json 壞了，從空白開始');
    }
    return this;
  }

  save() {
    const data = JSON.stringify(this.state);
    const job = this.writeChain.then(() => writeFileAtomic(this.file, data));
    this.writeChain = job.catch((err) => logWarn('寫入 push.json 失敗', { code: err.code }));
    return this.writeChain;
  }

  flush() {
    return this.writeChain;
  }

  // ---- 訂閱 ----
  find(endpoint) {
    return this.state.subs.find((s) => s.endpoint === endpoint) || null;
  }

  subscribe(sub, prefs) {
    const i = this.state.subs.findIndex((s) => s.endpoint === sub.endpoint);
    const entry = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, prefs: { ...DEFAULT_PREFS, ...cleanPrefs(prefs) }, createdAt: new Date(this.now()).toISOString() };
    if (i >= 0) {
      const old = this.state.subs[i];
      this.state.subs[i] = { ...old, ...entry, createdAt: old.createdAt || entry.createdAt, prefs: { ...old.prefs, ...cleanPrefs(prefs) } };
    } else {
      this.state.subs.push(entry);
      if (this.state.subs.length > MAX_SUBS) this.state.subs.shift();
    }
    this.save();
    return this.prefs(sub.endpoint);
  }

  unsubscribe(endpoint) {
    const n = this.state.subs.length;
    this.state.subs = this.state.subs.filter((s) => s.endpoint !== endpoint);
    if (this.state.subs.length !== n) this.save();
  }

  /** 改已訂閱裝置的通知種類；沒訂閱回 null（只改 prefs，不能新增訂閱，所以不需要推播密碼） */
  updatePrefs(endpoint, prefs) {
    const sub = this.find(endpoint);
    if (!sub) return null;
    sub.prefs = { ...DEFAULT_PREFS, ...sub.prefs, ...cleanPrefs(prefs) };
    this.save();
    return sub.prefs;
  }

  prefs(endpoint) {
    return this.find(endpoint)?.prefs || null;
  }

  // ---- 全站設定 ----
  /**
   * 全站共用的推播設定（只有一個人在用，不必每台裝置各一份）：勿擾時段與週／月門檻。
   * 沒在網頁上改過就用預設：勿擾時段來自 PUSH_QUIET，門檻是 RULES.longThresholds。
   */
  settings() {
    const s = this.state.settings || {};
    return {
      quiet: s.quiet !== undefined ? s.quiet : this.quiet,
      thresholds: s.thresholds || RULES.longThresholds,
    };
  }

  /** 從網頁改設定；格式不對回 null（不動原本的設定） */
  updateSettings(input) {
    const next = { ...(this.state.settings || {}) };
    if (input && 'quiet' in input) {
      const q = cleanQuiet(input.quiet);
      if (q === undefined) return null;
      next.quiet = q;
    }
    if (input && 'thresholds' in input) {
      const t = cleanThresholds(input.thresholds);
      if (!t) return null;
      next.thresholds = t;
    }
    this.state.settings = next;
    this.save();
    return this.settings();
  }
}

function blankState() {
  return { version: FORMAT_VERSION, subs: [], sent: {}, daily: {}, history: {} };
}

/** 勿擾時段：null（關閉）或 { start, end } 整點 0–23、不能相同；不合格回 undefined */
function cleanQuiet(q) {
  if (q === null) return null;
  const ok = (n) => Number.isInteger(n) && n >= 0 && n <= 23;
  if (!q || typeof q !== 'object' || !ok(q.start) || !ok(q.end) || q.start === q.end) return undefined;
  return { start: q.start, end: q.end };
}

/** 週／月門檻：0–3 個 50–94 的整數（95% 一定會發，不必設），去重後由高到低；不合格回 null */
function cleanThresholds(t) {
  if (!Array.isArray(t) || t.length > 3 || !t.every((n) => Number.isInteger(n) && n >= 50 && n <= 94)) return null;
  return [...new Set(t)].sort((a, b) => b - a);
}

function cleanPrefs(p) {
  const out = {};
  if (p && typeof p.usage === 'boolean') out.usage = p.usage;
  if (p && typeof p.reset === 'boolean') out.reset = p.reset;
  return out;
}

/** 檢查瀏覽器送來的訂閱物件；不合格回 null */
export function validSubscription(s) {
  if (!s || typeof s !== 'object') return null;
  const { endpoint, keys } = s;
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return null;
  let u;
  try { u = new URL(endpoint); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  const p256dh = keys.p256dh.replace(/=+$/, '');
  const auth = keys.auth.replace(/=+$/, '');
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) return null;
  return { endpoint, keys: { p256dh, auth } };
}
