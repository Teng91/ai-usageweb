import crypto from 'node:crypto';
import path from 'node:path';
import { SerialWriter, readFileOrNull } from './fsutil.js';
import { credsFromEnv } from './config.js';
import { logWarn, logInfo } from './log.js';

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
 *  - 環境變數由 config.js 讀好傳進來（initial）；測試可以改傳原始的 env 物件
 *  - 續期後的新值先原子寫入 volume，成功才更新記憶體（寫入失敗就不使用新 token）
 *  - 每家一個 in-flight 鎖，避免同時用舊 refresh token 續期兩次
 */
export class CredentialStore {
  constructor({ dataDir, keyB64, initial = null, env = {}, reset = [], knownIds = null }) {
    this.file = path.join(dataDir, 'credentials.enc');
    this.key = parseKey(keyB64);
    this.env = initial || credsFromEnv(env);
    this.reset = new Set(reset);
    // 有程式的服務；volume 裡其他服務（例如已刪掉的 Grok、Copilot）的憑證在載入時清掉，不再留著
    this.knownIds = knownIds ? new Set(knownIds) : null;
    this.creds = {};
    this.versions = {};
    this.locks = new Map();
    this.writer = new SerialWriter(this.file);
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

    let needWrite = false;
    const dropped = this.knownIds ? Object.keys(stored).filter((id) => !this.knownIds.has(id)) : [];
    for (const id of dropped) delete stored[id];
    if (dropped.length) {
      needWrite = true;
      logInfo('清掉已不存在服務的憑證', { providers: dropped });
    }
    const ids = new Set([...Object.keys(this.env), ...Object.keys(stored)]);
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
    await this.writer.write(encrypt(this.key, JSON.stringify(this.creds)));
  }

  /** 合併新值，先寫 volume 成功才生效；給了 expectVersion 而憑證已被換掉就不存（丟錯） */
  async save(id, patch, expectVersion) {
    if (expectVersion !== undefined && this.version(id) !== expectVersion) {
      throw new Error('憑證已被換掉，不存舊流程的續期結果');
    }
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
    const prevVersion = this.version(id);
    // 版本號先換：寫檔途中舊流程的續期結果（帶著舊版本號）就存不進來，不會蓋掉新憑證
    this.versions[id] = prevVersion + 1;
    this.creds[id] = { ...value };
    try {
      await this.persist();
    } catch (err) {
      this.creds[id] = prev;
      this.versions[id] = prevVersion;
      throw err;
    }
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
