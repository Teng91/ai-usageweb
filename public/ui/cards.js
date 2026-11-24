// 卡片、頂列連線狀態、空畫面；每秒重算倒數與「X 分鐘前」
import { $, ORDER, STALE_INTERVALS, WAKE_WINDOW_MS, state, visible } from './dom.js';
import { money, ago, resetText } from './format.js';
import { gameEffects } from './effects.js';
import { rankingsEl } from './rankings.js';

const cardsEl = $('cards');
const tpl = $('card-tpl');
const loadingTpl = $('empty').cloneNode(true);

export function renderAll() {
  const ids = ORDER.filter((id) => visible(state.providers.get(id)));
  for (const id of state.providers.keys()) if (!ORDER.includes(id) && visible(state.providers.get(id))) ids.push(id);
  // 移除不該出現的卡片
  for (const el of cardsEl.querySelectorAll('.card')) if (!ids.includes(el.dataset.id)) el.remove();
  for (const id of ids) renderCard(state.providers.get(id));
  renderEmpty();
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

function cardFor(id) {
  let el = cardsEl.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  if (!el) {
    el = tpl.content.firstElementChild.cloneNode(true);
    el.dataset.id = id;
    // 依固定順序插入
    const idx = ORDER.indexOf(id);
    const after = [...cardsEl.querySelectorAll('.card')].find((c) => ORDER.indexOf(c.dataset.id) > idx);
    cardsEl.insertBefore(el, after || null);
  }
  return el;
}

function effectiveStatus(p, now = Date.now()) {
  if (p.status !== 'ok') return p.status;
  const interval = (p.intervalSec || state.pollIntervalSec) * 1000;
  if (p.fetchedAt && now - Date.parse(p.fetchedAt) > STALE_INTERVALS * interval) return 'stale';
  return 'ok';
}

/**
 * 只有「剛打開頁面、資料已經舊到算過期（伺服器停機好一陣子）」才顯示更新中。
 * 平常的例行更新不顯示任何 loading，數字到了直接換掉。
 */
function isUpdating(p, now = Date.now()) {
  if (p.status === 'error' || p.status === 'auth') return false;
  if (!state.sessionStart || now - state.sessionStart > WAKE_WINDOW_MS) return false;
  if (state.offline) return false;
  if (!p.fetchedAt) return true;
  if (Date.parse(p.fetchedAt) >= state.sessionStart) return false;
  const interval = (p.intervalSec || state.pollIntervalSec) * 1000;
  return state.sessionStart - Date.parse(p.fetchedAt) > STALE_INTERVALS * interval;
}

export function renderCard(p) {
  if (!visible(p)) {
    cardsEl.querySelector(`.card[data-id="${CSS.escape(p.id)}"]`)?.remove();
    return;
  }
  const el = cardFor(p.id);
  el.querySelector('.card-name').textContent = p.name;
  el.querySelector('.plan').textContent = p.plan || '';
  renderPlanExpiry(el.querySelector('.plan-exp'), p.planExpiresAt);
  const body = el.querySelector('.card-body');
  body.replaceChildren();

  body.classList.toggle('or-body', p.id === 'openrouter');
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
  if (p.id === 'openrouter') body.append(rankingsEl());
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
  const pct = Math.round(w.usedPct);
  const level = w.usedPct >= 90 ? 'danger' : w.usedPct >= 70 ? 'warn' : '';

  const row = document.createElement('div');
  row.className = 'win-row';
  const label = document.createElement('span');
  label.textContent = w.label;
  const val = document.createElement('span');
  val.className = 'win-pct';
  val.textContent = w.limit ? `${w.used} / ${w.limit}（${pct}%）` : `${pct}%`;
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
  bar.append(fill);

  const sub = document.createElement('p');
  sub.className = 'win-sub';
  sub.dataset.resetsAt = w.resetsAt || '';

  wrap.append(row, bar, sub);
  return wrap;
}

/** 每秒更新：倒數、X 分鐘前、狀態 */
function tickCard(el, p, now = Date.now()) {
  for (const sub of el.querySelectorAll('.win-sub')) {
    sub.textContent = resetText(sub.dataset.resetsAt, now);
  }
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
    status.textContent = p.error || '更新失敗';
  } else if (st === 'auth') {
    status.classList.add('auth');
    status.textContent = '需要重新登入';
  } else if (p.slowed) {
    status.classList.add('info');
    status.textContent = '被限流，更新放慢';
  } else {
    status.textContent = '';
  }
  const mins = Math.round(((p.intervalSec || state.pollIntervalSec) / 60) * 10) / 10;
  el.querySelector('.card-meta').textContent = p.fetchedAt ? `資料時間 ${ago(p.fetchedAt, now)} · 每 ${mins} 分鐘更新` : '';
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
    for (const el of cardsEl.querySelectorAll('.card')) {
      const p = state.providers.get(el.dataset.id);
      if (p) tickCard(el, p, now);
    }
    renderChrome(now);
  }, 1000);
}
