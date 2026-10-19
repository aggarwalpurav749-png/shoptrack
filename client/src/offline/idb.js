// Minimal IndexedDB wrapper (no library). If the browser refuses IndexedDB the app still works, just without saving to disk.
const DB_NAME = 'shoptrack-offline';
const VERSION = 1;
export const TABLES = ['parties', 'products', 'orders', 'invoices', 'users'];

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let req;
    try {
      req = indexedDB.open(DB_NAME, VERSION);
    } catch (e) {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      TABLES.forEach((t) => db.createObjectStore(t, { keyPath: 'id' }));
      db.createObjectStore('kv', { keyPath: 'k' });
      db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      db.createObjectStore('pings', { keyPath: 'seq', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

const wrap = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

async function run(store, mode, fn) {
  const db = await open();
  if (!db) return undefined;
  const tx = db.transaction(store, mode);
  const out = await fn(tx.objectStore(store), tx);
  if (mode === 'readwrite') {
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  return out;
}

export const idb = {
  getAll: (store) => run(store, 'readonly', (s) => wrap(s.getAll())).then((r) => r || []),
  put: (store, value) => run(store, 'readwrite', (s) => wrap(s.put(value))),
  putMany: (store, values) =>
    values.length
      ? run(store, 'readwrite', (s) => {
          values.forEach((v) => s.put(v));
        })
      : Promise.resolve(),
  del: (store, key) => run(store, 'readwrite', (s) => wrap(s.delete(key))),
  delMany: (store, keys) =>
    keys.length
      ? run(store, 'readwrite', (s) => {
          keys.forEach((k) => s.delete(k));
        })
      : Promise.resolve(),
  clear: (store) => run(store, 'readwrite', (s) => wrap(s.clear())),
  async clearAll() {
    for (const t of [...TABLES, 'kv', 'outbox', 'pings']) await this.clear(t);
  },
};
