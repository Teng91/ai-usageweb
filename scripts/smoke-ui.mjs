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
  { ...base, id: 'claude', name: 'Claude', plan: 'Pro', planExpiresAt: '2027-11-04', windows: [{ id: '5h', label: '5 小時', usedPct: claude5h, resetsAt: iso(3600e3) }, { id: '7d', label: '每週', usedPct: 20, resetsAt: iso(5 * 86400e3) }, { id: '7d_opus', label: '每週 Opus', usedPct: 10, resetsAt: iso(5 * 86400e3) }, { id: '7d_sonnet', label: '每週 Sonnet', usedPct: 5, resetsAt: iso(5 * 86400e3) }] },
  { ...base, id: 'antigravity', name: 'Gemini', plan: 'Pro', windows: [
    { id: 'gemini', label: '5 小時', usedPct: 12, resetsAt: iso(4 * 3600e3), periodSec: 18000 },
    { id: 'gemini_week', label: '每週', usedPct: 0, resetsAt: null, periodSec: 604800 },
  ] },
  { ...base, id: 'codex', name: 'Codex', plan: 'Free', windows: [{ id: 'primary', label: '每月', usedPct: 95, resetsAt: iso(9 * 3600e3) }] },
  { ...base, id: 'openrouter', name: 'OpenRouter', plan: '預付', windows: [], balance: { currency: 'USD', remaining: -0.2, total: 10, used: 10.2 } },
];
const rank = (prefix, paid) => Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, slug: `${prefix}/m${i}`, name: `${prefix} 模型 ${i + 1}`, tokens: 1e12 / (i + 1), ...(paid ? { price: { input: 0.5, output: 2 } } : {}) }));
const rankings = { version: 2, updatedAt: iso(-60e3), views: Object.fromEntries(['day', 'week', 'month'].map((v) => [v, { free: rank('free', false), paid: rank('paid', true) }])) };

