/**
 * Tiny IndexedDB slot for ONE value — epic #267 / #476.
 * =============================================================================
 *
 * `FileSystemDirectoryHandle`s are structured-cloneable, so a picked folder can
 * be stashed in IndexedDB and re-hydrated on the next visit (localStorage can't
 * hold a handle). We only ever keep the most-recently-opened folder handle, so a
 * one-row store keyed by a constant is all we need. All calls resolve to a safe
 * fallback rather than reject, so a private-mode / blocked-IDB browser just loses
 * persistence instead of breaking the app.
 */
const DB_NAME = 'snakie-web'
const STORE = 'kv'
const KEY = 'lastFolderHandle'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Store the picked directory handle (best-effort; overwrites the previous one). */
export async function saveFolderHandle(handle: unknown): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(handle, KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    /* IndexedDB unavailable — folder just won't persist across reloads */
  }
}

/** Read the last stored directory handle, or null if none / IDB unavailable. */
export async function loadFolderHandle(): Promise<unknown | null> {
  try {
    const db = await openDb()
    const value = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return value ?? null
  } catch {
    return null
  }
}

/** Forget the stored handle (e.g. the folder was moved/deleted). */
export async function clearFolderHandle(): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    /* best-effort */
  }
}
