import { getMediaReferences } from '../lib/mediaPromotion';
import { extractYouTubeId } from '../lib/youtube';
import { reportStorageFailure, writeLocalValue } from '../lib/localPersistence';

export const MEDIA_DATABASE = 'uninote_media_db';
const STORE = 'media';
interface MediaRecord { id: string; blob: Blob; filename?: string; createdAt: number }
let database: Promise<IDBDatabase> | undefined;
const resolved = new Map<string, string>();
const resolving = new Map<string, Promise<string>>();
const listeners = new Set<() => void>();
let revision = 0;
let pendingMediaWrites = 0;
export const getPendingMediaWrites = () => pendingMediaWrites;
export const getMediaRevision = () => revision;
export const subscribeMedia = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const isLocalMediaObjectUrl = (url: string) => [...resolved.values()].includes(url);
const notify = () => { revision++; listeners.forEach(listener => listener()); };

const DB_VERSION = 2;

function openOnce(version?: number): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is unavailable'));
    const request = version === undefined ? indexedDB.open(MEDIA_DATABASE) : indexedDB.open(MEDIA_DATABASE, version);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = undefined; };
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('Cannot open media vault'));
    request.onblocked = () => reject(new Error('Media vault upgrade is blocked by another tab'));
  });
}

/**
 * Self-healing vault open. Databases created by older builds can exist at
 * version 1 WITHOUT the `media` object store; opening them plainly succeeds
 * and every transaction then throws "object stores was not found". Opening
 * at DB_VERSION runs the upgrade that creates the store, and if a database
 * still lacks the store we close it and reopen at the next version, which
 * forces the upgrade. No user should ever have to clear site data manually.
 */
function openVault(): Promise<IDBDatabase> {
  if (!database) database = (async () => {
    let db = await openOnce(DB_VERSION).catch(error =>
      error?.name === 'VersionError' ? openOnce() : Promise.reject(error));
    if (!db.objectStoreNames.contains(STORE)) {
      const nextVersion = db.version + 1;
      db.close();
      db = await openOnce(nextVersion);
    }
    return db;
  })().catch(error => { database = undefined; throw error; });
  return database;
}

const isMissingStore = (error: unknown) =>
  (error as any)?.name === 'NotFoundError' || /object stores was not found/i.test((error as any)?.message || '');

export function dataUrlToBlob(dataUrl: string): Blob {
  const match = dataUrl.match(/^data:(image\/[a-z\d.+-]+)(;base64)?,([\s\S]*)$/i);
  if (!match) throw new Error('Invalid image data URL');
  const raw = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
  return new Blob([Uint8Array.from(raw, char => char.charCodeAt(0))], { type: match[1] });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

type CloudMediaFetcher = (id: string) => Promise<Blob | null>;
let cloudMediaFetcher: CloudMediaFetcher | null = null;
export const setCloudMediaFetcher = (fetcher: CloudMediaFetcher | null) => {
  cloudMediaFetcher = fetcher;
};

async function putBlob(id: string, blob: Blob, filename?: string): Promise<void> {
  const write = async () => {
    const db = await openVault();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put({ id, blob, filename, createdAt: Date.now() } satisfies MediaRecord);
      // Request success is not durability: wait for transaction completion.
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('Media transaction failed'));
    });
  };
  try { await write(); }
  catch (error) {
    if (!isMissingStore(error)) throw error;
    database = undefined; // Force the healing reopen, then retry exactly once.
    await write();
  }
  if (!resolved.has(id)) { resolved.set(id, URL.createObjectURL(blob)); notify(); }

  // Resilient localStorage fallback cache for quick hydration across sessions
  if (blob.size <= 2.5 * 1024 * 1024) {
    void blobToDataUrl(blob).then(dataUrl => {
      try {
        const cacheRaw = localStorage.getItem('uninote_media_cache');
        const cache = cacheRaw ? JSON.parse(cacheRaw) : {};
        cache[id] = dataUrl;
        const keys = Object.keys(cache);
        if (keys.length > 50) delete cache[keys[0]];
        localStorage.setItem('uninote_media_cache', JSON.stringify(cache));
      } catch {}
    }).catch(() => undefined);
  }
}

export async function getLocalMediaBlob(id: string): Promise<Blob | null> {
  try {
    const db = await openVault();
    const fromIdb = await new Promise<Blob | null>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
      request.onsuccess = () => resolve((request.result as MediaRecord | undefined)?.blob || null);
      request.onerror = () => reject(request.error);
    });
    if (fromIdb) return fromIdb;
  } catch {}

  // Fallback to localStorage cache
  try {
    const cacheRaw = localStorage.getItem('uninote_media_cache');
    if (cacheRaw) {
      const cache = JSON.parse(cacheRaw);
      if (cache[id] && typeof cache[id] === 'string' && cache[id].startsWith('data:image/')) {
        return dataUrlToBlob(cache[id]);
      }
    }
  } catch {}

  return null;
}

