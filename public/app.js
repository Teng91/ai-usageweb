// AI 用量 — 前端進入點：資料與連線（fetch 快照 → SSE 即時更新；SSE 被擋時改輪詢）
// 畫面在 ui/cards.js，其他功能各自在 ui/ 底下的模組
import { state, withKey, keyAccepted, behind } from './ui/dom.js';
import { renderAll, renderCard, renderEmpty, renderChrome, startTicker } from './ui/cards.js';
import { initRankings, refreshRankingsIfStale } from './ui/rankings.js';
import { initThemeToggle } from './ui/theme-toggle.js';
import { initPwa } from './ui/pwa.js';
import { initPush } from './ui/push.js';
import { initMenu } from './ui/menu.js';

// 即時連線（SSE）失敗時改用輪詢；伺服器每 2 分鐘抓一次，輪詢 30 秒一次就不會晚太多
const FALLBACK_POLL_MS = 30_000;
// SSE 這麼久還沒連上就當作被擋（例如公司 proxy 會卡住串流，連線不成功也不報錯）
const SSE_OPEN_TIMEOUT_MS = 6_000;
// 輪詢模式下，每隔幾次再試一次 SSE
const SSE_RETRY_EVERY = 10;
// 喚醒超過這麼久才在右上角顯示「喚醒伺服器…」，避免熱機時閃一下
const SLOW_WAKE_MS = 800;
// 切到別的視窗太久，伺服器會停；切回來第一次拿到的是停之前的數字，伺服器幾秒後才抓到新的。
// SSE 連著會自己推過來；輪詢模式（或 SSE 還沒連上）就照這些間隔再問，直到各家都是新的，不必等下一輪或按 F5
const CATCH_UP_DELAYS_MS = [2000, 3000, 4000, 6000, 10000];

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

/** 先畫出上次存下的數字，伺服器還在喚醒時畫面就不會是空的（由 service worker 給，快取細節只在 sw.js） */
async function paintCached() {
  if (!navigator.serviceWorker?.controller) return; // 第一次開、還沒有 service worker：維持骨架畫面
  try {
    const res = await fetch('/api/usage', { headers: { 'x-cache-only': '1' } });
    if (res.ok) applySnapshot(await res.json());
  } catch {
    // 沒有快取：維持骨架畫面
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
    fallBackToPolling();
  }, SSE_OPEN_TIMEOUT_MS);
  es.addEventListener('open', () => {
    clearTimeout(state.sseOpenTimer);
    state.sseBlocked = false;
    state.live = true;
    state.sseFailures = 0;
    state.offline = false;
    stopFallback();
    armWatchdog();
    renderChrome();
  });
  es.addEventListener('snapshot', (e) => {
    armWatchdog();
    applySnapshot(JSON.parse(e.data));
  });
  es.addEventListener('provider', (e) => {
    armWatchdog();
    applyProvider(JSON.parse(e.data));
    renderChrome();
  });
  es.addEventListener('ping', (e) => {
    // 伺服器連上時先送一次，告訴我們間隔
    try { state.pingSec = Number(JSON.parse(e.data).sec) || state.pingSec; } catch { /* 用原本的 */ }
    armWatchdog();
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
    // 瀏覽器會自動重連（retry: 5000），但重連被拒（例如回 502／503）就整個關掉、不再重試，要馬上改輪詢；
    // 一直重連不上也一樣，連續失敗 3 次改輪詢
    if (es.readyState === EventSource.CLOSED || state.sseFailures >= 3) fallBackToPolling();
  });
}

/** SSE 用不了（卡住、被擋、斷線後重連被拒）：改用輪詢，並馬上問一次 */
function fallBackToPolling() {
  state.sseBlocked = true;
  closeStream();
  startFallback();
  loadSnapshot().then(scheduleCatchUp);
}

// ---------- 切回來時追上新數字 ----------
function scheduleCatchUp() {
  stopCatchUp();
  if (state.live || state.offline || document.visibilityState !== 'visible') return;
  if (state.catchUpStep >= CATCH_UP_DELAYS_MS.length) return;
  if (![...state.providers.values()].some((p) => behind(p))) return;
  state.catchUpTimer = setTimeout(async () => {
    state.catchUpTimer = null;
    if (state.live || document.visibilityState !== 'visible') return;
    state.catchUpStep += 1;
    await loadSnapshot();
    scheduleCatchUp();
  }, CATCH_UP_DELAYS_MS[state.catchUpStep]);
}

function stopCatchUp() {
  clearTimeout(state.catchUpTimer);
  state.catchUpTimer = null;
}

/**
 * 半斷線偵測：伺服器每 pingSec 秒送一次 ping，連續 3 次的時間沒收到任何事件就當作斷了，重新連線。
 * 筆電睡醒、proxy 悄悄切斷連線時 EventSource 不一定會報錯，畫面會停在「即時」卻不再更新。
 */
function armWatchdog() {
  clearTimeout(state.sseWatchdog);
  const es = state.es;
  state.sseWatchdog = setTimeout(() => {
    if (state.es !== es || document.visibilityState !== 'visible') return;
    closeStream();
    start();
  }, state.pingSec * 3 * 1000);
}

function closeStream() {
  clearTimeout(state.sseWatchdog);
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
  state.catchUpStep = 0;
  stopCatchUp();
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
  scheduleCatchUp();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    // 切走就關掉 SSE，讓 fly.io 可以停機
    closeStream();
    stopFallback();
    stopCatchUp();
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
initMenu();
initRankings();
startTicker();
start();
