import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, mockFetch, ctxFor } from './helpers.js';
import openrouter from '../src/providers/openrouter.js';
import copilot, { parseCopilot } from '../src/providers/copilot.js';
import claude, { parseClaude, parsePlanExpiry } from '../src/providers/claude.js';
import codex, { parseCodex } from '../src/providers/codex.js';
import antigravity, { parseModels, tierName, _resetCache } from '../src/providers/antigravity.js';
import { ProviderError } from '../src/errors.js';

let mock;
afterEach(() => {
  mock?.restore();
  mock = null;
  _resetCache();
});

const jwt = (exp) => `x.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.y`;

// ---------- OpenRouter ----------
test('openrouter: /credits → 餘額', async () => {
  mock = mockFetch([['/credits', () => ({ json: fixture('openrouter-credits.json') })]]);
  const r = await openrouter.fetch(ctxFor({ openrouter: { apiKey: 'k' } }));
  assert.deepEqual(r.balance, { currency: 'USD', remaining: 7.42, total: 10, used: 2.58 });
  assert.equal(mock.calls[0].headers.authorization, 'Bearer k');
});

test('openrouter: /credits 被拒就改用 /key', async () => {
  mock = mockFetch([
    ['/credits', () => ({ status: 403, json: { error: { message: 'no' } } })],
    ['/key', () => ({ json: fixture('openrouter-key.json') })],
  ]);
  const r = await openrouter.fetch(ctxFor({ openrouter: { apiKey: 'k' } }));
  assert.deepEqual(r.balance, { currency: 'USD', remaining: 3.75, total: 5, used: 1.25 });
});

test('openrouter: 缺欄位 → parse 錯誤', async () => {
  mock = mockFetch([['/credits', () => ({ json: { data: {} } })]]);
  await assert.rejects(openrouter.fetch(ctxFor({ openrouter: { apiKey: 'k' } })), (e) => e.kind === 'parse');
});

// ---------- Copilot ----------
test('copilot: 新版回傳', () => {
  const r = parseCopilot(fixture('copilot-new.json'));
  assert.equal(r.plan, 'Free');
  assert.equal(r.windows.length, 2); // premium unlimited 不顯示
  assert.deepEqual(r.windows[0], { id: 'chat', label: 'Chat', usedPct: 24, resetsAt: '2026-12-01T00:00:00.000Z', used: 12, limit: 50 });
  assert.equal(r.windows[1].used, 500);
  assert.equal(r.windows[1].limit, 2000);
});

test('copilot: individual + free sku 算 Free；額度 0 的項目不顯示', () => {
  const r = parseCopilot({
    copilot_plan: 'individual',
    access_type_sku: 'free_limited_copilot',
    quota_reset_date: '2026-12-01',
    quota_snapshots: {
      chat: { entitlement: 200, remaining: 198, percent_remaining: 99, unlimited: false },
      premium_interactions: { entitlement: 0, remaining: 0, percent_remaining: 0, unlimited: false },
    },
  });
  assert.equal(r.plan, 'Free');
  assert.deepEqual(r.windows.map((w) => w.id), ['chat']);
});

test('copilot: 舊版 Free 回傳', () => {
  const r = parseCopilot(fixture('copilot-old.json'));
  assert.equal(r.plan, 'Free');
  assert.deepEqual(r.windows.map((w) => [w.id, w.used, w.limit, w.usedPct]), [['chat', 12, 50, 24], ['completions', 100, 2000, 5]]);
});

test('copilot: 形狀不明 → parse', () => {
  assert.throws(() => parseCopilot({ foo: 1 }), (e) => e.kind === 'parse');
});

test('copilot: 被拒時帶編輯器標頭重試', async () => {
  mock = mockFetch([
    [(r) => r.url.includes('copilot_internal') && !r.headers['editor-version'], () => ({ status: 404, json: {} })],
    ['copilot_internal', () => ({ json: fixture('copilot-new.json') })],
  ]);
  const r = await copilot.fetch(ctxFor({ copilot: { token: 'gho_x' } }));
  assert.equal(r.windows.length, 2);
  assert.equal(mock.calls[0].headers.authorization, 'token gho_x');
  assert.equal(mock.calls[1].headers['editor-version'], 'vscode/1.100.0');
});

