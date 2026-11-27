// 預估用完時間：記最近的用量樣本，照目前的消耗速度算出什麼時候會用完（卡片顯示用）
// 樣本與速度的算法跟推播共用 alerts.js 的 recordSample／burnRate；樣本只放記憶體（推播的樣本另外存在 push.json）

import { recordSample, burnRate } from './alerts.js';

// 沒有重置時間的額度，預估超過這麼久就不顯示（太遠沒意義）
const MAX_AHEAD_MS = 7 * 86400_000;

export class Forecaster {
  constructor() {
    this.history = {};
  }

  /**
   * 某家抓到新資料時呼叫：記樣本，回傳加上 exhaustsAt 的窗口。
   * 只有照目前速度會在重置前用完才有 exhaustsAt（ISO 時間）；資料不夠、沒在用、重置前用不完的維持原樣。
   */
  annotate(id, windows, now) {
    return windows.map((w) => {
      const h = recordSample(this.history, `${id}:${w.id}`, w, now);
      const pct = Number(w.usedPct);
      if (!h || !(pct < 100)) return w;
      const rate = burnRate(h, now);
      if (!(rate > 0)) return w;
      const at = now + (100 - pct) / rate;
      const r = w.resetsAt ? Date.parse(w.resetsAt) : null;
      if (r ? at >= r : at - now > MAX_AHEAD_MS) return w;
      return { ...w, exhaustsAt: new Date(at).toISOString() };
    });
  }
}
