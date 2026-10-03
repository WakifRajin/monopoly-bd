// Bump this on every deploy. Caches are keyed by it, and activate() deletes the
// old ones — without a bump, returning players keep running cached scripts and
// can end up on a mixed set of old and new files.
const SW_VERSION = '1.8.3';
const STATIC_CACHE = `monopoly-bd-static-${SW_VERSION}`;
const RUNTIME_CACHE = `monopoly-bd-runtime-${SW_VERSION}`;

// Everything a first visit needs to play offline afterwards. Code is listed
// with the same ?v= stamp the page uses, so the offline copy is this version.
const withVersion = path => `${path}?v=${SW_VERSION}`;
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './logo.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon-32.png',
  './images/home-bg.webp',
  './images/home-bg-small.webp',
  withVersion('./styles/main.css'),
  withVersion('./styles/menu.css'),
  withVersion('./styles/standalone.css'),
  withVersion('./scripts/core-online-theme-lobby.js'),
  withVersion('./scripts/board-render-ai.js'),
  withVersion('./scripts/gameplay-actions.js'),
  withVersion('./scripts/ui-systems.js'),
  withVersion('./scripts/game-feel.js'),
  withVersion('./scripts/game-options.js'),
  withVersion('./scripts/app-shell.js'),
  withVersion('./scripts/save-game.js'),
  withVersion('./scripts/i18n-bn.js'),
  withVersion('./scripts/i18n.js'),
  withVersion('./scripts/lan.js'),
  withVersion('./scripts/init.js'),
  withVersion('./scripts/consent.js'),
  withVersion('./scripts/board3d.min.js'),
  './sounds/dice_roll_sfx.mp3',
  './sounds/clicktap_sfx.mp3',
  './sounds/win_sfx.mp3',
  './sounds/game_over_sfx.mp3',
  './sounds/inability_sfx.mp3',
  './boardeditor.html',
  './whats-new.html'
];
// Google Fonts, kept after the first visit so text looks the same offline.
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
  );
  // No skipWaiting() here: a page that is open keeps the worker (and caches)
  // it started with, so a match in progress never loses its offline copy.
  // The page offers a reload and then asks this worker to take over
  // (SKIP_WAITING below). With no page open, the new worker starts as usual.
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
    // Offline: prefer this exact version, else any cached version of the file.
    const cachedResponse =
      (await runtimeCache.match(request)) ||
      (await runtimeCache.match(request, { ignoreSearch: true })) ||
      (await caches.match(request, { ignoreSearch: true }));
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

  const requestUrl = new URL(request.url);
  if (FONT_HOSTS.includes(requestUrl.hostname)) {
    event.respondWith(handleRuntimeAssetRequest(request));
    return;
  }

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