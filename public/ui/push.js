// 推播通知設定：頂列的鈴鐺 → 對話框（開關、兩種通知、測試）；訂閱交給 service worker 的 pushManager
import { $, withKey, readStore, writeStore } from './dom.js';

const KEY_STORE = 'pushKey';
let publicKey = null;

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

function b64uToBytes(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function api(path, body, key) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(withKey(path), { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function currentSub() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

function setMsg(text, warn = false) {
  const el = $('push-msg');
  el.textContent = text;
  el.classList.toggle('warn', warn);
}

function prefsFromForm() {
  return { usage: $('push-usage').checked, reset: $('push-reset').checked };
}

/** 依目前訂閱狀態更新對話框 */
async function refresh() {
  const on = $('push-on');
  const needKey = !readStore(KEY_STORE);
  $('push-key-row').hidden = !needKey;
  if (!supported()) {
    on.disabled = true;
    $('push-test').disabled = true;
    setMsg(isIos() && !isStandalone()
      ? 'iPhone 要先「加入主畫面」，再從主畫面打開這個 App 才能開啟通知'
      : '這個瀏覽器不支援推播通知', true);
    return;
  }
  on.disabled = false;
  const sub = await currentSub().catch(() => null);
  let subscribed = false;
  if (sub) {
    const r = await api('/api/push/status', { endpoint: sub.endpoint }).catch(() => null);
    subscribed = Boolean(r?.data?.subscribed);
    if (subscribed) {
      $('push-usage').checked = r.data.prefs.usage !== false;
      $('push-reset').checked = r.data.prefs.reset !== false;
    }
  }
  on.checked = subscribed;
  $('push-test').disabled = !subscribed;
  $('push-btn').classList.toggle('on', subscribed);
  if (Notification.permission === 'denied') setMsg('通知權限被封鎖了，要到瀏覽器的網站設定裡打開', true);
  else setMsg(subscribed ? '已開啟：快用完或快重置時會通知這台裝置' : '尚未開啟');
}

async function enable() {
  const key = readStore(KEY_STORE) || $('push-key').value.trim();
  if (!key) { setMsg('先輸入推播密碼', true); $('push-on').checked = false; return; }
  if (await Notification.requestPermission() !== 'granted') {
    $('push-on').checked = false;
    setMsg('沒有拿到通知權限', true);
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const opts = { userVisibleOnly: true, applicationServerKey: b64uToBytes(publicKey) };
  let sub;
  try {
    sub = await reg.pushManager.subscribe(opts);
  } catch {
    // 伺服器換過金鑰時舊訂閱會卡住，退訂再試一次
    await (await reg.pushManager.getSubscription())?.unsubscribe();
    sub = await reg.pushManager.subscribe(opts);
  }
  const r = await api('/api/push/subscribe', { subscription: sub.toJSON(), prefs: prefsFromForm() }, key);
  if (!r.ok) {
    await sub.unsubscribe().catch(() => {});
    if (r.status === 403) writeStore(KEY_STORE, '');
    throw new Error(r.data.error || `訂閱失敗（${r.status}）`);
  }
  writeStore(KEY_STORE, key);
  $('push-key').value = '';
}

async function disable() {
  const sub = await currentSub();
  if (!sub) return;
  await api('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

async function savePrefs() {
  const sub = await currentSub().catch(() => null);
  const key = readStore(KEY_STORE);
  if (!sub || !key || !$('push-on').checked) return;
  const r = await api('/api/push/subscribe', { subscription: sub.toJSON(), prefs: prefsFromForm() }, key);
  setMsg(r.ok ? '已儲存' : (r.data.error || '儲存失敗'), !r.ok);
}

/** 顯示狀態時避免連點：執行期間停用開關 */
async function busy(fn, okMsg) {
  const on = $('push-on');
  on.disabled = true;
  try {
    await fn();
    await refresh();
    if (okMsg) setMsg(okMsg);
  } catch (err) {
    setMsg(err.message || '出錯了', true);
    await refresh().catch(() => {});
    setMsg(err.message || '出錯了', true);
  } finally {
    on.disabled = !supported();
  }
}

export async function initPush() {
  let cfg;
  try {
    const res = await fetch(withKey('/api/push/config'), { cache: 'no-store' });
    cfg = res.ok ? await res.json() : null;
  } catch {
    cfg = null;
  }
  if (!cfg?.enabled) return;
  publicKey = cfg.publicKey;
  const dlg = $('push-dialog');
  $('push-btn').hidden = false;
  $('push-btn').addEventListener('click', () => {
    dlg.showModal();
    refresh().catch(() => {});
  });
  $('push-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // 點外面關閉
  $('push-on').addEventListener('change', (e) => busy(() => (e.target.checked ? enable() : disable())));
  $('push-usage').addEventListener('change', () => savePrefs());
  $('push-reset').addEventListener('change', () => savePrefs());
  $('push-test').addEventListener('click', () => busy(async () => {
    const sub = await currentSub();
    const r = await api('/api/push/test', { endpoint: sub?.endpoint || '' });
    if (!r.ok) throw new Error(r.data.error || '送不出去');
  }, '已送出測試通知，幾秒內會收到'));
  // 已經訂閱的話鈴鐺亮起來
  if (supported()) {
    currentSub().then(async (sub) => {
      if (!sub) return;
      const r = await api('/api/push/status', { endpoint: sub.endpoint });
      $('push-btn').classList.toggle('on', Boolean(r.data.subscribed));
    }).catch(() => {});
  }
}
