import { createAccountSync } from './lib/accountSync';
import { createWriteQueue, mergeVersions, timestampMs, version } from './lib/cloudSync';
import { readLocalValue, writeLocalValue } from './lib/localPersistence';
import { setCloudWarning } from './lib/cloudStatus';
import { getMediaReferences, promoteMediaContent } from './lib/mediaPromotion';
import { isStandaloneDisplay } from './lib/pwa';
import { authDiagnostic, isAuthorizedHostname } from './lib/authDiagnostics';
import { canMoveFolder, collectFolderIds } from './lib/folderGraph';
import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, User, Auth } from 'firebase/auth';
import { runTransaction, getFirestore, initializeFirestore, doc, setDoc, deleteDoc, deleteField, getDoc, collection, query, where, getDocs, onSnapshot, Firestore } from 'firebase/firestore';
import { getLocalMediaBlob, registerLocalBlob, sanitizeContentImages, blobToDataUrl, dataUrlToBlob, setCloudMediaFetcher } from './utils/mediaStore';
import { loadGuestFolders, saveGuestFolders, loadGuestNotes, saveGuestNotes } from './demoData';
import firebaseConfig from '../firebase-applet-config.json';

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;
let googleProviderInstance: GoogleAuthProvider | null = null;

export const getFirebaseApp = () => {
  if (!app) {
    if (!firebaseConfig || !firebaseConfig.apiKey) {
      console.warn("Firebase config is missing or invalid. Check firebase-applet-config.json.");
    }
    app = initializeApp(firebaseConfig);
  }
  return app;
};

export const getFirebaseAuth = () => {
  if (!authInstance) {
    authInstance = getAuth(getFirebaseApp());
  }
  return authInstance;
};

export const getFirebaseDb = () => {
  if (!dbInstance) {
    const dbId = (firebaseConfig as any)?.firestoreDatabaseId;
    try {
      dbInstance = dbId
        ? initializeFirestore(getFirebaseApp(), { experimentalForceLongPolling: true, ignoreUndefinedProperties: true }, dbId)
        : initializeFirestore(getFirebaseApp(), { experimentalForceLongPolling: true, ignoreUndefinedProperties: true });
    } catch {
      dbInstance = dbId
        ? getFirestore(getFirebaseApp(), dbId)
        : getFirestore(getFirebaseApp());
    }
  }
  return dbInstance;
};


export const getGoogleProvider = () => {
  if (!googleProviderInstance) {
    googleProviderInstance = new GoogleAuthProvider();
    googleProviderInstance.setCustomParameters({
      prompt: 'select_account'
    });
  }
  return googleProviderInstance;
};

export const withTimeout = <T>(promise: Promise<T>, ms: number = 15000, label: string = 'Operation'): Promise<T> => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise
      .then(res => { clearTimeout(timer); resolve(res); })
      .catch(err => { clearTimeout(timer); reject(err); });
  });
};

/**
 * Commits locally first, then promotes to the authenticated owner bucket.
 * Offline failure returns the durable local token for later outbox promotion.
 */
export const uploadImageFile = async (userId: string, file: File | Blob, filename?: string): Promise<string> => {
  const id = await registerLocalBlob(file, filename);
  if (!userId || userId === 'guest' || userId === 'guest_user') return id;
  try { return await uploadVaultImage(userId, id); }
  catch { setCloudWarning('Image saved in this browser. Cloud upload is pending; use Retry cloud sync when connected.'); return id; }
};

