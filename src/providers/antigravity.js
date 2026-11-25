import { requestJson, toIso } from '../http.js';
import { ProviderError } from '../errors.js';
import { refreshToken, REFRESH_SKEW_MS } from '../oauth.js';

// 內部端點，可用環境變數覆寫。跟 agy CLI 一樣用 daily-cloudcode-pa：
// cloudcode-pa 回的 Gemini 組額度永遠是 100%（重置時間也一直往後推），daily 的才是實際用量（2026-11 實測）
const BASE = process.env.ANTIGRAVITY_BASE_URL || 'https://daily-cloudcode-pa.googleapis.com/v1internal';
const TOKEN_URL = process.env.ANTIGRAVITY_TOKEN_URL || 'https://oauth2.googleapis.com/token';
// 要用 agy CLI 的格式：retrieveUserQuotaSummary 看到 CLI 才會連 Gemini 組的額度一起回（只寫 antigravity 只有 Claude/GPT 組）
const USER_AGENT = process.env.ANTIGRAVITY_USER_AGENT || 'antigravity/cli/1.5.15';

// Google 的 access token 只放記憶體（1 小時），refresh token 不輪換
const cache = { owner: null, accessToken: null, expiresAt: 0, projectId: null, plan: null, planAt: 0 };
// 方案（訂閱）會變，每小時重查（升級後最慢一小時內更新）；機器 suspend 時記憶體不會清掉，不能只在啟動時查一次
const PLAN_TTL_MS = 3600 * 1000;

export function _resetCache() {
  cache.owner = null;
  cache.accessToken = null;
  cache.expiresAt = 0;
  cache.projectId = null;
  cache.plan = null;
  cache.planAt = 0;
}

/** 憑證換了（管理 API 換帳號）就丟掉舊帳號的 token、project 與方案 */
function syncCacheOwner(c) {
  const owner = `${c.clientId}\n${c.refreshToken}`;
  if (cache.owner === owner) return;
  _resetCache();
  cache.owner = owner;
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
    // 只採計有「數字」remainingFraction 的模型；缺這個欄位的（可能是無上限或尚未初始化）
    // 就跳過，不要當成已用完而讓整組誤報 100%
    if (q.remainingFraction === undefined || q.remainingFraction === null) continue;
    const frac = Number(q.remainingFraction);
    if (!Number.isFinite(frac)) continue;
    const cur = groups[fam];
    if (!cur || frac < cur.frac) groups[fam] = { frac, resetTime: q.resetTime };
  }

  const windows = [];
  if (groups.gemini) windows.push(toWindow('gemini', 'Gemini', groups.gemini));
  if (groups.other) windows.push(toWindow('claude_gpt', 'Claude/GPT', groups.other));
  return windows;
}

function usedOf(frac) {
  return Math.round(Math.min(1, Math.max(0, 1 - frac)) * 1000) / 10;
}

function toWindow(id, label, g) {
  return { id, label, usedPct: usedOf(g.frac), resetsAt: toIso(g.resetTime) };
}

const HOUR = 3600;
const PERIODS = { '5h': [5 * HOUR, '5h', ''], weekly: [7 * 24 * HOUR, '每週', '_week'] };
const FAMILIES = [['gemini', 'Gemini'], ['claude_gpt', 'Claude/GPT']];

/**
 * retrieveUserQuotaSummary：每組模型（Gemini、Claude/GPT）的 5 小時與每週額度（付費方案才有）。
 * 回傳 { gemini: { '5h': win, weekly: win }, claude_gpt: {...} }，沒有的就不放。
 */
export function parseSummary(data) {
  const out = {};
  for (const g of Array.isArray(data?.groups) ? data.groups : []) {
    // 先看組名，組名認不出來才看說明（說明裡會列出組內模型）
    const fam = family(g.displayName || '') || family(g.description || '');
    if (!fam) continue;
    const [id, name] = FAMILIES[fam === 'gemini' ? 0 : 1];
    for (const b of Array.isArray(g.buckets) ? g.buckets : []) {
      const p = PERIODS[b?.window];
      const frac = Number(b?.remainingFraction);
      if (!p || b.remainingFraction === undefined || b.remainingFraction === null || !Number.isFinite(frac)) continue;
      (out[id] ||= {})[b.window] = {
        id: id + p[2], label: `${name} ${p[1]}`, usedPct: usedOf(frac), resetsAt: toIso(b.resetTime), periodSec: p[0],
      };
    }
  }
  return out;
}

