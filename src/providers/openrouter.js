import { requestJson, requireField } from '../http.js';
import { ProviderError } from '../errors.js';
import { endpoints } from '../config.js';

const BASE = endpoints.openrouter.baseUrl;

const round2 = (n) => Math.round(Number(n) * 100) / 100;

export function parseCredits(data) {
  const d = requireField(data?.data, 'data');
  const total = Number(requireField(d.total_credits, 'data.total_credits'));
  const used = Number(requireField(d.total_usage, 'data.total_usage'));
  if (!Number.isFinite(total) || !Number.isFinite(used)) throw new ProviderError('parse', '金額不是數字');
  return { currency: 'USD', remaining: round2(total - used), total: round2(total), used: round2(used) };
}

export function parseKey(data) {
  const d = requireField(data?.data, 'data');
  const used = Number(requireField(d.usage, 'data.usage'));
  const limit = d.limit === null || d.limit === undefined ? null : Number(d.limit);
  const remaining = d.limit_remaining !== undefined && d.limit_remaining !== null
    ? Number(d.limit_remaining)
    : (limit !== null ? limit - used : null);
  return {
    currency: 'USD',
    remaining: remaining === null ? null : round2(remaining),
    total: limit === null ? null : round2(limit),
    used: round2(used),
  };
}

export default {
  id: 'openrouter',
  name: 'OpenRouter',
  minIntervalSec: 60,
  credentialFields: ['apiKey'],
  isConfigured(creds) {
    return Boolean(creds.openrouter?.apiKey);
  },
  async fetch({ creds }) {
    const headers = { Authorization: `Bearer ${creds.openrouter.apiKey}`, Accept: 'application/json' };
    try {
      const { data } = await requestJson(`${BASE}/credits`, { headers, label: 'OpenRouter ' });
      return { plan: '預付', windows: [], balance: parseCredits(data) };
    } catch (err) {
      // 一般 key 查 /credits 可能被拒（需要 provisioning key），改查 /key
      if (!(err instanceof ProviderError) || !['auth', 'forbidden'].includes(err.kind)) throw err;
      const { data } = await requestJson(`${BASE}/key`, { headers, label: 'OpenRouter ' });
      const plan = data?.data?.is_free_tier ? '免費' : '預付';
      return { plan, windows: [], balance: parseKey(data) };
    }
  },
};
