import { requestJson, clampPct, toIso } from '../http.js';
import { ProviderError } from '../errors.js';
import { refreshAndSave, callWithRefresh } from '../oauth.js';
import { endpoints, manual } from '../config.js';

// 需實測：網域與 client id 可能更動，可用環境變數覆寫（見 config.js）
const { usageUrl: USAGE_URL, tokenUrl: TOKEN_URL, clientId: CLIENT_ID } = endpoints.claude;

const HOUR = 3600;
const WINDOWS = [
  ['five_hour', '5h', '5 小時', 5 * HOUR],
  ['seven_day', '7d', '每週', 7 * 24 * HOUR],
  ['seven_day_opus', '7d_opus', '每週 Opus', 7 * 24 * HOUR],
  ['seven_day_sonnet', '7d_sonnet', '每週 Sonnet', 7 * 24 * HOUR],
];

/**
 * 訂閱到期日（API 沒有提供，手動設定 CLAUDE_PLAN_EXPIRES_AT=YYYY-MM-DD）。
 * 直接讀環境變數（config.js 的 manual）而不是憑證：憑證存在 volume 後會蓋過環境變數。
 * 回傳 'YYYY-MM-DD'（只有日期，避免時區把日子算錯）；格式不對就當沒設定。
 */
export function parsePlanExpiry(raw) {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(String(raw ?? '').trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseClaude(data) {
  if (!data || typeof data !== 'object') throw new ProviderError('parse', '回傳不是物件');
  const windows = [];
  for (const [key, id, label, periodSec] of WINDOWS) {
    const w = data[key];
    if (!w || w.utilization === null || w.utilization === undefined) continue;
    const usedPct = clampPct(w.utilization);
    if (usedPct === null) continue;
    windows.push({ id, label, usedPct, resetsAt: toIso(w.resets_at), periodSec });
  }
  if (!windows.some((w) => w.id === '5h' || w.id === '7d')) {
    throw new ProviderError('parse', '回傳缺少欄位 five_hour / seven_day');
  }
  return windows;
}

function doRefresh(ctx, current) {
  return refreshAndSave(ctx, current, {
    url: TOKEN_URL,
    body: { grant_type: 'refresh_token', refresh_token: current.refreshToken, client_id: CLIENT_ID },
    label: 'Claude 續期 ',
    expiresAt: (data) => Date.now() + (Number(data.expires_in) || 3600) * 1000,
  });
}

function callUsage(token, signal) {
  return requestJson(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
      Accept: 'application/json',
      'User-Agent': 'ai-usageweb',
    },
    signal,
    label: 'Claude ',
  });
}

export default {
  id: 'claude',
  name: 'Claude',
  minIntervalSec: 60,
  isConfigured(creds) {
    // refresh token（獨立登入）或 setup-token 產生的長效 token 都可以
    return Boolean(creds.claude?.refreshToken || creds.claude?.accessToken);
  },
  async fetch(ctx) {
    const c0 = ctx.creds.claude;
    // 方案名稱與到期日是手動設定，直接讀環境變數（不放進憑證）
    const plan = manual.claudePlan;
    const planExpiresAt = parsePlanExpiry(manual.claudePlanExpiresAt);
    return callWithRefresh(c0, {
      expiresAt: Number(c0.expiresAt) || 0,
      refresh: (c) => doRefresh(ctx, c),
      call: async (c) => {
        const { data } = await callUsage(c.accessToken, ctx.signal);
        return { plan, planExpiresAt, windows: parseClaude(data), balance: null };
      },
    });
  },
};
