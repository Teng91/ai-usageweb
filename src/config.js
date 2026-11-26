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
  // 同時最多幾條 SSE 連線；滿了回 503，前端會改用輪詢（避免有人開一堆連線讓機器一直不停機）
  sseMaxClients: int('SSE_MAX_CLIENTS', 20),
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

// 各家端點與 client id：內部端點常變，可用環境變數覆寫；啟動時讀一次
const env = (name, def) => process.env[name] || def;
export const endpoints = {
  claude: {
    usageUrl: env('CLAUDE_USAGE_URL', 'https://api.anthropic.com/api/oauth/usage'),
    tokenUrl: env('CLAUDE_TOKEN_URL', 'https://console.anthropic.com/v1/oauth/token'),
    clientId: env('CLAUDE_CLIENT_ID', '9d1c250a-e61b-44d9-88ed-5944d1962f5e'),
  },
  codex: {
    usageUrl: env('CODEX_USAGE_URL', 'https://chatgpt.com/backend-api/wham/usage'),
    tokenUrl: env('CODEX_TOKEN_URL', 'https://auth.openai.com/oauth/token'),
    clientId: env('CODEX_CLIENT_ID', 'app_EMoamEEZ73f0CkXaXp7hrann'),
  },
  // 跟 agy CLI 一樣用 daily-cloudcode-pa：cloudcode-pa 回的 Gemini 組額度永遠是 100%（重置時間也一直往後推），daily 的才是實際用量（2026-11 實測）
  // User-Agent 要用 agy CLI 的格式：retrieveUserQuotaSummary 看到 CLI 才會連 Gemini 組的額度一起回（只寫 antigravity 只有 Claude/GPT 組）
  antigravity: {
    baseUrl: env('ANTIGRAVITY_BASE_URL', 'https://daily-cloudcode-pa.googleapis.com/v1internal'),
    tokenUrl: env('ANTIGRAVITY_TOKEN_URL', 'https://oauth2.googleapis.com/token'),
    userAgent: env('ANTIGRAVITY_USER_AGENT', 'antigravity/cli/1.5.15'),
  },
  // grok.com 網頁用的內部端點；Cloudflare 會看 User-Agent，用一般瀏覽器的
  grok: {
    rateLimitsUrl: env('GROK_RATE_LIMITS_URL', 'https://grok.com/rest/rate-limits'),
    userAgent: env('GROK_USER_AGENT', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'),
  },
  copilot: {
    userUrl: env('COPILOT_USER_URL', 'https://api.github.com/copilot_internal/user'),
  },
  openrouter: {
    baseUrl: env('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
    // 排行榜頁面用的非官方端點；模型名稱與價格來自公開的模型列表
    rankingsUrl: env('OPENROUTER_RANKINGS_URL', 'https://openrouter.ai/api/frontend/v1/rankings/models'),
    modelsUrl: env('OPENROUTER_MODELS_URL', 'https://openrouter.ai/api/v1/models'),
  },
};

/**
 * 手動設定的值：每次用到才讀環境變數，不放進憑證（volume 裡的憑證會蓋過環境變數，改 fly secrets 就不會生效）
 */
export const manual = {
  get claudePlan() { return process.env.CLAUDE_PLAN || 'Pro'; },
  get claudePlanExpiresAt() { return process.env.CLAUDE_PLAN_EXPIRES_AT || ''; },
};
