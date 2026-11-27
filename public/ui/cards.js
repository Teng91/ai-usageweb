// 卡片、頂列連線狀態、空畫面；每秒重算倒數與「X 分鐘前」（一條額度的畫面在 windows.js）
import { $, WAKE_WINDOW_MS, state, visible, behind, setText, setTitle } from './dom.js';
import { money, ago, retryText } from './format.js';
import { renderWindow, tickWindow, levelOf } from './windows.js';
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
  // 何時算過期由伺服器算好（staleAt，含被限流還在等退避的情況），這裡只比對時間
  return p.staleAt && now > Date.parse(p.staleAt) ? 'stale' : 'ok';
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
    body.append(renderBalance(p.balance));
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

/**
 * 餘額：跟額度卡片同一種排法：一行「餘額（USD）」與金額、「已用／總額」的進度條、「已用 $X / $Y」小字。
 * 沒有總額（不限額的 key）就不畫進度條；用掉超過總額（餘額是負的）是紅色。
 * 不用 .win（那是額度，cards.js 每秒會重算它的倒數），顏色另外看 .balance 的 data-level。
 */
function renderBalance(b) {
  const wrap = document.createElement('div');
  wrap.className = 'balance';
  const total = Number(b.total);
  const used = Number(b.used);
  const hasTotal = b.total !== null && b.total !== undefined && total > 0 && Number.isFinite(used);
  const pct = hasTotal ? (used / total) * 100 : null;
  const level = pct !== null ? levelOf(pct, null) : Number(b.remaining) < 0 ? 'danger' : '';
  if (level) wrap.dataset.level = level;

  const row = document.createElement('div');
  row.className = 'win-row';
  const label = document.createElement('span');
  label.textContent = `餘額（${b.currency || 'USD'}）`;
  const val = document.createElement('span');
  val.className = 'win-pct';
  val.textContent = b.remaining === null || b.remaining === undefined ? '—' : money(b.remaining, b.currency);
  row.append(label, val);
  wrap.append(row);

  if (hasTotal) {
    const bar = document.createElement('div');
    bar.className = `bar ${level}`.trim();
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', '餘額已用');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(Math.round(Math.min(100, Math.max(0, pct)))));
    const fill = document.createElement('span');
    fill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    bar.append(fill);
    wrap.append(bar);
  }

  const sub = document.createElement('p');
  sub.className = 'win-sub';
  sub.textContent = hasTotal
    ? `已用 ${money(b.used, b.currency)} / ${money(b.total, b.currency)}`
    : `已用 ${money(b.used, b.currency)}`;
  wrap.append(sub);
  return wrap;
}

/** 每秒更新：倒數、X 分鐘前、狀態 */
function tickCard(el, p, now = Date.now()) {
  for (const win of el.querySelectorAll('.win')) tickWindow(win, now);
  const st = effectiveStatus(p, now);
  const updating = isUpdating(p, now);
  el.classList.toggle('stale', st === 'stale' && !updating);
  el.classList.toggle('updating', updating);
  const [kind, text] = statusLine(p, st, updating, now);
  const status = el.querySelector('.card-status');
  const cls = kind ? `card-status ${kind}` : 'card-status';
  if (status.className !== cls) status.className = cls;
  setText(status, text);
  // 資料時間：資料還新就不寫（頂列已經有「即時」，五張卡都寫很吵）；超過 2 個更新週期才寫，狀態列已經寫了時間（更新中、過期）就不重複
  const interval = (p.intervalSec || state.pollIntervalSec) * 1000;
  const old = p.fetchedAt && now - Date.parse(p.fetchedAt) > 2 * interval;
  setText(el.querySelector('.card-meta'), old && kind !== 'updating' && st !== 'stale' ? `資料時間 ${ago(p.fetchedAt, now)}` : '');
  // 卡片左邊的狀態色條：這張卡最嚴重的額度（含餘額）
  const level = el.querySelector('.card-body .bar.danger') ? 'danger' : el.querySelector('.card-body .bar.warn') ? 'warn' : '';
  if ((el.dataset.level || '') !== level) {
    if (level) el.dataset.level = level;
    else delete el.dataset.level;
  }
}

/** 卡片狀態列：[樣式, 文字] */
function statusLine(p, st, updating, now) {
  const retry = retryText(p.nextFetchAt, now);
  if (updating) return ['updating', p.fetchedAt ? `更新中，先顯示 ${ago(p.fetchedAt, now)}的數字` : '更新中…'];
  if (st === 'stale') return ['info', `資料已過期（${ago(p.fetchedAt, now)}）`];
  if (st === 'error') return ['error', `${p.error || '更新失敗'}${retry ? `（${retry}）` : ''}`];
  if (st === 'auth') return ['auth', '需要重新登入'];
  if (p.slowed) return ['info', `被限流，更新放慢${retry ? `（${retry}）` : ''}`];
  return ['', ''];
}

/** 頂列連線狀態、頂端進度條（每張卡片底下已有資料時間，頁尾不再顯示「最後更新」） */
export function renderChrome(now = Date.now()) {
  const polling = Boolean(state.fallbackTimer) && !state.offline;
  const connState = state.live ? 'live'
    : state.offline ? 'offline'
      : document.visibilityState === 'hidden' ? 'paused'
        : state.slowWake ? 'waking'
          : polling ? 'polling' : 'connecting';
  const conn = $('conn');
  if (conn.dataset.state !== connState) conn.dataset.state = connState;
  $('conn-dot').classList.toggle('live', state.live || polling);
  setText($('conn-text'), CONN_LABELS[connState]);

  // 資料最後更新的時間（各家最新一筆）：每張卡片在資料還新時不寫，統一寫在這裡；離線時橫幅也寫，才知道數字是多久前的
  const newest = newestFetchedAt();
  setText($('conn-age'), newest ? `${ago(newest, now)}更新` : '');
  setTitle(conn, newest ? `資料最後更新：${new Date(Date.parse(newest)).toLocaleString('zh-TW', { hour12: false })}` : '');
  const banner = $('offline-banner');
  banner.hidden = !state.offline;
  if (state.offline) {
    setText(banner, newest
      ? `離線：顯示的是${ago(newest, now) === '剛剛' ? '剛剛' : ` ${ago(newest, now)}`}的數字，連上網路後會自動更新`
      : '離線：連上網路後會自動更新');
  }

  let anyUpdating = false;
  for (const p of state.providers.values()) {
    if (visible(p) && isUpdating(p, now)) { anyUpdating = true; break; }
  }
  $('progress').classList.toggle('on', state.waking || anyUpdating);
}

const CONN_LABELS = { live: '即時', offline: '離線', paused: '暫停', waking: '喚醒伺服器…', polling: '自動更新', connecting: '連線中…' };

/** 各家（有顯示的）最新一筆資料的時間（ISO 字串）；都還沒有回 null */
function newestFetchedAt() {
  let newest = null;
  for (const p of state.providers.values()) {
    const t = visible(p) && p.fetchedAt ? Date.parse(p.fetchedAt) : NaN;
    if (Number.isFinite(t) && (newest === null || t > Date.parse(newest))) newest = p.fetchedAt;
  }
  return newest;
}

export function startTicker() {
  setInterval(() => {
    // 看不到就不必每秒更新（切回來時 app.js 會重新畫一次）
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    for (const el of cardsEl.querySelectorAll('.card[data-id]')) {
      const p = state.providers.get(el.dataset.id);
      if (p) tickCard(el, p, now);
    }
    renderChrome(now);
  }, 1000);
}
