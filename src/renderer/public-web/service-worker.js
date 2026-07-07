/**
 * Snakie web build service worker (epic #267 Phase W1) — app-shell cache-first
 * + runtime stale-while-revalidate, so the classroom PWA installs offline-
 * capable on Chromebooks. Hand-rolled (no `vite-plugin-pwa` dependency): Vite
 * content-hashes everything under `/assets/`, so those responses are safe to
 * cache indefinitely (cache-first); the HTML entry and other same-origin
 * requests use stale-while-revalidate so a redeploy is picked up on the next
 * visit without ever leaving the user with nothing while offline.
 *
 * Bump CACHE_VERSION when this file's caching *strategy* changes (not for
 * every app release — hashed asset URLs already bust their own cache entries).
 */
const CACHE_VERSION = 'v1'
const CACHE_NAME = `snakie-${CACHE_VERSION}`

self.addEventListener('install', (event) => {
  // Take over immediately; don't wait for old tabs to close.
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      )
      await self.clients.claim()
    })()
  )
})

/** Vite's content-hashed build output — immutable, safe to cache forever. */
function isHashedAsset(url) {
  return url.pathname.startsWith('/assets/')
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(request))
  } else {
    event.respondWith(staleWhileRevalidate(request))
  }
})

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) cache.put(request, response.clone())
  return response
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)
  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone())
      return response
    })
    .catch(() => undefined)
  return cached ?? (await networkPromise) ?? Response.error()
}
