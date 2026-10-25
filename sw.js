/* 高中地理智能化教学工作台 — Service Worker
 * 离线缓存策略：
 *  - 核心文件（index.html / manifest / 图标）安装时预缓存
 *  - 同源静态资源（html/css/js/jpg/png/json/swf）：cache-first + 运行时缓存
 *  - 跨域资源（天地图瓦片、Esri 影像等）：放行，由浏览器联网处理（地图本需联网）
 *  - 导航请求离线时回退到已缓存的 index.html，保证应用可离线启动
 */
const CACHE = 'geo-workbench-v1';
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 跨域资源（天地图瓦片、Esri 等）不拦截，依赖联网
  if (url.origin !== self.location.origin) return;

  // 页面导航：网络优先，离线回退到缓存首页
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match('./index.html').then(r => r || caches.match('./'))
      )
    );
    return;
  }

  // 同源静态资源：cache-first，缺失则网络拉取并缓存
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
