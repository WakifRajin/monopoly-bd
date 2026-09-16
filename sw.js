// Bump this on every deploy. Caches are keyed by it, and activate() deletes the
// old ones — without a bump, returning players keep running cached scripts and
// can end up on a mixed set of old and new files.
const SW_VERSION = '1.2.0';
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

// Code and markup must be network-first. The online rules are versioned against
// the client build, so serving a stale script from cache locks the player out of
// rooms entirely; the cache is only an offline fallback for these.
function isCodeAsset(url) {
  const path = url.pathname.toLowerCase();
  return (
    path.endsWith('.html') ||
    path.endsWith('.css') ||
    path.endsWith('.js') ||
    path.endsWith('.json')
  );
}

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
    const networkResponse = await fetch(request, { cache: 'no-cache' });
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

// Network-first: always try the deployed file, fall back to cache only offline.
// `cache: 'no-cache'` matters - a plain fetch() is served by the browser's HTTP
// cache, which would make "network-first" fetch a stale file and defeat itself.
async function handleCodeAssetRequest(request) {
  const runtimeCache = await caches.open(RUNTIME_CACHE);
  try {
    const networkResponse = await fetch(request.url, { cache: 'no-cache' });
    if (networkResponse && networkResponse.ok) {
      runtimeCache.put(request, networkResponse.clone());
      return networkResponse;
    }
    const cachedResponse = await runtimeCache.match(request);
    return cachedResponse || networkResponse;
  } catch (error) {
    const cachedResponse = await runtimeCache.match(request);
    return cachedResponse || Response.error();
  }
}

// Cache-first, for immutable media only.
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

  if (isCodeAsset(url)) {
    event.respondWith(handleCodeAssetRequest(request));
    return;
  }

  event.respondWith(handleRuntimeAssetRequest(request));
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});