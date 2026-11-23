// AI 用量 — 前端：fetch 快照 → SSE 即時更新 → 每秒自己重算倒數
const ORDER = ['claude', 'codex', 'antigravity', 'copilot', 'openrouter'];
const STALE_INTERVALS = 3;
const FALLBACK_POLL_MS = 60_000;

const $ = (id) => document.getElementById(id);
const cardsEl = $('cards');
const tpl = $('card-tpl');

const state = {
  providers: new Map(),
  pollIntervalSec: 60,
  es: null,
  live: false,
  sseFailures: 0,
  fallbackTimer: null,
  refreshing: true,
  offline: !navigator.onLine,
};

const accessKey = new URLSearchParams(location.search).get('k');
const withKey = (url) => (accessKey ? `${url}?k=${encodeURIComponent(accessKey)}` : url);

// ---------- 資料 ----------
async function loadSnapshot() {
  try {
    const res = await fetch(withKey('/api/usage'), { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    applySnapshot(await res.json());
    state.offline = res.headers.get('x-from-cache') === '1' || !navigator.onLine;
  } catch {
    state.offline = true;
  }
  renderChrome();
}

function applySnapshot(snap) {
  state.pollIntervalSec = snap.pollIntervalSec || 60;
  state.providers.clear();
  for (const p of snap.providers || []) state.providers.set(p.id, p);
  renderAll();
}

function applyProvider(p) {
  state.providers.set(p.id, p);
  state.refreshing = false;
  renderCard(p);
  renderEmpty();
}

// ---------- SSE ----------
function openStream() {
  closeStream();
  const es = new EventSource(withKey('/api/stream'));
  state.es = es;
  es.addEventListener('open', () => {
    state.live = true;
    state.sseFailures = 0;
    state.offline = false;
    stopFallback();
    renderChrome();
  });
  es.addEventListener('snapshot', (e) => {
    applySnapshot(JSON.parse(e.data));
  });
  es.addEventListener('provider', (e) => {
    applyProvider(JSON.parse(e.data));
    renderChrome();
  });
  es.addEventListener('bye', () => {
    // 伺服器主動斷開（連線太久或停機）：只有看得見時才重連
    closeStream();
    if (document.visibilityState === 'visible') setTimeout(start, 1000);
  });
  es.addEventListener('error', () => {
    state.live = false;
    state.sseFailures += 1;
    renderChrome();
    // 瀏覽器會自動重連（retry: 5000）；連續失敗 3 次改用輪詢備援
    if (state.sseFailures >= 3) {
      closeStream();
      startFallback();
    }
  });
}

function closeStream() {
  if (state.es) {
    state.es.close();
    state.es = null;
  }
  state.live = false;
}

function startFallback() {
  if (state.fallbackTimer) return;
  state.fallbackTimer = setInterval(async () => {
    await loadSnapshot();
    // 偶爾再試一次 SSE
    if (!state.offline && !state.es) {
      state.sseFailures = 0;
      openStream();
    }
  }, FALLBACK_POLL_MS);
}

function stopFallback() {
  clearInterval(state.fallbackTimer);
  state.fallbackTimer = null;
}

async function start() {
  state.refreshing = true;
  await loadSnapshot();
  if (document.visibilityState === 'visible') openStream();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    // 切走就關掉 SSE，讓 fly.io 可以停機
    closeStream();
    stopFallback();
    renderChrome();
  } else {
    start();
  }
});

window.addEventListener('online', () => { state.offline = false; start(); });
window.addEventListener('offline', () => { state.offline = true; renderChrome(); });

// ---------- 畫面 ----------
function visible(p) {
  return p && p.status !== 'disabled';
}

function renderAll() {
  const ids = ORDER.filter((id) => visible(state.providers.get(id)));
  for (const id of [...state.providers.keys()]) if (!ORDER.includes(id) && visible(state.providers.get(id))) ids.push(id);
  // 移除不該出現的卡片
  for (const el of cardsEl.querySelectorAll('.card')) if (!ids.includes(el.dataset.id)) el.remove();
  for (const id of ids) renderCard(state.providers.get(id));
  renderEmpty();
}

