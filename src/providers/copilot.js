import { requestJson, clampPct, toIso } from '../http.js';
import { ProviderError } from '../errors.js';

const URL_USER = process.env.COPILOT_USER_URL || 'https://api.github.com/copilot_internal/user';

const LABELS = { chat: 'Chat', completions: '程式碼補全', premium_interactions: 'Premium 請求' };
const ORDER = ['chat', 'completions', 'premium_interactions'];

function planName(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (s.includes('free')) return 'Free';
  if (s.includes('pro_plus') || s.includes('pro+')) return 'Pro+';
  if (s.includes('pro') || s.includes('individual')) return 'Pro';
  if (s.includes('business')) return 'Business';
  if (s.includes('enterprise')) return 'Enterprise';
  return String(raw);
}

/** 新舊兩種回傳形狀都處理 */
export function parseCopilot(data) {
  if (!data || typeof data !== 'object') throw new ProviderError('parse', '回傳不是物件');

  // 新版：quota_snapshots
  if (data.quota_snapshots && typeof data.quota_snapshots === 'object') {
    const resetsAt = toIso(data.quota_reset_date_utc || data.quota_reset_date);
    const windows = [];
    for (const key of ORDER) {
      const q = data.quota_snapshots[key];
      if (!q || q.unlimited) continue;
      const limit = Number(q.entitlement);
      // 額度 0 代表這個方案沒有這項（例如 Free 的 premium），不顯示
      if (q.entitlement !== undefined && !(limit > 0)) continue;
      const remaining = Number(q.remaining);
      let usedPct = null;
      if (Number.isFinite(Number(q.percent_remaining))) usedPct = clampPct(100 - Number(q.percent_remaining));
      else if (limit > 0 && Number.isFinite(remaining)) usedPct = clampPct(((limit - remaining) / limit) * 100);
      if (usedPct === null) continue;
      const w = { id: key, label: LABELS[key] || key, usedPct, resetsAt };
      if (limit > 0 && Number.isFinite(remaining)) {
        w.used = Math.max(0, Math.round(limit - remaining));
        w.limit = Math.round(limit);
      }
      windows.push(w);
    }
    const allUnlimited = ORDER.every((k) => !data.quota_snapshots[k] || data.quota_snapshots[k].unlimited);
    // access_type_sku 比 copilot_plan（常是籠統的 individual）準
    const sku = String(data.access_type_sku || '');
    return {
      plan: planName(sku.includes('free') ? sku : (data.copilot_plan || sku)),
      windows,
      balance: null,
      note: windows.length === 0 && allUnlimited ? '無使用上限' : null,
    };
  }

  // 舊版 Free：monthly_quotas（總額）＋ limited_user_quotas（剩餘）
  if (data.monthly_quotas && data.limited_user_quotas) {
    const resetsAt = toIso(data.limited_user_reset_date);
    const windows = [];
    for (const key of ['chat', 'completions']) {
      const limit = Number(data.monthly_quotas[key]);
      const remaining = Number(data.limited_user_quotas[key]);
      if (!(limit > 0) || !Number.isFinite(remaining)) continue;
      const used = Math.max(0, limit - remaining);
      windows.push({
        id: key,
        label: LABELS[key],
        usedPct: clampPct((used / limit) * 100),
        used: Math.round(used),
        limit: Math.round(limit),
        resetsAt,
      });
    }
    if (!windows.length) throw new ProviderError('parse', '回傳缺少額度欄位');
    return { plan: planName(data.access_type_sku || data.copilot_plan), windows, balance: null };
  }

  throw new ProviderError('parse', '回傳缺少 quota_snapshots / monthly_quotas');
}

export default {
  id: 'copilot',
  name: 'GitHub Copilot',
  minIntervalSec: 60,
  isConfigured(creds) {
    return Boolean(creds.copilot?.token);
  },
  async fetch({ creds, signal }) {
    const base = {
      Authorization: `token ${creds.copilot.token}`,
      Accept: 'application/json',
      'User-Agent': 'ai-usageweb',
    };
    try {
      const { data } = await requestJson(URL_USER, { headers: base, signal, label: 'Copilot ' });
      return parseCopilot(data);
    } catch (err) {
      if (!(err instanceof ProviderError) || !['forbidden', 'upstream'].includes(err.kind) || err.httpStatus >= 500) throw err;
      // 被拒時帶上編輯器標頭再試一次
      const { data } = await requestJson(URL_USER, {
        headers: { ...base, 'Editor-Version': 'vscode/1.100.0', 'Editor-Plugin-Version': 'copilot-chat/0.30.0' },
        signal,
        label: 'Copilot ',
      });
      return parseCopilot(data);
    }
  },
};
