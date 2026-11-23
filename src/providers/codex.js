import { requestJson, clampPct, toIso } from '../http.js';
import { ProviderError } from '../errors.js';
import { refreshToken, jwtExpiryMs, REFRESH_SKEW_MS } from '../oauth.js';

// 需實測：內部端點，可用環境變數覆寫
const USAGE_URL = process.env.CODEX_USAGE_URL || 'https://chatgpt.com/backend-api/wham/usage';
const TOKEN_URL = process.env.CODEX_TOKEN_URL || 'https://auth.openai.com/oauth/token';
const CLIENT_ID = process.env.CODEX_CLIENT_ID || 'app_EMoamEEZ73f0CkXaXp7hrann';

function windowLabel(sec, fallback) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0) return fallback;
  if (Math.abs(s - 5 * 3600) < 600) return '5 小時';
  if (Math.abs(s - 7 * 86400) < 3600) return '每週';
  if (Math.abs(s - 30 * 86400) < 2 * 86400) return '每月';
  if (s % 86400 === 0) return `${s / 86400} 天`;
  if (s % 3600 === 0) return `${s / 3600} 小時`;
  return `${Math.round(s / 60)} 分鐘`;
}

function planName(raw) {
  if (!raw) return null;
  const s = String(raw);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function parseWindow(w, id, fallbackLabel, now) {
  if (!w || typeof w !== 'object') return null;
  const usedPct = clampPct(w.used_percent);
  if (usedPct === null) return null;
  let resetsAt = toIso(w.reset_at ?? w.resets_at);
  const after = Number(w.reset_after_seconds ?? w.resets_in_seconds);
  if (!resetsAt && Number.isFinite(after)) resetsAt = new Date(now + after * 1000).toISOString();
  return { id, label: windowLabel(w.limit_window_seconds ?? w.window_minutes * 60, fallbackLabel), usedPct, resetsAt };
}

export function parseCodex(data, now = Date.now()) {
  if (!data || typeof data !== 'object') throw new ProviderError('parse', '回傳不是物件');
  const rl = data.rate_limit ?? data.rate_limits;
  const windows = [];
  if (rl && typeof rl === 'object') {
    const p = parseWindow(rl.primary_window ?? rl.primary, 'primary', '短窗', now);
    const s = parseWindow(rl.secondary_window ?? rl.secondary, 'secondary', '每週', now);
    if (p) windows.push(p);
    if (s) windows.push(s);
  }
  if (!('plan_type' in data) && !rl) {
    throw new ProviderError('parse', '回傳缺少欄位 plan_type / rate_limit');
  }
  return {
    plan: planName(data.plan_type),
    windows,
    balance: null,
    note: windows.length ? null : '此方案未提供額度資訊',
  };
}

async function doRefresh(ctx, current) {
  return ctx.withLock(async () => {
    const data = await refreshToken({
      url: TOKEN_URL,
      body: {
        client_id: CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: current.refreshToken,
        scope: 'openid profile email',
      },
      signal: ctx.signal,
      label: 'Codex 續期 ',
    });
    const patch = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || current.refreshToken,
      expiresAt: jwtExpiryMs(data.access_token) || Date.now() + 3600 * 1000,
    };
    try {
      await ctx.saveCreds(patch);
    } catch {
      throw new ProviderError('upstream', '無法保存續期後的憑證');
    }
    return { ...current, ...patch };
  });
}

function callUsage(c, signal) {
  const headers = {
    Authorization: `Bearer ${c.accessToken}`,
    Accept: 'application/json',
    'User-Agent': 'codex_cli_rs',
  };
  if (c.accountId) headers['ChatGPT-Account-Id'] = c.accountId;
  return requestJson(USAGE_URL, { headers, signal, label: 'Codex ' });
}

export default {
  id: 'codex',
  name: 'Codex',
  minIntervalSec: 60,
  intervalSec: 90,
  isConfigured(creds) {
    return Boolean(creds.codex?.refreshToken || creds.codex?.accessToken);
  },
  async fetch(ctx) {
    let c = ctx.creds.codex;
    const canRefresh = Boolean(c.refreshToken);
    const expiresAt = Number(c.expiresAt) || jwtExpiryMs(c.accessToken) || 0;
    if (canRefresh && (!c.accessToken || (expiresAt && expiresAt - Date.now() < REFRESH_SKEW_MS))) {
      c = await doRefresh(ctx, c);
    }
    try {
      const { data } = await callUsage(c, ctx.signal);
      return parseCodex(data);
    } catch (err) {
      if (!(err instanceof ProviderError) || err.kind !== 'auth' || !canRefresh) throw err;
      c = await doRefresh(ctx, c);
      const { data } = await callUsage(c, ctx.signal);
      return parseCodex(data);
    }
  },
};