// ---------- Claude ----------
test('claude: 解析時間窗', () => {
  const w = parseClaude(fixture('claude-usage.json'));
  assert.deepEqual(w.map((x) => [x.id, x.usedPct]), [['5h', 3], ['7d', 93], ['7d_sonnet', 40]]);
  assert.equal(w[0].resetsAt, '2026-11-23T12:19:00.000Z');
});

test('claude: 缺欄位 → parse', () => {
  assert.throws(() => parseClaude({}), (e) => e.kind === 'parse');
});

test('claude: token 快過期先續期，先存再用', async () => {
  const order = [];
  mock = mockFetch([
    ['/oauth/token', (req) => {
      const b = JSON.parse(req.body);
      assert.equal(b.grant_type, 'refresh_token');
      assert.equal(b.refresh_token, 'r1');
      return { json: { access_token: 'a2', refresh_token: 'r2', expires_in: 28800 } };
    }],
    ['/oauth/usage', (req) => {
      order.push('usage');
      assert.equal(req.headers.authorization, 'Bearer a2');
      assert.equal(req.headers['anthropic-beta'], 'oauth-2025-04-20');
      return { json: fixture('claude-usage.json') };
    }],
  ]);
  const ctx = ctxFor({ claude: { accessToken: 'a1', refreshToken: 'r1', expiresAt: Date.now() + 60_000 } }, {
    onSave: () => order.push('save'),
  });
  const r = await claude.fetch(ctx);
  assert.equal(r.plan, 'Pro');
  assert.deepEqual(order, ['save', 'usage']);
  assert.equal(ctx.saved[0].refreshToken, 'r2');
});

test('claude: 訂閱到期日只接受合法日期，統一成 YYYY-MM-DD', () => {
  assert.equal(parsePlanExpiry('2027-11-04'), '2027-11-04');
  assert.equal(parsePlanExpiry('2027/11/4'), '2027-11-04');
  assert.equal(parsePlanExpiry(' 2027-1-9 '), '2027-01-09');
  assert.equal(parsePlanExpiry('2027-02-30'), null);
  assert.equal(parsePlanExpiry('明年'), null);
  assert.equal(parsePlanExpiry(''), null);
  assert.equal(parsePlanExpiry(undefined), null);
});

test('claude: 設了 CLAUDE_PLAN_EXPIRES_AT 會帶出 planExpiresAt', async () => {
  mock = mockFetch([['/oauth/usage', () => ({ json: fixture('claude-usage.json') })]]);
  const old = process.env.CLAUDE_PLAN_EXPIRES_AT;
  process.env.CLAUDE_PLAN_EXPIRES_AT = '2027/11/4';
  try {
    const r = await claude.fetch(ctxFor({ claude: { accessToken: 'a1' } }));
    assert.equal(r.planExpiresAt, '2027-11-04');
  } finally {
    if (old === undefined) delete process.env.CLAUDE_PLAN_EXPIRES_AT;
    else process.env.CLAUDE_PLAN_EXPIRES_AT = old;
  }
});

test('claude: 401 → 續期一次再重試', async () => {
  let n = 0;
  mock = mockFetch([
    ['/oauth/token', () => ({ json: { access_token: 'a2', refresh_token: 'r2', expires_in: 28800 } })],
    ['/oauth/usage', (req) => {
      n += 1;
      return req.headers.authorization === 'Bearer a1' ? { status: 401, json: {} } : { json: fixture('claude-usage.json') };
    }],
  ]);
  const ctx = ctxFor({ claude: { accessToken: 'a1', refreshToken: 'r1', expiresAt: Date.now() + 3_600_000 } });
  await claude.fetch(ctx);
  assert.equal(n, 2);
  assert.equal(ctx.saved.length, 1);
});

