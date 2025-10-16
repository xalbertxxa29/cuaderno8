// initFirebase.js (v51) — Inicializa Firebase (compat), habilita persistencia offline
// y precalienta caché (consultas + imágenes) de forma segura en WebView.

(function () {
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

  const auth    = firebase.auth();
  const db      = firebase.firestore();
  const storage = firebase.storage ? firebase.storage() : null; // puede no estar cargado

  // Justo después de: const auth = firebase.auth();
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(console.warn);

// Opcional (robusto en WebView): reintenta si el WebView tarda en tener storage listo
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !auth.currentUser) {
    // No fuerces logout aquí; Firebase recupera la sesión automáticamente
  }
});

// Importante: No hagas signOut en ningún onAuthStateChanged, only en el botón “Cerrar sesión”.


  // -------------------------------
  // 1) Persistencia offline Firestore
  // -------------------------------
  (async () => {
    try {
      await db.enablePersistence({ synchronizeTabs: true });
      console.log('[Firestore] Persistencia habilitada (multi-tab).');
    } catch (err) {
      // Errores típicos:
      // - failed-precondition: varias pestañas con persistencia a la vez
      // - unimplemented: el navegador no soporta persistencia (p.ej., modo privado)
      const code = err && err.code;
      if (code === 'failed-precondition') {
        console.warn('[Firestore] Persistencia no habilitada: múltiples pestañas con persistencia abierta.');
      } else if (code === 'unimplemented') {
        console.warn('[Firestore] Persistencia no soportada en este navegador/WebView.');
      } else {
        console.warn('[Firestore] Persistencia no disponible:', code, err);
      }
    }
  })();

  // -------------------------------
  // 2) Warm-up de caché
  // -------------------------------
  async function warmFirestoreCache() {
    try {
      // Espera a que haya usuario (si no, no hace nada)
      await new Promise((resolve) => {
        if (auth.currentUser) return resolve();
        const off = auth.onAuthStateChanged(() => { off(); resolve(); });
      });
      if (!auth.currentUser) return;

      const userId = auth.currentUser.email.split('@')[0];

      // Perfil (si hay red intenta server; si no, cache)
      let profSnap = null;
      if (navigator.onLine) {
        profSnap = await db.collection('USUARIOS').doc(userId).get({ source: 'server' }).catch(() => null);
      }
      if (!profSnap) profSnap = await db.collection('USUARIOS').doc(userId).get().catch(() => null);

      if (!profSnap || !profSnap.exists) {
        console.warn('[warm] Sin perfil; no se precalienta.');
        return;
      }

      const { CLIENTE, UNIDAD } = profSnap.data() || {};
      if (!CLIENTE || !UNIDAD) {
        console.warn('[warm] Perfil sin CLIENTE/UNIDAD; no se precalienta.');
        return;
      }

      // Consultas típicas (se resuelven aunque estés offline gracias a la cache)
      const [per, tmp, cuaderno] = await Promise.all([
        db.collection('CONSIGNA_PERMANENTE')
          .where('cliente','==',CLIENTE).where('unidad','==',UNIDAD).limit(50).get().catch(() => ({ forEach: () => {} })),
        db.collection('CONSIGNA_TEMPORAL')
          .where('cliente','==',CLIENTE).where('unidad','==',UNIDAD).limit(50).get().catch(() => ({ forEach: () => {} })),
        db.collection('CUADERNO')
          .where('cliente','==',CLIENTE).where('unidad','==',UNIDAD)
          .orderBy('timestamp','desc').limit(30).get().catch(() => ({ forEach: () => {} })),
      ]);

      // Precarga de imágenes más prudente
      const urls = new Set();
      per.forEach(d => { const x=d.data(); if (x?.fotoURL) urls.add(x.fotoURL); /* NO necesitamos firmas para listar */ });
      tmp.forEach(d => { const x=d.data(); if (x?.fotoURL) urls.add(x.fotoURL); });
      cuaderno.forEach(d => { const x=d.data(); if (x?.fotoURL) urls.add(x.fotoURL); });

      // Limita a 30 imágenes y no bloquea el hilo
      Array.from(urls).slice(0, 30).forEach(u => {
        try { fetch(u, { mode: 'no-cors', cache: 'force-cache' }); } catch {}
      });

      console.log('[warm] Caché de consultas + imágenes lista');
    } catch (e) {
      console.warn('[warm] Error', e);
    }
  }

  // Llamada automática (no hace nada si no hay usuario)
  if (document.readyState === 'complete') warmFirestoreCache();
  else window.addEventListener('load', () => warmFirestoreCache());

  // Exponer por si quieres llamarlo manualmente
  window.warmFirestoreCache = warmFirestoreCache;

  // -------------------------------
  // 3) Service Worker: registrar/actualizar
  // -------------------------------
  if ('serviceWorker' in navigator) {
    // A) Registra si no hay
    navigator.serviceWorker.getRegistration().then(async (reg) => {
      try {
        if (!reg) {
          await navigator.serviceWorker.register('./sw.js');
          reg = await navigator.serviceWorker.getRegistration();
        }
        if (!reg) return;

        // Si ya hay uno esperando, sáltate la espera
        if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING');

        // Detecta SW nuevo e instala
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && reg.waiting) {
              reg.waiting.postMessage('SKIP_WAITING');
            }
          });
        });
      } catch (e) {
        console.warn('[SW] No se pudo registrar/actualizar:', e);
      }
    });

    // B) Recarga automática cuando se active el nuevo SW
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      // En WebView a veces es mejor un pequeño delay
      setTimeout(() => window.location.reload(), 60);
    });
  }

  // -------------------------------
  // 4) Utilidad en consola
  // -------------------------------
  window.fb = { auth, db, storage };
})();
