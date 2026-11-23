/**
 * kind:
 *  - auth        token 失效且續期失敗，需要重新登入
 *  - rate_limit  被限流（429）
 *  - forbidden   403／Cloudflare 擋下，這次觀看期間不再重試
 *  - network     網路錯誤、逾時
 *  - upstream    5xx 或其他非預期的 HTTP 狀態
 *  - parse       回傳格式變了
 */
export class ProviderError extends Error {
  constructor(kind, message, { retryAfterSec = null, httpStatus = null } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.retryAfterSec = retryAfterSec;
    this.httpStatus = httpStatus;
  }
}

export function parseRetryAfter(value) {
  if (!value) return null;
  const sec = Number(value);
  if (Number.isFinite(sec) && sec >= 0) return Math.ceil(sec);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return null;
}
