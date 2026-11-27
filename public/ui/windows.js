// 一條額度的畫面：標籤與已用 %、進度條（含時間進度標記）、重置倒數、預估用完時間
// renderWindow 建立元素；tickWindow 每秒由 cards.js 呼叫，更新倒數、時間進度與顏色（文字有變才寫）
import { setText, setTitle } from './dom.js';
import { resetText, etaText } from './format.js';

// 用量超過時間線這麼多個百分點就變橘：用得比時間快（剛開始用一點不會馬上變色）
const PACE_MARGIN = 10;

export function renderWindow(w) {
  const wrap = document.createElement('div');
  wrap.className = 'win';
  if (w.periodSec) wrap.dataset.period = w.periodSec < 86400 ? 'short' : 'long';
  const pct = Math.round(w.usedPct);

  const row = document.createElement('div');
  row.className = 'win-row';
  const label = document.createElement('span');
  label.textContent = w.label;
  const val = document.createElement('span');
  val.className = 'win-pct';
  val.textContent = `${pct}%`;
  row.append(label, val);

  // 顏色（warn／danger）在 tickWindow 依時間進度決定
  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', `${w.label} 已用`);
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', String(pct));
  const fill = document.createElement('span');
  fill.style.width = `${Math.min(100, Math.max(0, w.usedPct))}%`;
  // 時間進度：這個週期已經過了多少；用量條沒超過這條線就是還寬裕
  const mark = document.createElement('i');
  mark.className = 'time-mark';
  mark.hidden = true;
  bar.append(fill, mark);

  const sub = document.createElement('p');
  sub.className = 'win-sub';
  // 預估用完時間（伺服器算的，只有會在重置前用完才有）
  const eta = document.createElement('p');
  eta.className = 'win-eta';
  eta.hidden = true;

  wrap.dataset.resetsAt = w.resetsAt || '';
  wrap.dataset.periodSec = w.periodSec || '';
  wrap.dataset.exhaustsAt = w.exhaustsAt || '';
  wrap.dataset.used = String(w.usedPct);
  wrap.dataset.pct = String(pct);
  // 沒用過、也沒有重置時間（例如 Antigravity 的額度要用了第一次才開始計時）：講清楚，不要留白
  if (!w.resetsAt && !(w.usedPct > 0)) wrap.dataset.idle = '1';

  wrap.append(row, bar, sub, eta);
  return wrap;
}

/** 這個週期已經過了多少（0–1）；不知道週期長度、沒有重置時間或已經過了就回 null */
export function elapsed(resetsAtIso, periodSec, now) {
  const r = Date.parse(resetsAtIso);
  if (!Number.isFinite(r) || !(periodSec > 0) || r <= now) return null;
  return Math.min(1, Math.max(0, 1 - (r - now) / (periodSec * 1000)));
}

/**
 * 額度條的顏色：90% 以上紅；知道時間進度時，用量超過時間線 10 個百分點以上變橘（用得比時間快）；
 * 不知道時間進度（沒有週期長度或重置時間）的照舊 70% 變橘。
 */
export function levelOf(usedPct, frac) {
  if (usedPct >= 90) return 'danger';
  if (frac === null) return usedPct >= 70 ? 'warn' : '';
  return usedPct - frac * 100 >= PACE_MARGIN ? 'warn' : '';
}

function setHidden(el, hidden) {
  if (el.hidden !== hidden) el.hidden = hidden;
}

/** 每秒更新一條額度：重置倒數、時間進度與顏色、預估用完 */
export function tickWindow(win, now) {
  const grid = Boolean(win.closest('.win-grid'));
  const sub = win.querySelector('.win-sub');
  const full = resetText(win.dataset.resetsAt, now) || (win.dataset.idle ? '還沒用，用了才開始計時' : '');
  // 兩欄時寬度不夠，只顯示倒數，完整時間放在提示
  const short = grid ? full.replace(/（.*）$/, '') : full;
  setText(sub, short);
  setTitle(sub, short !== full ? full : '');

  const frac = elapsed(win.dataset.resetsAt, Number(win.dataset.periodSec), now);
  const mark = win.querySelector('.time-mark');
  const bar = win.querySelector('.bar');
  setHidden(mark, frac === null);
  if (frac !== null) {
    const left = `${(frac * 100).toFixed(1)}%`;
    if (mark.style.left !== left) mark.style.left = left;
  }
  setTitle(bar, frac === null ? '' : `時間過了 ${Math.round(frac * 100)}%，用了 ${win.dataset.pct}%`);
  const level = levelOf(Number(win.dataset.used), frac);
  bar.classList.toggle('warn', level === 'warn');
  bar.classList.toggle('danger', level === 'danger');

  const eta = win.querySelector('.win-eta');
  const etaFull = etaText(win.dataset.exhaustsAt, now);
  const etaShort = grid ? etaFull.replace('照目前速度', '') : etaFull;
  setHidden(eta, !etaFull);
  setText(eta, etaShort);
  setTitle(eta, etaShort !== etaFull ? etaFull : '');
}
