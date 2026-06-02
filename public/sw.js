const CACHE = 'resqnet-v1'
const ASSETS = [
  '/',
  '/index.html',
  '/reporter.html',
  '/coordinator.html',
  '/style.css',
  '/config.js',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json'
]

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  // Only handle GET requests
  if (e.request.method !== 'GET') return

  // Don't intercept Firebase / Google API calls — always fresh
  const url = new URL(e.request.url)
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('nominatim.openstreetmap.org') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('cdn.tailwindcss.com')
  ) {
    return
  }

  e.respondWith(
    caches.match(e.request)
      .then(r => r || fetch(e.request).then(response => {
        // Cache new successful GET responses for static assets
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone()
          caches.open(CACHE).then(cache => cache.put(e.request, clone))
        }
        return response
      }))
      .catch(() => {
        // Offline fallback: return index.html for navigation requests
        if (e.request.mode === 'navigate') {
          return caches.match('/index.html')
        }
      })
  )
})
