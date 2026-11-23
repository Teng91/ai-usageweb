import path from 'node:path';

function int(name, def) {
  const v = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : def;
}

export const config = {
  port: int('PORT', 8080),
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  pollIntervalSec: int('POLL_INTERVAL_SEC', 60),
  idleGraceSec: int('IDLE_GRACE_SEC', 90),
  requestTimeoutMs: int('REQUEST_TIMEOUT_MS', 10_000),
  sseMaxAgeSec: int('SSE_MAX_AGE_SEC', 30 * 60),
  ssePingSec: int('SSE_PING_SEC', 25),
  adminToken: process.env.ADMIN_TOKEN || '',
  accessKey: process.env.ACCESS_KEY || '',
  credentialsKey: process.env.CREDENTIALS_KEY || '',
  credentialsReset: (process.env.CREDENTIALS_RESET || '')
    .split(',').map((s) => s.trim()).filter(Boolean),
  // 只開部分服務，例如 PROVIDERS=openrouter,copilot；空白代表全部
  enabledProviders: (process.env.PROVIDERS || '')
    .split(',').map((s) => s.trim()).filter(Boolean),
};
