// AI 用量 — 前端進入點：資料與連線（fetch 快照 → SSE 即時更新；SSE 被擋時改輪詢）
// 畫面在 ui/cards.js，其他功能各自在 ui/ 底下的模組
import { state, withKey, keyAccepted } from './ui/dom.js';
import { renderAll, renderCard, renderEmpty, renderChrome, startTicker } from './ui/cards.js';
import { initRankings, refreshRankingsIfStale } from './ui/rankings.js';
import { initThemeToggle } from './ui/theme-toggle.js';
import { initPwa } from './ui/pwa.js';
import { initPush } from './ui/push.js';

// 即時連線（SSE）失敗時改用輪詢；伺服器每 2 分鐘抓一次，輪詢 30 秒一次就不會晚太多
const FALLBACK_POLL_MS = 30_000;
// SSE 這麼久還沒連上就當作被擋（例如公司 proxy 會卡住串流，連線不成功也不報錯）
const SSE_OPEN_TIMEOUT_MS = 6_000;
// 輪詢模式下，每隔幾次再試一次 SSE
const SSE_RETRY_EVERY = 10;
// 喚醒超過這麼久才在右上角顯示「喚醒伺服器…」，避免熱機時閃一下
const SLOW_WAKE_MS = 800;

// ---------- 資料 ----------
async function loadSnapshot() {
  try {
    const res = await fetch(withKey('/api/usage'), { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    applySnapshot(await res.json());
    const fromCache = res.headers.get('x-from-cache') === '1';
    // 伺服器真的回應了（不是 service worker 的快取），cookie 已經設好
    if (!fromCache) keyAccepted();
    state.offline = fromCache || !navigator.onLine;
  } catch {
    state.offline = true;
  }
  renderChrome();
}

/** 先畫出上次存下的數字，伺服器還在喚醒時畫面就不會是空的 */
async function paintCached() {
  try {
    const res = await (await caches.open('api-last')).match('/api/usage');
    if (res) applySnapshot(await res.json());
  } catch {
    // 沒有快取或瀏覽器不支援：維持骨架畫面
  }
}

function applySnapshot(snap) {
  state.pollIntervalSec = snap.pollIntervalSec || 120;
  state.providers.clear();
  for (const p of snap.providers || []) state.providers.set(p.id, p);
  renderAll();
}

function applyProvider(p) {
  state.providers.set(p.id, p);
  renderCard(p);
  renderEmpty();
}

// ---------- SSE 與備援輪詢 ----------
function openStream() {
  closeStream();
  const es = new EventSource(withKey('/api/stream'));
  state.es = es;
  // 連線卡住（不成功也不報錯）時改用輪詢，不要一直停在「連線中…」
  state.sseOpenTimer = setTimeout(() => {
    if (state.es !== es || state.live) return;
    state.sseBlocked = true;
    closeStream();
    startFallback();
    loadSnapshot();
  }, SSE_OPEN_TIMEOUT_MS);
  es.addEventListener('open', () => {
    clearTimeout(state.sseOpenTimer);
    state.sseBlocked = false;
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
      state.sseBlocked = true;
      closeStream();
      startFallback();
    }
  });
}

function closeStream() {
  clearTimeout(state.sseOpenTimer);
  if (state.es) {
    state.es.close();
    state.es = null;
  }
  state.live = false;
}

function startFallback() {
  if (state.fallbackTimer) return;
  state.fallbackTicks = 0;
  state.fallbackTimer = setInterval(async () => {
    await loadSnapshot();
    state.fallbackTicks += 1;
    // 偶爾再試一次 SSE（連不上的話 SSE_OPEN_TIMEOUT_MS 後又回到輪詢）
    if (!state.offline && !state.es && state.fallbackTicks % SSE_RETRY_EVERY === 0) {
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
  refreshRankingsIfStale();
  state.sessionStart = Date.now();
  state.waking = true;
  const slowTimer = setTimeout(() => { state.slowWake = true; renderChrome(); }, SLOW_WAKE_MS);
  renderChrome();
  if (!state.providers.size) await paintCached();
  renderEmpty();
  try {
    await loadSnapshot();
  } finally {
    clearTimeout(slowTimer);
    state.waking = false;
    state.slowWake = false;
    renderEmpty();
    renderChrome();
  }
  if (document.visibilityState !== 'visible') return;
  // 已經在輪詢（SSE 被擋）就繼續輪詢，不必每次回到前景都再等一次 SSE 逾時
  if (state.sseBlocked) startFallback();
  else openStream();
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

// ---------- 啟動 ----------
initThemeToggle();
initPwa();
initPush();
initRankings();
startTicker();
start();
