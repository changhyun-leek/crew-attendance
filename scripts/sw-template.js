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

self.addEventListener('push', (event) => {
  const raw = event.data?.json?.() ?? {}
  const notification = raw.notification ?? raw
  const title = notification.title || '새벽이슬 출석체크 알림'
  event.waitUntil(self.registration.showNotification(title, {
    body: notification.body || '이번 주 출석체크를 부탁드립니다.',
    icon: notification.icon || new URL('pwa-192x192.png', SCOPE_URL).href,
    badge: notification.badge || new URL('pwa-64x64.png', SCOPE_URL).href,
    tag: notification.tag || 'attendance-reminder',
    renotify: true,
    data: { url: notification.navigate || SCOPE_URL },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const destination = event.notification.data?.url || SCOPE_URL
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => client.url.startsWith(SCOPE_URL))
    return existing ? existing.focus().then(() => existing.navigate(destination)) : clients.openWindow(destination)
  }))
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
