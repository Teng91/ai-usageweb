// HTTP 回應與驗證的共用小工具（不含任何路由邏輯）
import crypto from 'node:crypto';

export function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(body);
}

/** 每個回應都帶的安全標頭；CSP 不允許內嵌 script 與 HTML 裡的 style="" */
export function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  // 之後一律用 https 連（fly.io 已經強制 https；本機 http 開發時瀏覽器會忽略這個標頭）
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; manifest-src 'self'",
  );
}

/** 讀 request body，超過 limit bytes 就中斷 */
export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** 固定時間比較，避免從回應時間猜出 token */
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function checkBearer(header, token) {
  if (!header || !token) return false;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return Boolean(m) && safeEqual(m[1].trim(), token);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const raw = part.slice(i + 1).trim();
    // 同網域其他程式留下的壞 cookie 不能讓整個請求變成 500
    try { out[part.slice(0, i).trim()] = decodeURIComponent(raw); } catch { out[part.slice(0, i).trim()] = raw; }
  }
  return out;
}

/** log 用：只留路徑，不留 query（query 裡可能有 ACCESS_KEY） */
export function safePath(u = '') {
  return String(u).split('?')[0];
}
