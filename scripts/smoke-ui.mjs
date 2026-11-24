// 前端 smoke test：用假資料起一個本機伺服器，開本機的 Chrome（headless，經 DevTools Protocol 操作）檢查畫面行為。
// 不需要安裝任何套件；需要本機有 Chrome／Edge／Chromium（或設 CHROME_PATH）。
// 用法：npm run test:ui
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

// ---------- 假資料 ----------
const now = Date.now();
const iso = (ms) => new Date(now + ms).toISOString();
const base = { status: 'ok', fetchedAt: iso(-10_000), nextFetchAt: iso(50_000), intervalSec: 60, slowed: false, error: null, note: null, balance: null };
const providers = (claude5h) => [
  { ...base, id: 'claude', name: 'Claude', plan: 'Pro', planExpiresAt: '2027-11-04', windows: [{ id: '5h', label: '5 小時', usedPct: claude5h, resetsAt: iso(3600e3) }, { id: '7d', label: '每週', usedPct: 20, resetsAt: iso(5 * 86400e3) }] },
  { ...base, id: 'codex', name: 'Codex', plan: 'Free', windows: [{ id: 'primary', label: '每月', usedPct: 95, resetsAt: iso(9 * 3600e3) }] },
  { ...base, id: 'antigravity', name: 'Antigravity', plan: 'Free', windows: [{ id: 'gemini', label: 'Gemini', usedPct: 0, resetsAt: iso(7 * 86400e3) }] },
  { ...base, id: 'copilot', name: 'GitHub Copilot', plan: 'Free', windows: [{ id: 'chat', label: 'Chat', usedPct: 1, used: 2, limit: 200, resetsAt: iso(7 * 86400e3) }] },
  { ...base, id: 'openrouter', name: 'OpenRouter', plan: '預付', windows: [], balance: { currency: 'USD', remaining: -0.2, total: 10, used: 10.2 } },
];
const day = (n) => new Date(now - n * 86400e3).toISOString().slice(0, 10);
const history = { tz: 'UTC', today: day(0), days: [3, 2, 1, 0].map((n) => ({ date: day(n), providers: { claude: { '5h': 10 + n * 10, '7d': 5 + n } } })) };
const rank = (prefix, paid) => Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, slug: `${prefix}/m${i}`, name: `${prefix} 模型 ${i + 1}`, tokens: 1e12 / (i + 1), ...(paid ? { price: { input: 0.5, output: 2 } } : {}) }));
const rankings = { version: 2, updatedAt: iso(-60e3), views: Object.fromEntries(['day', 'week', 'month'].map((v) => [v, { free: rank('free', false), paid: rank('paid', true) }])) };