export async function getAllLocalMediaBlobs(): Promise<{ id: string; blob: Blob; filename?: string }[]> {
  try {
    const db = await openVault();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readonly');
      const store = transaction.objectStore(STORE);
      const request = store.getAll();
      request.onsuccess = () => {
        const records = (request.result as MediaRecord[]) || [];
        resolve(records.map(r => ({ id: r.id, blob: r.blob, filename: r.filename })));
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

export async function registerLocalBlob(blob: Blob, filename?: string): Promise<string> {
  if (!blob.type.startsWith('image/')) throw new Error('Please choose an image file');
  if (blob.size > 25 * 1024 * 1024) throw new Error('Image exceeds the 25 MB limit');
  pendingMediaWrites++;
  listeners.forEach(listener => listener());
  try {
    // Content-addressed ID when WebCrypto is available (secure contexts).
    // Some mobile web views lack crypto.subtle; a unique ID is far better
    // than failing the whole insert on a phone.
    let digest: string;
    try {
      const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      digest = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    } catch {
      digest = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`.padEnd(64, '0');
    }
    const extension = blob.type.split('/')[1].replace(/[^a-z0-9]/gi, '');
    const id = `media_${digest}.${extension}`;
    await putBlob(id, blob, filename);
    return id;
  } catch (error) {
    reportStorageFailure('The image could not be saved to the local media vault. No notes or existing images were deleted. Free storage and try again.');
    throw error;
  } finally {
    pendingMediaWrites--;
    listeners.forEach(listener => listener());
  }
}

export async function registerLocalImage(url: string, filename?: string): Promise<string> {
  return url.startsWith('data:image/') ? registerLocalBlob(dataUrlToBlob(url), filename) : url;
}

const MAX_RESOLVED_URLS = 300;
function cacheResolved(id: string, url: string) {
  resolved.set(id, url);
  // Bound Blob-URL memory when browsing many image-heavy notes: revoke the
  // oldest URLs (already-rendered <img> elements keep their decoded image;
  // a later resolve simply recreates the URL).
  while (resolved.size > MAX_RESOLVED_URLS) {
    const oldest = resolved.keys().next().value as string;
    const stale = resolved.get(oldest); resolved.delete(oldest);
    if (stale) { try { URL.revokeObjectURL(stale); } catch { /* noop */ } }
  }
}
async function loadObjectUrl(id: string): Promise<string> {
  if (resolved.has(id)) return resolved.get(id)!;
  if (!resolving.has(id)) resolving.set(id, (async () => {
    let blob = await getLocalMediaBlob(id);
    if (!blob && cloudMediaFetcher) {
      try {
        blob = await cloudMediaFetcher(id);
        if (blob) {
          await putBlob(id, blob);
        }
      } catch (err) {
        console.warn('Cloud media fetcher failed for', id, err);
      }
    }
    if (!blob) return '';
    const url = URL.createObjectURL(blob);
    cacheResolved(id, url);
    notify();
    return url;
  })().finally(() => resolving.delete(id)));
  return resolving.get(id)!;
}

export function resolveLocalImage(url: string): string {
  if (!url) return '';
  // Remote and already-materialised URLs are authoritative as-is. Extracting a
  // media_ filename out of a Storage/HTTPS URL and blanking `src` while a
  // local copy loads was the cause of permanent placeholders after re-login.
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (resolved.has(url)) return resolved.get(url)!;

  // Extract media ID if url is or contains a media_* reference
  const mediaIdMatch = url.match(/(media_[a-zA-Z0-9._-]+)/);
  const mediaId = mediaIdMatch ? mediaIdMatch[1] : (url.startsWith('media_') ? url : null);

  if (!mediaId) {
    return url;
  }

  if (resolved.has(mediaId)) {
    const res = resolved.get(mediaId)!;
    resolved.set(url, res);
    return res;
  }

  // Fast-path synchronous hydration from localStorage cache
  try {
    const cacheRaw = typeof localStorage !== 'undefined' ? localStorage.getItem('uninote_media_cache') : null;
    if (cacheRaw) {
      const cache = JSON.parse(cacheRaw);
      if (cache[mediaId] && typeof cache[mediaId] === 'string' && cache[mediaId].startsWith('data:image/')) {
        const blob = dataUrlToBlob(cache[mediaId]);
        const objUrl = URL.createObjectURL(blob);
        cacheResolved(mediaId, objUrl);
        resolved.set(url, objUrl);
        return objUrl;
      }
    }
  } catch {}

  // Rendering remains synchronous; subscribers refresh once the Blob is hydrated.
  void loadObjectUrl(mediaId).then(objUrl => {
    if (objUrl) {
      resolved.set(url, objUrl);
    }
  }).catch(() => {
    reportStorageFailure('The local image vault could not be read. Existing notes and images have not been deleted.');
  });
  return '';
}

export async function compressImageFile(file: File | Blob, maxWidth = 1920, maxHeight = 1920, quality = 0.85): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml' || file.type === 'image/gif') {
    return file;
  }
  if (file.size <= 300 * 1024) {
    return file;
  }
  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    return file;
  }
  return new Promise<Blob>((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;
      if (width <= 0 || height <= 0) return resolve(file);

      if (width > maxWidth || height > maxHeight) {
        if (width / maxWidth > height / maxHeight) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        } else {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }
      // Hard pixel budget: phone canvases/GPU memory can kill the tab when
      // decoding or drawing very large camera photos.
      const MAX_PIXELS = 8_000_000;
      if (width * height > MAX_PIXELS) {
        const scale = Math.sqrt(MAX_PIXELS / (width * height));
        width = Math.max(1, Math.floor(width * scale));
        height = Math.max(1, Math.floor(height * scale));
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(file);

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      canvas.toBlob((blob) => {
        if (blob && blob.size < file.size) {
          resolve(blob);
        } else {
          resolve(file);
        }
      }, outputType, quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

export async function hydrateMedia(content: string): Promise<void> {
  await Promise.all(getMediaReferences(content).map(loadObjectUrl));
}

/** Which media references can actually be shown right now (local vault only). */
export async function localMediaStatus(content: string): Promise<{ ready: string[]; missing: string[] }> {
  const ready: string[] = []; const missing: string[] = [];
  for (const id of getMediaReferences(content)) {
    (await getLocalMediaBlob(id) ? ready : missing).push(id);
  }
  return { ready, missing };
}

/** Replace embedded base64 only after its Blob transaction has committed. */
export async function sanitizeContentImages(content: string): Promise<string> {
  let updated = content;
  const dataUrls = [...new Set(content.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=]+/g) || [])];
  for (const dataUrl of dataUrls) updated = updated.split(dataUrl).join(await registerLocalImage(dataUrl));
  return updated;
}

/** One-time, idempotent migration; legacy source is removed only after all commits. */
export async function initializeMediaVault(): Promise<void> {
  let legacyRaw: string | null = null;
  try { legacyRaw = localStorage.getItem('uninote_media_cache'); } catch { /* Continue with IndexedDB. */ }
  if (legacyRaw) {
    const legacy = JSON.parse(legacyRaw) as Record<string, string>;
    for (const [id, dataUrl] of Object.entries(legacy)) {
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) await putBlob(id, dataUrlToBlob(dataUrl));
    }
    if (localStorage.getItem('uninote_media_cache') === legacyRaw) localStorage.removeItem('uninote_media_cache');
  }
  // Migrate inline images in old local notes without overwriting concurrent edits.
  const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
    .filter((key): key is string => Boolean(key && (key === 'uninote_guest_notes' || key.startsWith('uninote_notes_'))));
  for (const key of keys) {
    const raw = localStorage.getItem(key);
    if (!raw?.includes('data:image/')) continue;
    const notes = JSON.parse(raw);
    if (!Array.isArray(notes)) continue;
    for (const note of notes) for (const section of note.sections || []) {
      if (typeof section.content === 'string') section.content = await sanitizeContentImages(section.content);
    }
    if (localStorage.getItem(key) === raw) writeLocalValue(key, JSON.stringify(notes));
  }
}

export const getMediaCandidates = (cleanId: string): string[] => {
  if (!cleanId) return [];
  const trimmed = cleanId.trim();
  const candidates = new Set<string>([trimmed]);
  try { candidates.add(decodeURIComponent(trimmed)); } catch {}
  const yt = extractYouTubeId(trimmed);
  if (yt?.videoId) {
    candidates.add(yt.videoId); candidates.add(`v=${yt.videoId}`); candidates.add(`youtu.be/${yt.videoId}`);
  } else {
    const withoutQuery = trimmed.split('?')[0];
    if (/\.(png|jpe?g|webp|gif|svg|bmp|ico)$/i.test(withoutQuery)) candidates.add(withoutQuery);
  }
  return [...candidates].filter(candidate => candidate.length > 2);
};

// Local-first media vault; cloud backup lives in Firestore (see firebase.ts).
export const ensurePermanentImageUrl = registerLocalImage;
export const migrateLocalMediaToPermanent = sanitizeContentImages;