/**
 * 合併兩個來源：每組先放 5 小時（summary 有就用 summary，否則用模型清單的），再放每週。
 * 模型清單的窗口若 5 小時內就重置，視為 5 小時額度（付費方案），標上長度。
 */
export function mergeWindows(modelWins, summary, now = Date.now()) {
  const out = [];
  for (const [id, name] of FAMILIES) {
    const s = summary[id] || {};
    let short = s['5h'];
    if (!short) {
      const m = modelWins.find((w) => w.id === id);
      if (m) {
        const left = Date.parse(m.resetsAt) - now;
        short = left > 0 && left <= 5 * HOUR * 1000 + 5 * 60_000
          ? { ...m, label: `${name} 5h`, periodSec: 5 * HOUR }
          : m;
      }
    }
    if (short) out.push(short);
    if (s.weekly) out.push(s.weekly);
  }
  return out;
}

/** 方案名稱整理成 Free／Pro／Ultra；認不得的照原樣顯示 */
export function tierName(load) {
  const t = load?.paidTier || load?.currentTier;
  const name = t?.name || t?.id;
  if (!name) return null;
  if (/ultra/i.test(name)) return 'Ultra';
  if (/\bpro\b/i.test(name)) return 'Pro';
  if (/free|starter|standard-tier|legacy/i.test(name)) return 'Free';
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
    // 少數情況 Google 也會給新的 refresh token：先 await 存檔成功才使用這次續期的結果
    if (data.refresh_token && data.refresh_token !== c.refreshToken) {
      try {
        await ctx.saveCreds({ refreshToken: data.refresh_token });
      } catch {
        throw new ProviderError('upstream', '無法保存續期後的憑證');
      }
      // 下一輪讀到的是新 refresh token，owner 跟著換，避免被當成換帳號而清掉快取
      cache.owner = `${c.clientId}\n${data.refresh_token}`;
    }
    cache.accessToken = data.access_token;
    cache.expiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
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
  if (!projectId || !cache.plan || Date.now() - cache.planAt > PLAN_TTL_MS) {
    const { data } = await post('loadCodeAssist', token, {
      metadata: { ideType: 'ANTIGRAVITY', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' },
    }, ctx.signal);
    const proj = data?.cloudaicompanionProject;
    projectId = projectId || (typeof proj === 'string' ? proj : proj?.id) || null;
    cache.projectId = projectId;
    cache.plan = tierName(data) || 'Free';
    cache.planAt = Date.now();
  }
  if (!projectId) throw new ProviderError('parse', '回傳缺少 project id');
  // 每週額度只在 summary 裡；summary 拿不到（免費方案、端點變了）就只顯示模型清單的
  const [models, summary] = await Promise.all([
    post('fetchAvailableModels', token, { project: projectId }, ctx.signal),
    post('retrieveUserQuotaSummary', token, { project: projectId }, ctx.signal).then(
      (r) => parseSummary(r.data),
      (err) => {
        if (err instanceof ProviderError && err.kind === 'auth') throw err;
        return {};
      },
    ),
  ]);
  const windows = mergeWindows(parseModels(models.data), summary);
  return {
    plan: cache.plan,
    windows,
    balance: null,
    note: windows.length ? null : '此方案未提供額度資訊',
  };
}

export default {
  id: 'antigravity',
  name: 'Gemini',
  minIntervalSec: 60,
  isConfigured(creds) {
    const c = creds.antigravity;
    return Boolean(c?.refreshToken && c?.clientId && c?.clientSecret);
  },
  async fetch(ctx) {
    syncCacheOwner(ctx.creds.antigravity);
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
