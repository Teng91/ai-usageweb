// Web Push：VAPID 簽名（RFC 8292）＋內容加密（RFC 8291，aes128gcm），只用 Node 內建 crypto
import crypto from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

/** 產生一組 VAPID 金鑰（base64url：公鑰 65 bytes 未壓縮、私鑰 32 bytes） */
export function generateVapidKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

function privateKeyObject(publicKey, privateKey) {
  const pub = fromB64u(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID 公鑰格式不對');
  return crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: b64u(fromB64u(privateKey)), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) },
    format: 'jwk',
  });
}

/** VAPID 的 Authorization 標頭值 */
export function vapidAuthorization(endpoint, { publicKey, privateKey, subject }, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const data = `${header}.${claims}`;
  const sig = crypto.sign('sha256', Buffer.from(data), { key: privateKeyObject(publicKey, privateKey), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${data}.${b64u(sig)}, k=${publicKey}`;
}

const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));

/**
 * 依 RFC 8291 加密內容。senderPrivateKey／salt 只給測試用（固定值才能比對 RFC 的範例）。
 * 回傳整個 request body（標頭＋單一 record）。
 */
export function encryptPayload(plaintext, { p256dh, auth }, { senderPrivateKey, salt } = {}) {
  const uaPublic = fromB64u(p256dh);
  const authSecret = fromB64u(auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('訂閱金鑰格式不對');
  const ecdh = crypto.createECDH('prime256v1');
  if (senderPrivateKey) ecdh.setPrivateKey(fromB64u(senderPrivateKey));
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const s = salt ? fromB64u(salt) : crypto.randomBytes(16);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hkdf(authSecret, shared, keyInfo, 32);
  const cek = hkdf(s, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(s, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([s, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/**
 * 送一則推播。回傳 { ok, gone, status }；gone=true 代表訂閱已失效（404／410），呼叫端該刪掉它。
 * 錯誤不帶回應內容，只回狀態碼。
 */
export async function sendPush(sub, payload, vapid, { ttlSec = 6 * 3600, urgency = 'normal', timeoutMs = 10_000 } = {}) {
  const body = encryptPayload(JSON.stringify(payload), sub.keys);
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuthorization(sub.endpoint, vapid),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttlSec),
        Urgency: urgency,
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.arrayBuffer().catch(() => {});
    return { ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410, status: res.status };
  } catch {
    return { ok: false, gone: false, status: null };
  }
}
