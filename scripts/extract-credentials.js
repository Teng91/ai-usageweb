#!/usr/bin/env node
/**
 * 從「獨立登入」的設定目錄讀出各家憑證，印出 fly secrets set 指令或 .env.local 內容。
 *
 *   node scripts/extract-credentials.js            # 印 fly secrets set ...
 *   node scripts/extract-credentials.js --env      # 印 .env.local 格式
 *   node scripts/extract-credentials.js --gen-keys # 同時產生 CREDENTIALS_KEY 與 ADMIN_TOKEN
 *   node scripts/extract-credentials.js --gh       # 用 gh auth token 當 Copilot token
 *
 * 讀取來源（都可以不存在）：
 *   ./server-claude/.credentials.json   CLAUDE_CONFIG_DIR=./server-claude claude 之後 /login 產生
 *   ./server-codex/auth.json            CODEX_HOME=./server-codex codex login 產生
 *   ./server-antigravity.json           scripts/antigravity-login.js 產生
 *   環境變數 OPENROUTER_API_KEY、GITHUB_COPILOT_TOKEN、CLAUDE_OAUTH_TOKEN（setup-token）
 *
 * ⚠ 輸出含有 token：只在自己的終端機執行，不要貼到任何地方或存進 repo。
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const out = {};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function set(k, v) {
  if (v !== undefined && v !== null && v !== '') out[k] = String(v);
}

// OpenRouter / Copilot：從環境變數
set('OPENROUTER_API_KEY', process.env.OPENROUTER_API_KEY);
set('GITHUB_COPILOT_TOKEN', process.env.GITHUB_COPILOT_TOKEN);
if (args.has('--gh') && !out.GITHUB_COPILOT_TOKEN) {
  try {
    set('GITHUB_COPILOT_TOKEN', execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim());
  } catch {
    console.error('# gh auth token 失敗；先執行 gh auth login');
  }
}

// Claude
const claude = readJson('./server-claude/.credentials.json');
const co = claude?.claudeAiOauth || claude;
if (co?.refreshToken) {
  set('CLAUDE_ACCESS_TOKEN', co.accessToken);
  set('CLAUDE_REFRESH_TOKEN', co.refreshToken);
  set('CLAUDE_EXPIRES_AT', co.expiresAt);
  if (co.subscriptionType) set('CLAUDE_PLAN', co.subscriptionType.charAt(0).toUpperCase() + co.subscriptionType.slice(1));
} else if (process.env.CLAUDE_OAUTH_TOKEN) {
  set('CLAUDE_OAUTH_TOKEN', process.env.CLAUDE_OAUTH_TOKEN);
}

// Codex
const codex = readJson('./server-codex/auth.json');
if (codex?.tokens?.refresh_token) {
  set('CODEX_ACCESS_TOKEN', codex.tokens.access_token);
  set('CODEX_REFRESH_TOKEN', codex.tokens.refresh_token);
  set('CODEX_ACCOUNT_ID', codex.tokens.account_id);
}

// Antigravity
const ag = readJson('./server-antigravity.json');
set('ANTIGRAVITY_REFRESH_TOKEN', ag?.refresh_token || process.env.ANTIGRAVITY_REFRESH_TOKEN);
set('ANTIGRAVITY_CLIENT_ID', ag?.client_id || process.env.ANTIGRAVITY_CLIENT_ID);
set('ANTIGRAVITY_CLIENT_SECRET', ag?.client_secret || process.env.ANTIGRAVITY_CLIENT_SECRET);
set('ANTIGRAVITY_PROJECT_ID', ag?.project_id || process.env.ANTIGRAVITY_PROJECT_ID);

if (args.has('--gen-keys')) {
  set('CREDENTIALS_KEY', crypto.randomBytes(32).toString('base64'));
  set('ADMIN_TOKEN', crypto.randomBytes(32).toString('base64url'));
}

const keys = Object.keys(out);
if (!keys.length) {
  console.error('沒有找到任何憑證。請看 README「各家憑證怎麼拿」。');
  process.exit(1);
}

console.error(`# 找到：${keys.join(', ')}`);
console.error('# ⚠ 下面含有 token，不要貼到別處或存進 repo');

if (args.has('--env')) {
  for (const k of keys) console.log(`${k}=${out[k]}`);
} else {
  const q = (v) => `'${v.replace(/'/g, `'\\''`)}'`;
  console.log(`fly secrets set ${keys.map((k) => `${k}=${q(out[k])}`).join(' ')}`);
}