export const googleAuthDiagnostic = () => authDiagnostic(typeof location === 'undefined' ? '' : location.hostname, firebaseConfig.projectId);
let authorized: boolean | undefined;
export const preflightGoogleAuth = async (): Promise<boolean | undefined> => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return undefined;
  try {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/projects?key=${encodeURIComponent(firebaseConfig.apiKey)}`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return undefined;
    const config = await response.json();
    if (Array.isArray(config.authorizedDomains)) authorized = isAuthorizedHostname(location.hostname, config.authorizedDomains);
  } catch { /* Network failures are not evidence of a domain configuration error. */ }
  return authorized;
};

export const signInWithGoogle = async (): Promise<User | null> => {
  try {
    if (authorized === false) throw Object.assign(new Error(googleAuthDiagnostic().message), { code: 'auth/unauthorized-domain' });
    // Installed (standalone) apps cannot host auth popups reliably: on
    // Android the popup opens outside the app and often never returns, and
    // on iOS it can kill the standalone web view. Redirect flow is the
    // supported path there; the result is collected on return.
    if (isStandaloneDisplay()) {
      await signInWithRedirect(getFirebaseAuth(), getGoogleProvider());
      return null; // Page is navigating away; auth observer fires on return.
    }
    const result = await signInWithPopup(getFirebaseAuth(), getGoogleProvider());
    return result.user;
  } catch (error: any) {
    if (
      error?.code !== 'auth/popup-closed-by-user' &&
      error?.code !== 'auth/cancelled-popup-request' &&
      error?.code !== 'auth/popup-blocked' &&
      error?.code !== 'auth/network-request-failed' &&
      error?.code !== 'auth/unauthorized-domain'
    ) {
      console.warn("Google Sign-In Notice:", error?.code || error?.message);
    }
    throw error;
  }
};

export const logout = async () => {
  return signOut(getFirebaseAuth());
};

/** Collect the result of a redirect sign-in after returning to the app. */
export async function completeRedirectSignIn(): Promise<{ user: User | null; error: string | null }> {
  try {
    const result = await getRedirectResult(getFirebaseAuth());
    return { user: result?.user || null, error: null };
  } catch (error: any) {
    if (error?.code === 'auth/unauthorized-domain') return { user: null, error: googleAuthDiagnostic().message };
    return { user: null, error: error?.message ? `Sign-in could not be completed: ${error.message}` : null };
  }
}

export const registerUserDoc = async (userId: string, email: string, displayName?: string, photoURL?: string): Promise<boolean> => {
  if (!email) { console.warn('registerUserDoc skipped: signed-in user has no email.'); return false; }
  try {
    const userDocRef = doc(getFirebaseDb(), 'users', userId);
    const existing = await withTimeout(getDoc(userDocRef), 4000, 'getUserDoc');
    if (!existing.exists()) {
      await withTimeout(setDoc(userDocRef, {
        uid: userId,
        email,
        displayName: displayName || 'User',
        photoURL: photoURL || null
      }), 4000, 'createUserDoc');
      return false; // Newly registered user
    }
    return true; // Already registered
  } catch (err) {
    console.warn('registerUserDoc failed:', err instanceof Error ? err.message : err);
    return false; // Report failure honestly; never pretend registration worked.
  }
};

// Firestore Utilities
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  // Deliberately excludes email / display name / provider data: console logs
  // are routinely pasted into bug reports and must not carry PII.
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: getFirebaseAuth().currentUser?.uid,
      isAnonymous: getFirebaseAuth().currentUser?.isAnonymous,
      providerInfo: (getFirebaseAuth().currentUser?.providerData || []).map(provider => ({
        providerId: provider.providerId, displayName: null, email: null, photoUrl: null,
      })),
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Folder Logic
export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  level: number;
  createdAt: any;
  updatedAt?: any;
  deletedAt?: number;
}

// Helper to safely extract milliseconds from any Firestore timestamp or number
export const getTimestampMs = timestampMs;


// Concurrent callers (navigation, login, reconnect) share one in-flight
// collection read instead of each downloading the whole vault and racing
// to apply it. Settled reads are never cached, so freshness is unchanged.
const inFlightReads = new Map<string, Promise<unknown>>();
function dedupeRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const existing = inFlightReads.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = read().finally(() => { if (inFlightReads.get(key) === promise) inFlightReads.delete(key); });
  inFlightReads.set(key, promise as Promise<unknown>);
  return promise;
}

export const getAllFolders = (userId: string): Promise<Folder[]> => dedupeRead(`folders:${userId}`, async (): Promise<Folder[]> => {
  try {
    const snapshot = await withTimeout(getDocs(collection(getFirebaseDb(), `users/${userId}/folders`)), 15000, 'getAllFolders');
    const cloud = snapshot.docs.map(item => ({ ...item.data(), id: item.id })) as Folder[];
    const merged = mergeWithOutbox(userId, 'folders', loadGuestFolders(userId), cloud);
    saveGuestFolders(merged, userId); return merged;
  } catch { if (getFirebaseAuth().currentUser?.uid === userId) setCloudWarning('Could not refresh cloud folders. Showing the local account cache; Retry cloud sync when connected.'); return loadGuestFolders(userId); }
});

export const createFolder = async (userId: string, name: string, parentId: string | null, level: number): Promise<Folder> =>
  saveFolderDirect(userId, { id: `folder_${crypto.randomUUID()}`, name, parentId, level, createdAt: Date.now() });

export const renameFolder = async (userId: string, folderId: string, newName: string): Promise<void> => {
  const folder = loadGuestFolders(userId).find(item => item.id === folderId);
  if (!folder) throw new Error('Folder not found');
  await saveFolderDirect(userId, { ...folder, name: newName });
};

export const moveFolder = async (userId: string, folderId: string, newParentId: string | null, newLevel: number): Promise<void> => {
  const folders = loadGuestFolders(userId);
  if (!canMoveFolder(folders, folderId, newParentId)) throw new Error('Invalid folder move: cycle or missing parent');
  await saveFolderDirect(userId, { ...folders.find(item => item.id === folderId)!, parentId: newParentId, level: newLevel });
};

export const deleteFolderRecursive = async (userId: string, folderId: string): Promise<void> => {
  // Refuse to guess a cloud subtree while offline; a partial deletion could orphan children.
  assertOwner(userId);
  const [folderSnapshot, noteSnapshot] = await withTimeout(Promise.all([
    getDocs(collection(getFirebaseDb(), `users/${userId}/folders`)),
    getDocs(collection(getFirebaseDb(), `users/${userId}/notes`))
  ]), 15000, 'Read folder subtree');
  const folders = mergeWithOutbox(userId, 'folders', loadGuestFolders(userId), folderSnapshot.docs.map(d => ({ ...d.data(), id: d.id })) as Folder[]);
  const notes = mergeWithOutbox(userId, 'notes', loadGuestNotes(userId), noteSnapshot.docs.map(d => ({ ...d.data(), id: d.id })) as Note[]);
  // Include tombstoned parent links when traversing an interrupted deletion.
  const tree = new Map(folderSnapshot.docs.map(d => [d.id, { ...d.data(), id: d.id } as Folder]));
  loadGuestFolders(userId).forEach(folder => tree.set(folder.id, folder));
  const ids = collectFolderIds([...tree.values()], folderId);
  const now = Date.now();
  const deletions: { kind: Kind; data: Item }[] = [
    ...notes.filter(note => ids.has(note.folderId)).map(note => ({ kind: 'notes' as const, data: { ...note, updatedAt: Math.max(now, version(note) + 1), deletedAt: now } })),
    ...folders.filter(folder => ids.has(folder.id)).map(folder => ({ kind: 'folders' as const, data: { ...folder, updatedAt: Math.max(now, version(folder) + 1), deletedAt: now } }))
  ];
  // Stage the entire known subtree before starting any remote deletion. Retry can finish every item.
  for (const entry of deletions) stageWrite(userId, entry.kind, entry.data);
  saveGuestNotes(loadGuestNotes(userId).filter(note => !ids.has(note.folderId)), userId);
  saveGuestFolders(loadGuestFolders(userId).filter(folder => !ids.has(folder.id)), userId);
  await withTimeout(Promise.all(deletions.map(entry => commitStaged(userId, entry.kind, entry.data))), 15000, 'Delete folder subtree');
};

// Note Logic
export interface NoteSection { id: string; title: string; content: string }
export interface Note {
  id: string; folderId: string; title: string; sections: NoteSection[];
  createdAt: any; updatedAt?: any; deletedAt?: number; isLocalOnly?: boolean; isImported?: boolean;
}

export const getNotes = async (userId: string, folderId: string): Promise<Note[]> => {
  const path = `users/${userId}/notes`;
  try {
    const q = query(
      collection(getFirebaseDb(), path),
      where('folderId', '==', folderId)
    );
    const snapshot = await getDocs(q);
    const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Note[];
    return list.sort((a, b) => getTimestampMs(a.createdAt) - getTimestampMs(b.createdAt));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
};

export const getAllNotes = (userId: string): Promise<Note[]> => dedupeRead(`notes:${userId}`, async (): Promise<Note[]> => {
  try {
    const snapshot = await withTimeout(getDocs(collection(getFirebaseDb(), `users/${userId}/notes`)), 15000, 'getAllNotes');
    const cloud = snapshot.docs.map(item => ({ ...item.data(), id: item.id })) as Note[];
    repairLegacyCloudNotes(userId, loadGuestNotes(userId), cloud);
    const merged = mergeWithOutbox(userId, 'notes', loadGuestNotes(userId), cloud);
    saveGuestNotes(merged, userId); return merged;
  } catch { if (getFirebaseAuth().currentUser?.uid === userId) setCloudWarning('Could not refresh cloud notes. Showing the local account cache; Retry cloud sync when connected.'); return loadGuestNotes(userId); }
});

export const createNote = async (userId: string, folderId: string, title: string, sections?: NoteSection[]): Promise<Note> =>
  saveNoteDirect(userId, { id: `note_${crypto.randomUUID()}`, folderId: folderId || 'general', title, sections: sections?.length ? sections : [{ id: 's1', title: 'Introduction', content: '' }], createdAt: Date.now() });

export const saveNoteDirect = async (userId: string, note: Note): Promise<Note> => {
  assertOwner(userId);
  const current = loadGuestNotes(userId);
  const targetVersion = Math.max(Date.now(), version(note) + 1, (version(current.find(n => n.id === note.id) || note)) + 1);
  // Clamp at the single write choke point so no caller (editor, rename,
  // import-keep, guest migration) can stage a note the rules must reject.
  const data: Note = { ...note, title: (note.title || 'Untitled Note').slice(0, 300), updatedAt: targetVersion, isLocalOnly: false, isImported: false };
  // Preserve a real edit timestamp; retries reuse the staged snapshot, never re-stamp it.
  stageWrite(userId, 'notes', data);
  saveGuestNotes([data, ...current.filter(n => n.id !== note.id)], userId);
  return withTimeout(commitStaged(userId, 'notes', data) as Promise<Note>, 15000, 'saveNoteDirect');
};

export const saveFolderDirect = async (userId: string, folder: Folder): Promise<Folder> => {
  assertOwner(userId);
  const current = loadGuestFolders(userId);
  const data: Folder = { ...folder, name: (folder.name.trim() || 'Untitled Folder').slice(0, 200), parentId: folder.parentId || null, updatedAt: Math.max(Date.now(), version(folder), version(current.find(f => f.id === folder.id) || folder) + 1) };
  stageWrite(userId, 'folders', data);
  saveGuestFolders([...current.filter(f => f.id !== folder.id), data], userId);
  return withTimeout(commitStaged(userId, 'folders', data) as Promise<Folder>, 15000, 'saveFolderDirect');
};

/** Resurrect a trashed note. Normal saves can never override a tombstone
 *  (by design), so restoration first removes the tombstone field itself,
 *  then replays the note through the normal staged write path — which also
 *  replaces any still-pending tombstone in the outbox for this note. */
export const restoreDeletedNote = async (userId: string, note: Note): Promise<Note> => {
  assertOwner(userId);
  const clean: Note = { ...note, updatedAt: Date.now(), isLocalOnly: false, isImported: false };
  delete (clean as any).deletedAt;
  await withTimeout(setDoc(doc(getFirebaseDb(), `users/${userId}/notes`, clean.id), { ...clean, deletedAt: deleteField() }, { merge: true }), 15000, 'restoreDeletedNote');
  return saveNoteDirect(userId, clean);
};

export const updateNote = async (userId: string, noteId: string, data: Partial<Note>): Promise<void> => {
  const note = loadGuestNotes(userId).find(n => n.id === noteId);
  if (!note) throw new Error('Note not found in account cache');
  await saveNoteDirect(userId, { ...note, ...data });
};

export const deleteNote = async (userId: string, noteId: string): Promise<void> => {
  assertOwner(userId);
  const current = loadGuestNotes(userId);
  const note = current.find(n => n.id === noteId);
  const tombstone: Note = { ...(note || { id: noteId, title: 'Deleted note', folderId: 'general', sections: [], createdAt: Date.now() }), updatedAt: Math.max(Date.now(), version(note || { id: noteId }) + 1), deletedAt: Date.now() };
  stageWrite(userId, 'notes', tombstone);
  saveGuestNotes(current.filter(n => n.id !== noteId), userId);
  await withTimeout(commitStaged(userId, 'notes', tombstone), 15000, 'deleteNote');
};

export const getNote = async (userId: string, noteId: string): Promise<Note | null> => {
  return (await getAllNotes(userId)).find(note => note.id === noteId) || null;
};

export const subscribeFolders = (userId: string, callback: (folders: Folder[]) => void): (() => void) => {
  const db = getFirebaseDb();
  const path = `users/${userId}/folders`;
  const q = query(collection(db, path));
  return onSnapshot(q, (snapshot) => {
    const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Folder[];
    list.sort((a, b) => getTimestampMs(a.createdAt) - getTimestampMs(b.createdAt));
    callback(mergeWithOutbox(userId, 'folders', loadGuestFolders(userId), list));
  }, (error) => {
    console.error("Firestore subscribeFolders error:", error);
  });
};

export const subscribeNotes = (userId: string, callback: (notes: Note[]) => void): (() => void) => {
  const db = getFirebaseDb();
  const path = `users/${userId}/notes`;
  const q = query(collection(db, path));
  return onSnapshot(q, (snapshot) => {
    const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Note[];
    list.sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt));
    callback(mergeWithOutbox(userId, 'notes', loadGuestNotes(userId), list));
  }, (error) => {
    console.error("Firestore subscribeNotes error:", error);
  });
};

// Account operations are serialized until their real promises settle (not UI timeout).
type Kind = 'notes' | 'folders';
type Item = Note | Folder;
function assertOwner(uid: string) {
  if (getFirebaseAuth().currentUser?.uid !== uid) throw new Error('Account changed. Cloud operation paused; local data retained.');
}
export async function saveVaultMediaToFirestore(uid: string, id: string, blob: Blob, filename?: string): Promise<void> {
  assertOwner(uid);
  const dataUrl = await blobToDataUrl(blob);
  const db = getFirebaseDb();
  const parentRef = doc(db, `users/${uid}/media`, id);
  const chunkSize = 500 * 1024;
  if (dataUrl.length <= 600 * 1024) {
    await setDoc(parentRef, {
      id,
      dataUrl,
      type: blob.type,
      size: blob.size,
      filename: filename || '',
      chunkCount: 1,
      updatedAt: Date.now()
    }, { merge: true });
  } else {
    const chunkCount = Math.ceil(dataUrl.length / chunkSize);
    await setDoc(parentRef, {
      id,
      type: blob.type,
      size: blob.size,
      filename: filename || '',
      chunkCount,
      updatedAt: Date.now()
    }, { merge: true });
    for (let i = 0; i < chunkCount; i++) {
      assertOwner(uid);
      const chunkDocRef = doc(db, `users/${uid}/media`, `${id}__p${i}`);
      const chunkData = dataUrl.slice(i * chunkSize, (i + 1) * chunkSize);
      await setDoc(chunkDocRef, {
        id: `${id}__p${i}`,
        parentId: id,
        partIndex: i,
        data: chunkData,
        updatedAt: Date.now()
      }, { merge: true });
    }
  }
}

export async function fetchVaultMediaFromFirestore(uid: string, id: string): Promise<Blob | null> {
  try {
    const db = getFirebaseDb();
    const docRef = doc(db, `users/${uid}/media`, id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    const data = snap.data();
    let dataUrl = data.dataUrl;
    if (!dataUrl && data.chunkCount > 1) {
      let assembled = '';
      for (let i = 0; i < data.chunkCount; i++) {
        if (data[`chunk_${i}`]) {
          assembled += data[`chunk_${i}`];
        } else {
          const partSnap = await getDoc(doc(db, `users/${uid}/media`, `${id}__p${i}`));
          if (!partSnap.exists()) return null; // Incomplete backup: report missing, never render corrupt data.
          assembled += partSnap.data().data || '';
        }
      }
      dataUrl = assembled;
    }
    if (dataUrl && typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
      return dataUrlToBlob(dataUrl);
    }
  } catch (err) {
    console.warn('Failed to fetch media from Firestore:', id, err);
  }
  return null;
}

// Register cloud media fetcher so images not yet in IndexedDB are hydrated automatically
setCloudMediaFetcher(async (id: string): Promise<Blob | null> => {
  const user = getFirebaseAuth().currentUser;
  if (!user?.uid) return null;
  const fromDb = await fetchVaultMediaFromFirestore(user.uid, id);
  if (fromDb) return fromDb;
  return null;
});

const accountSync = createAccountSync({
  read: readLocalValue, write: writeLocalValue, assertOwner, warn: setCloudWarning,
  async prepare(uid, kind, data) {
    if (kind === 'notes' && !data.deletedAt) {
      data.sections = await Promise.all((data as Note).sections.map(async section => ({
        ...section,
        // Media backup is decoupled from the note commit (see
        // uploadVaultImage): the note always syncs; un-backed-up images
        // stay staged in the media outbox and are reported by the health
        // center, instead of failing every save of the whole note.
        content: await promoteMediaContent(await sanitizeContentImages(section.content), id => uploadVaultImage(uid, id))
      })));
    }
    return data;
  },
  async commit(uid, kind, data) {
    const target = doc(getFirebaseDb(), `users/${uid}/${kind}`, data.id);
    return runTransaction(getFirebaseDb(), async transaction => {
      assertOwner(uid);
      const snapshot = await transaction.get(target);
      const remote = snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } as Item : null;
      if (remote && (remote.deletedAt || version(remote) > version(data))) return remote;
      transaction.set(target, data);
      return data;
    });
  },
  cache(uid, kind, data) {
    if (kind === 'notes') saveGuestNotes(mergeVersions(loadGuestNotes(uid), [data as Note]), uid);
    else saveGuestFolders(mergeVersions(loadGuestFolders(uid), [data as Folder]), uid);
  }
});
const stageWrite = accountSync.stage;
const commitStaged = accountSync.commit;
const mergeWithOutbox = accountSync.merge;
export const retryAccountSync = (uid: string): Promise<void> => withTimeout((async () => { await retryMediaUploads(uid); await accountSync.retry(uid); })(), 60000, 'Retry cloud sync');
const enqueueImageUpload = createWriteQueue();
// Upload-once receipts + a durable media outbox. An image is uploaded to the
// cloud exactly once per account; later note saves reuse the receipt instead
// of re-uploading every image on every keystroke-save.
const mediaReceiptsKey = (uid: string) => `uninote_media_receipts_${uid}`;
const mediaOutboxKey = (uid: string) => `uninote_media_outbox_${uid}`;
const readMediaMap = (key: string): Record<string, string> => { try { return JSON.parse(readLocalValue(key) || '{}'); } catch { return {}; } };
const readMediaOutbox = (uid: string): string[] => { try { const v = JSON.parse(readLocalValue(mediaOutboxKey(uid)) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; } catch { return []; } };
const stageMedia = (uid: string, id: string) => { const box = readMediaOutbox(uid); if (!box.includes(id)) writeLocalValue(mediaOutboxKey(uid), JSON.stringify([...box, id])); };
const settleMedia = (uid: string, id: string) => writeLocalValue(mediaOutboxKey(uid), JSON.stringify(readMediaOutbox(uid).filter(x => x !== id)));
export const pendingMediaUploads = (uid: string): string[] => readMediaOutbox(uid);

function uploadVaultImage(uid: string, id: string): Promise<string> {
  // NOTE: This project's Firebase Storage is unavailable (AI Studio Starter
  // Tier blocks Storage entirely), so the durable cloud copy of an image is
  // its chunked Firestore media document. The other devices of this account
  // resolve `media_*` references through the media fetcher below. There is no
  // Storage URL to promote to, and none is required for persistence.
  const receipt = readMediaMap(mediaReceiptsKey(uid))[id];
  if (receipt) return Promise.resolve(id);
  return enqueueImageUpload(`${uid}/${id}`, async () => {
    assertOwner(uid);
    if (readMediaMap(mediaReceiptsKey(uid))[id]) return id;
    stageMedia(uid, id);
    const blob = await getLocalMediaBlob(id);
    if (!blob) {
      // Not in this browser (e.g. new device or new site origin). Keep it
      // staged for a browser that has it; do NOT fail the note commit.
      console.warn('Image not present in this browser; media backup stays staged:', id);
      return id;
    }
    try {
      await saveVaultMediaToFirestore(uid, id, blob);
    } catch (error) {
      // The note still commits; the image remains staged and visible in the
      // Sync & Media health center instead of poisoning every note save.
      console.warn('Cloud media backup failed; image stays staged for retry:', id, error);
      setCloudWarning('One or more images could not be backed up to the cloud yet. Your notes are synced and the images are safe where they were inserted; open Sync & Media in your account panel for details, then Retry cloud sync.');
      return id;
    }
    writeLocalValue(mediaReceiptsKey(uid), JSON.stringify({ ...readMediaMap(mediaReceiptsKey(uid)), [id]: 'firestore' }));
    settleMedia(uid, id);
    return id;
  });
}

/** Retry every staged media upload, then replay pending note writes. */
export async function retryMediaUploads(uid: string): Promise<void> {
  for (const id of readMediaOutbox(uid)) {
    try { await uploadVaultImage(uid, id); } catch { /* Still staged; accountSync.retry below re-prepares notes too. */ }
  }
}

/**
 * Media health for a set of notes: every local media reference must resolve
 * from this browser or from the cloud backup. Missing items are reported to
 * the user (repair pass) instead of rendering as silent placeholders.
 */
export async function checkMediaHealth(uid: string, notes: Note[]): Promise<{ ready: number; missing: string[]; pending: string[] }> {
  const ids = [...new Set(notes.flatMap(note => note.sections.flatMap(section => getMediaReferences(section.content))))];
  const missing: string[] = [];
  for (const id of ids) {
    if (await getLocalMediaBlob(id)) continue;
    if (readMediaMap(mediaReceiptsKey(uid))[id]) continue;
    const cloud = await fetchVaultMediaFromFirestore(uid, id).catch(() => null);
    if (!cloud) missing.push(id);
  }
  return { ready: ids.length - missing.length, missing, pending: readMediaOutbox(uid) };
}
export const observeAuth = (callback: (user: User | null) => void, error: (error: Error) => void) => onAuthStateChanged(getFirebaseAuth(), callback, error);

/** Repair pre-Stage-3 cloud references from the original browser; never seed missing/deleted cloud IDs. */
function repairLegacyCloudNotes(uid: string, cached: Note[], cloud: Note[]) {
  if (getFirebaseAuth().currentUser?.uid !== uid) return;
  for (const remote of cloud) {
    if (remote.deletedAt || accountSync.hasPending(uid, 'notes', remote.id)) continue;
    const local = cached.find(note => note.id === remote.id);
    const candidate = local && version(local) > version(remote) ? local : remote;
    if (candidate.isImported) continue;
    // Only notes whose images are not yet confirmed backed-up (or that embed
    // raw base64) need repair. Without this, every load re-staged and
    // re-wrote every image-bearing note, churning versions forever.
    const receipts = readMediaMap(mediaReceiptsKey(uid));
    const refs = (candidate.sections || []).flatMap(section => getMediaReferences(section.content));
    const needsMedia = refs.some(id => !receipts[id]) || (candidate.sections || []).some(section => section.content.includes('data:image/'));
    if (needsMedia || version(candidate) > version(remote)) {
      const data = { ...candidate, updatedAt: Math.max(version(candidate), version(remote) + 1) };
      stageWrite(uid, 'notes', data);
      void commitStaged(uid, 'notes', data).catch(() => undefined);
    }
  }
}
