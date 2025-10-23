/* sw.js (v61)
   Estrategias:
   - HTML (navigate): network-first con timeout + navigationPreload + fallback a caché (ignoreSearch).
   - JS/CSS/Workers: stale-while-revalidate.
   - Imágenes/Fonts: cache-first.
   - No intercepta métodos ≠ GET. Evita Firebase/Google (Auth/FS/Storage/CDN).
   - Precarga de locales críticos + limpieza de versiones viejas.
   - skipWaiting + clients.claim + autorefresh suave.
*/

const SW_VERSION = 'v61';
const PRECACHE   = `precache-${SW_VERSION}`;
const RUNTIME    = `runtime-${SW_VERSION}`;

/* ==== Precarga local (ajusta si cambias ?v=) ==== */
const PRECACHE_URLS = [
  // Páginas
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
  './peatonal.html?v=60',
  './salida.html?v=60',

  // Altas rápidas
  './add_cliente_unidad.html',
  './add_unidad.html',
  './add_puesto.html',

  // CSS locales
  './style.css?v=60',
  './webview.css?v=60',

  // JS locales
  './firebase-config.js?v=60',
  './initFirebase.js?v=60',
  './auth.js?v=56',                 // <- usa la versión real que tienes en producción
  './menu.js?v=53a',                // si actualizas, sincroniza aquí
  './ui.js?v=60',
  './webview.js?v=60',
  './offline-queue.js?v=60',
  './sync.js?v=60',
  './peatonal.js?v=60',
  './salida.js?v=60',
  './ingresar_informacion.js?v=60',
  './registrar_incidente.js?v=60',  // sincroniza con tu HTML
  './ver_consignas.js?v=60',
  './registros.js?v=60',
  './consigna_permanente.js?v=60',
  './consigna_temporal.js?v=60',

  // PWA
  './manifest.json',
  './imagenes/logo_192.png',
  './imagenes/logo_512.png',
];

/* ========= Helpers ========= */
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
    h.includes('firebasestorage.googleapis.com') ||
    h.includes('googlesyndication.com') ||
    h.includes('googleusercontent.com')
  );
};

// fetch con timeout (para navegaciones)
const fetchWithTimeout = (req, ms = 8000) => {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(req, { signal: ctrl.signal, credentials: 'same-origin' })
    .finally(() => clearTimeout(id));
};

/* ========= Install ========= */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(PRECACHE);
      await cache.addAll(PRECACHE_URLS);
    } catch (e) {
      // Precarga best-effort (puede fallar en primer arranque sin red)
    } finally {
      await self.skipWaiting();
    }
  })());
});

/* ========= Activate ========= */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Navigation Preload para acelerar navigate si hay conexión
    if ('navigationPreload' in self.registration) {
      try { await self.registration.navigationPreload.enable(); } catch {}
    }
    // Limpieza de caches viejos
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (![PRECACHE, RUNTIME].includes(k)) return caches.delete(k);
    }));
    await self.clients.claim();
  })());
});

/* ========= Fetch ========= */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Métodos no-GET o esquemas no HTTP: no interceptar
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!['http:', 'https:'].includes(url.protocol)) return;

  // Dejar pasar Firebase/Google/CDN
  if (isFirebaseOrGoogle(url)) return;

  // Navegación HTML → network-first (+preload) con fallback a caché
  if (isHTMLNavigation(request)) {
    event.respondWith((async () => {
      const precache = await caches.open(PRECACHE);
      // 1) Usa navigationPreload si está disponible
      try {
        const preload = event.preloadResponse ? await event.preloadResponse : null;
        if (preload) {
          if (canCache(request)) precache.put(request, preload.clone()).catch(() => {});
          return preload;
        }
      } catch {}
      // 2) Network con timeout
      try {
        const fresh = await fetchWithTimeout(request, 8000);
        if (canCache(request)) precache.put(request, fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        // 3) Fallback ignorando querystring
        const match = await precache.match(request, { ignoreSearch: true });
        if (match) return match;
        // 4) Fallbacks amistosos
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
    request.destination === 'style'  ||
    request.destination === 'worker' ||
    request.url.endsWith('.js')      ||
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

/* ========= Mensajes ========= */
self.addEventListener('message', async (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data === 'CLEAR_CACHE') {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
  }
});