test('claude: 續期 invalid_grant → auth', async () => {
  mock = mockFetch([['/oauth/token', () => ({ status: 400, json: { error: 'invalid_grant' } })]]);
  const ctx = ctxFor({ claude: { refreshToken: 'r1' } });
  await assert.rejects(claude.fetch(ctx), (e) => e instanceof ProviderError && e.kind === 'auth');
});

test('claude: 寫回失敗就不用新 token', async () => {
  mock = mockFetch([
    ['/oauth/token', () => ({ json: { access_token: 'a2', refresh_token: 'r2', expires_in: 28800 } })],
    ['/oauth/usage', () => assert.fail('不應該打 usage')],
  ]);
  const ctx = ctxFor({ claude: { refreshToken: 'r1' } }, { onSave: () => { throw new Error('disk'); } });
  await assert.rejects(claude.fetch(ctx), (e) => e.kind === 'upstream');
});

test('claude: 只有長效 token（setup-token）時 401 直接 auth', async () => {
  mock = mockFetch([['/oauth/usage', () => ({ status: 401, json: {} })]]);
  await assert.rejects(claude.fetch(ctxFor({ claude: { accessToken: 'long' } })), (e) => e.kind === 'auth');
});

test('claude: 429 帶 Retry-After', async () => {
  mock = mockFetch([['/oauth/usage', () => ({ status: 429, json: {}, headers: { 'retry-after': '120' } })]]);
  await assert.rejects(claude.fetch(ctxFor({ claude: { accessToken: 'long' } })), (e) => e.kind === 'rate_limit' && e.retryAfterSec === 120);
});

// ---------- Codex ----------
test('codex: 解析 primary / secondary', () => {
  const now = Date.parse('2026-11-23T08:00:00Z');
  const r = parseCodex(fixture('codex-usage.json'), now);
  assert.equal(r.plan, 'Free');
  assert.deepEqual(r.windows.map((w) => [w.id, w.label, w.usedPct]), [['primary', '5 小時', 12.5], ['secondary', '每週', 61]]);
  assert.equal(r.windows[0].resetsAt, '2026-11-23T09:00:00.000Z');
  assert.equal(r.windows[1].resetsAt, new Date(1795500000 * 1000).toISOString());
});

test('codex: Free 沒有額度資料 → note', () => {
  const r = parseCodex(fixture('codex-usage-empty.json'));
  assert.equal(r.windows.length, 0);
  assert.equal(r.note, '此方案未提供額度資訊');
});

test('codex: 帶 account id 與 UA；JWT 快過期先續期', async () => {
  mock = mockFetch([
    ['auth.openai.com', () => ({ json: { access_token: jwt(Math.floor(Date.now() / 1000) + 3600), refresh_token: 'r2' } })],
    ['wham/usage', (req) => {
      assert.equal(req.headers['chatgpt-account-id'], 'acc');
      assert.equal(req.headers['user-agent'], 'codex_cli_rs');
      return { json: fixture('codex-usage.json') };
    }],
  ]);
  const ctx = ctxFor({ codex: { accessToken: jwt(Math.floor(Date.now() / 1000) + 30), refreshToken: 'r1', accountId: 'acc' } });
  await codex.fetch(ctx);
  assert.equal(ctx.saved[0].refreshToken, 'r2');
});

test('codex: Cloudflare 挑戰頁 → forbidden', async () => {
  mock = mockFetch([['wham/usage', () => ({ status: 403, text: '<html><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/x"></script></html>' })]]);
  const ctx = ctxFor({ codex: { accessToken: jwt(Math.floor(Date.now() / 1000) + 3600), accountId: 'acc' } });
  await assert.rejects(codex.fetch(ctx), (e) => e.kind === 'forbidden' && e.message.includes('Cloudflare'));
});

// ---------- Antigravity ----------
test('antigravity: 模型分兩組取最低剩餘；缺 remainingFraction 的模型跳過不誤報', () => {
  // fixture 裡 gpt-oss-120b 有 quotaInfo 但沒有 remainingFraction：應被跳過，
  // 所以 Claude/GPT 只看 claude-sonnet-4-5（0.4 → 用 60%），不會被拉成 100%。
  const w = parseModels(fixture('antigravity-models.json'));
  assert.deepEqual(w.map((x) => [x.id, x.label, x.usedPct]), [['gemini', 'Gemini', 20], ['claude_gpt', 'Claude/GPT', 60]]);
  assert.equal(w[1].resetsAt, '2026-11-29T00:00:00.000Z');
});

