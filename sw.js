const SW_VERSION = '1.0.0';
const STATIC_CACHE = `monopoly-bd-static-${SW_VERSION}`;
const RUNTIME_CACHE = `monopoly-bd-runtime-${SW_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './logo.svg',
  './dice.png',
  './boardeditor.html',
  './test-lab.html',
  './whats-new.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isCacheableRuntimeAsset(url) {
  if (url.origin !== self.location.origin) return false;
  const path = url.pathname.toLowerCase();
  return (
    path.endsWith('.html') ||
    path.endsWith('.css') ||
    path.endsWith('.js') ||
    path.endsWith('.json') ||
    path.endsWith('.png') ||
    path.endsWith('.jpg') ||
    path.endsWith('.jpeg') ||
    path.endsWith('.gif') ||
    path.endsWith('.webp') ||
    path.endsWith('.svg') ||
    path.endsWith('.mp3') ||
    path.endsWith('.wav') ||
    path.endsWith('.ogg')
  );
}

async function handleNavigationRequest(request) {
  const runtimeCache = await caches.open(RUNTIME_CACHE);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      runtimeCache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    const cachedResponse = await runtimeCache.match(request);
    if (cachedResponse) return cachedResponse;
    const fallbackShell = await caches.match('./index.html');
    return fallbackShell || Response.error();
  }
}

async function handleRuntimeAssetRequest(request) {
  const runtimeCache = await caches.open(RUNTIME_CACHE);
  const cachedResponse = await runtimeCache.match(request);

  const networkFetch = fetch(request)
    .then(networkResponse => {
      if (networkResponse && networkResponse.ok) {
        runtimeCache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => null);

  if (cachedResponse) {
    networkFetch.catch(() => null);
    return cachedResponse;
  }

  const networkResponse = await networkFetch;
  return networkResponse || Response.error();
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  const url = new URL(request.url);
  if (!isCacheableRuntimeAsset(url)) return;

  event.respondWith(handleRuntimeAssetRequest(request));
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});