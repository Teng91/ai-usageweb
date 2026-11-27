// 推播的存檔（/data/push.json）：裝置訂閱、全站設定，以及判斷用的樣本、已發紀錄與每日次數
// 存檔格式只有這個檔案知道；push.js 透過下面的方法讀寫，不直接碰 state
import path from 'node:path';
import { SerialWriter, readFileOrNull } from './fsutil.js';
import { logWarn } from './log.js';
import { RULES, recordSample } from './alerts.js';

// 存檔欄位改了就 +1，舊檔會被丟掉（只新增選填欄位時不要升，升了訂閱會一起丟掉）
const FORMAT_VERSION = 1;
const MAX_SUBS = 10;
// 通知種類（跟 alerts.js 的 kind 一樣）；舊訂閱沒有的種類當作開啟
const KINDS = ['usage', 'reset', 'restored'];
const DEFAULT_PREFS = Object.fromEntries(KINDS.map((k) => [k, true]));

export class PushStore {
  constructor({ dataDir, quiet, now = Date.now }) {
    this.file = path.join(dataDir, 'push.json');
    this.quiet = quiet; // PUSH_QUIET：網頁上沒改過勿擾時段時用這個
    this.now = now;
    this.state = blankState();
    this.writer = new SerialWriter(this.file);
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
    return this.writer.write(data).catch((err) => logWarn('寫入 push.json 失敗', { code: err.code }));
  }

  flush() {
    return this.writer.flush();
  }

  // ---- 判斷用的紀錄 ----
  /** 判斷規則（alerts.js 的 evaluateAlerts）要讀的樣本與已發紀錄；只讀，要改用下面的方法 */
  get history() {
    return this.state.history;
  }

  get sent() {
    return this.state.sent;
  }

  /** 某家抓到新資料：各窗口記一筆樣本並存檔 */
  recordSamples(id, windows, now) {
    for (const w of windows || []) recordSample(this.state.history, `${id}:${w.id}`, w, now);
    this.save();
  }

  /** 記下這些通知已發（每則通知的 keys 都記；不存檔，呼叫端一輪結束再 save） */
  markSent(alerts, now) {
    for (const a of alerts) for (const k of a.keys) this.state.sent[k] = now;
  }

  /** 某家在 day（當地日期）已經發了幾則 */
  dailyCount(provider, day) {
    const d = this.state.daily[provider];
    return d?.day === day ? d.count : 0;
  }

  addDaily(provider, day) {
    this.state.daily[provider] = { day, count: this.dailyCount(provider, day) + 1 };
  }

  /** 清掉超過 keepMs 的已發紀錄，以及最後一筆樣本超過 keepMs 的窗口 */
  prune(now, keepMs) {
    const { sent, history } = this.state;
    for (const [k, t] of Object.entries(sent)) if (now - t > keepMs) delete sent[k];
    for (const [k, h] of Object.entries(history)) {
      const last = h.samples[h.samples.length - 1];
      if (!last || now - last[0] > keepMs) delete history[k];
    }
  }

  // ---- 訂閱 ----
  get subs() {
    return this.state.subs;
  }

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
  for (const k of KINDS) if (p && typeof p[k] === 'boolean') out[k] = p[k];
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
