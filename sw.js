// 🏷️ 升级到 v5：剔除了破坏视频帧的媒体拦截机制，把视频交还给浏览器原生缓存
const CACHE_NAME = 'terminal-offline-v5'; 
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/code-grid.html',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
];

self.addEventListener('install', event => {
    self.skipWaiting(); 
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('>> 本地防空洞 v5 正在播种...');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.map(key => {
                    if (key !== CACHE_NAME) return caches.delete(key);
                })
            );
        }).then(() => self.clients.claim())
    );
});

// ✨【纯净缓存引擎】：只负责页面架构和静态图片，坚决不碰视频的 206 数据流
self.addEventListener('fetch', event => {
    const request = event.request;
    const url = request.url;

    // 🚀 核心修复：移除了对 video 的劫持！让浏览器原生底层去处理复杂的 MP4 分块传输和缓存。
    const isPageOrCss = request.mode === 'navigate' || url.includes('all.min.css') || url.endsWith('.html');
    const isImage = request.destination === 'image';

    if (isPageOrCss || isImage) {
        event.respondWith(
            caches.match(request).then(cachedResponse => {
                const networkFetch = fetch(request).then(networkResponse => {
                    // 绝不缓存 206，避免破坏文件流
                    if (networkResponse && (networkResponse.status === 200 || networkResponse.status === 0 || networkResponse.type === 'opaque')) {
                        const cacheCopy = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(request, cacheCopy);
                        });
                    }
                    return networkResponse;
                }).catch(() => {
                    console.log('>> [断网状态] 使用本地强缓存:', url);
                });

                return cachedResponse || networkFetch;
            })
        );
    }
});
