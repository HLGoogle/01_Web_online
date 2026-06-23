// 🏷️ 定义本地脱机离线缓存的存储版本和需要死死锁在本地的网页资产框架，非常重要
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
    const url = event.request.url;
    const request = event.request;

    // 拦截规则 1：原有的页面导航、HTML框架、CSS图标
    const isPageOrCss = request.mode === 'navigate' || url.includes('all.min.css') || url.endsWith('.html');
    
    // 拦截规则 2：【核心修复】只精准拦截“作为图片(缩略图)”渲染的浏览器请求！
    // 这样既能缓存网盘里的动态缩略图，又绝对不会误把大文件下载等数据流塞入存储，防止内存溢出。
    const isImage = request.destination === 'image';

    if (isPageOrCss || isImage) {
        event.respondWith(
            fetch(request)
                .then(networkResponse => {
                    // 情况 A：外网连通了（哪怕有延迟），正常加载并顺手静默刷新本地防空洞的备份
                    if (networkResponse && networkResponse.status === 200) {
                        const cacheCopy = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(request, cacheCopy);
                        });
                    }
                    return networkResponse;
                })
                .catch(() => {
                    // 🚨 情况 B：彻底断网，或者由于延迟太高直接抛错超时
                    // 0感知熔断网络！直接从本地防空洞里把缓存的资源原封不动吐给屏幕
                    console.log('>> [断网/高延迟拦截] 正在无缝从本地强缓存中提取资源:', url);
                    return caches.match(request);
                })
        );
    }
});
