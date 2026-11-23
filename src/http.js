import { ProviderError, parseRetryAfter } from './errors.js';
import { config } from './config.js';

/**
 * 對外部服務發一個請求並解析 JSON。所有錯誤都轉成 ProviderError，
 * 錯誤訊息只含狀態碼與簡短說明，不含 token 或原始回應。
 */
export async function requestJson(url, { method = 'GET', headers = {}, body, signal, label = '' } = {}) {
  const timeout = AbortSignal.timeout(config.requestTimeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
      signal: combined,
      redirect: 'follow',
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || timeout.aborted;
    throw new ProviderError('network', timedOut ? `${label}逾時`.trim() : `${label}連線失敗`.trim());
  }

  const text = await res.text().catch(() => '');
  const contentType = res.headers.get('content-type') || '';
  const looksHtml = contentType.includes('text/html') || /^\s*</.test(text);
  const cloudflare = looksHtml && /cloudflare|cf-chl|cf-ray|challenge-platform/i.test(text)
    || (res.status === 403 && /cf-/i.test(text))
    || res.headers.get('cf-mitigated') === 'challenge';

  if (cloudflare) {
    throw new ProviderError('forbidden', '被 Cloudflare 擋下', { httpStatus: res.status });
  }

  if (!res.ok) {
    const status = res.status;
    if (status === 429) {
      const retryAfterSec = parseRetryAfter(res.headers.get('retry-after'));
      throw new ProviderError('rate_limit', '429 請求太頻繁', { retryAfterSec, httpStatus: status });
    }
    if (status === 401) throw new ProviderError('auth', '401 token 失效', { httpStatus: status });
    if (status === 403) throw new ProviderError('forbidden', '403 沒有權限', { httpStatus: status });
    if (status >= 500) throw new ProviderError('upstream', `${status} 服務暫時有問題`, { httpStatus: status });
    const err = new ProviderError('upstream', `HTTP ${status}`, { httpStatus: status });
    err.oauthError = safeOauthError(text);
    throw err;
  }

  if (looksHtml) throw new ProviderError('parse', '回傳不是 JSON', { httpStatus: res.status });
  try {
    return { data: JSON.parse(text), status: res.status, headers: res.headers };
  } catch {
    throw new ProviderError('parse', '回傳不是 JSON', { httpStatus: res.status });
  }
}

// 只取出 OAuth 標準的 error 代碼（例如 invalid_grant），不保留其他內容
function safeOauthError(text) {
  try {
    const j = JSON.parse(text);
    const code = typeof j?.error === 'string' ? j.error : j?.error?.type;
    return typeof code === 'string' && /^[a-z_]{3,40}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

export function requireField(value, name) {
  if (value === undefined || value === null) {
    throw new ProviderError('parse', `回傳缺少欄位 ${name}`);
  }
  return value;
}

export function clampPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;
}

export function toIso(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') {
    // 秒或毫秒
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
