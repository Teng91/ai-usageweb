#!/usr/bin/env node
/**
 * 跑一次 Google OAuth（loopback + PKCE），取得伺服器專用的 Antigravity refresh token。
 *
 *   ANTIGRAVITY_CLIENT_ID=... ANTIGRAVITY_CLIENT_SECRET=... node scripts/antigravity-login.js
 *
 * client id／secret 需實測：從本機 Antigravity 的設定或社群資料找出它使用的 OAuth client。
 * 成功後寫入 ./server-antigravity.json（已在 .gitignore），再用 extract-credentials.js 產生 secrets。
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';

const CLIENT_ID = process.env.ANTIGRAVITY_CLIENT_ID;
const CLIENT_SECRET = process.env.ANTIGRAVITY_CLIENT_SECRET;
const SCOPES = (process.env.ANTIGRAVITY_SCOPES || [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'openid',
].join(' '));

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('請先設定 ANTIGRAVITY_CLIENT_ID 與 ANTIGRAVITY_CLIENT_SECRET');
  process.exit(1);
}

const verifier = crypto.randomBytes(32).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const stateParam = crypto.randomBytes(16).toString('hex');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname !== '/callback') {
    res.writeHead(404).end();
    return;
  }
  if (url.searchParams.get('state') !== stateParam) {
    res.writeHead(400).end('state 不符');
    return;
  }
  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400).end(`登入失敗：${url.searchParams.get('error') || '沒有 code'}`);
    return;
  }
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
    });
    const data = await tokenRes.json();
    if (!data.refresh_token) throw new Error(`沒有拿到 refresh_token（HTTP ${tokenRes.status}）`);
    fs.writeFileSync('./server-antigravity.json', JSON.stringify({
      refresh_token: data.refresh_token,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }, null, 2));
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('完成，可以關掉這個分頁。');
    console.log('已寫入 ./server-antigravity.json');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('交換 token 失敗，看終端機訊息');
    console.error(err.message);
  } finally {
    server.close();
  }
});

let redirectUri;
server.listen(0, '127.0.0.1', () => {
  redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.search = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: stateParam,
  }).toString();
  console.log('用瀏覽器打開以下網址登入 Google：\n');
  console.log(auth.toString());
});
