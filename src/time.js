// 時間的計算與寫法（依設定的時區；推播的判斷與內容用）

const MIN = 60_000;

/** 當地時間的各欄位；offsetMs = 當地時間 − UTC */
export function localParts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short',
  });
  const o = Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const y = Number(o.year), mo = Number(o.month), d = Number(o.day), hh = Number(o.hour), mm = Number(o.minute);
  const offsetMs = Date.UTC(y, mo - 1, d, hh, mm) - Math.floor(ms / MIN) * MIN;
  return { y, mo, d, hh, mm, weekday: o.weekday, offsetMs, dateKey: `${y}-${mo}-${d}` };
}

const WEEK = { Sun: '日', Mon: '一', Tue: '二', Wed: '三', Thu: '四', Fri: '五', Sat: '六' };

/** 重置時間的寫法：今天 16:00／明天 10:00／11/27（四）10:00 */
export function formatWhen(ms, now, tz) {
  const t = localParts(ms, tz);
  const n = localParts(now, tz);
  const hm = `${String(t.hh).padStart(2, '0')}:${String(t.mm).padStart(2, '0')}`;
  const dayDiff = Math.round((Date.UTC(t.y, t.mo - 1, t.d) - Date.UTC(n.y, n.mo - 1, n.d)) / 86400000);
  if (dayDiff === 0) return hm;
  if (dayDiff === 1) return `明天 ${hm}`;
  return `${t.mo}/${t.d}（${WEEK[t.weekday] || ''}）${hm}`;
}

export function formatDuration(ms) {
  const m = Math.max(1, Math.round(ms / MIN));
  if (m < 60) return `${m} 分鐘`;
  const h = Math.floor(m / 60);
  if (h < 10) return m % 60 ? `${h} 小時 ${m % 60} 分` : `${h} 小時`;
  if (h < 48) return `${Math.round(m / 60)} 小時`;
  return `${Math.round(m / 1440)} 天`;
}
