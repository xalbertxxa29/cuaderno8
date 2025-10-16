// sync.js — Reintenta subidas pendientes al volver la conexión (fotos/firmas)
(function () {
  if (!('OfflineQueue' in window)) return;

  function dataURLtoBlob(u) {
    const a = u.split(','), m = a[0].match(/:(.*?);/)[1];
    const b = atob(a[1]); let n = b.length; const x = new Uint8Array(n);
    while (n--) x[n] = b.charCodeAt(n);
    return new Blob([x], { type: m });
  }

  async function flush() {
    if (!firebase?.apps?.length || !navigator.onLine) return;
    const db = firebase.firestore();
    const storage = firebase.storage ? firebase.storage() : null;
    if (!storage) return;

    const jobs = await OfflineQueue.all();
    for (const job of jobs) {
      try {
        const { id, type, docPath, cliente, unidad, fotoEmbedded, firmaEmbedded } = job;
        const updates = {};
        const baseFolder = (type === 'cuaderno-upload') ? 'cuaderno' : 'incidencias';
        const stamp = Date.now();

        if (fotoEmbedded) {
          const blob = dataURLtoBlob(fotoEmbedded);
          const ref = storage.ref().child(`${baseFolder}/${cliente}/${unidad}/${stamp}_foto.jpg`);
          await ref.put(blob);
          updates.fotoURL = await ref.getDownloadURL();
          updates.fotoEmbedded = firebase.firestore.FieldValue.delete();
        }

        if (firmaEmbedded) {
          const blob = dataURLtoBlob(firmaEmbedded);
          const ref = storage.ref().child(`${baseFolder}/${cliente}/${unidad}/${stamp}_firma.png`);
          await ref.put(blob);
          updates.firmaURL = await ref.getDownloadURL();
          updates.firmaEmbedded = firebase.firestore.FieldValue.delete();
        }

        if (Object.keys(updates).length) {
          await db.doc(docPath).set(updates, { merge: true });
        }
        await OfflineQueue.remove(id);
      } catch (e) {
        // si falla, lo dejamos para el próximo intento
        console.warn('[sync] retry later', e);
      }
    }
  }

  // Disparadores
  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flush();
  });
  setInterval(flush, 15000);
  flush();
})();
