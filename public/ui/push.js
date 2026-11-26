// 推播通知設定：頂列的鈴鐺 → 對話框（開關、三種通知、測試）；訂閱交給 service worker 的 pushManager
// 推播密碼只在開啟通知時用一次，不存起來；之後改設定、退訂、測試都靠這台裝置的訂閱 endpoint
import { $, withKey, removeStore, isIos, isStandalone } from './dom.js';

let publicKey = null;

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

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

const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const THRESHOLD_CHOICES = [50, 60, 70, 75, 80, 85, 90];

/** 勿擾與門檻的選單只建一次 */
function buildSettingsForm() {
  for (const id of ['push-quiet-start', 'push-quiet-end']) {
    const sel = $(id);
    if (sel.options.length) continue;
    for (let h = 0; h < 24; h++) sel.add(new Option(hh(h), String(h)));
  }
  for (const id of ['push-t1', 'push-t2']) {
    const sel = $(id);
    if (sel.options.length) continue;
    sel.add(new Option('關閉', ''));
    for (const t of THRESHOLD_CHOICES) sel.add(new Option(`${t}%`, String(t)));
  }
}

/** 把伺服器的設定填進表單，也更新說明文字 */
function showSettings(s) {
  const q = s?.quiet || null;
  $('push-quiet-on').checked = Boolean(q);
  $('push-quiet-start').value = String(q ? q.start : 0);
  $('push-quiet-end').value = String(q ? q.end : 8);
  $('push-quiet-start').disabled = !q;
  $('push-quiet-end').disabled = !q;
  const t = s?.thresholds || [];
  $('push-t1').value = t[0] !== undefined ? String(t[0]) : '';
  $('push-t2').value = t[1] !== undefined ? String(t[1]) : '';
  const tText = t.length ? `週／月額度到 ${[...t].sort((a, b) => a - b).map((x) => `${x}%`).join('、')}；` : '';
  $('push-usage-desc').textContent = `照目前速度會在重置前用完；${tText}或已用 95%`;
  $('push-note').textContent = `${q ? `${hh(q.start)}–${hh(q.end)} 不通知；` : '沒有勿擾時段；'}網頁開著時先不通知，關掉後條件還成立才通知。`;
}

async function saveSettings() {
  const sub = await currentSub().catch(() => null);
  if (!sub) return;
  const on = $('push-quiet-on').checked;
  const settings = {
    quiet: on ? { start: Number($('push-quiet-start').value), end: Number($('push-quiet-end').value) } : null,
    thresholds: [$('push-t1').value, $('push-t2').value].filter(Boolean).map(Number),
  };
  const r = await api('/api/push/settings', { endpoint: sub.endpoint, settings });
  if (r.ok) showSettings(r.data.settings);
  setMsg(r.ok ? '已儲存' : (r.status === 400 && on && settings.quiet.start === settings.quiet.end ? '勿擾的開始和結束不能一樣' : (r.data.error || '儲存失敗')), !r.ok);
}

function prefsFromForm() {
  return { usage: $('push-usage').checked, reset: $('push-reset').checked, restored: $('push-restored').checked };
}

/** 依目前訂閱狀態更新對話框 */
async function refresh() {
  const on = $('push-on');
  if (!supported()) {
    $('push-key-row').hidden = true;
    $('push-settings').hidden = true;
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
  let subRes = null;
  if (sub) {
    const r = await api('/api/push/status', { endpoint: sub.endpoint }).catch(() => null);
    subRes = r;
    subscribed = Boolean(r?.data?.subscribed);
    if (subscribed) {
      $('push-usage').checked = r.data.prefs.usage !== false;
      $('push-reset').checked = r.data.prefs.reset !== false;
      $('push-restored').checked = r.data.prefs.restored !== false;
    }
  }
  on.checked = subscribed;
  // 已經開啟就不必再輸入密碼；勿擾與門檻只有開啟後才能改
  $('push-key-row').hidden = subscribed;
  $('push-settings').hidden = !subscribed;
  if (subscribed) showSettings(subRes.data.settings);
  $('push-test').disabled = !subscribed;
  $('push-btn').classList.toggle('on', subscribed);
  if (Notification.permission === 'denied') setMsg('通知權限被封鎖了，要到瀏覽器的網站設定裡打開', true);
  else setMsg(subscribed ? '已開啟：快用完、快重置或重置後會通知這台裝置' : '尚未開啟');
}

async function enable() {
  const key = $('push-key').value.trim();
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
    try {
      sub = await reg.pushManager.subscribe(opts);
    } catch {
      $('push-on').checked = false;
      throw new Error('瀏覽器拒絕訂閱推播，稍後再試或重新整理頁面'); // 瀏覽器的錯誤訊息是英文，換成中文
    }
  }
  const r = await api('/api/push/subscribe', { subscription: sub.toJSON(), prefs: prefsFromForm() }, key);
  if (!r.ok) {
    await sub.unsubscribe().catch(() => {});
    throw new Error(r.data.error || `訂閱失敗（${r.status}）`);
  }
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
  if (!sub || !$('push-on').checked) return;
  const r = await api('/api/push/prefs', { endpoint: sub.endpoint, prefs: prefsFromForm() });
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
  removeStore('pushKey'); // 舊版會把推播密碼存在 localStorage，清掉
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
  $('push-restored').addEventListener('change', () => savePrefs());
  buildSettingsForm();
  for (const id of ['push-quiet-on', 'push-quiet-start', 'push-quiet-end', 'push-t1', 'push-t2']) {
    $(id).addEventListener('change', () => saveSettings());
  }
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
