// 卡片、頂列連線狀態、空畫面；每秒重算倒數與「X 分鐘前」
import { $, WAKE_WINDOW_MS, state, visible, behind, backingOff } from './dom.js';
import { money, ago, resetText, retryText, etaText } from './format.js';
import { gameEffects } from './effects.js';
import { rankingsEl } from './rankings.js';

const cardsEl = $('cards');
const tpl = $('card-tpl');
const loadingTpl = $('empty').cloneNode(true);

export function renderAll() {
  // 順序照伺服器快照（state.providers 依快照順序放入）
  const ids = [...state.providers.keys()].filter((id) => visible(state.providers.get(id)));
  // 移除不該出現的卡片
  for (const el of cardsEl.querySelectorAll('.card[data-id]')) if (!ids.includes(el.dataset.id)) el.remove();
  for (const id of ids) renderCard(state.providers.get(id));
  syncGroups();
  renderEmpty();
}

// 分區：各家額度（含 OpenRouter 餘額）一區、底下 OpenRouter 熱門模型排行一區，都不加標題
const GROUPS = ['ai', 'rank'];

function groupEl(key) {
  let g = cardsEl.querySelector(`.group[data-group="${key}"]`);
  if (g) return g;
  g = document.createElement('section');
  g.className = 'group';
  g.dataset.group = key;
  const next = [...cardsEl.querySelectorAll('.group')].find((x) => GROUPS.indexOf(x.dataset.group) > GROUPS.indexOf(key));
  cardsEl.insertBefore(g, next || null);
  return g;
}

/** 有 OpenRouter 卡片才在底下放排行（排行資料來自 OpenRouter）；排行區塊只建一次，搬來搬去不重設分頁 */
let rankCard = null;
function syncRankCard() {
  if (!cardsEl.querySelector('.card[data-id="openrouter"]')) {
    rankCard?.remove();
    return;
  }
  rankCard ??= rankingsEl();
  const g = groupEl('rank');
  if (rankCard.parentElement !== g) g.append(rankCard);
}

/** 空的分區拿掉 */
function syncGroups() {
  syncRankCard();
  for (const g of cardsEl.querySelectorAll('.group')) {
    if (!g.querySelector(':scope > .card')) g.remove();
  }
}

export function renderEmpty() {
  const any = cardsEl.querySelector('.card');
  let empty = $('empty');
  if (any) {
    empty?.remove();
    return;
  }
  const isLoading = empty?.classList.contains('loading');
  if (state.waking) {
    // 還在等伺服器：顯示骨架卡片
    if (!isLoading) {
      empty?.remove();
      cardsEl.append(loadingTpl.cloneNode(true));
    }
    return;
  }
  if (!empty || isLoading) {
    empty?.remove();
    empty = document.createElement('p');
    empty.id = 'empty';
    empty.className = 'empty';
    cardsEl.append(empty);
  }
  empty.textContent = state.offline ? '離線中，還沒有任何資料' : '尚未設定任何服務的憑證';
}

function cardFor(p) {
  let el = cardsEl.querySelector(`.card[data-id="${CSS.escape(p.id)}"]`);
  if (!el) {
    el = tpl.content.firstElementChild.cloneNode(true);
    el.dataset.id = p.id;
  }
  // 放進額度分區，依固定順序
  const g = groupEl('ai');
  const order = [...state.providers.keys()];
  const idx = order.indexOf(p.id);
  const after = [...g.querySelectorAll(':scope > .card')].find((c) => c !== el && order.indexOf(c.dataset.id) > idx) || null;
  if (el.parentElement !== g || el.nextElementSibling !== after) g.insertBefore(el, after);
  return el;
}

function effectiveStatus(p, now = Date.now()) {
  if (p.status !== 'ok') return p.status;
  // 被限流、還在等退避：顯示「被限流」與重試時間，不算過期（退避最多 15 分鐘，比 3 個週期長）
  if (backingOff(p, now)) return 'ok';
  const interval = (p.intervalSec || state.pollIntervalSec) * 1000;
  if (p.fetchedAt && now - Date.parse(p.fetchedAt) > state.staleIntervals * interval) return 'stale';
  return 'ok';
}

/**
 * 剛打開頁面（或切回來）時資料比一個更新週期還舊：伺服器停過、正在重抓，先標「更新中」，新數字到了直接換掉
 * （輪詢模式由 app.js 每隔幾秒再問一次）。平常的例行更新不顯示任何 loading。
 */
function isUpdating(p, now = Date.now()) {
  if (p.status === 'error') return false; // 出錯的照樣顯示錯誤（與重試時間）
  if (!state.sessionStart || now - state.sessionStart > WAKE_WINDOW_MS || state.offline) return false;
  if (p.fetchedAt && Date.parse(p.fetchedAt) >= state.sessionStart) return false;
  return behind(p, state.sessionStart);
}

