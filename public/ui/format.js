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

export function tokens(n) {
  const v = Number(n);
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
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

export function resetText(iso, now = Date.now()) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Math.round((t - now) / 1000);
  if (diff <= 0) return '應已重置，等待更新';
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  let left;
  if (d > 0) left = `${d} 天 ${h} 小時`;
  else if (h > 0) left = `${h} 小時 ${m} 分`;
  else if (m > 0) left = `${m} 分鐘`;
  else left = '不到 1 分鐘';
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