test('antigravity: 一組全部缺 remainingFraction → 那組不顯示', () => {
  const w = parseModels({ models: {
    'gemini-x': { quotaInfo: { remainingFraction: 0.5, resetTime: '2026-12-01T00:00:00Z' } },
    'claude-y': { quotaInfo: { resetTime: '2026-12-01T00:00:00Z' } },
  } });
  assert.deepEqual(w.map((x) => x.id), ['gemini']);
});

test('antigravity: 續期 → loadCodeAssist → fetchAvailableModels', async () => {
  mock = mockFetch([
    ['oauth2.googleapis.com', (req) => {
      const b = new URLSearchParams(req.body);
      assert.equal(b.get('grant_type'), 'refresh_token');
      assert.equal(b.get('client_id'), 'cid');
      return { json: { access_token: 'g1', expires_in: 3599 } };
    }],
    [':loadCodeAssist', () => ({ json: fixture('antigravity-load.json') })],
    [':fetchAvailableModels', (req) => {
      assert.equal(JSON.parse(req.body).project, 'fluent-cat-123abc');
      assert.equal(req.headers.authorization, 'Bearer g1');
      return { json: fixture('antigravity-models.json') };
    }],
  ]);
  const r = await antigravity.fetch(ctxFor({ antigravity: { refreshToken: 'rt', clientId: 'cid', clientSecret: 'cs' } }));
  assert.equal(r.plan, 'Free');
  assert.equal(r.windows.length, 2);
});

test('antigravity: 方案名稱整理成 Free／Pro／Ultra，付費方案優先', () => {
  assert.equal(tierName({ currentTier: { id: 'free-tier', name: 'Antigravity Starter Quota' } }), 'Free');
  assert.equal(tierName({ currentTier: { name: 'Antigravity Free' } }), 'Free');
  assert.equal(tierName({ currentTier: { name: 'Free' }, paidTier: { id: 'g1-pro-tier', name: 'Google AI Pro' } }), 'Pro');
  assert.equal(tierName({ paidTier: { name: 'Google AI Ultra' } }), 'Ultra');
  assert.equal(tierName({ currentTier: { name: 'Enterprise Plus' } }), 'Enterprise Plus');
  assert.equal(tierName({}), null);
});

test('antigravity: 方案超過 6 小時會重查 loadCodeAssist', async () => {
  _resetCache();
  let loads = 0;
  let tier = { id: 'free-tier', name: 'Antigravity Starter Quota' };
  mock = mockFetch([
    ['oauth2.googleapis.com', () => ({ json: { access_token: 'g1', expires_in: 3599 } })],
    [':loadCodeAssist', () => { loads += 1; return { json: { cloudaicompanionProject: 'p1', currentTier: tier } }; }],
    [':fetchAvailableModels', () => ({ json: fixture('antigravity-models.json') })],
  ]);
  const ctx = ctxFor({ antigravity: { refreshToken: 'rt', clientId: 'cid', clientSecret: 'cs' } });
  assert.equal((await antigravity.fetch(ctx)).plan, 'Free');
  tier = { id: 'g1-pro-tier', name: 'Google AI Pro' };
  assert.equal((await antigravity.fetch(ctx)).plan, 'Free', '6 小時內沿用快取');
  const realNow = Date.now;
  Date.now = () => realNow() + 6 * 3600 * 1000 + 1000;
  try {
    assert.equal((await antigravity.fetch(ctx)).plan, 'Pro');
  } finally {
    Date.now = realNow;
  }
  assert.equal(loads, 2);
});

test('antigravity: 沒有 client id/secret 視為未設定', () => {
  assert.equal(antigravity.isConfigured({ antigravity: { refreshToken: 'rt' } }), false);
});
