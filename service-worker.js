const CACHE_NAME = 'maxer-v10';
const APP_SHELL = [
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/manifest.webmanifest',
  '/favicon-64.png',
  '/icon-64.png',
  '/icon-180.png',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Red-primero para el shell de la app (html, css, js): siempre la última versión
// cuando hay conexión; cae a la caché si no hay red. Así las actualizaciones se
// propagan solas sin tener que limpiar caché a mano.
function networkFirst(request, fallbackKey) {
  return fetch(request)
    .then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(fallbackKey || request, copy));
      return response;
    })
    .catch(() => caches.match(fallbackKey || request).then(c => c || caches.match('/index.html')));
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const request = event.request;
  const url = new URL(request.url);
  const acceptsHtml = request.headers.get('accept')?.includes('text/html');
  const isShell = url.origin === self.location.origin &&
    (url.pathname.startsWith('/css/') || url.pathname.startsWith('/js/'));

  // Navegación (HTML) → red-primero, cae a /index.html cacheado
  if (request.mode === 'navigate' || acceptsHtml) {
    event.respondWith(networkFirst(request, '/index.html'));
    return;
  }

  // CSS y JS de la app → red-primero (siempre frescos online)
  if (isShell) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Resto (iconos, fuentes, manifest) → caché-primero (rara vez cambian)
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        return response;
      });
    })
  );
});
