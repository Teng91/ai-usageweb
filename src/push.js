// 推播服務：訂閱管理、樣本累積、依規則（src/alerts.js）發通知；狀態存在 /data/push.json
import path from 'node:path';
import { writeFileAtomic, readFileOrNull } from './fsutil.js';
import { logInfo, logWarn } from './log.js';
import { sendPush } from './webpush.js';
import { evaluateAlerts, mergeAlerts, recordSample, localParts, RULES } from './alerts.js';

// 存檔欄位改了就 +1，舊檔會被丟掉
const FORMAT_VERSION = 1;
const MAX_SUBS = 10;
const DAILY_CAP = 4; // 每家每天最多幾則
const SENT_KEEP_MS = 40 * 86400_000;
const EVAL_DEBOUNCE_MS = 3000; // 各家陸續抓完再一起判斷，才能合成一則
const DEFAULT_PREFS = { usage: true, reset: true };

export class PushService {
  constructor({ dataDir, vapid, tz, quiet, snapshot, viewers = () => 0, now = Date.now, send = sendPush }) {
    this.file = path.join(dataDir, 'push.json');
    this.vapid = vapid;
    this.tz = tz;
    this.quiet = quiet;
    this.snapshot = snapshot;
    this.viewers = viewers;
    this.now = now;
    this.send = send;
    this.state = blankState();
    this.lastFetched = {};
    this.timer = null;
    this.evaluating = null;
    this.writeChain = Promise.resolve();
  }

  get enabled() {
    return Boolean(this.vapid?.publicKey && this.vapid?.privateKey);
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

  // ---- 訂閱 ----
  subscribe(sub, prefs) {
    const i = this.state.subs.findIndex((s) => s.endpoint === sub.endpoint);
    const entry = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, prefs: { ...DEFAULT_PREFS, ...cleanPrefs(prefs) }, createdAt: new Date(this.now()).toISOString() };
    if (i >= 0) this.state.subs[i] = { ...this.state.subs[i], ...entry, prefs: { ...this.state.subs[i].prefs, ...cleanPrefs(prefs) } };
    else {
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
    const sub = this.state.subs.find((s) => s.endpoint === endpoint);
    if (!sub) return null;
    sub.prefs = { ...DEFAULT_PREFS, ...sub.prefs, ...cleanPrefs(prefs) };
    this.save();
    return sub.prefs;
  }

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

  prefs(endpoint) {
    return this.state.subs.find((s) => s.endpoint === endpoint)?.prefs || null;
  }

  async test(endpoint) {
    const sub = this.state.subs.find((s) => s.endpoint === endpoint);
    if (!sub) return false;
    return this.#deliver(sub, { title: '🔔 測試通知', body: '收得到這則，額度快用完或快重置時就會通知你', tag: 'test', url: '/' });
  }

  // ---- 資料 ----
  /** 每次某家抓到新資料時呼叫 */
  observe(view) {
    // 推播沒啟用就不必累積樣本、也不必每次抓取都寫 push.json
    if (!this.enabled || !view || view.status !== 'ok' || !view.fetchedAt) return;
    if (this.lastFetched[view.id] === view.fetchedAt) return;
    this.lastFetched[view.id] = view.fetchedAt;
    const now = this.now();
    for (const w of view.windows || []) recordSample(this.state.history, `${view.id}:${w.id}`, w, now);
    this.save();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.evaluate().catch(() => {}); }, EVAL_DEBOUNCE_MS);
    this.timer.unref?.();
  }

  /** 判斷並發送；回傳送出的則數 */
  evaluate() {
    clearTimeout(this.timer);
    if (!this.evaluating) this.evaluating = this.#evaluateOnce().finally(() => { this.evaluating = null; });
    return this.evaluating;
  }

  async #evaluateOnce() {
    if (!this.enabled || !this.state.subs.length) return 0;
    const now = this.now();
    this.#prune(now);
    const providers = this.snapshot.snapshot(now).providers;
    const { quiet, thresholds } = this.settings();
    const alerts = evaluateAlerts({ providers, history: this.state.history, sent: this.state.sent, now, tz: this.tz, quiet, thresholds });
    if (!alerts.length) return 0;

    const markSent = (list) => { for (const a of list) for (const k of a.keys) this.state.sent[k] = now; };
    // 網頁開著時先不推播、也不記下：可能只是分頁開著人沒在看，關掉之後條件還成立就照樣推播
    if (this.viewers() > 0) return 0;

    // 超過每日上限的先不送也不記下，明天（或額度還沒重置前）還會再判斷，不會整個週期都漏掉
    const day = localParts(now, this.tz).dateKey;
    const countOf = (id) => (this.state.daily[id]?.day === day ? this.state.daily[id].count : 0);
    const planned = {};
    const toSend = alerts.filter((a) => {
      if (countOf(a.provider) + (planned[a.provider] || 0) >= DAILY_CAP) return false;
      planned[a.provider] = (planned[a.provider] || 0) + 1;
      return true;
    });

    let sent = 0;
    for (const kind of new Set(toSend.map((a) => a.kind))) {
      const group = toSend.filter((a) => a.kind === kind);
      const [msg] = mergeAlerts(group);
      const payload = { title: msg.title, body: msg.body, tag: kind, url: '/' };
      const targets = this.state.subs.filter((sub) => sub.prefs?.[kind] !== false);
      let delivered = 0;
      for (const sub of targets) {
        if (await this.#deliver(sub, payload, kind === 'usage' ? 'high' : 'normal')) delivered++;
      }
      sent += delivered;
      // 沒人要這一類：記下但不算次數；全部送失敗：不記，下次再試
      if (!targets.length) markSent(group);
      else if (delivered) {
        markSent(group);
        for (const a of group) this.state.daily[a.provider] = { day, count: countOf(a.provider) + 1 };
      }
    }
    this.save();
    if (sent) logInfo('push sent', { count: sent, kinds: [...new Set(toSend.map((a) => a.kind))] });
    return sent;
  }

  async #deliver(sub, payload, urgency = 'normal') {
    const r = await this.send(sub, payload, this.vapid, { urgency });
    if (r.gone) {
      this.unsubscribe(sub.endpoint);
      logInfo('push subscription gone', { status: r.status });
    } else if (!r.ok) {
      logWarn('push failed', { status: r.status });
    }
    return r.ok;
  }

  #prune(now) {
    for (const [k, t] of Object.entries(this.state.sent)) if (now - t > SENT_KEEP_MS) delete this.state.sent[k];
    for (const [k, h] of Object.entries(this.state.history)) {
      const last = h.samples[h.samples.length - 1];
      if (!last || now - last[0] > SENT_KEEP_MS) delete this.state.history[k];
    }
  }

  flush() {
    return this.writeChain;
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
