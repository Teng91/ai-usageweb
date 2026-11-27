// 預估用完時間：照目前的消耗速度算出什麼時候會用完（卡片顯示用）
//  - 5 小時這種短週期：看最近 90 分鐘的速度（樣本與算法跟推播共用 alerts.js 的 recordSample／burnRate；樣本只放記憶體）
//  - 每週、每月這種長週期：看這一輪的平均速度（已用 ÷ 已過的時間）。寫程式時一小時漲幾 % 很正常，
//    拿最近 90 分鐘往後推好幾天會一直說「快用完」，但人不會連續寫幾十個小時

import { RULES, recordSample, burnRate } from './alerts.js';

// 沒有重置時間的額度，預估超過這麼久就不顯示（太遠沒意義）
const MAX_AHEAD_MS = 7 * 86400_000;
// 長週期至少要過了這麼久才算平均速度（剛開始幾個小時用一點就會被放大成「很快用完」）
const LONG_MIN_ELAPSED_MS = 86400_000;
const LONG_MIN_ELAPSED_FRAC = 0.15;

/** 長週期：照這一輪的平均速度，會在重置前用完就回預估時間（毫秒），否則 null */
export function cycleEta(w, now) {
  const period = Number(w.periodSec) * 1000;
  const r = Date.parse(w.resetsAt);
  const pct = Number(w.usedPct);
  if (!(period > 0) || !Number.isFinite(r) || r <= now || !(pct > 0) || !(pct < 100)) return null;
  const elapsed = now - (r - period);
  if (elapsed < Math.max(LONG_MIN_ELAPSED_MS, period * LONG_MIN_ELAPSED_FRAC)) return null;
  const at = now + ((100 - pct) / pct) * elapsed;
  return at < r ? at : null;
}

export class Forecaster {
  constructor() {
    this.history = {};
  }

  /**
   * 某家抓到新資料時呼叫：回傳加上 exhaustsAt 的窗口。
   * 只有照目前速度會在重置前用完才有 exhaustsAt（ISO 時間）；資料不夠、沒在用、重置前用不完的維持原樣。
   */
  annotate(id, windows, now) {
    return windows.map((w) => {
      if (Number(w.periodSec) >= RULES.longPeriodSec) {
        const at = cycleEta(w, now);
        return at === null ? w : { ...w, exhaustsAt: new Date(at).toISOString() };
      }
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
