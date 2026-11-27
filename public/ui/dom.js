// 各模組共用：取元素、共用狀態、常數、加上 ACCESS_KEY 的網址

export const $ = (id) => document.getElementById(id);

// 打開頁面後這段時間內，舊資料視為「更新中」而不是「過期」（伺服器剛喚醒正在抓）
export const WAKE_WINDOW_MS = 90_000;

/** 資料與連線的共用狀態（app.js 寫、cards.js 讀） */
export const state = {
  // 卡片順序就是伺服器快照的順序（src/providers/index.js），前端不另外寫一份
  providers: new Map(),
  pollIntervalSec: 120,
  es: null,
  live: false,
  // 頂列的連線狀態（live／offline／paused／waking／polling／connecting），由 app.js 算好
  conn: 'connecting',
  // SSE 太久沒收到事件就當作半斷線：伺服器 ping 的間隔（連上時伺服器會告訴我們）與計時器
  pingSec: 25,
  sseWatchdog: null,
  sseFailures: 0,
  fallbackTimer: null,
  fallbackTicks: 0,
  sseOpenTimer: null,
  sseBlocked: false,
  waking: false,
  slowWake: false,
  sessionStart: 0,
  // 切回來後追新數字（app.js）：第幾次、下一次的計時器
  catchUpStep: 0,
  catchUpTimer: null,
  offline: !navigator.onLine,
};

// ?k=<ACCESS_KEY> 只在第一次需要：伺服器收到後會設 HttpOnly cookie，之後靠 cookie
let accessKey = new URLSearchParams(location.search).get('k');
export const withKey = (url) => (accessKey ? `${url}?k=${encodeURIComponent(accessKey)}` : url);

/** API 帶著 ?k= 成功回應後呼叫：存取碼從網址列與瀏覽紀錄拿掉，之後的請求不再帶 */
export function keyAccepted() {
  if (!accessKey) return;
  accessKey = null;
  const u = new URL(location.href);
  u.searchParams.delete('k');
  history.replaceState(history.state, '', `${u.pathname}${u.search}${u.hash}`);
}

/** 沒設定憑證的服務不顯示 */
export const visible = (p) => Boolean(p) && p.status !== 'disabled';

// 抓一次要幾秒：比一個更新週期再舊這麼多才算「伺服器停過」
const BEHIND_SLACK_MS = 15_000;

/** 被限流或出錯，伺服器還在等退避時間（nextFetchAt 還沒到）才會再抓 */
export function backingOff(p, at = Date.now()) {
  return Boolean(p.slowed || p.status === 'error') && Date.parse(p.nextFetchAt) > at;
}

/**
 * 在 at 這個時間點，這家的資料比一個更新週期還舊：伺服器停過一陣子，被叫醒後正在重抓。
 * 要重新登入的、還在等退避的不算（伺服器不會馬上有新的）。
 */
export function behind(p, at = Date.now()) {
  if (!visible(p) || p.status === 'auth' || backingOff(p, at)) return false;
  if (!p.fetchedAt) return true;
  return at - Date.parse(p.fetchedAt) > (p.intervalSec || state.pollIntervalSec) * 1000 + BEHIND_SLACK_MS;
}

/** 文字有變才寫：倒數每秒都會算一次，沒變就不動 DOM（螢幕閱讀器不會一直唸，也省重繪） */
export function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

/** 提示文字（title）有變才寫；空字串就拿掉 */
export function setTitle(el, text) {
  if (!text) el.removeAttribute('title');
  else if (el.title !== text) el.title = text;
}

/** 讀寫 localStorage；私密模式等情況會丟錯，一律吞掉 */
export function readStore(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeStore(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 不能存就只在這次有效 */ }
}

export function removeStore(key) {
  try { localStorage.removeItem(key); } catch { /* 忽略 */ }
}

/** iPhone／iPad（iPadOS 會偽裝成 Mac，用觸控點數分辨） */
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** 從主畫面（PWA）打開的 */
export const isStandalone = () => navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