const sseClients = new Set();
const seenKey = {}; // 各 API 收到的 ?k=，檢查存取碼只在第一次帶
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) (seenKey[u.pathname] ||= []).push(u.searchParams.get('k'));
  const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/api/usage') return json({ version: 1, pollIntervalSec: 60, providers: providers(30) });
  if (u.pathname === '/api/rankings') return json(rankings);
  if (u.pathname === '/api/push/config') return json({ enabled: true, publicKey: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8' });
  if (u.pathname === '/api/push/status') return json({ subscribed: false, prefs: null });
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
  const chromeArgs = ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`];
  // CI（GitHub Actions 的 Linux）裡 Chrome 的 sandbox 可能用不了
  if (process.env.CI) chromeArgs.push('--no-sandbox', '--disable-dev-shm-usage');
  const chrome = spawn(chromePath, [...chromeArgs, 'about:blank'], { stdio: 'ignore' });

  try {
    let list;
    // CI 的 runner 有時候 Chrome 啟動得很慢：最多等 30 秒，等到有分頁才連
    let page;
    for (let i = 0; i < 100 && !page; i++) {
      await sleep(300);
      list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => null);
      page = Array.isArray(list) ? list.find((t) => t.type === 'page') : null;
    }
    if (!page) throw new Error(`Chrome 30 秒內沒有開好 DevTools（port ${port}）`);
    const ws = new WebSocket(page.webSocketDebuggerUrl);
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
    await send('Page.navigate', { url: `${url}?k=smoke` });
    await sleep(2500);

    // ---- 簡約風格 ----
    check('存取碼：第一次 /api/usage 有帶 ?k=', seenKey['/api/usage']?.[0] === 'smoke', JSON.stringify(seenKey['/api/usage']));
    check('存取碼：成功後從網址拿掉，SSE 不再帶', (await ev(`location.search`)) === '' && seenKey['/api/stream']?.every((k) => k === null), JSON.stringify(seenKey['/api/stream']));
    check('四張卡片都畫出來，加上排行卡', (await ev(`document.querySelectorAll('.card[data-id]').length + '|' + document.querySelectorAll('.card.rank-card').length`)) === '4|1');
    check('SSE 連上顯示「即時」', (await ev(`document.getElementById('conn-text').textContent`)) === '即時');
    check('排行榜免費／付費各 10 名', (await ev(`[...document.querySelectorAll('.rank-list')].map((l) => l.children.length).join(',')`)) === '10,10');
    check('付費排行有價格', (await ev(`document.querySelector('.rank-col.paid .rank-list .pr')?.textContent`)) === '$0.5 / $2');
    check('Codex 95% 有「快用完了！」泡泡（元素存在）', (await ev(`!!document.querySelector('.card[data-id="codex"] .alert-bubble:not([hidden])')`)) === true);
    check('簡約風格不建立場景地圖', (await ev(`document.querySelectorAll('.scene .map').length`)) === 0);
    check('卡片順序：Claude、Gemini、Codex', (await ev(`[...document.querySelectorAll('.card')].slice(0, 3).map((c) => c.querySelector('.card-name').textContent).join(',')`)) === 'Claude,Gemini,Codex');
    const rows = await ev(`(() => { const b = document.querySelector('.card[data-id="claude"] .card-body'); const wins = [...b.querySelectorAll('.win')]; const c = document.querySelector('.card[data-id="antigravity"] .card-body'); const bottom = (el) => Math.max(...[...el.children].map((x) => x.getBoundingClientRect().bottom)) - el.getBoundingClientRect().top; return { rows: new Set(wins.map((w) => w.offsetTop)).size, h: bottom(b), ch: bottom(c), sx: wins.every((w) => w.scrollWidth <= w.clientWidth + 1) }; })()`);
    check('沒用過也沒有重置時間的額度顯示「用了才開始計時」', (await ev(`document.querySelectorAll('.card[data-id="antigravity"] .win-sub')[1]?.textContent`)) === '還沒用，用了才開始計時');
    check('分區：四張卡片（OpenRouter 餘額在第四張）一區、熱門模型排行自己一區，都沒有標題', (await ev(`document.querySelectorAll('.group-title').length + '|' + [...document.querySelectorAll('.group')].map((g) => [...g.querySelectorAll('.card')].map((c) => c.dataset.id || 'rank').join('+')).join(' | ')`)) === '0|claude+antigravity+codex+openrouter | rank');
    check('OpenRouter 卡片只放餘額，排行不在卡片裡', (await ev(`(() => { const c = document.querySelector('.card[data-id="openrouter"]'); return !!c.querySelector('.balance') && !c.querySelector('.rank'); })()`)) === true);
    check('寬螢幕四張卡片排成一列，排行卡在下面佔滿整列', (await ev(`(() => { const cs = [...document.querySelectorAll('.card[data-id]')].map((c) => c.getBoundingClientRect()); const rk = document.querySelector('.rank-card').getBoundingClientRect(); const top = cs[0].top; return cs.every((r) => Math.abs(r.top - top) < 2) && rk.top > cs[0].bottom && Math.abs(rk.left - cs[0].left) < 2 && Math.abs(rk.right - cs[3].right) < 2; })()`)) === true);
    check('四條額度（Claude 加上每週 Opus／Sonnet）排成兩列，不比兩條的卡片高、不溢出', rows?.rows === 2 && rows.h <= rows.ch + 1 && rows.sx, JSON.stringify(rows));
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
    check('「快用完了！」泡泡完整露出在卡片上方（不被卡片裁掉）', await ev(`(() => { const card = document.querySelector('.card[data-id="codex"]'); const b = card.querySelector('.alert-bubble'); const r = b.getBoundingClientRect(); const c = card.getBoundingClientRect(); return getComputedStyle(b).display !== 'none' && r.bottom <= c.top + 4 && getComputedStyle(card).overflow === 'visible'; })()`));
    check('四張地圖建立', (await ev(`document.querySelectorAll('.scene .map').length`)) === 4);
    check('新原創怪物（紫光小菇靈／露珠水精靈）存在於場景', (await ev(`!!document.querySelector('.scene .mon-sporeling') && !!document.querySelector('.scene .mon-dewdrop')`)) === true);
    check('從春天開始', (await ev(`document.documentElement.dataset.map`)) === 'spring');
    check('多層遠景：春天有遠丘、近丘、小鎮、彩虹與四朵柔和的雲', await ev(`(() => { const m = document.querySelector('.map.active'); const c = m.querySelectorAll('.sc-cloud'); return ['.sc-hills-far', '.sc-hills-near', '.sc-town', '.sc-town-lights', '.sc-rainbow'].every((s) => m.querySelector(s)) && c.length === 4 && getComputedStyle(c[0]).backgroundImage.includes('cloud-soft'); })()`));
    // 白天／夜晚：月亮、小鎮燈火、彩虹、地圖本身不再整層調暗（燈火才亮得起來）
    const themeBefore = await ev(`document.documentElement.dataset.theme || ''`);
    const nightState = async (theme) => {
      await ev(`document.documentElement.dataset.theme = '${theme}'`);
      await sleep(150);
      return ev(`['.sc-moon', '.map.active .sc-town-lights', '.map.active .sc-rainbow'].map((s) => getComputedStyle(document.querySelector(s)).display).concat(getComputedStyle(document.querySelector('.map.active')).filter).join()`);
    };
    check('白天：沒有月亮與燈火，有彩虹', (await nightState('light')) === 'none,none,block,none');
    check('夜晚：月亮與小鎮燈火亮起、彩虹收起，地圖不整層調暗', (await nightState('dark')) === 'block,block,none,none');
    await ev(themeBefore ? `document.documentElement.dataset.theme = '${themeBefore}'` : `delete document.documentElement.dataset.theme`);
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

    // 通知設定
    check('推播啟用時顯示鈴鐺', (await ev(`!document.getElementById('push-btn').hidden`)) === true);
    await ev(`document.getElementById('push-btn').click()`);
    await sleep(300);
    check('點鈴鐺打開通知設定', (await ev(`document.getElementById('push-dialog').open`)) === true);
    let keyRow = null;
    for (let i = 0; i < 10 && keyRow !== false; i++) { keyRow = await ev(`document.getElementById('push-key-row').hidden`); if (keyRow !== false) await sleep(200); }
    check('還沒訂閱時要輸入推播密碼', keyRow === false);
    check('還沒開啟通知時不顯示勿擾與門檻設定（選單已建好）', (await ev(`[document.getElementById('push-settings').hidden, document.getElementById('push-quiet-start').options.length, document.getElementById('push-t1').options.length].join()`)) === 'true,24,8');
    check('推播密碼不存在瀏覽器裡', (await ev(`localStorage.getItem('pushKey')`)) === null);
    const skinBefore = await ev(`document.documentElement.dataset.skin`);
    await key('s');
    check('通知設定開著時不吃快捷鍵', (await ev(`document.documentElement.dataset.skin`)) === skinBefore);
    const d = await ev(`(() => { const b = document.getElementById('push-dialog').getBoundingClientRect(); return [b.left, b.right, innerWidth]; })()`);
    check('手機：通知設定在畫面內', d && d[0] >= 0 && d[1] <= d[2], JSON.stringify(d));
    await ev(`document.getElementById('push-close').click()`);
    check('按「關閉」收起通知設定', (await ev(`document.getElementById('push-dialog').open`)) === false);

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
