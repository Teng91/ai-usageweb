// 歷史用量：每張卡片的額度條下面畫近 30 天每日最高用量的小長條圖
import { withKey } from './dom.js';
import { shiftDay, todayIn } from './format.js';

const HISTORY_POLL_MS = 30 * 60_000;
const SPARK_DAYS = 30;

let history = null;
let loadedAt = 0;
let onUpdate = () => {};

/** onChange：拿到新資料時要重畫卡片 */
export function initHistory(onChange) {
  onUpdate = onChange;
  setInterval(() => {
    if (document.visibilityState === 'visible') loadHistory();
  }, HISTORY_POLL_MS);
}

/** 太久沒更新才重抓（回到前景時呼叫） */
export function refreshHistoryIfStale() {
  if (Date.now() - loadedAt > HISTORY_POLL_MS) loadHistory();
}

async function loadHistory() {
  loadedAt = Date.now();
  try {
    const res = await fetch(withKey('/api/history'), { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    if (Array.isArray(data?.days)) {
      history = data;
      onUpdate();
    }
  } catch {
    // 拿不到就不畫，不影響其他資料
  }
}

/** 近 30 天每日最高用量的小長條圖；有資料的日子少於 2 天就不畫 */
export function renderSpark(providerId, w) {
  if (!history?.days?.length || !providerId) return null;
  const byDate = new Map(history.days.map((d) => [d.date, d.providers?.[providerId]?.[w.id]]));
  const today = todayIn(history.tz || 'Asia/Taipei');
  const values = [];
  for (let i = SPARK_DAYS - 1; i >= 0; i--) {
    const date = shiftDay(today, i);
    let v = byDate.get(date);
    // 今天的長條跟著即時數字走
    if (i === 0) v = Math.max(Number.isFinite(v) ? v : 0, Number(w.usedPct) || 0);
    values.push([date, Number.isFinite(v) ? v : null]);
  }
  const known = values.filter(([, v]) => v !== null);
  if (known.length < 2) return null;

  const rowEl = document.createElement('div');
  rowEl.className = 'spark-row';
  const cap = document.createElement('span');
  cap.className = 'spark-cap';
  cap.textContent = '近 30 天';
  const box = document.createElement('div');
  box.className = 'spark';
  const peak = Math.max(...known.map(([, v]) => v));
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', `${w.label} 近 30 天每日最高用量，最高 ${Math.round(peak)}%，有資料 ${known.length} 天`);
  for (const [date, v] of values) {
    const b = document.createElement('span');
    const md = `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
    if (v === null) {
      b.className = 'sp none';
      b.title = `${md}：沒有資料`;
    } else {
      b.className = v >= 90 ? 'sp danger' : v >= 70 ? 'sp warn' : 'sp';
      b.style.height = `${Math.max(6, Math.min(100, v))}%`;
      b.title = `${md}：最高 ${Math.round(v * 10) / 10}%`;
    }
    box.append(b);
  }
  rowEl.append(cap, box);
  return rowEl;
}
