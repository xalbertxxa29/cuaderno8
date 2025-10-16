// offline-queue.js — Cola mínima para reintentos usando IndexedDB
(function () {
  const DB_NAME = 'offlineQueueDB';
  const STORE = 'queue';
  let db = null;

  function openDB() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const _db = e.target.result;
        if (!_db.objectStoreNames.contains(STORE)) {
          _db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  async function getDB() { return db || (db = await openDB()); }

  async function add(task) {
    const _db = await getDB();
    return new Promise((res, rej) => {
      const tx = _db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).add(task);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }

  async function all() {
    const _db = await getDB();
    return new Promise((res, rej) => {
      const tx = _db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => rej(req.error);
    });
  }

  async function remove(id) {
    const _db = await getDB();
    return new Promise((res, rej) => {
      const tx = _db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }

  window.OfflineQueue = { add, all, remove };
})();
