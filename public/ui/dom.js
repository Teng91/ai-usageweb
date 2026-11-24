// 各模組共用：取元素、共用狀態、常數、加上 ACCESS_KEY 的網址

export const $ = (id) => document.getElementById(id);

// 卡片固定順序
export const ORDER = ['claude', 'codex', 'antigravity', 'copilot', 'openrouter'];
// 超過幾個更新週期沒新資料就算過期
export const STALE_INTERVALS = 3;
// 打開頁面後這段時間內，舊資料視為「更新中」而不是「過期」（伺服器剛喚醒正在抓）
export const WAKE_WINDOW_MS = 90_000;

/** 資料與連線的共用狀態（app.js 寫、cards.js 讀） */
export const state = {
  providers: new Map(),
  pollIntervalSec: 120,
  es: null,
  live: false,
  sseFailures: 0,
  fallbackTimer: null,
  fallbackTicks: 0,
  sseOpenTimer: null,
  sseBlocked: false,
  waking: false,
  slowWake: false,
  sessionStart: 0,
  offline: !navigator.onLine,
};

const accessKey = new URLSearchParams(location.search).get('k');
export const withKey = (url) => (accessKey ? `${url}?k=${encodeURIComponent(accessKey)}` : url);

/** 沒設定憑證的服務不顯示 */
export const visible = (p) => Boolean(p) && p.status !== 'disabled';

/** 讀寫 localStorage；私密模式等情況會丟錯，一律吞掉 */
export function readStore(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeStore(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 不能存就只在這次有效 */ }
}
