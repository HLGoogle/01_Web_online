// 🏷️ 定义本地防空洞的存储版本和需要死死锁在本地的网页资产框架
const CACHE_NAME = 'terminal-offline-v1';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/code-grid.html',
    // 💡 自动把原本会严重卡网速的远程 Font-Awesome 图标线也强行抓到本地盒子里缓存！
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
];

// 1. 【安装激活阶段】：有网时，强行把所有页面框架和图标样式全量塞进浏览器本地防空洞
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('>> 本地防空洞正在播种静态页面框架资产...');
            return cache.addAll(ASSETS_TO_CACHE);
        }).then(() => self.skipWaiting())
    );
});

// 2. 【清理阶段】：自动对齐老旧的残留缓存
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

// 3. ✨【硬核拦截核心】：网络首选。如果因为跨境网络连不上，0秒切回本地强缓存吐出画面！
self.addEventListener('fetch', event => {
    // 只针对常规页面、静态图标和网页本身进行本地拦截劫持，不锁死你的 /api/ 数据接口
    if (event.request.mode === 'navigate' || event.request.url.includes('all.min.css') || event.request.url.endsWith('.html')) {
        event.respondWith(
            fetch(event.request)
                .then(networkResponse => {
                    // 情况 A：外网连通了（哪怕有延迟），正常加载并顺手静默刷新本地防空洞的备份
                    if (networkResponse.status === 200) {
                        const cacheCopy = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, cacheCopy));
                    }
                    return networkResponse;
                })
                .catch(() => {
                    // 🚨 情况 B：在大陆彻底断网，或者由于访问海外 Cloudflare 延迟太高直接抛错超时
                    // 0感知熔断网络！直接从本地防空洞里把缓存的 index.html 或 code-grid.html 原封不动吐给屏幕
                    console.log('>> [跨境联网失败/高延迟拦截] 正在无缝从本地强缓存中提取纯本地离线框架...秒开画面。');
                    return caches.match(event.request);
                })
        );
    }
});
