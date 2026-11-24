// One last document per browser profile and origin; no IP, account or server upload.
export function createSessionStore(factory = globalThis.indexedDB, database = 'deallsoft-pdf-editor') {
  let connection;
  let queue = Promise.resolve();
  const open = () => connection ??= new Promise((resolve, reject) => {
    if (!factory) { reject(new Error('Local storage unavailable')); return; }
    const request = factory.open(database, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sessions');
    request.onerror = () => { connection = null; reject(request.error); };
    request.onblocked = () => { connection = null; reject(new Error('Local storage blocked')); };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); connection = null; };
      resolve(db);
    };
  });
  const transact = async (mode, action) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sessions', mode);
      const request = action(tx.objectStore('sessions'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? new Error('Local save interrupted'));
      tx.onerror = () => reject(tx.error ?? request.error);
    });
  };
  return {
    read: () => transact('readonly', store => store.get('last-document')),
    write(snapshot) {
      // Preserve invocation order even when an earlier transaction failed.
      const operation = queue.catch(() => {}).then(() => transact('readwrite', store => store.put(snapshot, 'last-document')));
      queue = operation;
      return operation;
    },
  };
}

export function validSession(value) {
  return value?.version === 1 && value.bytes instanceof Uint8Array && value.bytes.length >= 5
    && new TextDecoder().decode(value.bytes.subarray(0, 5)) === '%PDF-'
    && typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 1024;
}
