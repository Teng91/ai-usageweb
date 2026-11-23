import { requestJson, clampPct, toIso } from '../http.js';
import { ProviderError } from '../errors.js';
import { refreshToken, REFRESH_SKEW_MS } from '../oauth.js';

// 需實測：網域與 client id 可能更動，可用環境變數覆寫
const USAGE_URL = process.env.CLAUDE_USAGE_URL || 'https://api.anthropic.com/api/oauth/usage';
const TOKEN_URL = process.env.CLAUDE_TOKEN_URL || 'https://console.anthropic.com/v1/oauth/token';
const CLIENT_ID = process.env.CLAUDE_CLIENT_ID || '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

const WINDOWS = [
  ['five_hour', '5h', '5 小時'],
  ['seven_day', '7d', '每週'],
  ['seven_day_opus', '7d_opus', '每週 Opus'],
  ['seven_day_sonnet', '7d_sonnet', '每週 Sonnet'],
];

export function parseClaude(data) {
  if (!data || typeof data !== 'object') throw new ProviderError('parse', '回傳不是物件');
  const windows = [];
  for (const [key, id, label] of WINDOWS) {
    const w = data[key];
    if (!w || w.utilization === null || w.utilization === undefined) continue;
    const usedPct = clampPct(w.utilization);
    if (usedPct === null) continue;
    windows.push({ id, label, usedPct, resetsAt: toIso(w.resets_at) });
  }
  if (!windows.some((w) => w.id === '5h' || w.id === '7d')) {
    throw new ProviderError('parse', '回傳缺少欄位 five_hour / seven_day');
  }
  return windows;
}

async function doRefresh(ctx, current) {
  return ctx.withLock(async () => {
    const data = await refreshToken({
      url: TOKEN_URL,
      body: { grant_type: 'refresh_token', refresh_token: current.refreshToken, client_id: CLIENT_ID },
      signal: ctx.signal,
      label: 'Claude 續期 ',
    });
    const patch = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || current.refreshToken,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    };
    try {
      // 先寫回 volume 才使用新 token；寫入失敗就不要用
      await ctx.saveCreds(patch);
    } catch {
      throw new ProviderError('upstream', '無法保存續期後的憑證');
    }
    return { ...current, ...patch };
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
    const plan = c0.plan || 'Pro';
    let c = c0;
    const canRefresh = Boolean(c.refreshToken);
    const expiresAt = Number(c.expiresAt) || 0;

    if (canRefresh && (!c.accessToken || (expiresAt && expiresAt - Date.now() < REFRESH_SKEW_MS))) {
      c = await doRefresh(ctx, c);
    }

    try {
      const { data } = await callUsage(c.accessToken, ctx.signal);
      return { plan, windows: parseClaude(data), balance: null };
    } catch (err) {
      if (!(err instanceof ProviderError) || err.kind !== 'auth' || !canRefresh) throw err;
      // 401：續期一次再重試一次
      c = await doRefresh(ctx, c);
      const { data } = await callUsage(c.accessToken, ctx.signal);
      return { plan, windows: parseClaude(data), balance: null };
    }
  },
};
