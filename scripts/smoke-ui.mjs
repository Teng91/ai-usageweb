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
  { ...base, id: 'codex', name: 'Codex', plan: 'Free', windows: [{ id: 'primary', label: '每月', usedPct: 95, resetsAt: iso(9 * 3600e3), exhaustsAt: iso(40 * 60e3) }] },
  { ...base, id: 'openrouter', name: 'OpenRouter', plan: '預付', windows: [], balance: { currency: 'USD', remaining: -0.2, total: 10, used: 10.2 } },
];
const rank = (prefix, paid) => Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, slug: `${prefix}/m${i}`, name: `${prefix === 'free' ? '免費' : '付費'}模型 ${'ABCDEFGHIJ'[i]}`, tokens: 1e12 / (i + 1), ...(paid ? { price: { input: 0.5, output: 2 } } : {}) }));
const rankings = { version: 2, updatedAt: iso(-60e3), views: Object.fromEntries(['day', 'week', 'month'].map((v) => [v, { free: rank('free', false), paid: rank('paid', true) }])) };

const sseClients = new Set();
const seenKey = {}; // 各 API 收到的 ?k=，檢查存取碼只在第一次帶
// 模擬伺服器的狀況（測試後段用）：
//  usageMode 'stale-once'：下一次 /api/usage 回 5 分鐘前的資料（伺服器剛被叫醒），之後回剛抓到的
//  sseMode 'reject'：SSE 回 503（例如機器重啟中）；'quiet'：連上後只說 ping 間隔 1 秒，之後什麼都不送（半斷線）
let usageMode = null;
let sseMode = null;
let streamCount = 0; // 收到幾次 SSE 連線
const quietClients = new Set();
// 資料時間跟著真實時間走（10 秒前抓的），測試跑多久都不會被當成「伺服器停過」
const aged = (ms) => providers(30).map((p) => ({ ...p, fetchedAt: new Date(Date.now() - ms).toISOString() }));
// 跟真的伺服器一樣定時送 ping（安靜的連線不送）
setInterval(() => { for (const c of sseClients) if (!quietClients.has(c)) c.write('event: ping\ndata: {"sec":25}\n\n'); }, 20_000).unref();
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) (seenKey[u.pathname] ||= []).push(u.searchParams.get('k'));
  const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/api/usage' && usageMode) {
    const ms = usageMode === 'stale-once' ? 5 * 60e3 : 1000;
    usageMode = 'fresh';
    return json({ version: 1, pollIntervalSec: 60, providers: aged(ms) });
  }
  if (u.pathname === '/api/usage') return json({ version: 1, pollIntervalSec: 60, providers: aged(10_000) });
  if (u.pathname === '/api/rankings') return json(rankings);
  if (u.pathname === '/api/push/config') return json({ enabled: true, publicKey: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8' });
  if (u.pathname === '/api/push/status') return json({ subscribed: false, prefs: null });
  if (u.pathname === '/api/stream' && sseMode === 'reject') {
    res.writeHead(503, { 'content-type': 'application/json' });
    return res.end('{}');
  }
  if (u.pathname === '/api/stream') {
    streamCount += 1;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`event: snapshot\ndata: ${JSON.stringify({ pollIntervalSec: 60, providers: aged(10_000) })}\n\n`);
    res.write(`event: ping\ndata: ${JSON.stringify({ sec: sseMode === 'quiet' ? 1 : 25 })}\n\n`);
    sseClients.add(res);
    if (sseMode === 'quiet') quietClients.add(res);
    req.on('close', () => { sseClients.delete(res); quietClients.delete(res); });
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
    // SMOKE_SHOTS=資料夾：順便存截圖（檔名跟 docs/images 一樣，更新文件截圖用；平常不存）
    const shot = async (name) => {
      if (!process.env.SMOKE_SHOTS) return;
      await sleep(500); // 等場景與動畫畫好
      const d = await send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(process.env.SMOKE_SHOTS, { recursive: true });
      fs.writeFileSync(path.join(process.env.SMOKE_SHOTS, `${name}.png`), Buffer.from(d.data, 'base64'));
    };
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
    const danger = await ev(`(() => { const c = document.querySelector('.card[data-id="codex"]'); return [c.dataset.level, !!c.querySelector('.win[data-level="danger"] .win-pct'), getComputedStyle(c).boxShadow.includes('inset')].join('|'); })()`);
    check('簡約風格：快用完時百分比變紅、卡片左邊有狀態色條', danger === 'danger|true|true', danger);
    const balance = await ev(`(() => { const b = document.querySelector('.card[data-id="openrouter"] .balance .bar'); return b ? b.className + '|' + b.getAttribute('aria-valuenow') : 'none'; })()`);
    check('OpenRouter 餘額卡有「已用／總額」進度條（超過總額是紅的）', balance === 'bar danger|100', balance);
    check('排行的 token 數字不寫多餘的 .0（1T、500B）', (await ev(`[...document.querySelectorAll('.rank-col:not(.paid) .rank-list .tk')].slice(0, 2).map((e) => e.textContent).join(',')`)) === '1T,500B');
    // 餘額卡跟其他卡片同一種排法：一行「餘額（USD）」與金額（負的是紅色），沒有金幣圖示
    const balRow = await ev(`(() => { const c = document.querySelector('.card[data-id="openrouter"]'); const r = c.querySelector('.balance .win-row'); const pct = r.querySelector('.win-pct'); return [r.firstElementChild.textContent, pct.textContent, c.querySelector('.balance').dataset.level, c.querySelector('.balance .win-sub').textContent].join('|'); })()`);
    check('餘額卡跟其他卡片一樣：「餘額（USD）」一行、進度條、已用金額', balRow === '餘額（USD）|-$0.20|danger|已用 $10.20 / $10.00', balRow);
    check('不再有時間線的圖例', (await ev(`!document.querySelector('.legend')`)) === true);
    check('資料還新時卡片不寫「資料時間」', (await ev(`[...document.querySelectorAll('.card[data-id] .card-meta')].every((m) => m.textContent === '' && getComputedStyle(m).display === 'none')`)) === true);
    check('簡約風格不建立場景地圖', (await ev(`document.querySelectorAll('.scene .map').length`)) === 0);
    check('卡片順序：Claude、Gemini、Codex', (await ev(`[...document.querySelectorAll('.card')].slice(0, 3).map((c) => c.querySelector('.card-name').textContent).join(',')`)) === 'Claude,Gemini,Codex');
    const rows = await ev(`(() => { const b = document.querySelector('.card[data-id="claude"] .card-body'); const wins = [...b.querySelectorAll('.win')]; const c = document.querySelector('.card[data-id="antigravity"] .card-body'); const bottom = (el) => Math.max(...[...el.children].map((x) => x.getBoundingClientRect().bottom)) - el.getBoundingClientRect().top; return { rows: new Set(wins.map((w) => w.offsetTop)).size, h: bottom(b), ch: bottom(c), sx: wins.every((w) => w.scrollWidth <= w.clientWidth + 1) }; })()`);
    check('沒用過也沒有重置時間的額度顯示「用了才開始計時」', (await ev(`document.querySelectorAll('.card[data-id="antigravity"] .win-sub')[1]?.textContent`)) === '還沒用，用了才開始計時');
    // 時間進度：Gemini 5 小時還有 4 小時才重置 → 已過 20%；不知道週期長度（Codex）或沒有重置時間的不畫
    const marks = await ev(`(() => { const m = (sel) => document.querySelector(sel + ' .time-mark'); const g = m('.card[data-id="antigravity"] .win'); return [g.hidden, Math.round(parseFloat(g.style.left)), document.querySelectorAll('.card[data-id="antigravity"] .time-mark')[1].hidden, m('.card[data-id="codex"] .win').hidden, document.querySelector('.card[data-id="antigravity"] .bar').title].join('|'); })()`);
    check('進度條上的時間進度標記（Gemini 5 小時已過 20%；沒有週期長度或重置時間的不畫）', marks === 'false|20|true|true|時間過了 20%，用了 12%', marks);
    const eta = await ev(`(() => { const e = document.querySelector('.card[data-id="codex"] .win-eta'); return (e.hidden ? 'hidden' : '') + e.textContent + '|' + document.querySelector('.card[data-id="claude"] .win-eta').hidden; })()`);
    check('預估用完時間：照目前速度會在重置前用完才顯示', /^照目前速度約 (39|40) 分鐘後用完\|true$/.test(eta), eta);
    check('分區：四張卡片（OpenRouter 餘額在第四張）一區、熱門模型排行自己一區，都沒有標題', (await ev(`document.querySelectorAll('.group-title').length + '|' + [...document.querySelectorAll('.group')].map((g) => [...g.querySelectorAll('.card')].map((c) => c.dataset.id || 'rank').join('+')).join(' | ')`)) === '0|claude+antigravity+codex+openrouter | rank');
    check('OpenRouter 卡片只放餘額，排行不在卡片裡', (await ev(`(() => { const c = document.querySelector('.card[data-id="openrouter"]'); return !!c.querySelector('.balance') && !c.querySelector('.rank-list'); })()`)) === true);
    check('寬螢幕四張卡片排成一列，排行卡在下面佔滿整列', (await ev(`(() => { const cs = [...document.querySelectorAll('.card[data-id]')].map((c) => c.getBoundingClientRect()); const rk = document.querySelector('.rank-card').getBoundingClientRect(); const top = cs[0].top; return cs.every((r) => Math.abs(r.top - top) < 2) && rk.top > cs[0].bottom && Math.abs(rk.left - cs[0].left) < 2 && Math.abs(rk.right - cs[3].right) < 2; })()`)) === true);
    check('四條額度（Claude 加上每週 Opus／Sonnet）排成兩列，不比兩條的卡片高、不溢出', rows?.rows === 2 && rows.h <= rows.ch + 1 && rows.sx, JSON.stringify(rows));
    const rankHead = `(() => { const rk = document.querySelector('.rank-card'); const cl = document.querySelector('.card[data-id="claude"]'); const off = (c) => c.querySelector('.card-name').getBoundingClientRect().left - c.getBoundingClientRect().left; const body = (c) => c.querySelector('.card-body').getBoundingClientRect().left - c.getBoundingClientRect().left; return rk.querySelector('.card-head .card-name')?.textContent === 'OpenRouter 熱門模型' && !!rk.querySelector('.card-head .seg') && Math.abs(off(rk) - off(cl)) < 1 && Math.abs(body(rk) - body(cl)) < 1; })()`;
    check('排行卡片跟上面四張同樣的標題列（標題、時間切換在標題列，左邊對齊）', (await ev(rankHead)) === true);
    const themeNow = () => ev(`document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')`);
    await shot(`minimal-${await themeNow()}`);
    check('Claude 到期日', /2027\/11\/4 到期/.test(await ev(`document.querySelector('.card[data-id="claude"] .plan-exp').textContent`)));
    // 鍵盤焦點框：按 Tab 後，有焦點的元素是實線外框
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await sleep(100);
    const focusRing = await ev(`(() => { const a = document.activeElement; return a && a !== document.body ? a.matches(':focus-visible') + '|' + getComputedStyle(a).outlineStyle : 'no focus'; })()`);
    check('用鍵盤（Tab）移動焦點時有明顯的焦點框', focusRing === 'true|solid', focusRing);
    await ev(`document.activeElement?.blur()`);

    // ---- 亮暗切換 ----
    // 小字（重置倒數）對卡片底色的對比至少 4.5:1
    const contrastOf = `(() => { const rgb = (c) => c.match(/[0-9.]+/g).slice(0, 3).map(Number); const L = (c) => { const [r, g, b] = rgb(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }; const fg = getComputedStyle(document.querySelector('.win-sub')).color; const bg = getComputedStyle(document.querySelector('.card[data-id]')).backgroundColor; const [a, b] = [L(fg), L(bg)].sort((x, y) => y - x); return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100; })()`;
    // 還沒選過亮暗：跟著系統切換（data-theme 一律設好，CSS 只看它）
    const follow = [];
    for (const scheme of ['dark', 'light']) {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await sleep(150);
      follow.push(`${await ev(`document.documentElement.dataset.theme`)}:${await ev(contrastOf)}`);
    }
    check('沒選過亮暗時跟著系統切換，兩種都設好 data-theme', follow.map((x) => x.split(':')[0]).join() === 'dark,light', follow.join(' '));
    check('簡約風格的小字對比至少 4.5:1（暗色、亮色）', follow.every((x) => Number(x.split(':')[1]) >= 4.5), follow.join(' '));
    const before = await ev(`getComputedStyle(document.body).backgroundColor`);
    await ev(`document.getElementById('theme-btn').click()`);
    await sleep(200);
    await shot(`minimal-${await themeNow()}`);
    check('亮暗切換會換背景並記住', (await ev(`getComputedStyle(document.body).backgroundColor`)) !== before && ['light', 'dark'].includes(await ev(`localStorage.getItem('theme')`)));

    // ---- 冒險風格 ----
    await ev(`document.getElementById('skin-btn').click()`);
    await sleep(800);
    check('切到冒險風格', (await ev(`document.documentElement.dataset.skin`)) === 'adventure');
    check('「快用完了！」泡泡完整露出在卡片上方（不被卡片裁掉）', await ev(`(() => { const card = document.querySelector('.card[data-id="codex"]'); const b = card.querySelector('.alert-bubble'); const r = b.getBoundingClientRect(); const c = card.getBoundingClientRect(); return getComputedStyle(b).display !== 'none' && r.bottom <= c.top + 4 && getComputedStyle(card).overflow === 'visible'; })()`));
    check('冒險風格：排行卡片的標題列也對齊', (await ev(rankHead)) === true);
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
    await shot('adventure-day');
    check('夜晚：月亮與小鎮燈火亮起、彩虹收起，地圖不整層調暗', (await nightState('dark')) === 'block,block,none,none');
    await shot('adventure-night');
    const advContrast = [];
    for (const theme of ['light', 'dark']) {
      await ev(`document.documentElement.dataset.theme = '${theme}'`);
      await sleep(150);
      advContrast.push(`${theme}:${await ev(contrastOf)}`);
    }
    check('冒險風格的小字對比至少 4.5:1（白天、夜晚）', advContrast.every((x) => Number(x.split(':')[1]) >= 4.5), advContrast.join(' '));
    await ev(themeBefore ? `document.documentElement.dataset.theme = '${themeBefore}'` : `delete document.documentElement.dataset.theme`);
    const maps = [];
    for (let i = 0; i < 4; i++) { await key('m'); await sleep(2300); maps.push(await ev(`document.documentElement.dataset.map`)); }
    check('M 依序切換四季並循環', maps.join(',') === 'summer,autumn,winter,spring', maps.join(','));
    check('點怪物會跳並冒字', await ev(`(() => { const m = document.querySelector('.map.active .mon'); m.dispatchEvent(new MouseEvent('click', { bubbles: true })); return m.classList.contains('hit') && !!document.querySelector('.sc-pop'); })()`));

    // 用量上升時跳出「+N%」
    pushProvider(providers(36)[0]);
    await sleep(600);
    check('用量上升時卡片跳出 +N%', (await ev(`document.querySelector('.card[data-id="claude"] .dmg')?.textContent`)) === '+6%');

    // 被限流還在等退避：資料雖然 10 分鐘前，不算過期，顯示「被限流」與重試時間；出錯的也顯示重試時間
    const real = (ms) => new Date(Date.now() + ms).toISOString();
    pushProvider({ ...providers(36)[0], slowed: true, fetchedAt: real(-600e3), nextFetchAt: real(270e3) });
    pushProvider({ ...providers(30)[3], status: 'error', error: '503 服務暫時有問題', nextFetchAt: real(150e3) });
    await sleep(400);
    const retries = await ev(`['claude', 'openrouter'].map((id) => { const c = document.querySelector('.card[data-id="' + id + '"]'); return c.querySelector('.card-status').textContent + (c.classList.contains('stale') ? '（stale）' : ''); }).join('|')`);
    check('被限流等退避時不算過期、出錯時顯示下次重試時間', retries === '被限流，更新放慢（5 分鐘後重試）|503 服務暫時有問題（3 分鐘後重試）', retries);
    pushProvider(providers(36)[0]);
    pushProvider(providers(30)[3]);

    // 資料舊了（超過 2 個更新週期）而且狀態列沒寫時間（例如出錯）才寫「資料時間」
    pushProvider({ ...providers(30)[3], status: 'error', error: '503 服務暫時有問題', fetchedAt: real(-5 * 60e3), nextFetchAt: real(150e3) });
    await sleep(300);
    check('資料舊了才寫「資料時間」', (await ev(`document.querySelector('.card[data-id="openrouter"] .card-meta').textContent`)) === '資料時間 5 分鐘前');
    pushProvider(providers(30)[3]);

    // 過期由伺服器算好的 staleAt 決定，前端只比對時間
    pushProvider({ ...providers(30)[3], staleAt: real(-1000) });
    await sleep(300);
    check('過了伺服器給的 staleAt 就標「資料已過期」', /^資料已過期/.test(await ev(`document.querySelector('.card[data-id="openrouter"] .card-status').textContent`)));
    pushProvider(providers(30)[3]);

    // 依速度變色：用量超過時間線 10 點以上才變橘；用到 75% 但時間已過 90% 是正常的，不變色
    const gem = (pct, resetIn) => ({ ...providers(30)[1], windows: [{ id: 'gemini', label: '5 小時', usedPct: pct, resetsAt: real(resetIn), periodSec: 18000 }] });
    const gemBar = `(() => { const b = document.querySelector('.card[data-id="antigravity"] .bar'); return b.classList.contains('warn') + '|' + b.classList.contains('danger'); })()`;
    pushProvider(gem(60, 4 * 3600e3)); // 時間過了 20%、用了 60%
    await sleep(300);
    const fast = await ev(gemBar);
    pushProvider(gem(75, 30 * 60e3)); // 時間過了 90%、用了 75%
    await sleep(300);
    const onPace = await ev(gemBar);
    check('依速度變色：用得比時間快才變橘，75% 但時間快到了不變色', fast === 'true|false' && onPace === 'false|false', `${fast} / ${onPace}`);
    pushProvider(providers(30)[1]);
    check('卡片底部不再有閃爍的 ▼（看起來能點卻沒作用）', (await ev(`getComputedStyle(document.querySelector('.card-meta'), '::after').content`)) === 'none');
    check('卡片區不加 aria-live（倒數每秒在變，螢幕閱讀器會一直唸）', (await ev(`document.getElementById('cards').hasAttribute('aria-live')`)) === false);

    // 只看風景
    await key('b');
    await sleep(400);
    check('B 只看風景：卡片收起', (await ev(`getComputedStyle(document.getElementById('cards')).display`)) === 'none');
    await key('Escape');
    await sleep(400);
    check('Esc 回到用量', (await ev(`getComputedStyle(document.getElementById('cards')).display`)) !== 'none');

    // 手機：「顯示用量」按鈕要在畫面內
    await viewport(390, 844, true);
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await sleep(400);
    await shot('mobile');

    // 單欄時「快用完了！」泡泡不能壓到上一張卡片
    const bubbleGap = await ev(`(() => { const b = document.querySelector('.card[data-id="codex"] .alert-bubble').getBoundingClientRect(); const prev = document.querySelector('.card[data-id="antigravity"]').getBoundingClientRect(); return Math.round(b.top - prev.bottom); })()`);
    check('手機：「快用完了！」泡泡不壓到上一張卡片', bubbleGap >= 0, String(bubbleGap));

    // 手機頂列維持一排；換風格、只看風景、安裝收在「更多」選單
    const topRow = await ev(`(() => { const tops = [...document.querySelectorAll('.topbar > *')].filter((e) => e.getClientRects().length && getComputedStyle(e).position !== 'absolute').map((e) => e.getBoundingClientRect()); const mid = (r) => r.top + r.height / 2; return [Math.round(Math.max(...tops.map(mid)) - Math.min(...tops.map(mid))), document.getElementById('skin-btn').getClientRects().length, document.getElementById('more-btn').getClientRects().length].join('|'); })()`);
    check('手機：頂列維持一排，換風格收進「更多」', topRow === '0|0|1', topRow);
    const touch = await ev(`matchMedia('(pointer: coarse)').matches + '|' + Math.round(document.getElementById('theme-btn').getBoundingClientRect().height)`);
    check('觸控裝置：頂列按鈕放大到至少 36px 高', touch.startsWith('true|') && Number(touch.split('|')[1]) >= 36, touch);
    await ev(`document.getElementById('more-btn').click()`);
    await sleep(200);
    const menu = await ev(`(() => { const m = document.getElementById('more-menu'); const s = document.getElementById('skin-btn').getBoundingClientRect(); return [m.hasAttribute('data-open'), document.getElementById('more-btn').getAttribute('aria-expanded'), s.width > 100 && s.left >= 0 && s.right <= innerWidth].join('|'); })()`);
    check('手機：點「更多」打開選單，換風格按鈕在畫面內', menu === 'true|true|true', menu);
    const skinWas = await ev(`document.documentElement.dataset.skin || 'minimal'`);
    await ev(`document.getElementById('skin-btn').click()`);
    await sleep(300);
    const afterPick = await ev(`(document.documentElement.dataset.skin || 'minimal') + '|' + document.getElementById('more-menu').hasAttribute('data-open')`);
    check('手機：在選單裡換風格會切換並收起選單', afterPick === `${skinWas === 'adventure' ? 'minimal' : 'adventure'}|false`, afterPick);
    await ev(`document.getElementById('more-btn').click()`);
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    check('手機：按 Esc 收起選單', (await ev(`document.getElementById('more-menu').hasAttribute('data-open')`)) === false);
    await ev(`document.getElementById('skin-btn').click()`); // 換回原本的風格
    await sleep(300);
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
    check('三種通知都能選（用量警告、快重置還有剩、額度重置了），預設都開', (await ev(`['push-usage', 'push-reset', 'push-restored'].map((id) => document.getElementById(id)?.checked).join()`)) === 'true,true,true');
    check('推播密碼不存在瀏覽器裡', (await ev(`localStorage.getItem('pushKey')`)) === null);
    const skinBefore = await ev(`document.documentElement.dataset.skin`);
    await key('s');
    check('通知設定開著時不吃快捷鍵', (await ev(`document.documentElement.dataset.skin`)) === skinBefore);
    const d = await ev(`(() => { const b = document.getElementById('push-dialog').getBoundingClientRect(); return [b.left, b.right, innerWidth]; })()`);
    check('手機：通知設定在畫面內', d && d[0] >= 0 && d[1] <= d[2], JSON.stringify(d));
    await ev(`document.getElementById('push-close').click()`);
    check('按「關閉」收起通知設定', (await ev(`document.getElementById('push-dialog').open`)) === false);

    // 離線：排行跟用量一樣經 service worker 存一份（離線時給這份；模擬離線管不到 service worker，所以只檢查有存）
    const cached = await send('Runtime.evaluate', { expression: `(async () => { await navigator.serviceWorker.ready; for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 200)); if (!navigator.serviceWorker.controller) return 'service worker 沒接管頁面'; await fetch('/api/rankings'); let r; for (let i = 0; i < 20 && !r?.ok; i++) { r = await fetch('/api/rankings', { headers: { 'x-cache-only': '1' } }); if (!r.ok) await new Promise((ok) => setTimeout(ok, 100)); } if (!r.ok) return '沒存到'; return r.headers.get('x-from-cache') === '1' && !!(await r.json()).views; })()`, awaitPromise: true, returnByValue: true });
    check('排行經 service worker 存一份，離線時用得到', cached?.result?.value === true, JSON.stringify(cached?.result));

    // SSE 半斷線：連著但什麼都收不到（連 ping 都沒有）超過 3 個 ping 間隔，就自己重連
    sseMode = 'quiet';
    const streamsBefore = streamCount;
    for (const c of sseClients) c.end();
    for (let i = 0; i < 60 && streamCount < streamsBefore + 2; i++) await sleep(250);
    check('SSE 太久沒收到 ping 就自己重連（半斷線偵測）', streamCount >= streamsBefore + 2, `${streamsBefore} → ${streamCount}`);
    sseMode = null;
    await sleep(4000); // 等最後一條安靜的連線也被換成正常的

    // SSE 斷線後重連被拒（503）：瀏覽器不會再重試，要馬上改輪詢，不能停在「連線中…」
    sseMode = 'reject';
    for (const c of sseClients) c.end();
    let conn = '';
    for (let i = 0; i < 40 && conn !== '自動更新'; i++) { await sleep(250); conn = await ev(`document.getElementById('conn-text').textContent`); }
    check('SSE 重連被拒時改用輪詢（右上角「自動更新」）', conn === '自動更新', conn);

    // 切到別的視窗再切回來：伺服器停過，第一次拿到舊數字 → 先標「更新中」，幾秒內自動拿到新的（不必等 30 秒的輪詢或按 F5）
    await ev(`Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange'))`);
    usageMode = 'stale-once';
    await ev(`delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange'))`);
    await sleep(800);
    const claudeCard = `(() => { const c = document.querySelector('.card[data-id="claude"]'); return c.querySelector('.card-status').textContent + '|' + c.querySelector('.card-meta').textContent; })()`;
    const whileWaking = await ev(claudeCard);
    check('切回來時資料比一個週期舊：先標「更新中」', /^更新中/.test(whileWaking), whileWaking);
    await sleep(3000);
    const caughtUp = await ev(claudeCard);
    check('切回來幾秒內自動換成新數字（資料還新，狀態列與資料時間都不寫）', caughtUp === '|' && (await ev(`document.querySelector('.card[data-id="claude"]').classList.contains('updating')`)) === false, caughtUp);

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
