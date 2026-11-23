import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

export function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));
}

export function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-usageweb-'));
}

/**
 * 假的 fetch：routes 是 [matcher, handler] 陣列。
 * handler(req) 回傳 { status, json, text, headers }。
 * 回傳的物件記錄所有呼叫。
 */
export function mockFetch(routes) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const req = {
      url: String(url),
      method: init.method || 'GET',
      headers: Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v])),
      body: init.body,
    };
    calls.push(req);
    for (const [match, handler] of routes) {
      const ok = typeof match === 'function' ? match(req) : req.url.includes(match);
      if (!ok) continue;
      const r = await handler(req, calls);
      if (r instanceof Error) throw r;
      const body = r.text !== undefined ? r.text : JSON.stringify(r.json ?? {});
      const headers = { 'content-type': r.text !== undefined ? 'text/html' : 'application/json', ...(r.headers || {}) };
      return new Response(body, { status: r.status || 200, headers });
    }
    // 打本機測試伺服器的請求照常送出
    if (/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(req.url)) return original(url, init);
    throw new Error(`unmocked ${req.method} ${req.url}`);
  };
  return {
    calls,
    restore() { globalThis.fetch = original; },
  };
}

export function ctxFor(creds, { onSave } = {}) {
  const saved = [];
  return {
    creds,
    saved,
    withLock: (fn) => fn(),
    saveCreds: async (patch) => {
      if (onSave) await onSave(patch);
      saved.push(patch);
    },
  };
}
