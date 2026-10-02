self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', event => {
  let message = {}
  try { message = event.data?.json() ?? {} } catch { message = { body: event.data?.text() } }
  const title = message.title || 'Cali reminder'
  event.waitUntil(self.registration.showNotification(title, {
    body: message.body || 'You have an upcoming schedule item.',
    icon: '/icons/cali-192.png',
    badge: '/icons/cali-192.png',
    tag: message.tag || 'cali-reminder',
    renotify: true,
    data: { url: message.url || '/calendar' },
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/calendar', self.location.origin).href
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    for (const client of clients) {
      if ('navigate' in client) await client.navigate(target)
      if ('focus' in client) return client.focus()
    }
    return self.clients.openWindow(target)
  }))
})

const OCR_CACHE = 'cali-ocr-v1'
const OCR_ASSET_PREFIX = '/ocr/v1/'

const offlinePage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#F6FCFF"><title>You're offline | Cali</title>
<style>*{box-sizing:border-box}body{margin:0;display:grid;min-height:100svh;place-items:center;padding:20px;background:#f6fcff;color:#173247;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(100%,500px);padding:42px 30px;border:1px solid #d7e5f3;border-radius:24px;background:#fff;box-shadow:0 24px 65px #12384d12;text-align:center}.icon{display:grid;place-items:center;width:70px;height:70px;margin:auto;border-radius:21px;background:#eaf7fc;color:#189ad3}.icon svg{width:34px}.label{margin:22px 0 0;color:#189ad3;font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}h1{margin:10px 0 0;font-size:clamp(32px,8vw,40px);letter-spacing:-.04em}p{margin:13px auto 0;max-width:370px;color:#526579;font-size:14px;line-height:1.7}button{width:100%;min-height:49px;margin-top:28px;border:0;border-radius:12px;background:#0758b8;color:#fff;font:700 14px system-ui;cursor:pointer}@media(prefers-color-scheme:dark){body{background:#0c202b;color:#eaf6fb}.card{border-color:#294958;background:#102a37}.icon{background:#173b4b}p{color:#a9c2ce}}</style></head>
<body><main class="card"><div class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m3 3 18 18M8.5 8.7A8.8 8.8 0 0 1 12 8c3.6 0 6.7 2.1 8.2 5M5 12.8c.3-.4.7-.8 1.1-1.1M9 16.5a4.6 4.6 0 0 1 6 0M12 20h.01"/></svg></div><div class="label">Connection unavailable</div><h1>You're offline.</h1><p>Cali needs an internet connection to load your workspace and save changes. Reconnect, then try again.</p><button onclick="location.reload()">Try again</button></main></body></html>`

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method === 'GET' && url.origin === self.location.origin && url.pathname.startsWith(OCR_ASSET_PREFIX)) {
    event.respondWith(caches.open(OCR_CACHE).then(async cache => {
      const cached = await cache.match(event.request)
      if (cached) return cached
      const response = await fetch(event.request)
      if (response.ok) await cache.put(event.request, response.clone())
      return response
    }))
    return
  }
  if (event.request.mode !== 'navigate') return
  event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => new Response(offlinePage, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })))
})

// Only immutable, versioned OCR runtime/model files are cached. Application
// files, API data, registration images, and OCR results are never cached here.
