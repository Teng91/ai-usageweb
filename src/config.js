import path from 'node:path';

function int(name, def) {
  const v = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : def;
}

export const config = {
  port: int('PORT', 8080),
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  pollIntervalSec: int('POLL_INTERVAL_SEC', 120),
  idleGraceSec: int('IDLE_GRACE_SEC', 90),
  requestTimeoutMs: int('REQUEST_TIMEOUT_MS', 10_000),
  sseMaxAgeSec: int('SSE_MAX_AGE_SEC', 30 * 60),
  ssePingSec: int('SSE_PING_SEC', 25),
  adminToken: process.env.ADMIN_TOKEN || '',
  accessKey: process.env.ACCESS_KEY || '',
  credentialsKey: process.env.CREDENTIALS_KEY || '',
  credentialsReset: (process.env.CREDENTIALS_RESET || '')
    .split(',').map((s) => s.trim()).filter(Boolean),
  // Web Push（三個都設才會啟用）：VAPID 金鑰用 npm run gen-vapid 產生；PUSH_KEY 是訂閱時要輸入的密碼
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || '',
  vapidSubject: process.env.VAPID_SUBJECT || 'https://ai-usageweb.fly.dev',
  pushKey: process.env.PUSH_KEY || '',
  // 排程喚醒（GitHub Actions）用的 token
  pushTickToken: process.env.PUSH_TICK_TOKEN || '',
  pushTz: process.env.PUSH_TZ || 'Asia/Taipei',
  pushQuiet: process.env.PUSH_QUIET ?? '00-08',
  // 只開部分服務，例如 PROVIDERS=openrouter,copilot；空白代表全部
  enabledProviders: (process.env.PROVIDERS || '')
    .split(',').map((s) => s.trim()).filter(Boolean),
};