function renderEmpty() {
  const any = cardsEl.querySelector('.card');
  let empty = $('empty');
  if (any) {
    empty?.remove();
  } else {
    if (!empty) {
      empty = document.createElement('p');
      empty.id = 'empty';
      empty.className = 'empty';
      cardsEl.append(empty);
    }
    empty.textContent = state.offline ? '離線中，還沒有任何資料' : '尚未設定任何服務的憑證';
  }
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

function renderCard(p) {
  if (!visible(p)) {
    cardsEl.querySelector(`.card[data-id="${CSS.escape(p.id)}"]`)?.remove();
    return;
  }
  const el = cardFor(p.id);
  el.querySelector('.card-name').textContent = p.name;
  el.querySelector('.plan').textContent = p.plan || '';
  const body = el.querySelector('.card-body');
  body.replaceChildren();

  if (p.balance) {
    body.append(renderBalance(p.balance));
  } else if (p.windows?.length) {
    for (const w of p.windows) body.append(renderWindow(w));
  } else if (p.note) {
    const n = document.createElement('p');
    n.className = 'note';
    n.textContent = p.note;
    body.append(n);
  } else if (!p.fetchedAt) {
    const n = document.createElement('p');
    n.className = 'note';
    n.textContent = '等待第一次資料…';
    body.append(n);
  }
  tickCard(el, p);
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

/** 每秒更新：倒數、X 秒前、狀態 */
function tickCard(el, p, now = Date.now()) {
  for (const sub of el.querySelectorAll('.win-sub')) {
    sub.textContent = resetText(sub.dataset.resetsAt, now);
  }
  const st = effectiveStatus(p, now);
  el.classList.toggle('stale', st === 'stale');
  const status = el.querySelector('.card-status');
  status.className = 'card-status';
  if (st === 'stale') {
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
  } else if (state.refreshing && !state.live) {
    status.classList.add('info');
    status.textContent = '更新中…';
  } else {
    status.textContent = '';
  }
  el.querySelector('.card-meta').textContent = p.fetchedAt ? `資料時間 ${ago(p.fetchedAt, now)}` : '';
}

function renderChrome(now = Date.now()) {
  const dot = $('conn-dot');
  dot.classList.toggle('live', state.live);
  $('conn-text').textContent = state.live
    ? '即時'
    : state.offline ? '離線' : document.visibilityState === 'hidden' ? '暫停' : state.fallbackTimer ? '輪詢中' : '連線中…';
  $('offline-banner').hidden = !state.offline;

  let latest = 0;
  for (const p of state.providers.values()) {
    if (visible(p) && p.fetchedAt) latest = Math.max(latest, Date.parse(p.fetchedAt));
  }
  $('last-updated').textContent = latest ? `最後更新 ${ago(new Date(latest).toISOString(), now)}` : '—';
}

setInterval(() => {
  const now = Date.now();
  for (const el of cardsEl.querySelectorAll('.card')) {
    const p = state.providers.get(el.dataset.id);
    if (p) tickCard(el, p, now);
  }
  renderChrome(now);
}, 1000);

// ---------- 格式 ----------
function money(n, currency = 'USD') {
  if (n === null || n === undefined) return '—';
  const sym = currency === 'USD' ? '$' : `${currency} `;
  const v = Number(n);
  return `${v < 0 ? '-' : ''}${sym}${Math.abs(v).toFixed(2)}`;
}

function ago(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} 秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小時前`;
  return `${Math.floor(h / 24)} 天前`;
}

function resetText(iso, now = Date.now()) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Math.round((t - now) / 1000);
  if (diff <= 0) return '應已重置，等待更新';
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  let left;
  if (d > 0) left = `${d} 天 ${h} 小時`;
  else if (h > 0) left = `${h} 小時 ${m} 分`;
  else if (m > 0) left = `${m} 分 ${s} 秒`;
  else left = `${s} 秒`;
  return `${left}後重置（${localWhen(t, now)}）`;
}

function localWhen(t, now) {
  const date = new Date(t);
  const today = new Date(now);
  const tomorrow = new Date(now + 86400_000);
  const hm = date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (date.toDateString() === today.toDateString()) return `今天 ${hm}`;
  if (date.toDateString() === tomorrow.toDateString()) return `明天 ${hm}`;
  const md = date.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', weekday: 'short' });
  return `${md} ${hm}`;
}

// ---------- PWA ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    const showUpdate = (worker) => {
      $('update-banner').hidden = false;
      $('update-btn').onclick = () => worker.postMessage({ type: 'SKIP_WAITING' });
    };
    if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(nw);
      });
    });
    // 每次回到前景檢查一次新版本
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => {});

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  $('install-btn').hidden = false;
});
$('install-btn').addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice.catch(() => {});
  deferredInstall = null;
  $('install-btn').hidden = true;
});
window.addEventListener('appinstalled', () => { $('install-btn').hidden = true; });

start();
