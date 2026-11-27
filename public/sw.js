// 快取名稱帶版本號；改了前端檔案就把版本 +1
const CACHE = 'app-v55';
const SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/theme.js',
  '/skin-adventure.css',
  '/app.js',
  '/ui/dom.js',
  '/ui/format.js',
  '/ui/cards.js',
  '/ui/windows.js',
  '/ui/effects.js',
  '/ui/rankings.js',
  '/ui/theme-toggle.js',
  '/ui/pwa.js',
  '/ui/push.js',
  '/ui/menu.js',
  '/scene.js',
  '/scene-maps.js',
  '/scene.css',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/pixel/cloud-soft.svg',
  '/pixel/grass.svg',
  '/pixel/hero.svg',
  '/pixel/house.svg',
  '/pixel/mountains.svg',
  '/pixel/slime.svg',
  '/pixel/slime-pink.svg',
  '/pixel/tree.svg',
  '/pixel/tree-blossom.svg',
  '/pixel/tree-maple.svg',
  '/pixel/tree-gold.svg',
  '/pixel/grass-autumn.svg',
  '/pixel/platform-autumn.svg',
  '/pixel/leafling.svg',
  '/pixel/chick.svg',
  '/pixel/cloudling.svg',
  '/pixel/crab.svg',
  '/pixel/sporeling.svg',
  '/pixel/dewdrop.svg',
  '/pixel/portal.svg',
  '/pixel/platform-grass.svg',
  '/pixel/platform-snow.svg',
  '/pixel/platform-wood.svg',
  '/pixel/ladder.svg',
  '/pixel/palm.svg',
  '/pixel/boat.svg',
  '/pixel/dock.svg',
  '/pixel/sea.svg',
  '/pixel/sand.svg',
  '/pixel/snow.svg',
  '/pixel/pine.svg',
  '/pixel/snowman.svg',
  '/pixel/hills-far-spring.svg',
  '/pixel/hills-near-spring.svg',
  '/pixel/hills-far-summer.svg',
  '/pixel/hills-far-autumn.svg',
  '/pixel/hills-near-autumn.svg',
  '/pixel/hills-far-winter.svg',
  '/pixel/island.svg',
  '/pixel/island-autumn.svg',
  '/pixel/island-snow.svg',
  '/pixel/rainbow.svg',
  '/pixel/moon.svg',
  '/pixel/town-spring.svg',
  '/pixel/town-lights-spring.svg',
  '/pixel/town-autumn.svg',
  '/pixel/town-lights-autumn.svg',
  '/pixel/town-winter.svg',
  '/pixel/town-lights-winter.svg',
  '/pixel/hills-near-winter.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];
// 上次的 /api/usage、/api/rankings；名稱只在這裡，前端要讀就帶 x-cache-only 標頭來問
const API_CACHE = 'api-last';

self.addEventListener('install', (event) => {
  // cache: 'reload' 跳過瀏覽器的 HTTP 快取，確保新版本拿到的是新檔案
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE && k !== API_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// ---- 推播 ----
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(d.title || 'AI 用量', {
    body: d.body || '',
    tag: d.tag || 'usage', // 同一類的新通知蓋掉舊的
    renotify: true,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png', // Android 通知列只看輪廓：要白色圖形＋透明背景（scripts/gen-badge.mjs 產生）
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (win) return win.focus();
    return self.clients.openWindow(target);
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // SSE、推播與管理 API 完全不經過 service worker（/api/usage、/api/rankings 走下面的 network-first）
  if (url.pathname === '/api/stream' || url.pathname.startsWith('/api/push/') || url.pathname.startsWith('/admin/') || url.pathname === '/healthz') return;

  // 用量與排行：先問伺服器，失敗（離線）才用上次存下的；帶 x-cache-only 的只看上次存下的（開頁先畫舊數字用）
  if (url.pathname === '/api/usage' || url.pathname === '/api/rankings') {
    event.respondWith(req.headers.get('x-cache-only') ? fromApiCache(url.pathname) : networkFirst(event, req, url.pathname));
    return;
  }

  event.respondWith(cacheFirst(req));
});

async function networkFirst(event, req, key) {
  try {
    const res = await fetch(req);
    // 寫快取放進 waitUntil：回應先給頁面，service worker 也不會在寫完前被停掉
    if (res.ok) {
      const copy = res.clone();
      event.waitUntil(caches.open(API_CACHE).then((c) => c.put(key, copy)));
    }
    return res;
  } catch {
    return fromApiCache(key);
  }
}

/** 上次存下的回應，標上 x-from-cache（前端顯示「離線」）；沒有就 503 */
async function fromApiCache(key) {
  const cached = await (await caches.open(API_CACHE)).match(key);
  if (!cached) return new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  const headers = new Headers(cached.headers);
  headers.set('x-from-cache', '1');
  return new Response(await cached.blob(), { status: 200, headers });
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const url = new URL(req.url);
  const key = req.mode === 'navigate' ? '/' : url.pathname;
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok && SHELL.includes(url.pathname)) cache.put(key, res.clone());
    return res;
  } catch {
    return (await cache.match('/')) || Response.error();
  }
}
