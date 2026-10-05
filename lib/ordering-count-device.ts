/**
 * Ordering > Count screen: what it keeps ON THE DEVICE (browser only; every function is safe to call when storage is blocked).
 *
 *   The queue of taps waiting to sync   localStorage, through the data layer's helpers (lib/ordering-data.ts). It is written
 *                                       synchronously BEFORE the screen updates, so a tap is on the device the moment it shows.
 *                                       If the device refuses (storage full or blocked) the queue lives in memory for as long
 *                                       as the page is open and the screen warns that the counts are not safe from a reload.
 *   The venue copy (products, categories, the session and its lines)   IndexedDB, one record per venue, so the screen opens
 *                                       with no signal. It is only ever shown to the person it was saved for (lib/ordering-count-ui.ts cacheUsable).
 *
 * Nothing here talks to the database.
 */
import type { QueueStorage } from "./ordering-data";
import type { CountCache } from "./ordering-count-ui";

/* ------------------------------------------------------------------ the queue's storage */

export interface DeviceQueueStorage extends QueueStorage {
  /** true once a write was refused and the queue is only held in memory */
  degraded(): boolean;
}

/** localStorage with an in-memory fallback, so a blocked or full device never loses a tap while the page is open. */
export function createQueueStorage(ls: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = safeLocalStorage()): DeviceQueueStorage {
  const memory = new Map<string, string>();
  let degraded = false;
  return {
    getItem(key) {
      if (memory.has(key)) return memory.get(key) ?? null;
      try {
        return ls ? ls.getItem(key) : null;
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        if (!ls) throw new Error("no storage");
        ls.setItem(key, value);
        memory.delete(key);
      } catch {
        degraded = true;
        memory.set(key, value);
      }
    },
    degraded: () => degraded,
  };
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ the venue copy (IndexedDB) */

const DB_NAME = "precinct-ordering";
const STORE = "count-cache";
const keyFor = (venueId: number) => `v1:${venueId}`;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise<T | null>((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = work(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(req.result ?? null);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

/** The saved copy for a venue, or null (nothing saved, or IndexedDB unavailable). Check it with cacheUsable before showing it. */
export async function readCountCache(venueId: number): Promise<CountCache | null> {
  const v = await run<unknown>("readonly", (s) => s.get(keyFor(venueId)));
  return (v as CountCache | null) ?? null;
}

/** Saves the copy; false when the device refused (the screen just keeps working online). */
export async function writeCountCache(cache: CountCache): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise<boolean>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(cache, keyFor(cache.venueId));
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        resolve(false);
      };
    } catch {
      db.close();
      resolve(false);
    }
  });
}

export async function clearCountCache(venueId: number): Promise<void> {
  await run<undefined>("readwrite", (s) => s.delete(keyFor(venueId)) as IDBRequest<undefined>);
}

/* ------------------------------------------------------------------ small browser helpers */

/** navigator.onLine can say true on a dead wifi, so a sync failure is treated as offline too; this is only the first signal. */
export function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** The device's clock as an ISO string (what the edit carries so last write wins). */
export function nowIso(): string {
  return new Date().toISOString();
}
