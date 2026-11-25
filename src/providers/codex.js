import { requestJson, clampPct, toIso } from '../http.js';
import { ProviderError } from '../errors.js';
import { jwtExpiryMs, refreshAndSave, callWithRefresh } from '../oauth.js';

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
  const sec = Number(w.limit_window_seconds ?? w.window_minutes * 60);
  const out = { id, label: windowLabel(sec, fallbackLabel), usedPct, resetsAt };
  if (Number.isFinite(sec) && sec > 0) out.periodSec = sec;
  return out;
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

function doRefresh(ctx, current) {
  return refreshAndSave(ctx, current, {
    url: TOKEN_URL,
    body: {
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
      scope: 'openid profile email',
    },
    label: 'Codex 續期 ',
    expiresAt: (data) => jwtExpiryMs(data.access_token) || Date.now() + 3600 * 1000,
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
  isConfigured(creds) {
    return Boolean(creds.codex?.refreshToken || creds.codex?.accessToken);
  },
  async fetch(ctx) {
    const c0 = ctx.creds.codex;
    return callWithRefresh(c0, {
      expiresAt: Number(c0.expiresAt) || jwtExpiryMs(c0.accessToken) || 0,
      refresh: (c) => doRefresh(ctx, c),
      call: async (c) => parseCodex((await callUsage(c, ctx.signal)).data),
    });
  },
};
