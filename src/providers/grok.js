import { requestJson, clampPct } from '../http.js';
import { ProviderError } from '../errors.js';
import { endpoints } from '../config.js';

// grok.com 網頁自己用的內部端點（非公開 API，可能會變；可用環境變數覆寫，見 config.js）
const { rateLimitsUrl: URL_RATE, userAgent: USER_AGENT } = endpoints.grok;
// 免費方案只看 Fast（grok-3 的 DEFAULT）這組；其他模式免費帳號選不到
const BODY = { requestKind: 'DEFAULT', modelName: 'grok-3' };

function windowLabel(sec) {
  if (!(sec > 0)) return '額度';
  if (sec % 86400 === 0) return sec === 86400 ? '每天' : `每 ${sec / 86400} 天`;
  if (sec % 3600 === 0) return `${sec / 3600} 小時`;
  return '額度';
}

/** /rest/rate-limits：剩餘次數／總次數 → 已用百分比（免費方案不給重置時間） */
export function parseGrok(data) {
  if (!data || typeof data !== 'object') throw new ProviderError('parse', '回傳不是物件');
  const total = Number(data.totalQueries);
  const remaining = Number(data.remainingQueries);
  // 付費方案改用每週用量池，這個端點不再給次數
  if (!(total > 0) || !Number.isFinite(remaining)) {
    return { plan: null, windows: [], balance: null, note: '此方案未提供額度資訊（目前只支援免費方案）' };
  }
  const sec = Number(data.windowSizeSeconds);
  const w = {
    id: 'chat',
    label: windowLabel(sec),
    usedPct: clampPct(((total - remaining) / total) * 100),
    resetsAt: null,
    used: Math.max(0, Math.round(total - remaining)),
    limit: Math.round(total),
  };
  if (sec > 0) w.periodSec = sec;
  return { plan: 'Free', windows: [w], balance: null, note: null };
}

export default {
  id: 'grok',
  name: 'Grok',
  minIntervalSec: 60,
  // grok.com 登入後的 Cookie（至少要有 sso）；過期就重新貼一次
  credentialFields: ['cookie'],
  isConfigured(creds) {
    return Boolean(creds.grok?.cookie);
  },
  async fetch(ctx) {
    const { data } = await requestJson(URL_RATE, {
      method: 'POST',
      headers: {
        Cookie: ctx.creds.grok.cookie,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: 'https://grok.com',
        Referer: 'https://grok.com/',
        'User-Agent': USER_AGENT,
      },
      body: BODY,
      signal: ctx.signal,
      label: 'Grok ',
    });
    return parseGrok(data);
  },
};