export function renderCard(p) {
  if (!visible(p)) {
    cardsEl.querySelector(`.card[data-id="${CSS.escape(p.id)}"]`)?.remove();
    syncGroups();
    return;
  }
  const el = cardFor(p);
  syncGroups();
  el.querySelector('.card-name').textContent = p.name;
  el.querySelector('.plan').textContent = p.plan || '';
  renderPlanExpiry(el.querySelector('.plan-exp'), p.planExpiresAt);
  const body = el.querySelector('.card-body');
  body.replaceChildren();

  // 超過兩條額度就排成兩欄（左 5 小時、右每週），卡片高度跟只有兩條的一樣
  body.classList.toggle('win-grid', !p.balance && (p.windows?.length || 0) > 2);
  if (p.balance) {
    const bal = document.createElement('div');
    bal.className = 'balance';
    bal.append(renderBalance(p.balance));
    body.append(bal);
  } else if (p.windows?.length) {
    for (const w of p.windows) body.append(renderWindow(w));
  } else if (p.note) {
    body.append(note(p.note));
  } else if (!p.fetchedAt) {
    body.append(note('等待第一次資料…'));
  }
  gameEffects(el, p);
  tickCard(el, p);
}

function note(text) {
  const n = document.createElement('p');
  n.className = 'note';
  n.textContent = text;
  return n;
}

