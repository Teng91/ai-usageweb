// 數字、金額、時間的顯示格式

export function money(n, currency = 'USD') {
  if (n === null || n === undefined) return '—';
  const sym = currency === 'USD' ? '$' : `${currency} `;
  const v = Number(n);
  return `${v < 0 ? '-' : ''}${sym}${Math.abs(v).toFixed(2)}`;
}

/** 每百萬 token 的價格：$10、$2.5、$0.14、$0.035 */
export function usd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '$0';
  if (v >= 1) return `$${Number(v.toFixed(2))}`;
  return `$${Number(v.toPrecision(2))}`;
}

/** 1.0T → 1T、576.2B → 576.2B：小數點後是 0 就不寫 */
export function tokens(n) {
  const v = Number(n);
  const short = (x, unit) => `${x.toFixed(1).replace(/\.0$/, '')}${unit}`;
  if (v >= 1e12) return short(v / 1e12, 'T');
  if (v >= 1e9) return short(v / 1e9, 'B');
  if (v >= 1e6) return short(v / 1e6, 'M');
  if (v >= 1e3) return short(v / 1e3, 'K');
  return String(v);
}

/** 「剛剛」「3 分鐘前」：只到分鐘，不讓秒數一直跳 */
export function ago(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return '剛剛';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小時前`;
  return `${Math.floor(h / 24)} 天前`;
}

/** 秒數 →「2 天 3 小時」「3 小時 5 分」「12 分鐘」「不到 1 分鐘」 */
export function durationText(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} 天 ${h} 小時`;
  if (h > 0) return `${h} 小時 ${m} 分`;
  if (m > 0) return `${m} 分鐘`;
  return '不到 1 分鐘';
}

export function resetText(iso, now = Date.now()) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Math.round((t - now) / 1000);
  if (diff <= 0) return '應已重置，等待更新';
  return `${durationText(diff)}後重置（${localWhen(t, now)}）`;
}

/** 下次重試：「3 分鐘後重試」；沒有或時間已過回空字串 */
export function retryText(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || t <= now) return '';
  const m = Math.ceil((t - now) / 60_000);
  return m <= 1 ? '1 分鐘內重試' : `${m} 分鐘後重試`;
}

/** 預估用完：「照目前速度約 1 小時 40 分後用完」；沒有或時間已過回空字串 */
export function etaText(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || t <= now) return '';
  return `照目前速度約 ${durationText(Math.round((t - now) / 1000))}後用完`;
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
