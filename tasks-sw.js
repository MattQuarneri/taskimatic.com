// Bump this version whenever index.html or one of its dependencies changes.
// A new worker waits for existing tabs to close before switching the whole shell.
const CACHE_PREFIX = 'taskimatic-tasks-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v3`;
const SHELL_ASSETS = [
    './index.html',
    './webcomp/backuptracker.js',
    './webcomp/searcher-element.js',
    './webcomp/session-times.js',
    './js/task-planning-model.js',
    './js/task-table-model.js',
    './tasks.webmanifest',
    './favicon.ico',
    './favicon-16x16.png',
    './favicon-32x32.png',
    './apple-touch-icon.png',
    './android-icon-144x144.png',
    './android-icon-192x192.png',
    './android-icon-512x512.png'
].map(path => new URL(path, self.location.href).href);
const SHELL_URLS = new Set(SHELL_ASSETS);
const PAGE_URL = new URL('./index.html', self.location.href).href;

self.addEventListener('install', event => {
    // addAll is atomic: a failed download never activates an incomplete shell.
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(
        SHELL_ASSETS.map(url => new Request(url, { cache: 'reload' }))
    )));
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
            .map(name => caches.delete(name)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    // Only the task shell is cached; other pages, APIs and external links pass through.
    url.search = '';
    url.hash = '';
    if (!SHELL_URLS.has(url.href)) return;
    // Queries are ignored only for page navigation, never for scripts or other assets.
    const cacheKey = event.request.mode === 'navigate' && url.href === PAGE_URL
        ? PAGE_URL : event.request.url;
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(cacheKey)) || fetch(event.request);
    })());
});
