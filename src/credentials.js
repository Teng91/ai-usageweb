import crypto from 'node:crypto';
import path from 'node:path';
import { writeFileAtomic, readFileOrNull } from './fsutil.js';
import { logWarn, logInfo } from './log.js';

/** 每家從環境變數（fly secrets）讀出的初始憑證 */
export function credsFromEnv(env = process.env) {
  const pick = (obj) => {
    const out = {};
    for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== '') out[k] = v;
    return Object.keys(out).length ? out : null;
  };
  const num = (v) => (v === undefined || v === '' ? undefined : Number(v));
  return {
    openrouter: pick({ apiKey: env.OPENROUTER_API_KEY }),
    copilot: pick({ token: env.GITHUB_COPILOT_TOKEN }),
    claude: pick({
      accessToken: env.CLAUDE_ACCESS_TOKEN || env.CLAUDE_OAUTH_TOKEN,
      refreshToken: env.CLAUDE_REFRESH_TOKEN,
      expiresAt: num(env.CLAUDE_EXPIRES_AT),
    }),
    codex: pick({
      accessToken: env.CODEX_ACCESS_TOKEN,
      refreshToken: env.CODEX_REFRESH_TOKEN,
      accountId: env.CODEX_ACCOUNT_ID,
    }),
    antigravity: pick({
      refreshToken: env.ANTIGRAVITY_REFRESH_TOKEN,
      clientId: env.ANTIGRAVITY_CLIENT_ID,
      clientSecret: env.ANTIGRAVITY_CLIENT_SECRET,
      projectId: env.ANTIGRAVITY_PROJECT_ID,
    }),
  };
}

function encrypt(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: tag.toString('base64'), data: enc.toString('base64') });
}

function decrypt(key, text) {
  const box = JSON.parse(text);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8');
}

export function parseKey(b64) {
  if (!b64) return null;
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('CREDENTIALS_KEY 必須是 32 bytes 的 base64');
  return key;
}

/**
 * 憑證儲存：
 *  - 讀取優先順序：volume（加密）> 環境變數；CREDENTIALS_RESET 指定的服務以環境變數為準
 *  - 續期後的新值先原子寫入 volume，成功才更新記憶體（寫入失敗就不使用新 token）
 *  - 每家一個 in-flight 鎖，避免同時用舊 refresh token 續期兩次
 */
export class CredentialStore {
  constructor({ dataDir, keyB64, env = process.env, reset = [] }) {
    this.file = path.join(dataDir, 'credentials.enc');
    this.key = parseKey(keyB64);
    this.env = credsFromEnv(env);
    this.reset = new Set(reset);
    this.creds = {};
    this.versions = {};
    this.locks = new Map();
    this.writeChain = Promise.resolve();
  }

  async load() {
    let stored = {};
    if (this.key) {
      const raw = await readFileOrNull(this.file);
      if (raw) {
        try {
          stored = JSON.parse(decrypt(this.key, raw.toString('utf8')));
        } catch {
          logWarn('credentials.enc 無法解密，改用環境變數（金鑰換過了？）');
          stored = {};
        }
      }
    } else {
      logWarn('未設定 CREDENTIALS_KEY：續期後的 token 只存在記憶體，重開機會遺失');
    }

    const ids = new Set([...Object.keys(this.env), ...Object.keys(stored)]);
    let needWrite = false;
    for (const id of ids) {
      const fromEnv = this.env[id];
      const fromVol = stored[id];
      if (this.reset.has(id) && fromEnv) {
        this.creds[id] = { ...fromEnv };
        needWrite = true;
        logInfo('憑證以環境變數重設', { provider: id });
      } else if (fromVol) {
        this.creds[id] = { ...fromVol };
      } else if (fromEnv) {
        this.creds[id] = { ...fromEnv };
      }
      this.versions[id] = 1;
    }
    if (needWrite) await this.persist();
    return this;
  }

  /** 傳給 adapter 的唯讀快照（整份），isConfigured(creds) 用 */
  all() {
    return structuredClone(this.creds);
  }

  get(id) {
    return this.creds[id] ? structuredClone(this.creds[id]) : null;
  }

  version(id) {
    return this.versions[id] || 0;
  }

  async persist() {
    if (!this.key) return;
    const text = encrypt(this.key, JSON.stringify(this.creds));
    const job = this.writeChain.then(() => writeFileAtomic(this.file, text));
    this.writeChain = job.catch(() => {});
    await job;
  }

  /** 合併新值，先寫 volume 成功才生效 */
  async save(id, patch) {
    const next = { ...(this.creds[id] || {}), ...patch };
    const prev = this.creds[id];
    this.creds[id] = next;
    try {
      await this.persist();
    } catch (err) {
      this.creds[id] = prev;
      throw err;
    }
    // 只記服務名稱，方便從 log 確認伺服器有自己續期（不記 token）
    if (this.key) logInfo('憑證已續期並寫入', { provider: id });
    else logWarn('憑證已續期，但沒設 CREDENTIALS_KEY，只存在記憶體（重開機會遺失）', { provider: id });
  }

  /** 管理 API：整份替換某一家的憑證（視為新登入）；正在續期就等它結束，免得續期結果蓋掉新憑證 */
  async replace(id, value) {
    await this.locks.get(id)?.catch(() => {});
    const prev = this.creds[id];
    this.creds[id] = { ...value };
    try {
      await this.persist();
    } catch (err) {
      this.creds[id] = prev;
      throw err;
    }
    this.versions[id] = (this.versions[id] || 0) + 1;
  }

  /** 同一家同時只會有一個續期在跑；其他呼叫者共用同一個 Promise */
  withLock(id, fn) {
    const existing = this.locks.get(id);
    if (existing) return existing;
    const p = Promise.resolve().then(fn).finally(() => this.locks.delete(id));
    this.locks.set(id, p);
    return p;
  }
}
