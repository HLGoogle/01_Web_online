// 🏷️ 升级到 v4，触发浏览器强制换掉旧的拦截策略
const CACHE_NAME = 'terminal-offline-v4'; 
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/code-grid.html',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
];

// 1. 【安装阶段】：强制立即接管
self.addEventListener('install', event => {
    self.skipWaiting(); 
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('>> 本地防空洞 v4 (支持视频流) 正在播种...');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

// 2. 【清理阶段】：自动销毁旧版本缓存释放空间
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

// 3. ✨【极致无感核心】：SWR策略 + MP4视频流缓存
self.addEventListener('fetch', event => {
    const request = event.request;
    const url = request.url;

    // 🚀 核心更新：新增对 video 标签发起的请求的拦截！
    const isPageOrCss = request.mode === 'navigate' || url.includes('all.min.css') || url.endsWith('.html');
    const isMedia = request.destination === 'image' || request.destination === 'video';

    if (isPageOrCss || isMedia) {
        event.respondWith(
            caches.match(request).then(cachedResponse => {
                
                const networkFetch = fetch(request).then(networkResponse => {
                    // 🚀 允许状态码 200(普通), 0(跨域不透明), 206(视频断点续传/切片) 安全入库
                    if (networkResponse && (networkResponse.status === 200 || networkResponse.status === 206 || networkResponse.status === 0 || networkResponse.type === 'opaque')) {
                        const cacheCopy = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(request, cacheCopy);
                        });
                    }
                    return networkResponse;
                }).catch(() => {
                    console.log('>> [断网状态] 保持使用本地离线图像/视频:', url);
                });

                // 一旦防空洞有货立刻给屏幕，同时后台(networkFetch)悄悄更新。
                return cachedResponse || networkFetch;
            })
        );
    }
});
