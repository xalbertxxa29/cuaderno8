/* sw.js (v51)
   Estrategias:
   - HTML (navegación): network-first con fallback a caché (mejor frescura).
   - JS/CSS/Workers: stale-while-revalidate (rápido + actualización en bg).
   - Imágenes/Fonts: cache-first.
   - NO cachea métodos ≠ GET. Evita interceptar Firebase/Google (Auth/FS/Storage).
   - Precarga de páginas/JS/CSS críticos. Limpieza de versiones viejas.
   - Skip waiting + clients.claim + helper con timeout para navegaciones.
*/

const SW_VERSION = 'v51';
const PRECACHE   = `precache-${SW_VERSION}`;
const RUNTIME    = `runtime-${SW_VERSION}`;

/* ==== Precarga (ajusta si agregas/quitas archivos) ==== */
const PRECACHE_URLS = [
  // Páginas principales
  './',
  './index.html',
  './menu.html',
  './ingresar_informacion.html',
  './registrar_incidente.html',
  './ver_consignas.html',
  './registros.html',
  './ingresar_consigna.html',
  './consigna_permanente.html',
  './consigna_temporal.html',
  './peatonal.html?v=51',
  './salida.html?v=51',

  // Altas rápidas (iframes)
  './add_cliente_unidad.html',
  './add_unidad.html',
  './add_puesto.html',

  // CSS (mantén versiones coordinadas)
  './style.css?v=54',
  './webview.css?v=54',

  // JS propios (coordina todos a v51 en los HTML)
  './firebase-config.js?v=51',
  './initFirebase.js?v=51',
  './auth.js?v=55',
  './menu.js?v=53a',
  './ui.js?v=51',
  './webview.js?v=51',
  './offline-queue.js?v=51',
  './sync.js?v=51',
  '/.peatonal.js?v=51',
  './salida.js?v=51',

  './ingresar_informacion.js?v=51',
  './registrar_incidente.js?v=59',
  './ver_consignas.js?v=51',
  './registros.js?v=51',
  './consigna_permanente.js?v=51',
  './consigna_temporal.js?v=51',

  // PWA
  './manifest.json',
  './imagenes/logo_192.png',
  './imagenes/logo_512.png',

  // Librerías externas críticas
  'https://www.gstatic.com/firebasejs/10.9.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.9.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.9.0/firebase-storage-compat.js',
  'https://cdn.jsdelivr.net/npm/browser-image-compression@2.0.2/dist/browser-image-compression.js',
  'https://cdn.jsdelivr.net/npm/signature_pad@4.0.0/dist/signature_pad.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.2.0/css/all.min.css',
];

/* ================== Helpers ================== */
const isHTMLNavigation = (req) =>
  req.mode === 'navigate' ||
  (req.method === 'GET' && (req.headers.get('accept') || '').includes('text/html'));

const isImageOrFont = (req) => {
  const u = new URL(req.url);
  return (
    /\.(png|jpe?g|webp|gif|svg|ico|avif|bmp|ttf|otf|woff2?)$/i.test(u.pathname) ||
    u.hostname.endsWith('googleusercontent.com') ||
    u.hostname.includes('firebasestorage.googleapis.com')
  );
};

const canCache = (req) =>
  req.method === 'GET' && (req.url.startsWith('http://') || req.url.startsWith('https://'));

const isFirebaseOrGoogle = (url) => {
  const h = url.hostname;
  return (
    h.includes('googleapis.com') ||
    h.includes('gstatic.com') ||
    h.includes('firebaseio.com') ||
    h.includes('googlesyndication.com')
  );
};

// fetch con timeout (navegaciones)
const fetchWithTimeout = (req, ms = 8000) => {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(req, { signal: ctrl.signal, credentials: 'same-origin' })
    .finally(() => clearTimeout(id));
};

/* ================== Install / Activate ================== */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (![PRECACHE, RUNTIME].includes(k)) return caches.delete(k);
    }));
    await self.clients.claim();
  })());
});

/* ================== Fetch ================== */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Métodos no-GET: no interceptar
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Dejar pasar Firebase/Google (Auth/Firestore/Storage/CDN)
  if (isFirebaseOrGoogle(url)) return;

  // Navegación HTML → network-first
  if (isHTMLNavigation(request)) {
    event.respondWith((async () => {
      const precache = await caches.open(PRECACHE);
      try {
        const fresh = await fetchWithTimeout(request, 8000);
        if (canCache(request)) precache.put(request, fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        const match = await precache.match(request, { ignoreSearch: true });
        if (match) return match;
        return (await precache.match('./menu.html')) ||
               (await precache.match('./index.html')) ||
               Response.error();
      }
    })());
    return;
  }

  // Imágenes/Fonts → cache-first
  if (isImageOrFont(request)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const resp = await fetch(request);
        if (canCache(request)) cache.put(request, resp.clone()).catch(() => {});
        return resp;
      } catch {
        return cached || Response.error();
      }
    })());
    return;
  }

  // JS/CSS/Workers → stale-while-revalidate
  if (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'worker' ||
    request.url.endsWith('.js') ||
    request.url.endsWith('.css')
  ) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(request);
      const networkPromise = fetch(request).then((resp) => {
        if (canCache(request)) cache.put(request, resp.clone()).catch(() => {});
        return resp;
      }).catch(() => null);
      return cached || networkPromise || fetch(request).catch(() => cached || Response.error());
    })());
    return;
  }

  // Otros GET → network con fallback a caché
  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME);
    try {
      const resp = await fetch(request);
      if (canCache(request)) cache.put(request, resp.clone()).catch(() => {});
      return resp;
    } catch {
      const match = await cache.match(request);
      return match || Response.error();
    }
  })());
});

/* ================== Mensajes ================== */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