const sseClients = new Set();
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/api/usage') return json({ version: 1, pollIntervalSec: 60, providers: providers(30) });
  if (u.pathname === '/api/history') return json(history);
  if (u.pathname === '/api/rankings') return json(rankings);
  if (u.pathname === '/api/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`event: snapshot\ndata: ${JSON.stringify({ pollIntervalSec: 60, providers: providers(30) })}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }
  const f = path.join(PUBLIC, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
  if (!f.startsWith(PUBLIC) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
const pushProvider = (p) => { for (const c of sseClients) c.write(`event: provider\ndata: ${JSON.stringify(p)}\n\n`); };

// ---------- Chrome ----------
function findChrome() {
  const c = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return c.find((p) => fs.existsSync(p));
}

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const chromePath = findChrome();
  if (!chromePath) { console.error('找不到 Chrome／Edge，設 CHROME_PATH 後再試'); process.exit(2); }
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aiu-smoke-'));
  const port = 9400 + Math.floor(Math.random() * 400);
  const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

  try {
    let list;
    for (let i = 0; i < 30 && !list; i++) { await sleep(300); list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => null); }
    const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
    let id = 0;
    const pend = new Map();
    const errors = [];
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && pend.has(d.id)) { pend.get(d.id)(d.result); pend.delete(d.id); }
      else if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text);
    };
    await new Promise((r) => { ws.onopen = r; });
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true }))?.result?.value;
    const key = (k) => ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}' }))`);
    const viewport = (width, height, mobile = false) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });

    await send('Runtime.enable');
    await viewport(1916, 908);
    await send('Page.navigate', { url });
    await sleep(2500);

    // ---- 簡約風格 ----
    check('五張卡片都畫出來', (await ev(`document.querySelectorAll('.card').length`)) === 5);
    check('SSE 連上顯示「即時」', (await ev(`document.getElementById('conn-text').textContent`)) === '即時');
    check('排行榜免費／付費各 10 名', (await ev(`[...document.querySelectorAll('.rank-list')].map((l) => l.children.length).join(',')`)) === '10,10');
    check('付費排行有價格', (await ev(`document.querySelector('.rank-col.paid .rank-list .pr')?.textContent`)) === '$0.5 / $2');
    check('歷史小長條圖出現（Claude 有 30 格）', (await ev(`document.querySelector('.card[data-id="claude"] .spark')?.children.length`)) === 30);
    check('沒資料的服務不畫小長條圖', (await ev(`!document.querySelector('.card[data-id="codex"] .spark')`)) === true);
    check('Codex 95% 有「快用完了！」泡泡（元素存在）', (await ev(`!!document.querySelector('.card[data-id="codex"] .alert-bubble:not([hidden])')`)) === true);
    check('簡約風格不建立場景地圖', (await ev(`document.querySelectorAll('.scene .map').length`)) === 0);
    check('Claude 到期日', /2027\/11\/4 到期/.test(await ev(`document.querySelector('.card[data-id="claude"] .plan-exp').textContent`)));

    // ---- 亮暗切換 ----
    const before = await ev(`getComputedStyle(document.body).backgroundColor`);
    await ev(`document.getElementById('theme-btn').click()`);
    await sleep(200);
    check('亮暗切換會換背景並記住', (await ev(`getComputedStyle(document.body).backgroundColor`)) !== before && ['light', 'dark'].includes(await ev(`localStorage.getItem('theme')`)));

    // ---- 冒險風格 ----
    await ev(`document.getElementById('skin-btn').click()`);
    await sleep(800);
    check('切到冒險風格', (await ev(`document.documentElement.dataset.skin`)) === 'adventure');
    check('四張地圖建立', (await ev(`document.querySelectorAll('.scene .map').length`)) === 4);
    check('從春天開始', (await ev(`document.documentElement.dataset.map`)) === 'spring');
    const maps = [];
    for (let i = 0; i < 4; i++) { await key('m'); await sleep(2300); maps.push(await ev(`document.documentElement.dataset.map`)); }
    check('M 依序切換四季並循環', maps.join(',') === 'summer,autumn,winter,spring', maps.join(','));
    check('點怪物會跳並冒字', await ev(`(() => { const m = document.querySelector('.map.active .mon'); m.dispatchEvent(new MouseEvent('click', { bubbles: true })); return m.classList.contains('hit') && !!document.querySelector('.sc-pop'); })()`));

    // 用量上升時跳出「+N%」
    pushProvider(providers(36)[0]);
    await sleep(600);
    check('用量上升時卡片跳出 +N%', (await ev(`document.querySelector('.card[data-id="claude"] .dmg')?.textContent`)) === '+6%');

    // 只看風景
    await key('b');
    await sleep(400);
    check('B 只看風景：卡片收起', (await ev(`getComputedStyle(document.getElementById('cards')).display`)) === 'none');
    await key('Escape');
    await sleep(400);
    check('Esc 回到用量', (await ev(`getComputedStyle(document.getElementById('cards')).display`)) !== 'none');

    // 手機：「顯示用量」按鈕要在畫面內
    await viewport(390, 844, true);
    await sleep(400);
    await ev(`document.getElementById('bg-btn').click()`);
    await sleep(400);
    const r = await ev(`(() => { const b = document.getElementById('bg-exit').getBoundingClientRect(); return [b.top, b.bottom, innerHeight]; })()`);
    check('手機：「顯示用量」在畫面內', r && r[0] >= 0 && r[1] <= r[2], JSON.stringify(r));
    await ev(`document.getElementById('bg-exit').click()`);

    check('沒有 JS 錯誤', errors.length === 0, errors.join(' | '));
  } finally {
    chrome.kill();
    server.close();
    for (const c of sseClients) c.end();
  }

  let failed = 0;
  for (const t of results) {
    console.log(`${t.ok ? 'ok  ' : 'FAIL'} ${t.name}${t.ok || !t.detail ? '' : `（${t.detail}）`}`);
    if (!t.ok) failed++;
  }
  console.log(`\n${results.length - failed}/${results.length} 通過`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
