const CACHE_NAME = 'saebyeokiseul-shell-__BUILD_VERSION__'
const SCOPE_URL = self.registration.scope
const APP_SHELL = [
  SCOPE_URL,
  new URL('manifest.webmanifest', SCOPE_URL).href,
  new URL('pwa-192x192.png', SCOPE_URL).href,
  new URL('pwa-512x512.png', SCOPE_URL).href,
  new URL('apple-touch-icon-180x180.png', SCOPE_URL).href,
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('saebyeokiseul-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL(SCOPE_URL).pathname)) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(SCOPE_URL, response.clone()))
          return response
        })
        .catch(async () => (await caches.match(request)) || (await caches.match(SCOPE_URL)) || Response.error()),
    )
    return
  }

  if (['script', 'style', 'image', 'font', 'manifest'].includes(request.destination)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()))
        return response
      })),
    )
  }
})
