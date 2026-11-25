import { requestJson } from './http.js';
import { ProviderError } from './errors.js';

/**
 * 通用的 refresh_token 續期。refresh 端點回 400/401（invalid_grant 等）一律視為 auth：
 * 停止輪詢這一家，直到換新憑證。
 */
export async function refreshToken({ url, body, form = false, signal, label }) {
  const headers = { Accept: 'application/json' };
  let payload;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(body).toString();
  } else {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  try {
    const { data } = await requestJson(url, { method: 'POST', headers, body: payload, signal, label });
    if (!data?.access_token) throw new ProviderError('parse', '續期回傳缺少 access_token');
    return data;
  } catch (err) {
    if (err instanceof ProviderError && (err.httpStatus === 400 || err.httpStatus === 401 || err.kind === 'auth')) {
      throw new ProviderError('auth', '續期失敗，需要重新登入', { httpStatus: err.httpStatus });
    }
    throw err;
  }
}

/** 讀 JWT 的 exp（毫秒）；不驗證簽章，只用來判斷何時該續期 */
export function jwtExpiryMs(token) {
  try {
    const part = String(token).split('.')[1];
    const json = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

export const REFRESH_SKEW_MS = 5 * 60 * 1000;

/**
 * 續期並寫回：在 withLock 裡呼叫 refresh 端點，先 await saveCreds 成功才回傳新憑證；
 * 寫入失敗就丟 upstream，不使用新 token。expiresAt(data) 算出新的到期時間（毫秒）。
 */
export function refreshAndSave(ctx, current, { url, body, label, expiresAt }) {
  return ctx.withLock(async () => {
    const data = await refreshToken({ url, body, signal: ctx.signal, label });
    const patch = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || current.refreshToken,
      expiresAt: expiresAt(data),
    };
    try {
      await ctx.saveCreds(patch);
    } catch {
      throw new ProviderError('upstream', '無法保存續期後的憑證');
    }
    return { ...current, ...patch };
  });
}

/**
 * 帶續期的呼叫：有 refresh token 且 access token 沒有或快到期就先續期；
 * call 回 401（auth）時續期一次再重試一次。沒有 refresh token（長效 token）就不續期。
 */
export async function callWithRefresh(c, { expiresAt, refresh, call }) {
  const canRefresh = Boolean(c.refreshToken);
  if (canRefresh && (!c.accessToken || (expiresAt && expiresAt - Date.now() < REFRESH_SKEW_MS))) {
    c = await refresh(c);
  }
  try {
    return await call(c);
  } catch (err) {
    if (!(err instanceof ProviderError) || err.kind !== 'auth' || !canRefresh) throw err;
    return call(await refresh(c));
  }
}
