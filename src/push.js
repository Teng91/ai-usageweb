// 推播服務：累積樣本、依規則（src/alerts.js）判斷、去重與每日上限、發送；訂閱與存檔在 push-store.js
import { logInfo, logWarn } from './log.js';
import { sendPush } from './webpush.js';
import { evaluateAlerts, mergeAlerts, recordSample } from './alerts.js';
import { localParts } from './time.js';
import { PushStore } from './push-store.js';

const DAILY_CAP = 4; // 每家每天最多幾則
const SENT_KEEP_MS = 40 * 86400_000;
const EVAL_DEBOUNCE_MS = 3000; // 各家陸續抓完再一起判斷，才能合成一則

export class PushService {
  constructor({ dataDir, vapid, tz, quiet, snapshot, viewers = () => 0, now = Date.now, send = sendPush }) {
    this.store = new PushStore({ dataDir, quiet, now });
    this.vapid = vapid;
    this.tz = tz;
    this.snapshot = snapshot;
    this.viewers = viewers;
    this.now = now;
    this.send = send;
    this.lastFetched = {};
    this.timer = null;
    this.evaluating = null;
  }

  get enabled() {
    return Boolean(this.vapid?.publicKey && this.vapid?.privateKey);
  }

  async load() {
    await this.store.load();
    return this;
  }

  flush() {
    return this.store.flush();
  }

  async test(endpoint) {
    const sub = this.store.find(endpoint);
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
    for (const w of view.windows || []) recordSample(this.store.state.history, `${view.id}:${w.id}`, w, now);
    this.store.save();
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
    const state = this.store.state;
    if (!this.enabled || !state.subs.length) return 0;
    const now = this.now();
    this.#prune(now);
    const providers = this.snapshot.snapshot(now).providers;
    const { quiet, thresholds } = this.store.settings();
    const alerts = evaluateAlerts({ providers, history: state.history, sent: state.sent, now, tz: this.tz, quiet, thresholds });
    if (!alerts.length) return 0;

    const markSent = (list) => { for (const a of list) for (const k of a.keys) state.sent[k] = now; };
    // 網頁開著時先不推播、也不記下：可能只是分頁開著人沒在看，關掉之後條件還成立就照樣推播
    if (this.viewers() > 0) return 0;

    // 超過每日上限的先不送也不記下，明天（或額度還沒重置前）還會再判斷，不會整個週期都漏掉
    const day = localParts(now, this.tz).dateKey;
    const countOf = (id) => (state.daily[id]?.day === day ? state.daily[id].count : 0);
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
      // 送的途中訂閱可能因 410 被刪掉，先複製一份清單
      const targets = state.subs.filter((sub) => sub.prefs?.[kind] !== false);
      let delivered = 0;
      for (const sub of targets) {
        if (await this.#deliver(sub, payload, kind === 'usage' ? 'high' : 'normal')) delivered++;
      }
      sent += delivered;
      // 沒人要這一類：記下但不算次數；全部送失敗：不記，下次再試
      if (!targets.length) markSent(group);
      else if (delivered) {
        markSent(group);
        for (const a of group) state.daily[a.provider] = { day, count: countOf(a.provider) + 1 };
      }
    }
    this.store.save();
    if (sent) logInfo('push sent', { count: sent, kinds: [...new Set(toSend.map((a) => a.kind))] });
    return sent;
  }

  async #deliver(sub, payload, urgency = 'normal') {
    const r = await this.send(sub, payload, this.vapid, { urgency });
    if (r.gone) {
      this.store.unsubscribe(sub.endpoint);
      logInfo('push subscription gone', { status: r.status });
    } else if (!r.ok) {
      logWarn('push failed', { status: r.status });
    }
    return r.ok;
  }

  #prune(now) {
    const { sent, history } = this.store.state;
    for (const [k, t] of Object.entries(sent)) if (now - t > SENT_KEEP_MS) delete sent[k];
    for (const [k, h] of Object.entries(history)) {
      const last = h.samples[h.samples.length - 1];
      if (!last || now - last[0] > SENT_KEEP_MS) delete history[k];
    }
  }
}
