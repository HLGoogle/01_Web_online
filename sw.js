// 🏷️ 将缓存版本升到 v3，强制刷新之前的策略
const CACHE_NAME = 'terminal-offline-v3'; 
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
            console.log('>> 本地防空洞 v3 正在播种...');
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

// 3. ✨【极致无感核心】：缓存优先 + 后台静默刷新 (Stale-While-Revalidate)
self.addEventListener('fetch', event => {
    const request = event.request;
    const url = request.url;

    // 拦截规则
    const isPageOrCss = request.mode === 'navigate' || url.includes('all.min.css') || url.endsWith('.html');
    const isImage = request.destination === 'image';

    if (isPageOrCss || isImage) {
        event.respondWith(
            // 第一步：不管三七二十一，先去防空洞里找！
            caches.match(request).then(cachedResponse => {
                
                // 第二步：同时在后台悄悄发起网络请求去拿最新版
                const networkFetch = fetch(request).then(networkResponse => {
                    // 拿到最新版后，悄悄更新防空洞里的备用金，保证下次也是最新的
                    if (networkResponse && (networkResponse.status === 200 || networkResponse.status === 0 || networkResponse.type === 'opaque')) {
                        const cacheCopy = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(request, cacheCopy);
                        });
                    }
                    return networkResponse;
                }).catch(() => {
                    // 如果真断网了，这个后台请求会失败，但无所谓，反正前面已经把缓存给用户了
                    console.log('>> [断网状态] 保持使用本地缓存:', url);
                });

                // 第三步（绝杀）：如果防空洞里有货 (cachedResponse)，【立刻、0毫秒】返回给屏幕！
                // 如果是用户第一次访问，防空洞没货，那就乖乖等网络请求 (networkFetch) 返回。
                return cachedResponse || networkFetch;
            })
        );
    }
});
