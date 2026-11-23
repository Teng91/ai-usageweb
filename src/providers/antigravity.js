import { requestJson, toIso } from '../http.js';
import { ProviderError } from '../errors.js';
import { refreshToken, REFRESH_SKEW_MS } from '../oauth.js';

// 需實測：內部端點，可用環境變數覆寫
const BASE = process.env.ANTIGRAVITY_BASE_URL || 'https://cloudcode-pa.googleapis.com/v1internal';
const TOKEN_URL = process.env.ANTIGRAVITY_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const USER_AGENT = process.env.ANTIGRAVITY_USER_AGENT || 'antigravity';

// Google 的 access token 只放記憶體（1 小時），refresh token 不輪換
const cache = { accessToken: null, expiresAt: 0, projectId: null, plan: null };

export function _resetCache() {
  cache.accessToken = null;
  cache.expiresAt = 0;
  cache.projectId = null;
  cache.plan = null;
}

function family(name) {
  const s = String(name).toLowerCase();
  if (s.includes('gemini')) return 'gemini';
  if (/claude|gpt|openai|anthropic|\bo\d/.test(s)) return 'other';
  return null;
}

/** 模型依家族分兩組，每組取最低的 remainingFraction */
export function parseModels(data) {
  const raw = data?.models;
  if (!raw || typeof raw !== 'object') throw new ProviderError('parse', '回傳缺少欄位 models');
  const list = Array.isArray(raw)
    ? raw.map((m) => [m.name || m.id || m.model || '', m])
    : Object.entries(raw);

  const groups = { gemini: null, other: null };
  for (const [key, m] of list) {
    const q = m?.quotaInfo;
    if (!q) continue;
    const fam = family(`${key} ${m.displayName || ''} ${m.model || ''}`);
    if (!fam) continue;
    // quotaInfo 存在但沒有 remainingFraction 代表已用完
    const frac = q.remainingFraction === undefined || q.remainingFraction === null ? 0 : Number(q.remainingFraction);
    if (!Number.isFinite(frac)) continue;
    const cur = groups[fam];
    if (!cur || frac < cur.frac) groups[fam] = { frac, resetTime: q.resetTime };
  }

  const windows = [];
  if (groups.gemini) windows.push(toWindow('gemini', 'Gemini', groups.gemini));
  if (groups.other) windows.push(toWindow('claude_gpt', 'Claude/GPT', groups.other));
  return windows;
}

function toWindow(id, label, g) {
  const usedPct = Math.round(Math.min(1, Math.max(0, 1 - g.frac)) * 1000) / 10;
  return { id, label, usedPct, resetsAt: toIso(g.resetTime) };
}

function tierName(load) {
  const t = load?.paidTier || load?.currentTier;
  const name = t?.name || t?.id;
  if (!name) return null;
  if (/free|standard-tier|legacy/i.test(name) && !/pro|ultra/i.test(name)) return 'Free';
  return String(name);
}

async function accessToken(ctx) {
  if (cache.accessToken && cache.expiresAt - Date.now() > REFRESH_SKEW_MS) return cache.accessToken;
  const c = ctx.creds.antigravity;
  if (!c.clientId || !c.clientSecret) throw new ProviderError('auth', '缺少 Antigravity client id／secret');
  return ctx.withLock(async () => {
    const data = await refreshToken({
      url: TOKEN_URL,
      form: true,
      body: {
        client_id: c.clientId,
        client_secret: c.clientSecret,
        refresh_token: c.refreshToken,
        grant_type: 'refresh_token',
      },
      signal: ctx.signal,
      label: 'Antigravity 續期 ',
    });
    cache.accessToken = data.access_token;
    cache.expiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
    // 少數情況 Google 也會給新的 refresh token，存起來
    if (data.refresh_token && data.refresh_token !== c.refreshToken) {
      await ctx.saveCreds({ refreshToken: data.refresh_token }).catch(() => {});
    }
    return cache.accessToken;
  });
}

function post(path, token, body, signal) {
  return requestJson(`${BASE}:${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    body,
    signal,
    label: 'Antigravity ',
  });
}

async function fetchOnce(ctx, token) {
  const c = ctx.creds.antigravity;
  let projectId = c.projectId || cache.projectId;
  if (!projectId || !cache.plan) {
    const { data } = await post('loadCodeAssist', token, {
      metadata: { ideType: 'ANTIGRAVITY', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' },
    }, ctx.signal);
    const proj = data?.cloudaicompanionProject;
    projectId = projectId || (typeof proj === 'string' ? proj : proj?.id) || null;
    cache.projectId = projectId;
    cache.plan = tierName(data) || 'Free';
  }
  if (!projectId) throw new ProviderError('parse', '回傳缺少 project id');
  const { data } = await post('fetchAvailableModels', token, { project: projectId }, ctx.signal);
  const windows = parseModels(data);
  return {
    plan: cache.plan,
    windows,
    balance: null,
    note: windows.length ? null : '此方案未提供額度資訊',
  };
}

export default {
  id: 'antigravity',
  name: 'Antigravity',
  minIntervalSec: 60,
  intervalSec: 90,
  isConfigured(creds) {
    const c = creds.antigravity;
    return Boolean(c?.refreshToken && c?.clientId && c?.clientSecret);
  },
  async fetch(ctx) {
    const token = await accessToken(ctx);
    try {
      return await fetchOnce(ctx, token);
    } catch (err) {
      if (!(err instanceof ProviderError) || err.kind !== 'auth') throw err;
      cache.accessToken = null;
      return fetchOnce(ctx, await accessToken(ctx));
    }
  },
};
