/* 庖丁 Service Worker —— 应用外壳网络优先(可更新) + 已解析菜谱离线可用 */
const VER = 'paoding-v3';
const SHELL = [
  './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VER).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VER).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// 网络优先：拿到新版就用新版并回填缓存；断网才回退缓存（离线可用）
function networkFirst(req, fallback) {
  return fetch(req).then((res) => {
    if (res && res.ok) {
      if (new URL(req.url).origin === location.origin) { const cp = res.clone(); caches.open(VER).then((c) => c.put(req, cp)); }
      return res;
    }
    // 服务端 4xx/5xx：优先回退到缓存的可用外壳，实在没有才把错误响应交出去
    return caches.match(req).then((m) => m || (fallback ? caches.match(fallback).then((f) => f || res) : res));
  }).catch(() => caches.match(req).then((m) => m || (fallback ? caches.match(fallback) : undefined)));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/progress/')) return; // SSE 不拦
  if (url.pathname.startsWith('/api/') && url.pathname !== '/api/recipes') return; // AI 调用直连
  if (url.pathname === '/api/recipes') { e.respondWith(networkFirst(req)); return; }
  // 应用外壳与同源资源：网络优先，离线回退缓存/首页
  e.respondWith(networkFirst(req, './index.html'));
});
