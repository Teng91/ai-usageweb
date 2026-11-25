// 快取名稱帶版本號；改了前端檔案就把版本 +1
const CACHE = 'app-v35';
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
  '/ui/effects.js',
  '/ui/rankings.js',
  '/ui/theme-toggle.js',
  '/ui/pwa.js',
  '/ui/push.js',
  '/scene.js',
  '/scene-maps.js',
  '/scene.css',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/pixel/cloud.svg',
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
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];
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
    badge: '/icons/icon-192.png',
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

  // SSE、推播與管理 API 完全不經過 service worker
  if (url.pathname === '/api/stream' || url.pathname === '/api/rankings' || url.pathname.startsWith('/api/push/') || url.pathname.startsWith('/admin/') || url.pathname === '/healthz') return;

  if (url.pathname === '/api/usage') {
    event.respondWith(networkFirstUsage(req));
    return;
  }

  event.respondWith(cacheFirst(req));
});

async function networkFirstUsage(req) {
  const cache = await caches.open(API_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put('/api/usage', res.clone());
    return res;
  } catch {
    const cached = await cache.match('/api/usage');
    if (!cached) return new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    // 標記為快取，前端顯示「離線」
    const headers = new Headers(cached.headers);
    headers.set('x-from-cache', '1');
    return new Response(await cached.blob(), { status: 200, headers });
  }
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
