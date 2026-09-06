const DB_NAME = 'TunisBusDB';
const DB_VERSION = 1;

let db = null;

export function openDB() {
  return new Promise((resolve, reject) => {
    if (db && db.name === DB_NAME) { resolve(db); return; }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('routes')) {
        d.createObjectStore('routes', { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains('trips')) {
        d.createObjectStore('trips', { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains('favorites')) {
        d.createObjectStore('favorites', { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => { db = e.target.result; resolve(db); };
    request.onerror = (e) => reject(e.target.error);
  });
}

export async function saveRoutes(routes) {
  const d = await openDB();
  const tx = d.transaction('routes', 'readwrite');
  const store = tx.objectStore('routes');
  routes.forEach(r => store.put(r));
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function getRoutes() {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('routes', 'readonly');
    const store = tx.objectStore('routes');
    const result = [];
    const cursor = store.openCursor();
    cursor.onsuccess = (e) => {
      const cur = e.target.result;
      if (cur) { result.push(cur.value); cur.continue(); }
      else { resolve(result); }
    };
    cursor.onerror = (e) => reject(e.target.error);
  });
}

export async function saveTrip(trip) {
  const d = await openDB();
  const tx = d.transaction('trips', 'readwrite');
  tx.objectStore('trips').put(trip);
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function getTrips() {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('trips', 'readonly');
    const store = tx.objectStore('trips');
    const result = [];
    const cursor = store.openCursor();
    cursor.onsuccess = (e) => {
      const cur = e.target.result;
      if (cur) { result.push(cur.value); cur.continue(); }
      else { resolve(result.reverse()); }
    };
    cursor.onerror = (e) => reject(e.target.error);
  });
}

export async function toggleFavorite(routeId) {
  const d = await openDB();
  const tx = d.transaction('favorites', 'readwrite');
  const store = tx.objectStore('favorites');
  const existing = await new Promise((resolve) => {
    const req = store.get(routeId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  if (existing) {
    store.delete(routeId);
  } else {
    store.put({ id: routeId, addedAt: Date.now() });
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
}

export async function getFavorites() {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('favorites', 'readonly');
    const store = tx.objectStore('favorites');
    const result = [];
    const cursor = store.openCursor();
    cursor.onsuccess = (e) => {
      const cur = e.target.result;
      if (cur) { result.push(cur.value.id); cur.continue(); }
      else { resolve(result); }
    };
    cursor.onerror = (e) => reject(e.target.error);
  });
}