/** 訂閱到期日：剩 30 天內變橘色，過期變紅色 */
function renderPlanExpiry(span, ymd, now = new Date()) {
  span.className = 'plan-exp';
  span.textContent = '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) return;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // 用本地日曆的「天」來算，不受時區與時分影響
  const days = Math.round((Date.UTC(y, mo - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400_000);
  const date = `${y}/${mo}/${d}`;
  if (days < 0) {
    span.textContent = `已於 ${date} 到期`;
    span.classList.add('danger');
  } else {
    span.textContent = days === 0 ? `今天到期（${date}）` : `${date} 到期・剩 ${days} 天`;
    if (days <= 30) span.classList.add('warn');
  }
}

function renderBalance(b) {
  const frag = document.createDocumentFragment();
  const big = document.createElement('p');
  big.className = Number(b.remaining) < 0 ? 'balance-big negative' : 'balance-big';
  big.textContent = b.remaining === null || b.remaining === undefined ? '—' : money(b.remaining, b.currency);
  frag.append(big);
  const sub = document.createElement('p');
  sub.className = 'balance-sub';
  sub.textContent = b.total !== null && b.total !== undefined
    ? `已用 ${money(b.used, b.currency)} / ${money(b.total, b.currency)}`
    : `已用 ${money(b.used, b.currency)}`;
  frag.append(sub);
  return frag;
}

function renderWindow(w) {
  const wrap = document.createElement('div');
  wrap.className = 'win';
  if (w.periodSec) wrap.dataset.period = w.periodSec < 86400 ? 'short' : 'long';
  const pct = Math.round(w.usedPct);
  const level = w.usedPct >= 90 ? 'danger' : w.usedPct >= 70 ? 'warn' : '';

  const row = document.createElement('div');
  row.className = 'win-row';
  const label = document.createElement('span');
  label.textContent = w.label;
  const val = document.createElement('span');
  val.className = 'win-pct';
  val.textContent = `${pct}%`;
  row.append(label, val);

  const bar = document.createElement('div');
  bar.className = `bar ${level}`;
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', `${w.label} 已用`);
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', String(pct));
  const fill = document.createElement('span');
  fill.style.width = `${Math.min(100, Math.max(0, w.usedPct))}%`;
  // 時間進度：這個週期已經過了多少（每秒在 tickWindow 更新位置）；用量條沒超過這條線就是還寬裕
  const mark = document.createElement('i');
  mark.className = 'time-mark';
  mark.hidden = true;
  bar.append(fill, mark);

  const sub = document.createElement('p');
  sub.className = 'win-sub';
  // 預估用完時間（伺服器依最近的消耗速度算，只有會在重置前用完才有）
  const eta = document.createElement('p');
  eta.className = 'win-eta';
  eta.hidden = true;

  wrap.dataset.resetsAt = w.resetsAt || '';
  wrap.dataset.periodSec = w.periodSec || '';
  wrap.dataset.exhaustsAt = w.exhaustsAt || '';
  wrap.dataset.pct = String(pct);
  // 沒用過、也沒有重置時間（例如 Antigravity 的額度要用了第一次才開始計時）：講清楚，不要留白
  if (!w.resetsAt && !(w.usedPct > 0)) wrap.dataset.idle = '1';

  wrap.append(row, bar, sub, eta);
  return wrap;
}

/** 這個週期已經過了多少（0–1）；不知道週期長度、沒有重置時間或已經過了就回 null */
function elapsed(resetsAtIso, periodSec, now) {
  const r = Date.parse(resetsAtIso);
  if (!Number.isFinite(r) || !(periodSec > 0) || r <= now) return null;
  return Math.min(1, Math.max(0, 1 - (r - now) / (periodSec * 1000)));
}

/** 每秒更新一條額度：重置倒數、時間進度、預估用完 */
function tickWindow(win, now) {
  const grid = Boolean(win.closest('.win-grid'));
  const sub = win.querySelector('.win-sub');
  const full = resetText(win.dataset.resetsAt, now) || (win.dataset.idle ? '還沒用，用了才開始計時' : '');
  // 兩欄時寬度不夠，只顯示倒數，完整時間放在提示
  const short = grid ? full.replace(/（.*）$/, '') : full;
  sub.textContent = short;
  if (short !== full) sub.title = full; else sub.removeAttribute('title');

  const frac = elapsed(win.dataset.resetsAt, Number(win.dataset.periodSec), now);
  const mark = win.querySelector('.time-mark');
  const bar = win.querySelector('.bar');
  mark.hidden = frac === null;
  if (frac === null) {
    bar.removeAttribute('title');
  } else {
    mark.style.left = `${(frac * 100).toFixed(2)}%`;
    bar.title = `時間過了 ${Math.round(frac * 100)}%，用了 ${win.dataset.pct}%`;
  }

  const eta = win.querySelector('.win-eta');
  const etaFull = etaText(win.dataset.exhaustsAt, now);
  const etaShort = grid ? etaFull.replace('照目前速度', '') : etaFull;
  eta.hidden = !etaFull;
  eta.textContent = etaShort;
  if (etaShort !== etaFull) eta.title = etaFull; else eta.removeAttribute('title');
}

/** 每秒更新：倒數、X 分鐘前、狀態 */
function tickCard(el, p, now = Date.now()) {
  for (const win of el.querySelectorAll('.win')) tickWindow(win, now);
  const st = effectiveStatus(p, now);
  const updating = isUpdating(p, now);
  el.classList.toggle('stale', st === 'stale' && !updating);
  el.classList.toggle('updating', updating);
  const status = el.querySelector('.card-status');
  status.className = 'card-status';
  if (updating) {
    status.classList.add('updating');
    status.textContent = p.fetchedAt ? `更新中，先顯示 ${ago(p.fetchedAt, now)}的數字` : '更新中…';
  } else if (st === 'stale') {
    status.classList.add('info');
    status.textContent = `資料已過期（${ago(p.fetchedAt, now)}）`;
  } else if (st === 'error') {
    status.classList.add('error');
    const retry = retryText(p.nextFetchAt, now);
    status.textContent = `${p.error || '更新失敗'}${retry ? `（${retry}）` : ''}`;
  } else if (st === 'auth') {
    status.classList.add('auth');
    status.textContent = '需要重新登入';
  } else if (p.slowed) {
    status.classList.add('info');
    const retry = retryText(p.nextFetchAt, now);
    status.textContent = `被限流，更新放慢${retry ? `（${retry}）` : ''}`;
  } else {
    status.textContent = '';
  }
  el.querySelector('.card-meta').textContent = p.fetchedAt ? `資料時間 ${ago(p.fetchedAt, now)}` : '';
}

/** 頂列連線狀態、頂端進度條（每張卡片底下已有資料時間，頁尾不再顯示「最後更新」） */
export function renderChrome(now = Date.now()) {
  const polling = Boolean(state.fallbackTimer) && !state.offline;
  $('conn-dot').classList.toggle('live', state.live || polling);
  $('conn-text').textContent = state.live
    ? '即時'
    : state.offline ? '離線'
      : document.visibilityState === 'hidden' ? '暫停'
        : state.slowWake ? '喚醒伺服器…'
          : polling ? '自動更新' : '連線中…';
  $('offline-banner').hidden = !state.offline;

  let anyUpdating = false;
  for (const p of state.providers.values()) {
    if (visible(p) && isUpdating(p, now)) { anyUpdating = true; break; }
  }
  $('progress').classList.toggle('on', state.waking || anyUpdating);
}

export function startTicker() {
  setInterval(() => {
    const now = Date.now();
    for (const el of cardsEl.querySelectorAll('.card[data-id]')) {
      const p = state.providers.get(el.dataset.id);
      if (p) tickCard(el, p, now);
    }
    renderChrome(now);
  }, 1000);
}
