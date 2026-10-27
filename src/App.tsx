import { katex, renderNoteMath } from './lib/math';
import { highlightSearch } from './lib/searchHighlight';
import { planVaultImport, createVaultBackup, backupMarkdown, downloadFile } from './lib/vaultBackup';
import { backupHtml } from './lib/htmlExport';
import { getPwaState, subscribePwa, installPwa, applyPwaUpdate } from './lib/pwa';
import { getMediaReferences } from './lib/mediaPromotion';
import { listTrash, addToTrash, removeFromTrash, takeFromTrash, type TrashEntry } from './lib/trash';
import { authTransitionGuard } from './lib/cloudSync';
import { getCloudWarning, subscribeCloudStatus, setCloudWarning } from './lib/cloudStatus';
import { readLocalValue } from './lib/localPersistence';
import { useMediaRevision } from './hooks/useMediaRevision';
import { getStorageWarning, subscribeStorageWarnings, writeLocalValue, retryPendingWrites, hasPendingLocalWrites } from './lib/localPersistence';
import { parseContentIntoSegments, isMediaLine, replaceSegmentText, deleteSegment, updateMediaMarker, insertAtSelection } from './lib/sectionContent';
export { parseContentIntoSegments } from './lib/sectionContent';
export type { ContentSegment } from './lib/sectionContent';
import { THEMES, normalizeTheme, type ThemeId } from './lib/themes';
import { extractYouTubeId } from './lib/youtube';
export { extractYouTubeId } from './lib/youtube';
import { renderContent, getMediaLayoutStyles } from './lib/renderContent';
import { canMoveFolder, getFolderAncestors, collectFolderIds } from './lib/folderGraph';
import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, ChangeEvent, ClipboardEvent } from 'react';
import {
  getFirebaseAuth, observeAuth, signInWithGoogle, completeRedirectSignIn, logout, retryAccountSync, preflightGoogleAuth, googleAuthDiagnostic,
  createFolder, renameFolder, deleteFolderRecursive, getAllFolders, moveFolder, Folder,
  getAllNotes, createNote, updateNote, deleteNote, Note, NoteSection,
  uploadImageFile, saveNoteDirect, saveFolderDirect, registerUserDoc, getTimestampMs, saveVaultMediaToFirestore, checkMediaHealth, fetchVaultMediaFromFirestore, pendingMediaUploads, restoreDeletedNote
} from './firebase';
import {
  loadGuestFolders, saveGuestFolders, loadGuestNotes, saveGuestNotes, resetGuestDemoData,
  isDemoNoteModified, isDemoFolderModified
} from './demoData';
import { User } from 'firebase/auth';
import { motion, AnimatePresence } from 'motion/react';
import {
  LogIn, LogOut, LayoutDashboard, Home, User as UserIcon, Loader2,
  Folder as FolderIcon, Plus, ChevronRight, ArrowLeft, MoreVertical,
  Edit2, Trash2, X, Check, FileText, Eye, Save, Image as ImageIcon,
  Settings as SettingsIcon, ChevronLeft, GripVertical, Type, Maximize, Minimize, Menu,
  AlignLeft, AlignCenter, AlignRight, Square, Download, Upload, FileJson,
  Cloud, CloudOff, Undo, Redo, CloudUpload, Highlighter, Underline,
  Youtube, Play, CheckCircle2, AlertCircle, Search, ChevronUp, ChevronDown, SlidersHorizontal,
  Sparkles, BookOpen, List, Hash, Copy, FileDown, RotateCcw, Share2, Palette, Clock,
  Layers, Pencil
} from 'lucide-react';
import { cn } from './lib/utils';
import { ConfirmModal, PromptModal, YouTubeModal, ImageModal } from './components/modals';
import TurndownService from 'turndown';
import { getLocalMediaBlob, getAllLocalMediaBlobs, registerLocalImage, resolveLocalImage, sanitizeContentImages, getMediaCandidates, getPendingMediaWrites, subscribeMedia, compressImageFile, hydrateMedia } from './utils/mediaStore';

// --- Custom UI Components ---
const DEFAULT_AVATAR = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%23f1f5f9"/><rect x="22" y="24" width="22" height="18" rx="2" fill="%23cbd5e1" opacity="0.6"/><path d="M26 30h14M26 34h10" stroke="%2394a3b8" stroke-width="1.5" stroke-linecap="round"/><circle cx="50" cy="38" r="15" fill="%23fcd34d"/><path d="M37 32c0-8 6-14 13-14s13 4 13 10c0 4-2 6-4 8-1 0-3-4-8-4s-8 3-9 4c-3-2-5-3-5-4z" fill="%231e293b"/><circle cx="45" cy="38" r="1.8" fill="%230f172a"/><circle cx="55" cy="38" r="1.8" fill="%230f172a"/><path d="M48 43c1 1 3 1 4 0" stroke="%23b45309" stroke-width="1.5" stroke-linecap="round"/><path d="M28 85c0-18 10-26 22-26s22 8 22 26z" fill="%232563eb"/><path d="M44 59l6 14 6-14" fill="%231d4ed8"/><rect x="34" y="68" width="32" height="20" rx="2.5" fill="%230f172a"/><circle cx="50" cy="77" r="1.8" fill="%23ffffff" opacity="0.9"/><path d="M30 88h40a2 2 0 0 1 2 2v1H28v-1a2 2 0 0 1 2-2z" fill="%2364748b"/></svg>`;

const THEMES_LIST = THEMES;

const cleanSnippet = (content?: string) => {
  if (!content || typeof content !== 'string') return 'Empty note';
  const cleaned = content
    .replace(/^#+\s+/gm, '')
    .replace(/\[(?:youtube|video)\]\([^)]+\)(?:[ \t]*@@[a-z0-9-]+@@)?/gi, '')
    .replace(/!\[[^\]]*\]\([^)]+\)(?:[ \t]*@@[a-z0-9-]+@@)?/g, '')
    .replace(/\$\$[\s\S]*?\$\$/g, '')
    .replace(/\$[^$\n]+\$/g, '')
    .replace(/\\\[[\s\S]*?\\\]/g, '')
    .replace(/[*_~`>#|]/g, '')
    .replace(/@@[a-z0-9-]+@@/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'Empty note';
};

const normalizeNote = (note: Partial<Note>): Note => {
  const sections = Array.isArray(note.sections) && note.sections.length > 0
    ? note.sections.map((s, idx) => ({
        id: s.id || `s_${idx + 1}`,
        title: s.title || `Section ${idx + 1}`,
        content: typeof s.content === 'string' ? s.content : ''
      }))
    : [{ id: 's1', title: 'Introduction', content: '' }];

  return {
    id: note.id || `note_${Date.now()}`,
    folderId: note.folderId || 'general',
    title: note.title || 'Untitled Note',
    sections,
    createdAt: note.createdAt || Date.now(),
    updatedAt: note.updatedAt || Date.now(),
    isLocalOnly: note.isLocalOnly,
    isImported: note.isImported
  };
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const accountUidRef = useRef<string | null | undefined>(undefined);
  const authEpochRef = useRef(0);
  const parentIdRef = useRef<string | null>(null);
  const pwa = React.useSyncExternalStore(subscribePwa, getPwaState, getPwaState);
  const [exportTarget, setExportTarget] = useState<{ notes: Note[]; folders: Folder[]; title: string; sectionIndex?: number } | null>(null);
  const [exportCurrentOnly, setExportCurrentOnly] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [importWarning, setImportWarning] = useState<string | null>(null);
  const cloudWarning = React.useSyncExternalStore(subscribeCloudStatus, getCloudWarning, () => null);
  const [isGuestMode, setIsGuestMode] = useState<boolean>(() => {
    return localStorage.getItem('uninote_guest_mode') !== 'false';
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<ThemeId>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('aetheria_settings') || '{}');
      return normalizeTheme(saved.theme);
    } catch {
      return 'dark';
    }
  });
  const [isThemePickerOpen, setIsThemePickerOpen] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', currentTheme);
    const theme = THEMES.find(item => item.id === currentTheme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme?.color || '#131314');
  }, [currentTheme]);

  const applyTheme = (themeId: ThemeId) => {
    setCurrentTheme(themeId);
    document.documentElement.setAttribute('data-theme', themeId);
    try {
      const saved = JSON.parse(localStorage.getItem('aetheria_settings') || '{}');
      saved.theme = themeId;
      localStorage.setItem('aetheria_settings', JSON.stringify(saved));
    } catch {}
  };

  const handleCycleTheme = () => {
    const themeIds = THEMES.map(theme => theme.id);
    const next = themeIds[(themeIds.indexOf(currentTheme) + 1) % themeIds.length];
    applyTheme(next);
  };

  const activeUser = user || {
    uid: 'guest_user',
    displayName: 'Local Vault',
    email: 'Offline / Browser Storage',
    photoURL: null
  };

  // Navigation State
  const [allFolders, setAllFolders] = useState<Folder[]>(() => {
    try {
      const u = getFirebaseAuth().currentUser;
      return loadGuestFolders(u?.uid);
    } catch {
      return loadGuestFolders();
    }
  });
  const [folders, setFolders] = useState<Folder[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [allVaultNotes, setAllVaultNotes] = useState<Note[]>(() => {
    try {
      const u = getFirebaseAuth().currentUser;
      return loadGuestNotes(u?.uid).map(normalizeNote);
    } catch {
      return loadGuestNotes().map(normalizeNote);
    }
  });
  const [homeSearchQuery, setHomeSearchQuery] = useState<string>('');
  const [selectedSearchQuery, setSelectedSearchQuery] = useState('');
  const [path, setPath] = useState<Folder[]>([]);
  const [currentParentId, setCurrentParentId] = useState<string | null>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlFolder = params.get('folderId');
      if (urlFolder && urlFolder !== 'null' && urlFolder !== 'undefined') return urlFolder;
      const saved = localStorage.getItem('uninote_current_folder_id');
      if (saved && saved !== 'null' && saved !== 'undefined') return saved;
    } catch {}
    return null;
  });
  parentIdRef.current = currentParentId;
  const editorFlushRef = useRef<(() => void) | null>(null);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const selectedNoteRef = useRef<Note | null>(null);
  selectedNoteRef.current = selectedNote;
  const [initialSectionIndex, setInitialSectionIndex] = useState<number>(0);
  const [initialScrollY, setInitialScrollY] = useState<number>(0);

  // Helper for root folder matching
  const isRootFolder = (f: Folder) => !f.parentId || f.parentId === 'null' || f.parentId === 'undefined' || f.parentId === '';

  // Continuous reactive synchronization: ALWAYS keeps folders and notes in sync with currentParentId, allFolders, and allVaultNotes
  useEffect(() => {
    const normParent = (currentParentId && currentParentId !== 'null' && currentParentId !== 'undefined') ? currentParentId : null;
    const childFolders = allFolders.filter(f => {
      if (normParent === null) return isRootFolder(f);
      return f.parentId === normParent;
    });
    setFolders(childFolders);

    if (normParent) {
      setNotes(allVaultNotes.filter(n => n.folderId === normParent));
    } else {
      setNotes(allVaultNotes);
    }
  }, [currentParentId, allFolders, allVaultNotes]);

  // Reconstruct breadcrumbs whenever allFolders or currentParentId changes
  useEffect(() => {
    if (!loading && currentParentId && allFolders.length > 0) {
      const targetFolder = allFolders.find(f => f.id === currentParentId);
      if (targetFolder) {
        setPath(getFolderAncestors(allFolders, currentParentId));
      } else {
        // Folder no longer exists after sync, deletion, or account change
        setCurrentParentId(null);
        setPath([]);
        try {
          localStorage.removeItem('uninote_current_folder_id');
          const url = new URL(window.location.href);
          url.searchParams.delete('folderId');
          window.history.replaceState({}, '', url.toString());
        } catch {}
      }
    } else if (!currentParentId) {
      setPath([]);
    }
  }, [currentParentId, allFolders, loading]);

  const filteredSearchFolders = useMemo(() => {
    if (!homeSearchQuery.trim()) return [];
    const q = homeSearchQuery.toLowerCase();
    return allFolders.filter(f => f.name.toLowerCase().includes(q));
  }, [allFolders, homeSearchQuery]);

  const filteredSearchNotes = useMemo(() => {
    if (!homeSearchQuery.trim()) return [];
    const q = homeSearchQuery.toLowerCase();
    return allVaultNotes.filter(n => n.title.toLowerCase().includes(q) || n.sections.some(s => s.content.toLowerCase().includes(q)));
  }, [allVaultNotes, homeSearchQuery]);

  const homeSearchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selectedNote) return;
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        homeSearchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNote]);

  // UI State
  const [isUserDrawerOpen, setIsUserDrawerOpen] = useState<boolean>(false);
  const [trashEntries, setTrashEntries] = useState<TrashEntry[]>([]);
  useEffect(() => { if (isUserDrawerOpen) setTrashEntries(listTrash(user?.uid)); }, [isUserDrawerOpen, user]);
  const handleRestoreNote = async (noteId: string) => {
    const entry = takeFromTrash(user?.uid, noteId);
    setTrashEntries(listTrash(user?.uid));
    if (!entry) return;
    const uid = user?.uid;
    const foldersNow = loadGuestFolders(uid);
    const safeFolderId = foldersNow.some(f => f.id === entry.note.folderId) ? entry.note.folderId : (foldersNow.find(f => !f.parentId)?.id || 'general');
    const restored: Note = { ...entry.note, folderId: safeFolderId, deletedAt: undefined, updatedAt: Date.now() };
    const current = loadGuestNotes(uid);
    saveGuestNotes([restored, ...current.filter(n => n.id !== restored.id)], uid);
    setAllVaultNotes(prev => [restored, ...prev.filter(n => n.id !== restored.id)]);
    if (user) { try { await restoreDeletedNote(user.uid, restored); showToast('Note restored from Trash.', 'success'); } catch { showToast('Note restored in this browser, but cloud restore needs a connection — keep this tab open and retry while online, or it may reappear as deleted after a refresh.', 'error'); } }
    else showToast('Note restored from Trash.', 'success');
    void fetchItems(user?.uid ?? 'guest_user', currentParentId);
  };
  const handleEmptyTrashItem = (noteId: string) => { removeFromTrash(user?.uid, noteId); setTrashEntries(listTrash(user?.uid)); showToast('Removed from Trash permanently.', 'info'); };
  const [mediaHealth, setMediaHealth] = useState<{ ready: number; missing: number; pending: number } | null>(null);
  useEffect(() => {
    if (!isUserDrawerOpen || !user) { if (!isUserDrawerOpen) setMediaHealth(null); return; }
    let live = true;
    void checkMediaHealth(user.uid, loadGuestNotes(user.uid)).then(h => { if (live) setMediaHealth({ ready: h.ready, missing: h.missing.length, pending: h.pending.length }); }).catch(() => undefined);
    return () => { live = false; };
  }, [isUserDrawerOpen, user]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [movingFolder, setMovingFolder] = useState<Folder | null>(null);
  const [movingNote, setMovingNote] = useState<Note | null>(null);

  const fetchItems = useCallback(async (uid?: string | null, parentId?: string | null) => {
    const isGuest = !uid || uid === 'guest_user';
    const epoch = authEpochRef.current;
    const isCurrent = () => epoch === authEpochRef.current && (isGuest ? !accountUidRef.current : accountUidRef.current === uid);
    if (!isCurrent()) return;

    if (isGuest) {
      const allFolderData = loadGuestFolders();
      setAllFolders(allFolderData);

      const allGuestNotes = loadGuestNotes().map(normalizeNote);
      setAllVaultNotes(allGuestNotes);
      return;
    }

    try {
      const allFolderData = await getAllFolders(uid);
      const allNotes = (await getAllNotes(uid)).map(normalizeNote);
      if (!isCurrent()) return;
      setAllFolders(allFolderData);
      setAllVaultNotes(allNotes);
      // Repair/report pass: hydrate what exists locally or in the cloud, and
      // surface (never hide) references that resolve nowhere.
      for (const note of allNotes) for (const section of note.sections) void hydrateMedia(section.content).catch(() => undefined);
      void checkMediaHealth(uid, allNotes).then(health => {
        if (!isCurrent()) return;
        if (health.missing.length) setCloudWarning(`${health.missing.length} image(s) in your notes could not be found in this browser or in your cloud backup. The notes and their layout are intact; re-insert those images to restore them.`);
        else if (health.pending.length) setCloudWarning(`${health.pending.length} image upload(s) are still pending. Use Retry cloud sync when connected.`);
      }).catch(() => undefined);
      // Refresh a stale cached deep link only after flushing any intervening edit.
      const open = selectedNoteRef.current;
      if (open) {
        editorFlushRef.current?.();
        const current = selectedNoteRef.current;
        const refreshed = allNotes.find(note => note.id === open.id);
        if (current?.id === open.id && refreshed && getTimestampMs(refreshed.updatedAt || refreshed.createdAt) > getTimestampMs(current.updatedAt || current.createdAt)) {
          selectedNoteRef.current = refreshed; setSelectedNote(refreshed);
        } else if (current?.id === open.id && !refreshed) {
          selectedNoteRef.current = null; setSelectedNote(null); setIsEditingNote(false);
        }
      }
    } catch (err) {
      if (!isCurrent()) return;
      console.warn("Firestore fetch error, falling back to local vault:", err);
      const allFolderData = loadGuestFolders(uid);
      setAllFolders(allFolderData);
      const allUserNotes = loadGuestNotes(uid).map(normalizeNote);
      setAllVaultNotes(allUserNotes);
    }
  }, []);

  const handleRenameNote = async (noteId: string) => {
    const note = allVaultNotes.find(n => n.id === noteId) || notes.find(n => n.id === noteId);
    setPromptModal({
      isOpen: true,
      title: "Rename Note",
      defaultValue: note?.title || "",
      onConfirm: async (newTitle) => {
        setPromptModal(null);
        if (!newTitle) return;
        const trimmedTitle = newTitle.trim();
        if (!trimmedTitle) return;

        // Optimistic update across all note collections immediately
        setAllVaultNotes(prev => prev.map(n => n.id === noteId ? { ...n, title: trimmedTitle } : n));
        setNotes(prev => prev.map(n => n.id === noteId ? { ...n, title: trimmedTitle } : n));
        if (selectedNote?.id === noteId) {
          setSelectedNote(prev => prev ? { ...prev, title: trimmedTitle } : null);
        }

        const activeUid = user ? user.uid : undefined;
        const currentGuest = loadGuestNotes(activeUid);
        saveGuestNotes(currentGuest.map(n => n.id === noteId ? { ...n, title: trimmedTitle } : n), activeUid);

        if (user) {
          try {
            await updateNote(user.uid, noteId, { title: trimmedTitle });
          } catch (err) {
            console.warn("Failed to sync rename note to cloud:", err);
            showToast('Rename saved locally; cloud sync will retry. Check connectivity and use Retry cloud sync.', 'error');
          }
        }
      }
    });
  };

  const handleMoveNote = async (noteId: string, newFolderId: string | null) => {
    if (!user) {
      const updated = loadGuestNotes().map(n => n.id === noteId ? { ...n, folderId: newFolderId || '' } : n);
      saveGuestNotes(updated);
      setAllVaultNotes(updated);
      setMovingNote(null);
      fetchItems('guest_user', currentParentId);
      return;
    }
    await updateNote(user.uid, noteId, { folderId: newFolderId });
    setMovingNote(null);
    fetchItems(user.uid, currentParentId);
  };

  const [isCreating, setIsCreating] = useState<'folder' | 'note' | null>(null);
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [createLevel, setCreateLevel] = useState<number>(1);
  const [newItemName, setNewItemName] = useState('');
  const createInputRef = useRef<HTMLInputElement>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'synced' | 'local' | 'syncing' | 'error'>('synced');

  // Recent Notes History State (User-clearable like search history)
  const [recentNoteIds, setRecentNoteIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('uninote_recent_note_ids');
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return ['__INITIAL__'];
  });

  // Seed default recent notes on first launch if never cleared by user
  useEffect(() => {
    if (recentNoteIds.length === 1 && recentNoteIds[0] === '__INITIAL__') {
      if (allVaultNotes.length > 0) {
        const initial = allVaultNotes.slice(0, 6).map(n => n.id);
        setRecentNoteIds(initial);
        try {
          localStorage.setItem('uninote_recent_note_ids', JSON.stringify(initial));
        } catch {}
      }
    }
  }, [allVaultNotes, recentNoteIds]);

  const addToRecentNotes = useCallback((noteId: string) => {
    if (!noteId || noteId === '__INITIAL__') return;
    setRecentNoteIds(prev => {
      const filtered = prev.filter(id => id !== noteId && id !== '__INITIAL__');
      const updated = [noteId, ...filtered].slice(0, 12);
      try {
        localStorage.setItem('uninote_recent_note_ids', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, []);

  const handleClearRecentNotes = useCallback(() => {
    setRecentNoteIds([]);
    try {
      localStorage.setItem('uninote_recent_note_ids', JSON.stringify([]));
    } catch {}
  }, []);

  const handleRemoveFromRecent = useCallback((e: React.MouseEvent, noteId: string) => {
    e.stopPropagation();
    setRecentNoteIds(prev => {
      const updated = prev.filter(id => id !== noteId);
      try {
        localStorage.setItem('uninote_recent_note_ids', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, []);

  const handleRestoreRecentNotes = useCallback(() => {
    const latest = allVaultNotes.slice(0, 6).map(n => n.id);
    setRecentNoteIds(latest);
    try {
      localStorage.setItem('uninote_recent_note_ids', JSON.stringify(latest));
    } catch {}
  }, [allVaultNotes]);

  const recentNotes = useMemo(() => {
    if (!recentNoteIds || recentNoteIds.length === 0 || (recentNoteIds.length === 1 && recentNoteIds[0] === '__INITIAL__')) {
      return [];
    }
    const noteMap = new Map<string, Note>();
    allVaultNotes.forEach(n => noteMap.set(n.id, n));
    return recentNoteIds
      .map(id => noteMap.get(id))
      .filter((n): n is Note => Boolean(n));
  }, [recentNoteIds, allVaultNotes]);

  // Modal & Toast State
  const [confirmModal, setConfirmModalState] = useState<{
    isOpen: boolean,
    title: string,
    message: string,
    confirmLabel?: string,
    cancelLabel?: string,
    variant?: 'danger' | 'primary',
    onConfirm: () => void,
    onCancel?: () => void
  } | null>(null);
  const [promptModal, setPromptModalState] = useState<{ isOpen: boolean, title: string, defaultValue: string, onConfirm: (value: string) => void } | null>(null);
  const setConfirmModal = (value: typeof confirmModal) => { editorFlushRef.current?.(); setConfirmModalState(value); };
  const setPromptModal = (value: typeof promptModal) => { editorFlushRef.current?.(); setPromptModalState(value); };
  const pendingMediaWrites = React.useSyncExternalStore(subscribeMedia, getPendingMediaWrites, () => 0);
  const storageWarning = React.useSyncExternalStore(subscribeStorageWarnings, getStorageWarning, () => null);
  const [toasts, setToasts] = useState<{ id: string; message: string; type: 'info' | 'success' | 'error' }[]>([]);

  const showToast = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    setToasts(prev => [...prev.slice(-3), { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  useEffect(() => {
    const protectPendingMedia = (event: BeforeUnloadEvent) => {
      editorFlushRef.current?.();
      if (getPendingMediaWrites() > 0) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', protectPendingMedia);
    return () => window.removeEventListener('beforeunload', protectPendingMedia);
  }, []);
  useEffect(() => { if (storageWarning) showToast(storageWarning, 'error'); }, [storageWarning, showToast]);

  // Back/forward restores the requested local note without allowing the outgoing
  // editor's cleanup to write into the newly selected note.
  useEffect(() => {
    const restoreLocation = () => {
      editorFlushRef.current?.();
      const params = new URLSearchParams(window.location.search);
      const id = params.get('noteId');
      const note = id ? loadGuestNotes(user?.uid).find(item => item.id === id) : null;
      setSelectedNote(note ? normalizeNote(note) : null);
      setInitialSectionIndex(Math.max(0, Number(params.get('section')) || 0));
      setCurrentParentId(params.get('folderId'));
      setIsEditingNote(false);
    };
    window.addEventListener('popstate', restoreLocation);
    return () => window.removeEventListener('popstate', restoreLocation);
  }, [user?.uid]);

  const handleSelectNote = (note: Note, sectionIndex: number = 0, scrollY: number = 0) => {
    editorFlushRef.current?.();
    setSelectedSearchQuery(homeSearchQuery.trim());
    setSelectedNote(note);
    const searchSection = homeSearchQuery.trim() ? note.sections.findIndex(section => section.content.toLowerCase().includes(homeSearchQuery.trim().toLowerCase())) : -1;
    sectionIndex = searchSection >= 0 ? searchSection : sectionIndex;
    setInitialSectionIndex(sectionIndex);
    setInitialScrollY(scrollY);
    setIsEditingNote(false);
    addToRecentNotes(note.id);

    const url = new URL(window.location.href);
    url.searchParams.set('noteId', note.id);
    url.searchParams.set('section', String(sectionIndex));
    window.history.pushState({}, '', url.toString());

    try {
      localStorage.setItem('uninote_reading_state', JSON.stringify({
        noteId: note.id,
        sectionIndex,
        scrollY,
        timestamp: Date.now()
      }));
      if (note.id.startsWith('vault_') || note.isLocalOnly) {
        localStorage.setItem('uninote_cached_local_note', JSON.stringify(note));
      }
    } catch {}
  };

  const handleCloseNote = () => {
    editorFlushRef.current?.();
    setSelectedNote(null);
    setIsEditingNote(false);
    setInitialSectionIndex(0);
    setInitialScrollY(0);

    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('noteId');
      url.searchParams.delete('section');
      if (currentParentId) {
        url.searchParams.set('folderId', currentParentId);
      } else {
        url.searchParams.delete('folderId');
      }
      window.history.replaceState({}, '', url.toString());
      localStorage.removeItem('uninote_reading_state');
    } catch {}
  };

  useEffect(() => {
    const guard = authTransitionGuard();
    let disposed = false;
    void preflightGoogleAuth();
    void completeRedirectSignIn().then(({ error }) => { if (error && !disposed) setError(error); }).catch(() => undefined);
    const unsubscribe = observeAuth(async currentUser => {
      const stillCurrent = guard.change(currentUser?.uid || null);
      // Same-account refreshes update the User object only; never reset navigation/editor.
      if (!stillCurrent) { setUser(currentUser); return; }
      const initial = accountUidRef.current === undefined;
      editorFlushRef.current?.();
      authEpochRef.current++;
      accountUidRef.current = currentUser?.uid || null;
      setUser(currentUser);
      setCloudWarning(null);
      setIsGuestMode(!currentUser);
      setLoading(false);
      if (!initial) {
        selectedNoteRef.current = null;
        setSelectedNote(null);
        setIsEditingNote(false);
        setExportTarget(null); setImportWarning(null);
        setConfirmModalState(null); setPromptModalState(null);
        setMovingNote(null); setMovingFolder(null); setIsUserDrawerOpen(false);
        setIsCreating(null); setNewItemName(''); setEditingFolderId(null); setEditName('');
        setHomeSearchQuery(''); setSelectedSearchQuery(''); setToasts([]);
        setCurrentParentId(null);
        setPath([]);
        localStorage.removeItem('uninote_reading_state');
        localStorage.removeItem('uninote_cached_local_note');
        localStorage.removeItem('uninote_current_folder_id');
        const url = new URL(location.href);
        for (const key of ['noteId', 'section', 'folderId']) url.searchParams.delete(key);
        history.replaceState({}, '', url);
      }
      setAllFolders(loadGuestFolders(currentUser?.uid));
      setAllVaultNotes(loadGuestNotes(currentUser?.uid).map(normalizeNote));
      if (initial) {
        const params = new URLSearchParams(location.search);
        const saved = (() => { try { return JSON.parse(localStorage.getItem('uninote_reading_state') || '{}'); } catch { return {}; } })();
        const cached = loadGuestNotes(currentUser?.uid).find(n => n.id === (params.get('noteId') || saved.noteId));
        if (cached) {
          selectedNoteRef.current = cached;
          setSelectedNote(cached);
          const section = Number(params.get('section') ?? saved.sectionIndex ?? 0);
          setInitialSectionIndex(Number.isFinite(section) ? Math.max(0, Math.min(cached.sections.length - 1, section)) : 0);
          setInitialScrollY(saved.scrollY || 0);
        }
      }
      const valid = () => !disposed && stillCurrent();
      if (currentUser) {
        try {
          await retryAccountSync(currentUser.uid);
          if (!valid()) return;
          await migrateGuestDataToUser(currentUser.uid, loadGuestFolders(), loadGuestNotes(), currentUser.email, currentUser.displayName);
        } catch (err) {
          if (valid()) setCloudWarning('Some cloud changes are pending. Local account data is retained; Retry cloud sync after checking connectivity and rules.');
        }
      }
      if (!valid()) return;
      await fetchItems(currentUser?.uid || 'guest_user', parentIdRef.current);
      if (!valid() || selectedNoteRef.current) return;
      const params = new URLSearchParams(location.search);
      const saved = (() => { try { return JSON.parse(localStorage.getItem('uninote_reading_state') || '{}'); } catch { return {}; } })();
      const noteId = params.get('noteId') || saved.noteId;
      if (noteId) {
        const note = loadGuestNotes(currentUser?.uid).find(n => n.id === noteId);
        if (note && valid() && !selectedNoteRef.current) {
          selectedNoteRef.current = note;
          setSelectedNote(note);
          const section = Number(params.get('section') ?? saved.sectionIndex ?? 0);
          setInitialSectionIndex(Number.isFinite(section) ? Math.max(0, Math.min(note.sections.length - 1, section)) : 0);
          setInitialScrollY(saved.scrollY || 0);
        }
      }
    }, () => {
      if (accountUidRef.current === undefined) {
        accountUidRef.current = null; setUser(null); setIsGuestMode(true);
        setAllFolders(loadGuestFolders()); setAllVaultNotes(loadGuestNotes().map(normalizeNote));
      }
      setError('Authentication could not initialize. Reload to retry; existing local data has not been changed.'); setLoading(false);
    });
    const reconnect = () => {
      const uid = accountUidRef.current;
      if (uid) void retryAccountSync(uid).then(() => fetchItems(uid, parentIdRef.current)).catch(() => undefined);
    };
    window.addEventListener('online', reconnect);
    return () => { disposed = true; guard.invalidate(); unsubscribe(); window.removeEventListener('online', reconnect); };
  }, [fetchItems]);

  const [isSigningIn, setIsSigningIn] = useState(false);

  const migrateGuestDataToUser = async (
    uid: string, guestFolders: Folder[], guestNotes: Note[], email?: string | null, displayName?: string | null
  ) => {
    if (getFirebaseAuth().currentUser?.uid !== uid) throw new Error('Account changed');
    await registerUserDoc(uid, email || '', displayName || undefined);
    // A guest item may be claimed by one account only. Never copy account edits back to Guest.
    const readClaims = (): Record<string, string> => { try { return JSON.parse(readLocalValue('uninote_guest_claims') || '{}'); } catch { return {}; } };
    const readMap = (): Record<string, string> => { try { return JSON.parse(readLocalValue(`uninote_guest_map_${uid}`) || '{}'); } catch { return {}; } };
    const map = readMap();
    const mapId = (kind: string, id: string) => {
      const key = `${kind}:${id}`;
      if (!map[key]) { map[key] = `guest_${kind}_${crypto.randomUUID()}`; writeLocalValue(`uninote_guest_map_${uid}`, JSON.stringify(map)); }
      return map[key];
    };
    const claim = (kind: string, id: string) => { const claims = readClaims(); if (!claims[`${kind}:${id}`]) writeLocalValue('uninote_guest_claims', JSON.stringify({ ...claims, [`${kind}:${id}`]: uid })); };
    const notes = guestNotes.filter(n => !n.isImported && (!n.id.startsWith('demo_') || isDemoNoteModified(n)) && !readClaims()[`notes:${n.id}`]);
    const neededFolders = new Set<string>();
    for (const note of notes) { let id = note.folderId; const seen = new Set<string>(); while (id && !seen.has(id)) { seen.add(id); neededFolders.add(id); id = guestFolders.find(f => f.id === id)?.parentId || ''; } }
    const folders = guestFolders.filter(f => neededFolders.has(f.id) || (!f.id.startsWith('demo_') || isDemoFolderModified(f)) && !readClaims()[`folders:${f.id}`]);
    for (const f of folders) mapId('folders', f.id);
    for (const f of folders.sort((a, b) => a.level - b.level)) {
      if (readClaims()[`folders:${f.id}`] === uid) continue;
      await saveFolderDirect(uid, { ...f, id: mapId('folders', f.id), parentId: f.parentId ? map[`folders:${f.parentId}`] || null : null });
      claim('folders', f.id);
    }
    for (const n of notes) {
      await saveNoteDirect(uid, { ...n, id: mapId('notes', n.id), folderId: map[`folders:${n.folderId}`] || 'general', isLocalOnly: false, isImported: false });
      claim('notes', n.id);
    }
    // Migrate all local media blobs from IndexedDB into the user's cloud media vault.
    // Failures are reported, never silently swallowed: an unreported failure
    // would look like a successful migration while images stayed local-only.
    const localBlobs = await getAllLocalMediaBlobs().catch(() => []);
    let failedMedia = 0;
    for (const item of localBlobs) {
      try { await saveVaultMediaToFirestore(uid, item.id, item.blob, item.filename); }
      catch { failedMedia++; }
    }
    if (failedMedia) showToast(`${failedMedia} image(s) could not be copied to the cloud yet. They remain safe in this browser; use Retry cloud sync when connected.`, 'error');
  };

  const handleSignIn = async () => {
    editorFlushRef.current?.();
    setIsSigningIn(true);
    setError(null);
    try {
      const signedInUser = await signInWithGoogle(); // The observer is the sole owner of migration and account transitions.
      if (!signedInUser) { showToast('Taking you to Google sign-in…', 'info'); return; } // Redirect flow (installed app): page is leaving.
      showToast('Signed in. Loading your account and syncing pending changes.', 'success');
    } catch (err: any) {
      if (err?.code === 'auth/popup-blocked') setError('Sign-in popup was blocked. Open Uni.Note in a new tab and retry.');
      else if (['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(err?.code)) setError(null);
      else if (err?.code === 'auth/unauthorized-domain') setError(googleAuthDiagnostic().message);
      else if (err?.code === 'auth/network-request-failed') setError('Google sign-in could not reach Firebase. Check your connection; local notes are unchanged.');
      else setError(`Sign-in failed: ${err?.message || 'Please retry.'}`);
    } finally { setIsSigningIn(false); }
  };

  const handleSignOut = async () => {
    editorFlushRef.current?.();
    try { await logout(); } catch { setError('Sign-out failed. You are still signed in; please retry.'); }
  };

  const handleSyncLocalToCloud = async () => {
    if (!user) return;
    setIsSyncing(true);
    try {
      await retryAccountSync(user.uid);
      const localFolders = loadGuestFolders();
      const localNotes = loadGuestNotes();
      await migrateGuestDataToUser(user.uid, localFolders, localNotes, user.email, user.displayName);
      await fetchItems(user.uid, currentParentId);
      if (accountUidRef.current === user.uid) showToast("Cloud retry completed. Check any remaining conflict warning before clearing local data.", "success");
    } catch (err: any) {
      if (accountUidRef.current === user.uid) showToast("Sync failed: " + err.message, "error");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCreateItem = async () => {
    createInputRef.current?.blur();
    (document.activeElement as HTMLElement)?.blur();
    const type = isCreating;
    if (!type) return;

    const rawName = (newItemName || createInputRef.current?.value || '').trim();
    const defaultName = type === 'folder' ? 'Untitled Folder' : 'Untitled Note';
    const name = rawName || defaultName;

    const parentId = createParentId;
    const level = createLevel || 1;

    // Immediately dismiss creation panel so it disappears when hitting enter or check
    setIsCreating(null);
    setNewItemName('');
    setCreateParentId(null);
    setCreateLevel(1);

    if (!user) {
      if (type === 'folder') {
        const newFolder: Folder = {
          id: `folder_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          name,
          parentId: parentId,
          level,
          createdAt: Date.now()
        };
        const currentGuestFolders = loadGuestFolders();
        const updated = [...currentGuestFolders, newFolder];
        saveGuestFolders(updated);
        setAllFolders(updated);
        if ((parentId || null) === (currentParentId || null)) {
          setFolders(prev => [...prev, newFolder]);
        }
      } else if (type === 'note') {
        let targetFolderId = parentId || currentParentId;
        const currentGuestFolders = loadGuestFolders();
        if (!targetFolderId) {
          const rootFolder = currentGuestFolders.find(f => !f.parentId) || currentGuestFolders[0];
          if (rootFolder) {
            targetFolderId = rootFolder.id;
          } else {
            const defaultFolder: Folder = {
              id: `folder_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              name: 'General',
              parentId: null,
              level: 1,
              createdAt: Date.now()
            };
            const updatedF = [...currentGuestFolders, defaultFolder];
            saveGuestFolders(updatedF);
            setAllFolders(updatedF);
            targetFolderId = defaultFolder.id;
          }
        }
        const newNote: Note = {
          id: `note_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          folderId: targetFolderId,
          title: name,
          sections: [{ id: `sec_${Date.now()}`, title: 'Introduction', content: '' }],
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        const currentGuestNotes = loadGuestNotes().map(normalizeNote);
        const updated = [newNote, ...currentGuestNotes];
        saveGuestNotes(updated);
        setAllVaultNotes(updated);
        if ((targetFolderId || null) === (currentParentId || null)) {
          setNotes(prev => [newNote, ...prev]);
        }
        addToRecentNotes(newNote.id);

        handleSelectNote(newNote, 0, 0);
        setIsEditingNote(true);
      }
      return;
    }

    // Logged in user flow
    try {
      if (type === 'folder') {
        const cleanParentId = (parentId && parentId !== 'null' && parentId !== 'undefined') ? parentId : null;
        const tempFolder: Folder = {
          id: `folder_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name,
          parentId: cleanParentId,
          level: Math.max(0, Math.floor(level) || 0),
          createdAt: Date.now()
        };
        // Optimistic update both state and local cache immediately
        setAllFolders(prev => {
          const next = [...prev.filter(f => f.id !== tempFolder.id), tempFolder];
          saveGuestFolders(next, user.uid);
          return next;
        });
        if (cleanParentId === (currentParentId || null)) {
          setFolders(prev => [...prev.filter(f => f.id !== tempFolder.id), tempFolder]);
        }

        try {
          const createdFolder = await saveFolderDirect(user.uid, tempFolder);
          if (accountUidRef.current !== user.uid) return;
          if (createdFolder && createdFolder.id !== tempFolder.id) {
            setAllFolders(prev => {
              const next = prev.map(f => f.id === tempFolder.id ? createdFolder : f);
              saveGuestFolders(next, user.uid);
              return next;
            });
            setFolders(prev => prev.map(f => f.id === tempFolder.id ? createdFolder : f));
          }
        } catch (fErr) {
          console.warn("Folder created locally (cloud sync pending):", fErr);
        }
      } else if (type === 'note') {
        let targetFolderId = parentId || currentParentId;
        if (!targetFolderId) {
          const rootFolder = allFolders.find(f => !f.parentId) || allFolders[0];
          if (rootFolder) {
            targetFolderId = rootFolder.id;
          } else {
            const newF = await createFolder(user.uid, 'General', null, 1);
            if (accountUidRef.current !== user.uid) return;
            targetFolderId = newF?.id || 'general';
          }
        }
        const createdNote = await createNote(user.uid, targetFolderId, name);
        if (accountUidRef.current !== user.uid) return;
        const normalized = normalizeNote(createdNote);
        setAllVaultNotes(prev => {
          const next = [normalized, ...prev.filter(n => n.id !== normalized.id)];
          saveGuestNotes(next, user.uid);
          return next;
        });
        if ((targetFolderId || null) === (currentParentId || null)) {
          setNotes(prev => [normalized, ...prev.filter(n => n.id !== normalized.id)]);
        }
        addToRecentNotes(normalized.id);
        handleSelectNote(normalized, 0, 0);
        setIsEditingNote(true);
      }
    } catch (err: any) {
      if (user && accountUidRef.current === user.uid) { setAllFolders(loadGuestFolders(user.uid)); setAllVaultNotes(loadGuestNotes(user.uid).map(normalizeNote)); }
      showToast("Creation is saved locally if staged; cloud confirmation is pending.", "info");
    }
  };

  const handleRenameFolder = async (folderId: string) => {
    const folder = allFolders.find(f => f.id === folderId) || folders.find(f => f.id === folderId);
    setPromptModal({
      isOpen: true,
      title: "Rename Folder",
      defaultValue: folder?.name || "",
      onConfirm: async (newName) => {
        setPromptModal(null);
        if (!newName) return;
        const trimmedName = newName.trim();
        if (!trimmedName) return;

        // Optimistic update
        setAllFolders(prev => prev.map(f => f.id === folderId ? { ...f, name: trimmedName } : f));
        setFolders(prev => prev.map(f => f.id === folderId ? { ...f, name: trimmedName } : f));
        setPath(prev => prev.map(f => f.id === folderId ? { ...f, name: trimmedName } : f));

        const activeUid = user ? user.uid : undefined;
        const currentFolders = loadGuestFolders(activeUid);
        saveGuestFolders(currentFolders.map(f => f.id === folderId ? { ...f, name: trimmedName } : f), activeUid);

        if (user) {
          try {
            await renameFolder(user.uid, folderId, trimmedName);
          } catch (err) {
            console.warn("Failed to sync rename folder to cloud:", err);
            showToast('Rename saved locally; cloud sync will retry. Check connectivity and use Retry cloud sync.', 'error');
          }
        }
      }
    });
  };

  const handleMoveFolder = async (folderId: string, newParentId: string | null) => {
    if (!canMoveFolder(allFolders, folderId, newParentId)) {
      showToast('Cannot move a folder into itself, a descendant, or an invalid folder tree.', 'error');
      return;
    }
    let newLevel = 1;
    if (newParentId) {
      const parent = allFolders.find(f => f.id === newParentId);
      if (parent) {
        newLevel = (parent.level || 1) + 1;
      }
    }

    if (!user) {
      const updated = loadGuestFolders().map(f => f.id === folderId ? { ...f, parentId: newParentId, level: newLevel } : f);
      saveGuestFolders(updated);
      setAllFolders(updated);
      setMovingFolder(null);
      return;
    }

    setAllFolders(prev => prev.map(f => f.id === folderId ? { ...f, parentId: newParentId, level: newLevel } : f));
    setMovingFolder(null);
    try {
      await moveFolder(user.uid, folderId, newParentId, newLevel);
    } catch (err) {
      console.warn("Move folder sync:", err);
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    setConfirmModal({
      isOpen: true,
      title: "Delete Folder",
      message: "Are you sure you want to delete this folder and all its contents? Notes inside will be kept in Trash for 30 days; the folder itself cannot be restored.",
      onConfirm: async () => {
        try {
          const folderIdsToDelete = collectFolderIds(allFolders, folderId);
          for (const n of loadGuestNotes(user?.uid).filter(n => folderIdsToDelete.has(n.folderId))) addToTrash(user?.uid, n);

          if (currentParentId && folderIdsToDelete.has(currentParentId)) {
            setCurrentParentId(null);
            setPath([]);
            try {
              localStorage.removeItem('uninote_current_folder_id');
              const url = new URL(window.location.href);
              url.searchParams.delete('folderId');
              window.history.replaceState({}, '', url.toString());
            } catch {}
          }

          if (selectedNote && folderIdsToDelete.has(selectedNote.folderId)) {
            handleCloseNote();
          }

          if (!user) {
            const allF = loadGuestFolders().filter(f => !folderIdsToDelete.has(f.id));
            const allN = loadGuestNotes().filter(n => !folderIdsToDelete.has(n.folderId));
            saveGuestFolders(allF);
            saveGuestNotes(allN);
            setAllFolders(allF);
            setAllVaultNotes(allN);
            setConfirmModal(null);
            return;
          }

          await deleteFolderRecursive(user.uid, folderId);
          await fetchItems(user.uid, currentParentId);
          setConfirmModal(null);
        } catch (error: any) {
          showToast("Folder deletion was not fully confirmed: " + error.message, "error");
          setConfirmModal(null);
        }
      },
      onCancel: () => setConfirmModal(null)
    });
  };

  const handleDeleteNote = async (noteId: string) => {
    setConfirmModal({
      isOpen: true,
      title: "Delete Note",
      message: "Are you sure you want to delete this note? It will be kept in Trash for 30 days.",
      onConfirm: async () => {
        try {
          setRecentNoteIds(prev => {
            const updated = prev.filter(id => id !== noteId);
            try {
              localStorage.setItem('uninote_recent_note_ids', JSON.stringify(updated));
            } catch {}
            return updated;
          });

          const doomed = loadGuestNotes(user?.uid).find(n => n.id === noteId);
          if (doomed) addToTrash(user?.uid, doomed);
          if (!user) {
            const updated = loadGuestNotes().filter(n => n.id !== noteId);
            saveGuestNotes(updated);
            setAllVaultNotes(updated);
            setNotes(prev => prev.filter(n => n.id !== noteId));
            if (selectedNote && selectedNote.id === noteId) {
              setSelectedNote(null);
            }
            fetchItems('guest_user', currentParentId);
            setConfirmModal(null);
            return;
          }

          if (selectedNoteRef.current?.id === noteId) handleCloseNote();
          await deleteNote(user.uid, noteId);
          if (accountUidRef.current !== user.uid) return;
          setNotes(prev => prev.filter(n => n.id !== noteId));
          setAllVaultNotes(prev => prev.filter(n => n.id !== noteId));
          const currentNotes = loadGuestNotes(user.uid);
          saveGuestNotes(currentNotes.filter(n => n.id !== noteId), user.uid);
          if (selectedNote && selectedNote.id === noteId) {
            setSelectedNote(null);
          }
          fetchItems(user.uid, currentParentId);
          setConfirmModal(null);
        } catch (error: any) {
          showToast("Failed to delete note: " + error.message, "error");
        }
      },
      onCancel: () => setConfirmModal(null)
    });
  };

  const toggleFolder = (folderId: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folderId)) {
      newExpanded.delete(folderId);
    } else {
      newExpanded.add(folderId);
    }
    setExpandedFolders(newExpanded);
  };

  const FolderTreeItem = React.memo(({ folder, level, ancestors = [] }: { folder: Folder, level: number, key?: string, ancestors?: string[] }) => {
    const visited = new Set([...ancestors, folder.id]);
    const children = allFolders.filter(f => f.parentId === folder.id && !visited.has(f.id));
    const isExpanded = expandedFolders.has(folder.id);
    const hasChildren = children.length > 0;

    return (
      <div key={folder.id} className="w-full flex flex-col">
        {/* Row UI */}
        <div
          onClick={() => {
            navigateToFolder(folder);
          }}
          className={cn(
            "w-full p-3.5 sm:p-4 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-white/20 hover:bg-white/[0.06] transition-all cursor-pointer flex items-center justify-between group",
            level === 1 && "ml-4 border-l-2 border-white/15",
            level === 2 && "ml-8 border-l-2 border-white/15"
          )}
        >
          <div className="flex items-center gap-3 overflow-hidden flex-1 min-w-0">
            {/* Left side tick / chevron button: Toggles accordion inline without navigating away */}
            {hasChildren && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFolder(folder.id);
                }}
                className="w-6 h-6 flex items-center justify-center shrink-0 rounded-lg hover:bg-white/10 text-neutral-400 hover:text-text transition-colors p-0.5 cursor-pointer"
                title={isExpanded ? "Collapse subfolders" : "Expand subfolders"}
              >
                <ChevronRight
                  className={cn(
                    "w-4 h-4 transition-transform duration-200",
                    isExpanded && "rotate-90"
                  )}
                />
              </button>
            )}

            <FolderIcon className={cn(
              "w-5 h-5 shrink-0",
              level === 0 ? "text-sky-400" : level === 1 ? "text-indigo-400" : "text-amber-400"
            )} strokeWidth={2} />

            <div className="flex flex-col min-w-0 flex-1">
              <span className="folder-title truncate text-sm sm:text-base font-semibold text-text group-hover:text-accent transition-colors">
                {folder.name}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigateToFolder(folder);
                setIsCreating('note');
                setCreateParentId(folder.id);
              }}
              className="p-1.5 rounded-lg text-text/50 hover:text-text hover:bg-white/10 transition-colors"
              title="Add Note to this Folder"
            >
              <FileText size={16} />
            </button>
            {level < 2 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsCreating('folder');
                  setCreateParentId(folder.id);
                  setCreateLevel(level + 1);
                }}
                className="p-1.5 rounded-lg text-text/50 hover:text-text hover:bg-white/10 transition-colors"
                title="Add Subfolder"
              >
                <Plus size={16} />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); handleRenameFolder(folder.id); }}
              className="p-1.5 rounded-lg text-text/50 hover:text-text hover:bg-white/10 transition-colors"
              title="Rename Folder"
            >
              <Edit2 size={16} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setMovingFolder(folder); }}
              className="p-1.5 rounded-lg text-text/50 hover:text-text hover:bg-white/10 transition-colors"
              title="Move Folder"
            >
              <GripVertical size={16} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder.id); }}
              className="p-1.5 rounded-lg text-text/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Delete Folder"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        {/* Children Accordion */}
        <div className={cn(
          "grid transition-all duration-300 ease-in-out",
          isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}>
          <div className="overflow-hidden">
            <div className="flex flex-col gap-1 my-1">
              {children.map(child => (
                <FolderTreeItem key={child.id} folder={child} level={level + 1} ancestors={[...visited]} />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  });

  const navigateToFolder = (folder: Folder) => {
    editorFlushRef.current?.();
    setPath(getFolderAncestors(allFolders, folder.id));
    setCurrentParentId(folder.id);
    setSelectedNote(null);
    setIsEditingNote(false);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('folderId', folder.id);
      url.searchParams.delete('noteId');
      url.searchParams.delete('section');
      window.history.replaceState({}, '', url.toString());
      localStorage.setItem('uninote_current_folder_id', folder.id);
    } catch {}
  };

  const navigateBack = () => {
    editorFlushRef.current?.();
    if (selectedNote) {
      handleCloseNote();
      return;
    }
    if (path.length === 0) return;
    const newPath = path.slice(0, -1);
    const newParentId = newPath.length > 0 ? newPath[newPath.length - 1].id : null;
    setPath(newPath);
    setCurrentParentId(newParentId);
    try {
      const url = new URL(window.location.href);
      if (newParentId) {
        url.searchParams.set('folderId', newParentId);
        localStorage.setItem('uninote_current_folder_id', newParentId);
      } else {
        url.searchParams.delete('folderId');
        localStorage.removeItem('uninote_current_folder_id');
      }
      window.history.replaceState({}, '', url.toString());
    } catch {}
  };

  const navigateToBreadcrumb = (index: number) => {
    handleCloseNote();
    if (index === -1) {
      setPath([]);
      setCurrentParentId(null);
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('folderId');
        window.history.replaceState({}, '', url.toString());
        localStorage.removeItem('uninote_current_folder_id');
      } catch {}
    } else {
      const newPath = path.slice(0, index + 1);
      const folder = newPath[newPath.length - 1];
      setPath(newPath);
      setCurrentParentId(folder.id);
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('folderId', folder.id);
        window.history.replaceState({}, '', url.toString());
        localStorage.setItem('uninote_current_folder_id', folder.id);
      } catch {}
    }
  };

  // Note Section Logic
  const handleSaveNote = useCallback(async (sections: NoteSection[], noteId: string) => {
    if ((user?.uid || null) !== accountUidRef.current) return;
    const targetBase = selectedNoteRef.current?.id === noteId ? selectedNoteRef.current
      : loadGuestNotes(user?.uid).find(item => item.id === noteId);
    if (!targetBase) return;

    const updatedNote: Note = {
      ...targetBase,
      sections,
      updatedAt: Date.now()
    };

    // 1. Immediately update in-memory state
    if (selectedNoteRef.current?.id === noteId) {
      setSelectedNote(updatedNote);
      selectedNoteRef.current = updatedNote;
    }
    setNotes(prev => prev.map(n => n.id === updatedNote.id ? updatedNote : n));
    setAllVaultNotes(prev => prev.map(n => n.id === updatedNote.id ? updatedNote : n));

    // 2. Persist locally, retaining complete in-tab recovery data if storage fails.
    const activeUid = user ? user.uid : undefined;
    const currentLocal = loadGuestNotes(activeUid);
    const updatedLocal = currentLocal.some(n => n.id === updatedNote.id)
      ? currentLocal.map(n => n.id === updatedNote.id ? updatedNote : n)
      : [updatedNote, ...currentLocal];
    const locallySaved = saveGuestNotes(updatedLocal, activeUid);

    // If working in guest mode or if this note is imported (not yet explicitly kept to cloud account), keep local
    if (!user || updatedNote.isImported) {
      setSyncStatus(locallySaved ? 'local' : 'error');
      return;
    }

    // 3. For logged-in users, sync to Firestore
    setSyncStatus('syncing');
    try {
      const savedDoc = await saveNoteDirect(user.uid, updatedNote);
      if (accountUidRef.current === user.uid) {
        setSyncStatus('synced');
        if (savedDoc && selectedNoteRef.current?.id === noteId) {
          selectedNoteRef.current = savedDoc;
          setSelectedNote(savedDoc);
        }
      }
    } catch (err: any) {
      console.warn("Cloud write deferred, saved to local storage:", err);
      if (accountUidRef.current === user.uid) setSyncStatus('local');
    }
  }, [user]);

  const handleAsyncInsertion = (noteId: string, sectionId: string, base: string, start: number, end: number, insertion: string) => {
    if ((user?.uid || null) !== accountUidRef.current) return;
    editorFlushRef.current?.();
    const target = selectedNoteRef.current?.id === noteId ? selectedNoteRef.current : loadGuestNotes(user?.uid).find(item => item.id === noteId);
    if (!target || !target.sections.some(section => section.id === sectionId)) return;
    const sections = target.sections.map(section => section.id === sectionId
      ? { ...section, content: insertAtSelection(section.content, base, start, end, insertion) } : section);
    void handleSaveNote(sections, noteId);
  };

  const handleExportVault = (note: Note, currentSectionIndex = 0) => {
    editorFlushRef.current?.();
    const latest = loadGuestNotes(user?.uid).find(item => item.id === note.id) || note;
    setExportCurrentOnly(false);
    const folders = loadGuestFolders(user?.uid); const included = new Set<string>(); let parent = latest.folderId;
    while (parent && !included.has(parent)) { included.add(parent); parent = folders.find(folder => folder.id === parent)?.parentId || ''; }
    setExportTarget({ notes: [latest], folders: folders.filter(folder => included.has(folder.id)), title: latest.title, sectionIndex: currentSectionIndex });
  };
  const exportNotes = async (format: 'json' | 'md' | 'html') => {
    if (!exportTarget || isExporting) return;
    editorFlushRef.current?.(); setIsExporting(true);
    try {
      const current = loadGuestNotes(user?.uid);
      const notes = exportTarget.notes.map(note => current.find(item => item.id === note.id) || note).map(note => exportCurrentOnly && exportTarget.sectionIndex !== undefined ? { ...note, sections: [note.sections[exportTarget.sectionIndex]] } : note);
      const backup = await createVaultBackup(notes, exportTarget.folders, async id => (await getLocalMediaBlob(id)) || (user ? fetchVaultMediaFromFirestore(user.uid, id) : null));
      const content = format === 'json' ? JSON.stringify(backup) : format === 'md' ? backupMarkdown(backup) : backupHtml(backup);
      if (new TextEncoder().encode(content).length > 50 * 1024 * 1024) throw new Error('Export exceeds 50 MB. Export fewer notes or individual sections.');
      downloadFile(content, `${exportTarget.title}.${format}`, format === 'json' ? 'application/json' : format === 'md' ? 'text/markdown' : 'text/html');
      setExportTarget(null); showToast('Export ready. Local images are included; external image/video URLs still require their hosts.', 'success');
    } catch (err: any) { showToast(`Export failed: ${err.message}`, 'error'); }
    finally { setIsExporting(false); }
  };
  const handleImportVault = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    editorFlushRef.current?.();
    const uid = user?.uid;
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('Import exceeds 50 MB; split the backup into smaller vaults.');
      const raw = await file.text();
      const parsed = /\.json$/i.test(file.name) ? JSON.parse(raw) : { title: file.name.replace(/\.[^.]+$/, ''), content: raw };
      const existingFolders = loadGuestFolders(uid);
      const destination = currentParentId || existingFolders.find(folder => !folder.parentId)?.id || `folder_${crypto.randomUUID()}`;
      const plan = planVaultImport(parsed, destination);
      const mediaMap = new Map<string, string>();
      for (const [id, value] of Object.entries(plan.media)) mediaMap.set(id, await registerLocalImage(value, id));
      let missingImages = 0;
      for (const note of plan.notes) for (const section of note.sections) {
        section.content = section.content.replace(/(^|[\s(])(media_[a-zA-Z0-9._-]+)(?=[\s)"']|$)/gm, (_, prefix, id) => prefix + (mediaMap.get(id) || id));
        section.content = await sanitizeContentImages(section.content);
        for (const id of getMediaReferences(section.content)) if (!(await getLocalMediaBlob(id))) missingImages++;
      }
      if ((uid || null) !== accountUidRef.current) return;
      // Re-read after async media work so intervening edits are never overwritten.
      const folders = loadGuestFolders(uid);
      if (plan.notes.some(note => note.folderId === destination) && !folders.some(folder => folder.id === destination)) plan.folders.unshift({ id: destination, name: 'Imported Notes', parentId: null, level: 0, createdAt: Date.now() });
      const nextFolders = [...folders, ...plan.folders];
      const nextNotes = [...plan.notes, ...loadGuestNotes(uid)];
      const folderSaved = saveGuestFolders(nextFolders, uid); const notesSaved = saveGuestNotes(nextNotes, uid);
      setAllFolders(nextFolders); setAllVaultNotes(nextNotes);
      if (missingImages) setImportWarning(`${missingImages} image reference(s) have no local Blob or archived image. Note text is retained; restore those images before exporting a complete backup.`);
      else setImportWarning(null);
      if (plan.notes[0]) { addToRecentNotes(plan.notes[0].id); handleSelectNote(plan.notes[0], 0, 0); }
      setSyncStatus(folderSaved && notesSaved ? 'local' : 'error');
      showToast(`Imported ${plan.notes.length} note(s) and ${plan.folders.length} folder(s). Imports remain local until explicitly kept.`, 'success');
    } catch (err: any) { if ((uid || null) === accountUidRef.current) showToast(`Failed to import file: ${err.message}`, 'error'); }
  };

  const handleKeepNote = async (targetSections?: NoteSection[]) => {
    if (!selectedNote) return;

    const sectionsToKeep = (targetSections && targetSections.length > 0)
      ? targetSections
      : (selectedNote.sections && selectedNote.sections.length > 0 ? selectedNote.sections : [{ id: 's1', title: 'Introduction', content: '' }]);

    let targetFolderId = selectedNote.folderId || currentParentId;
    if (!targetFolderId) {
      const rootFolder = allFolders.find(f => !f.parentId) || allFolders[0];
      targetFolderId = rootFolder ? rootFolder.id : 'general';
    }

    // Step 1: IMMEDIATELY mark as kept in local state so UI updates instantly and button vanishes
    const keptNote: Note = {
      ...selectedNote,
      folderId: targetFolderId,
      sections: sectionsToKeep,
      isImported: false,
      isLocalOnly: !user,
      updatedAt: Date.now()
    };

    setSelectedNote(keptNote);
    setNotes(prev => prev.map(n => n.id === keptNote.id ? keptNote : n));
    setAllVaultNotes(prev => prev.map(n => n.id === keptNote.id ? keptNote : n));
    addToRecentNotes(keptNote.id);

    // Save only to the active account cache.
    const activeUid = user ? user.uid : undefined;
    const currentLocal = loadGuestNotes(activeUid);
    const updatedLocal = currentLocal.some(n => n.id === keptNote.id)
      ? currentLocal.map(n => n.id === keptNote.id ? keptNote : n)
      : [keptNote, ...currentLocal];
    saveGuestNotes(updatedLocal, activeUid);


    if (!user) {
      setSyncStatus('local');
      showToast(`"${keptNote.title}" kept in Local Vault!`, "success");
      return;
    }

    // Step 2: For signed-in users, sync to Google Cloud account
    setSyncStatus('syncing');
    try {
      // First save immediately to Firestore
      await saveNoteDirect(user.uid, keptNote);
      if (accountUidRef.current !== user.uid) return;
      setSyncStatus('synced');
      showToast(`"${keptNote.title}" permanently saved to your Google account!`, "success");

    } catch (err: any) {
      if (accountUidRef.current !== user.uid) return;
      console.warn("Could not save to Cloud Firestore immediately:", err);
      setSyncStatus('local');
      showToast(`"${keptNote.title}" kept in vault (saved locally)`, "info");
    }
  };

  const handleKeepNoteById = async (noteId: string) => {
    const targetNote = allVaultNotes.find(n => n.id === noteId);
    if (!targetNote) return;

    let targetFolderId = targetNote.folderId || currentParentId;
    if (!targetFolderId) {
      const rootFolder = allFolders.find(f => !f.parentId) || allFolders[0];
      targetFolderId = rootFolder ? rootFolder.id : 'general';
    }

    // Step 1: Update in-memory state and local storage immediately
    const keptNote: Note = {
      ...targetNote,
      folderId: targetFolderId,
      isImported: false,
      isLocalOnly: !user,
      updatedAt: Date.now()
    };

    setNotes(prev => prev.map(n => n.id === noteId ? keptNote : n));
    setAllVaultNotes(prev => prev.map(n => n.id === noteId ? keptNote : n));
    if (selectedNote?.id === noteId) {
      setSelectedNote(keptNote);
    }
    addToRecentNotes(noteId);

    const activeUid = user ? user.uid : undefined;
    const currentLocal = loadGuestNotes(activeUid);
    const updatedLocal = currentLocal.map(n => n.id === noteId ? keptNote : n);
    saveGuestNotes(updatedLocal, activeUid);


    if (!user) {
      showToast(`"${keptNote.title}" kept in Local Vault!`, "success");
      return;
    }

    // Step 2: Persist to Google Cloud account
    try {
      await saveNoteDirect(user.uid, keptNote);
      if (accountUidRef.current !== user.uid) return;
      showToast(`"${keptNote.title}" saved to your Google account!`, "success");

    } catch (err) {
      if (accountUidRef.current !== user.uid) return;
      showToast(`"${keptNote.title}" kept in local vault`, "info");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
          <Loader2 className="w-8 h-8 text-accent" />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="app-container min-h-screen bg-bg text-text font-sans selection:bg-accent/30">
      <AnimatePresence mode="wait">
          <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-4 md:p-8 min-h-screen flex flex-col">
            <header className="top-header-bar py-4 border-b border-white/5 flex items-center justify-between">
              {/* Left: Home pill button */}
              <button
                onClick={() => navigateToBreadcrumb(-1)}
                className={cn(
                  "px-4 py-2 rounded-xl transition-all flex items-center gap-2 cursor-pointer font-semibold text-sm",
                  path.length === 0 && !selectedNote
                    ? "text-text bg-white/10 border border-white/15 shadow-sm"
                    : "text-text/70 hover:text-text hover:bg-white/5 border border-white/5"
                )}
                title="Go to Home"
              >
                <Home className="w-4 h-4 text-text" />
                <span>Home</span>
              </button>

              {/* Right: Working Import button + User menu button */}
              <div className="flex items-center gap-2 sm:gap-3">
                {/* Working Import Button */}
                <label
                  className="flex items-center gap-2 px-3 sm:px-3.5 py-2 rounded-xl bg-accent text-on-accent font-bold text-xs sm:text-sm hover:bg-accent/90 active:scale-95 transition-all shadow-md shadow-accent/15 cursor-pointer shrink-0"
                  title="Import Note (.json, .md, .txt)"
                >
                  <Upload className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" />
                  <span>Import</span>
                  <input
                    type="file"
                    accept=".json,.md,.markdown,.txt"
                    onChange={handleImportVault}
                    className="hidden"
                  />
                </label>

                {!user && (
                  <button
                    type="button"
                    onClick={handleSignIn}
                    disabled={isSigningIn}
                    className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-text font-medium text-xs transition-all cursor-pointer"
                    title="Sign in with Google"
                  >
                    {isSigningIn ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <LogIn className="w-3.5 h-3.5" />
                    )}
                    <span>{isSigningIn ? "Signing in..." : "Sign in"}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setIsUserDrawerOpen(true)}
                  className="flex items-center gap-1.5 p-1 rounded-2xl hover:bg-white/5 border border-white/10 transition-all cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  title="Open Account & Settings"
                  aria-label="Open Account & Settings"
                >
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full overflow-hidden border border-white/20 bg-white/10 flex items-center justify-center shrink-0 shadow-sm group-hover:border-accent transition-all">
                    <img
                      src={user?.photoURL || DEFAULT_AVATAR}
                      alt={activeUser?.displayName || 'User'}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <Menu className="w-4 h-4 text-text/70 group-hover:text-text mr-1.5 transition-colors" />
                </button>
              </div>
            </header>

            {pwa.updateAvailable && <div role="status" className="my-3 p-3 rounded-xl border border-accent text-sm">A new Uni.Note version is ready. <button className="underline" onClick={async () => {
              editorFlushRef.current?.();
              if (getPendingMediaWrites() || hasPendingLocalWrites()) { showToast('Finish image saves or export unsaved changes before updating.', 'error'); return; }
              try { await applyPwaUpdate(); } catch { showToast('Update could not be applied. Keep this tab open and retry when ready.', 'error'); }
            }}>Update and reload</button></div>}
            {importWarning && <div role="alert" className="my-3 p-3 rounded-xl border border-amber-500 text-sm">{importWarning}<button className="ml-3 underline" onClick={() => setImportWarning(null)}>Dismiss</button></div>}
            {cloudWarning && user && <div role="alert" className="my-3 p-4 rounded-xl bg-amber-500/15 border border-amber-500 text-text text-sm">
              {cloudWarning} <button className="ml-3 underline" onClick={() => { void handleSyncLocalToCloud(); }}>Retry cloud sync</button>
              {readLocalValue(`uninote_conflicts_${user.uid}`) && <button className="ml-3 underline" onClick={() => {
                const url = URL.createObjectURL(new Blob([readLocalValue(`uninote_conflicts_${user.uid}`) || '[]'], { type: 'application/json' }));
                const link = document.createElement('a'); link.href = url; link.download = 'uninote-conflict-backup.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}>Download conflict backup</button>}
              <a className="ml-3 underline" href="https://console.firebase.google.com/project/steadfast-rigging-g2w8r/firestore" target="_blank" rel="noopener noreferrer">Firestore console</a>
            </div>}
            {pendingMediaWrites > 0 && <div role="status" className="my-3 p-3 rounded-xl bg-accent/10 text-text text-sm">Saving image locally… Wait before closing this tab.</div>}
            {storageWarning && (
              <div role="alert" className="my-3 p-4 rounded-xl bg-amber-500/15 border border-amber-500 text-text text-sm">
                <strong>Storage warning:</strong> {storageWarning}
                <button className="ml-3 underline" onClick={() => { if (retryPendingWrites()) setSyncStatus('local'); }}>Retry saving</button>
              </div>
            )}
            {/* Error / popup alert banner */}
            {error && (
              <div className="mt-4 mb-2 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-center justify-between gap-3 shadow-md">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
                  <span>{error} {error.includes("authorized") && <a href={googleAuthDiagnostic().authSettingsUrl} target="_blank" rel="noopener noreferrer" className="underline">Open Firebase authorized domains</a>}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={window.location.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-400/20 hover:bg-amber-400/30 text-amber-200 font-semibold underline text-xs transition-colors"
                  >
                    Open in new tab <ChevronRight className="w-3 h-3" />
                  </a>
                  <button onClick={() => setError(null)} className="p-1 text-amber-400/70 hover:text-text rounded transition-colors cursor-pointer">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Collapsible Side Panel (Drawer sliding from right) */}
            <AnimatePresence>
              {isUserDrawerOpen && (
                <>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => {
                      setIsUserDrawerOpen(false);
                      setIsThemePickerOpen(false);
                    }}
                    className="fixed inset-0 bg-black/65 backdrop-blur-sm z-[9999]"
                  />
                  <motion.aside
                    initial={{ x: '100%' }}
                    animate={{ x: 0 }}
                    exit={{ x: '100%' }}
                    transition={{ type: 'spring', damping: 26, stiffness: 300 }}
                    className="fixed top-0 right-0 bottom-0 w-84 max-w-[88vw] bg-surface border-l border-white/10 z-[10000] p-6 flex flex-col justify-between shadow-2xl overflow-y-auto"
                  >
                    <div className="space-y-6">
                      {/* Drawer Header with Close Button */}
                      <div className="flex items-center justify-between pb-4 border-b border-white/10">
                        <span className="text-xs font-bold uppercase tracking-widest text-text">ACCOUNT &amp; ACTIONS</span>
                        <button
                          onClick={() => {
                            setIsUserDrawerOpen(false);
                            setIsThemePickerOpen(false);
                          }}
                          className="p-1.5 rounded-lg text-text/40 hover:text-text hover:bg-white/10 transition-colors cursor-pointer"
                          title="Close panel"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>

                      {/* User Profile Card */}
                      <div className="flex items-center gap-3.5 p-3.5 rounded-2xl bg-white/[0.04] border border-white/10">
                        <div className="w-12 h-12 rounded-full overflow-hidden border border-white/15 bg-white/10 flex items-center justify-center shrink-0 shadow-sm">
                          <img
                            src={user?.photoURL || DEFAULT_AVATAR}
                            alt={activeUser?.displayName || 'User'}
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-bold text-text truncate">
                              {user ? (user.displayName || 'Google User') : 'Local Vault (Offline)'}
                            </h3>
                            <span className={cn(
                              "text-[10px] px-2 py-0.5 rounded-md font-semibold shrink-0 uppercase tracking-wide",
                              user ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-sky-500/20 text-sky-400 border border-sky-500/30"
                            )}>
                              {user ? "Cloud" : "Local"}
                            </span>
                          </div>
                          <p className="text-xs text-text/40 truncate mt-0.5">
                            {user ? user.email : "Saved in browser • No internet required"}
                          </p>
                        </div>
                      </div>

                      {/* Google Sign In or Cloud Sync CTA in Drawer */}
                      {!user ? (
                        <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
                          <p className="text-xs text-text/60 leading-relaxed">
                            Sign in with your Google account to sync your notes across devices and back them up in the Cloud.
                          </p>
                          <button
                            onClick={() => { setIsUserDrawerOpen(false); handleSignIn(); }}
                            disabled={isSigningIn}
                            className="w-full flex items-center justify-center gap-2.5 p-3 rounded-xl bg-accent text-on-accent font-semibold text-xs hover:bg-accent/90 active:scale-[0.98] transition-all shadow-md cursor-pointer disabled:opacity-75"
                          >
                            {isSigningIn ? <Loader2 className="w-3.5 h-3.5 animate-spin text-on-accent" /> : <LogIn className="w-3.5 h-3.5 text-on-accent" />}
                            <span>{isSigningIn ? "Connecting to Google..." : "Sign in with Google"}</span>
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={handleSyncLocalToCloud}
                          disabled={isSyncing}
                          className="w-full flex items-center justify-center gap-2.5 p-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-text border border-white/10 font-semibold text-xs transition-all cursor-pointer disabled:opacity-50"
                        >
                          {isSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" /> : <CloudUpload className="w-3.5 h-3.5 text-accent" />}
                          <span>{isSyncing ? "Syncing notes to Cloud..." : "Sync Local Notes to Cloud Account"}</span>
                        </button>
                      )}

                      {/* Quick Actions (Note, Folder, Import) */}
                      <div className="space-y-2">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-text/40 px-1">
                          CREATE &amp; ORGANIZE
                        </div>

                        <button
                          onClick={() => {
                            setIsUserDrawerOpen(false);
                            setIsCreating('note');
                            const rootFolder = allFolders.find(f => !f.parentId) || allFolders[0];
                            setCreateParentId(path.length > 0 ? currentParentId : (rootFolder ? rootFolder.id : null));
                          }}
                          className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] text-text font-medium text-sm transition-all cursor-pointer shadow-sm"
                        >
                          <Plus className="w-4 h-4 text-text" />
                          <span>New Note</span>
                        </button>

                        <button
                          onClick={() => {
                            setIsUserDrawerOpen(false);
                            if (path.length === 0) {
                              setIsCreating('folder');
                              setCreateParentId(null);
                              setCreateLevel(1);
                            } else {
                              setIsCreating('folder');
                              setCreateParentId(currentParentId);
                              setCreateLevel(path.length + 1);
                            }
                          }}
                          disabled={path.length >= 3}
                          className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] text-text font-medium text-sm transition-all cursor-pointer disabled:opacity-50 shadow-sm"
                        >
                          <FolderIcon className="w-4 h-4 text-sky-400" />
                          <span>{path.length === 0 ? "New Folder" : "New Subfolder"}</span>
                        </button>

                        <label className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] text-text font-medium text-sm transition-all cursor-pointer shadow-sm">
                          <Upload className="w-4 h-4 text-purple-400" />
                          <span>Import Vault (.json)</span>
                          <input type="file" accept=".json" onChange={(e) => { handleImportVault(e); setIsUserDrawerOpen(false); }} className="hidden" />
                        </label>
                      </div>

                      <div className="space-y-2">
                        <button className="w-full p-3 rounded-xl border border-white/10 text-left" onClick={async () => {
                          editorFlushRef.current?.();
                          try { const result = await installPwa(); showToast(result === 'manual' ? 'Install: Chrome/Edge → browser menu → Install app. On iPhone/iPad: Safari → Share → Add to Home Screen.' : result === 'accepted' ? 'Installation requested. Complete the browser installation dialog.' : result === 'installed' ? 'Uni.Note is already running as an installed app.' : 'Installation dismissed; you can try again from the browser menu.', 'info'); }
                          catch { showToast('Installation could not start. Use your browser menu → Install app / Add to Home Screen.', 'info'); }
                        }}><Download className="inline w-4 h-4 mr-2" />{pwa.installed ? 'Uni.Note installed' : 'Install Uni.Note'}</button>
                        <button className="w-full p-3 rounded-xl border border-white/10 text-left" onClick={() => {
                          editorFlushRef.current?.(); setExportCurrentOnly(false);
                          setExportTarget({ notes: loadGuestNotes(user?.uid), folders: loadGuestFolders(user?.uid), title: 'Uni.Note-Vault' }); setIsUserDrawerOpen(false);
                        }}><Download className="inline w-4 h-4 mr-2" />Export all notes & folders</button>
                      </div>
                      {/* Sync & Media health center */}
                      <div className="space-y-2">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-text/40 px-1">SYNC &amp; MEDIA</div>
                        <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 text-sm space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-text/60">Cloud sync</span>
                            <span className="font-semibold text-text">{!user ? 'Local vault only' : isSyncing ? 'Syncing…' : syncStatus === 'synced' ? 'Synced ✓' : syncStatus === 'error' ? 'Needs attention' : 'Local copy safe'}</span>
                          </div>
                          {user && <div className="flex items-center justify-between">
                            <span className="text-text/60">Images</span>
                            <span className="font-semibold text-text">{mediaHealth ? `${mediaHealth.ready} backed up${mediaHealth.pending ? ` · ${mediaHealth.pending} pending` : ''}${mediaHealth.missing ? ` · ${mediaHealth.missing} missing` : ''}` : 'Checking…'}</span>
                          </div>}
                          {user && <div className="flex items-center justify-between">
                            <span className="text-text/60">Uploads waiting</span>
                            <span className="font-semibold text-text">{pendingMediaUploads(user.uid).length}</span>
                          </div>}
                          <div className="flex gap-2 pt-1">
                            {user && <button onClick={() => { void handleSyncLocalToCloud(); }} className="flex-1 py-2 px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-semibold text-text transition-all cursor-pointer">Retry cloud sync</button>}
                            <button onClick={() => { setExportTarget({ notes: loadGuestNotes(user?.uid), folders: loadGuestFolders(user?.uid), title: 'Uni.Note-Vault' }); setIsUserDrawerOpen(false); }} className="flex-1 py-2 px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-semibold text-text transition-all cursor-pointer">Download backup</button>
                          </div>
                          {mediaHealth?.missing ? <p className="text-xs text-amber-400">Some images exist nowhere (this browser or cloud). Notes and layouts are intact — re-insert those images to restore them.</p> : null}
                        </div>
                      </div>

                      {/* Trash (30-day restore) */}
                      <div className="space-y-2">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-text/40 px-1">TRASH (30 DAYS)</div>
                        <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 text-sm space-y-2">
                          {!trashEntries.length && <p className="text-text/50 text-xs">Trash is empty. Deleted notes are kept here for 30 days.</p>}
                          {trashEntries.map(entry => (
                            <div key={entry.note.id} className="flex items-center justify-between gap-2">
                              <span className="truncate text-text/80">{entry.note.title || 'Untitled'}</span>
                              <span className="flex gap-1.5 shrink-0">
                                <button onClick={() => { void handleRestoreNote(entry.note.id); }} className="py-1 px-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-semibold text-text cursor-pointer">Restore</button>
                                <button onClick={() => handleEmptyTrashItem(entry.note.id)} className="py-1 px-2 rounded-lg bg-red-950/30 hover:bg-red-950/50 border border-red-900/30 text-xs font-semibold text-red-400 cursor-pointer">Delete forever</button>
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Preferences (Theme) */}
                      <div className="space-y-2">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-text/40 px-1">
                          PREFERENCES
                        </div>
                        <div className="relative">
                          <button
                            onClick={() => setIsThemePickerOpen(!isThemePickerOpen)}
                            className="w-full flex items-center justify-between p-3.5 rounded-xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] transition-all text-sm font-semibold text-text cursor-pointer shadow-sm"
                            title="Choose Theme"
                          >
                            <div className="flex items-center gap-2.5">
                              <Palette className="w-4 h-4 text-amber-400" />
                              <span className="font-medium">Theme Option</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-text font-medium capitalize px-3 py-1 rounded-lg bg-white/10 border border-white/10">
                                {currentTheme}
                              </span>
                              <ChevronDown className={cn("w-3.5 h-3.5 text-text/40 transition-transform", isThemePickerOpen && "rotate-180")} />
                            </div>
                          </button>

                          {isThemePickerOpen && (
                            <div className="mt-2 p-2 rounded-2xl bg-surface border border-white/10 shadow-2xl space-y-1">
                              {THEMES_LIST.map(t => (
                                <button
                                  key={t.id}
                                  onClick={() => {
                                    applyTheme(t.id);
                                    setIsThemePickerOpen(false);
                                  }}
                                  className={cn(
                                    "w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer",
                                    currentTheme === t.id ? "bg-white/15 text-text" : "text-text/60 hover:text-text hover:bg-white/5"
                                  )}
                                >
                                  <div className="flex items-center gap-2.5">
                                    <span className="w-3.5 h-3.5 rounded-full border border-white/20 shrink-0" style={{ background: t.color }} />
                                    <span className="capitalize">{t.name}</span>
                                  </div>
                                  {currentTheme === t.id && <Check className="w-3.5 h-3.5 text-text" />}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Drawer Footer (Sign Out or Reset Demo) */}
                    <div className="pt-6 border-t border-white/10 space-y-2 mt-6">
                      {user ? (
                        <button
                          onClick={() => { setIsUserDrawerOpen(false); handleSignOut(); }}
                          className="w-full flex items-center justify-center gap-2 p-3.5 rounded-xl bg-red-950/20 hover:bg-red-950/30 text-red-400 border border-red-900/30 transition-all text-sm font-semibold cursor-pointer shadow-sm active:scale-98"
                        >
                          <LogOut className="w-4 h-4" /> Sign Out (Switch to Local Vault)
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            resetGuestDemoData();
                            fetchItems('guest_user', null);
                            setIsUserDrawerOpen(false);
                          }}
                          className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-white/5 hover:bg-white/10 text-text/70 hover:text-text border border-white/10 transition-colors text-xs font-medium cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Restore Default Demo Notebooks
                        </button>
                      )}
                    </div>
                  </motion.aside>
                </>
              )}
            </AnimatePresence>

            {/* Navigation Breadcrumb Bar - Only shown inside folders or notes, hidden on the root homepage */}
            {(path.length > 0 || selectedNote) && (
              <div className="flex items-center gap-2 py-2 sm:py-3 overflow-x-auto no-scrollbar mb-2 text-xs sm:text-sm">
                <button
                  onClick={navigateBack}
                  className="p-1.5 sm:p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-text/80 hover:text-text transition-all mr-1 cursor-pointer shrink-0 shadow-sm"
                  title="Go back"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>

                <div className="flex items-center font-medium whitespace-nowrap">
                  {path.length === 0 ? (
                    <button
                      onClick={() => navigateToBreadcrumb(-1)}
                      className="text-neutral-400 hover:text-text transition-colors cursor-pointer"
                    >
                      All Notes
                    </button>
                  ) : (
                    path.map((folder, idx) => (
                      <div key={folder.id} className="flex items-center">
                        {idx > 0 && <ChevronRight className="w-3.5 h-3.5 mx-1 text-neutral-500" />}
                        <button
                          onClick={() => navigateToBreadcrumb(idx)}
                          className={cn(
                            "hover:text-accent transition-colors max-w-[140px] truncate cursor-pointer",
                            idx === path.length - 1 && !selectedNote ? "text-text font-semibold" : "text-neutral-400"
                          )}
                        >
                          {folder.name}
                        </button>
                      </div>
                    ))
                  )}
                  {selectedNote && (
                    <div className="flex items-center">
                      <ChevronRight className="w-3.5 h-3.5 mx-1 text-neutral-500" />
                      <span className="text-text font-semibold max-w-[160px] truncate">{selectedNote.title}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <main className="flex-1 py-6">
              <AnimatePresence mode="popLayout">
                {isCreating && (
                  <motion.form
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}

                    onSubmit={(e) => {
                      e.preventDefault();
                      handleCreateItem();
                    }}
                    className="mb-6 p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center gap-3 shadow-lg"
                  >
                    {isCreating === 'folder' ? <FolderIcon className="w-5 h-5 text-accent" /> : <FileText className="w-5 h-5 text-accent" />}
                    <input
                      ref={createInputRef}
                      autoFocus
                      type="text"
                      enterKeyHint="done"
                      autoComplete="off"
                      autoCorrect="off"
                      placeholder={`${isCreating === 'folder' ? 'Folder' : 'Note'} name...`}
                      value={newItemName}
                      onChange={(e) => setNewItemName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.keyCode === 13) {
                          e.preventDefault();
                          e.stopPropagation();
                          handleCreateItem();
                        } else if (e.key === 'Escape') {
                          setIsCreating(null);
                          setNewItemName('');
                        }
                      }}
                      className="flex-1 bg-transparent border-none outline-none text-sm text-text placeholder:text-neutral-500"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          createInputRef.current?.blur();
                          setIsCreating(null);
                          setNewItemName('');
                        }}
                        className="p-2 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all cursor-pointer text-text/60"
                        title="Cancel"
                        aria-label="Cancel"
                      >
                        <X className="w-5 h-5" />
                      </button>
                      <button
                        type="submit"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleCreateItem();
                        }}
                        className="p-2 hover:text-accent hover:bg-accent/10 rounded-lg transition-all cursor-pointer text-text"
                        title="Create item"
                        aria-label="Create item"
                      >
                        <Check className="w-5 h-5 stroke-[2.5]" />
                      </button>
                    </div>
                  </motion.form>
                )}
              </AnimatePresence>

              {!selectedNote ? (
                <>
                  {/* ROOT / HOME VIEW */}
                  {path.length === 0 && (
                    <>
                      {/* Elevated Hero Section with sleek clean white border */}
                      <div className="relative overflow-hidden rounded-3xl p-8 sm:p-12 mb-8 bg-surface/95 border-2 border-white/30 hover:border-white/40 shadow-[0_0_35px_rgba(255,255,255,0.06),0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl transition-all">
                        {/* Ambient subtle radial highlight */}
                        <div className="absolute -top-24 right-0 w-[420px] h-[300px] bg-white/[0.04] blur-[120px] rounded-full pointer-events-none" />
                        <div className="absolute -bottom-24 left-0 w-[300px] h-[200px] bg-white/[0.02] blur-[100px] rounded-full pointer-events-none" />

                        <div className="relative z-10 max-w-2xl">
                          <div className="text-xs font-bold uppercase tracking-[0.2em] text-accent mb-4">
                            ACADEMIC KNOWLEDGE BASE &amp; RESEARCH
                          </div>

                          <h1 className="font-hero text-5xl sm:text-7xl font-bold text-text tracking-tight leading-[1.02] mb-5">
                            Uni<span className="text-accent">.</span>Note
                          </h1>

                          <p className="text-muted text-base sm:text-lg md:text-xl font-normal leading-relaxed mb-8 max-w-xl">
                            A distraction-free thinking environment built for mathematical research, lecture notebooks, and organized thought.
                          </p>

                          <div className="flex flex-wrap items-center gap-3">
                            <button
                              onClick={() => {
                                setIsCreating('folder');
                                setCreateParentId(null);
                                setCreateLevel(1);
                              }}
                              className="flex items-center gap-2.5 py-3 px-5 rounded-2xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-text text-sm font-semibold transition-all shadow-md active:scale-[0.98] cursor-pointer"
                            >
                              <Plus className="w-4 h-4" /> New Folder
                            </button>
                            <button
                              onClick={() => {
                                setIsCreating('note');
                                const rootFolder = allFolders.find(f => !f.parentId) || allFolders[0];
                                setCreateParentId(rootFolder ? rootFolder.id : null);
                              }}
                              className="flex items-center gap-2.5 py-3 px-5 rounded-2xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-text text-sm font-semibold transition-all shadow-md active:scale-[0.98] cursor-pointer"
                            >
                              <FileText className="w-4 h-4 text-text/80" /> New Note
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Global Search Bar */}
                      <div className="mb-8 relative">
                        <div className="relative flex items-center">
                          <Search className="w-4 h-4 text-neutral-400 absolute left-4.5 pointer-events-none" />
                          <input
                            ref={homeSearchInputRef}
                            type="text"
                            placeholder="Search research, notes, and folders... (Press / to search)"
                            value={homeSearchQuery}
                            onChange={(e) => setHomeSearchQuery(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                setHomeSearchQuery('');
                                homeSearchInputRef.current?.blur();
                              }
                            }}
                            className="w-full pl-12 pr-16 py-3.5 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-white/20 focus:border-white/30 text-sm text-text placeholder:text-neutral-500 transition-all outline-none"
                          />
                          <div className="absolute right-4 flex items-center gap-1.5 pointer-events-auto">
                            {homeSearchQuery ? (
                              <button
                                onClick={() => {
                                  setHomeSearchQuery('');
                                  homeSearchInputRef.current?.focus();
                                }}
                                className="p-1 hover:text-text text-text/40 transition-colors cursor-pointer"
                                title="Clear search (Esc)"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            ) : (
                              <kbd className="hidden sm:inline-block text-xs font-mono text-neutral-400 bg-white/5 border border-white/10 px-2 py-0.5 rounded-lg pointer-events-none">
                                /
                              </kbd>
                            )}
                          </div>
                        </div>

                        {/* Search Results Dropdown */}
                        {homeSearchQuery.trim() && (
                          <div className="mt-3 p-3 rounded-2xl bg-surface border border-white/10 shadow-2xl space-y-1 max-h-80 overflow-y-auto">
                            <div className="px-2 py-1 text-[11px] font-bold text-text/40 uppercase tracking-widest flex items-center justify-between">
                              <span>Search Results ({filteredSearchNotes.length + filteredSearchFolders.length})</span>
                              <span className="text-[10px] text-text/30 lowercase">esc to close</span>
                            </div>
                            {filteredSearchFolders.map(folder => (
                              <div
                                key={folder.id}
                                onClick={() => {
                                  setHomeSearchQuery('');
                                  navigateToFolder(folder);
                                }}
                                className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/5 cursor-pointer group transition-colors"
                              >
                                <FolderIcon className="w-4 h-4 text-sky-400 shrink-0" />
                                <span className="text-sm font-semibold text-text group-hover:text-accent truncate">
                                  {folder.name}
                                </span>
                                <span className="text-[11px] text-text/40 ml-auto">Folder</span>
                              </div>
                            ))}
                            {filteredSearchNotes.map(note => (
                              <div
                                key={note.id}
                                onClick={() => {
                                  setHomeSearchQuery('');
                                  handleSelectNote(note, 0, 0);
                                }}
                                className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/5 cursor-pointer group transition-colors"
                              >
                                <FileText className="w-4 h-4 text-text/80 shrink-0" />
                                <div className="min-w-0 flex-1">
                                  <h4 className="text-sm font-medium text-text group-hover:text-accent truncate">
                                    {note.title}
                                  </h4>
                                  <p className="text-[11px] text-text/40 truncate">
                                    {cleanSnippet(note.sections[0]?.content)}
                                  </p>
                                </div>
                                <span className="text-[11px] text-text/40 shrink-0">Note</span>
                              </div>
                            ))}
                            {filteredSearchNotes.length === 0 && filteredSearchFolders.length === 0 && (
                              <div className="py-6 text-center text-xs text-text/40">
                                No notes or folders match "{homeSearchQuery}"
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Recent Notes Section (Clearable just like search history) */}
                      {!homeSearchQuery.trim() && allVaultNotes.length > 0 && (
                        <div className="mb-10">
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                              <Clock className="w-4 h-4 text-text" />
                              <h3 className="text-sm font-bold text-text tracking-tight">Recent Notes</h3>
                              {recentNotes.length > 0 && (
                                <span className="text-[11px] px-2 py-0.5 rounded-md bg-white/5 text-neutral-400 font-medium">
                                  {recentNotes.length}
                                </span>
                              )}
                            </div>
                            {recentNotes.length > 0 ? (
                              <button
                                type="button"
                                onClick={handleClearRecentNotes}
                                className="text-xs text-neutral-400 hover:text-text flex items-center gap-1.5 py-1 px-2.5 rounded-lg hover:bg-white/10 transition-all cursor-pointer font-medium border border-transparent hover:border-white/10"
                                title="Clear recent notes history"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Clear recent</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={handleRestoreRecentNotes}
                                className="text-xs text-neutral-400 hover:text-text flex items-center gap-1.5 py-1 px-2 rounded-lg hover:bg-white/5 transition-all cursor-pointer font-medium"
                                title="Reset recent notes history"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>Reset list</span>
                              </button>
                            )}
                          </div>

                          {recentNotes.length > 0 ? (
                            <div className="space-y-2.5">
                              {recentNotes.map(note => (
                                <div
                                  key={note.id}
                                  onClick={() => handleSelectNote(note, 0, 0)}
                                  className="w-full p-4 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-white/20 hover:bg-white/[0.06] transition-all cursor-pointer flex items-center justify-between group relative"
                                >
                                  <div className="flex items-center gap-3.5 min-w-0 flex-1 pr-3">
                                    <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center shrink-0 text-text/70 group-hover:text-text transition-colors">
                                      <FileText className="w-4 h-4" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <h4 className="text-sm font-semibold text-text group-hover:text-accent transition-colors truncate">
                                          {note.title}
                                        </h4>
                                        {note.isImported && (
                                          <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-semibold">
                                              Imported
                                            </span>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleKeepNoteById(note.id);
                                              }}
                                              className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500 hover:bg-amber-400 text-black font-bold transition-all shadow-sm flex items-center gap-1 cursor-pointer active:scale-95"
                                              title="Keep note permanently in your vault / account"
                                            >
                                              <CloudUpload className="w-3 h-3" />
                                              <span>Keep</span>
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                      <p className="text-xs text-neutral-400 mt-0.5 line-clamp-1">
                                        {cleanSnippet(note.sections[0]?.content)}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2.5 text-xs text-neutral-400 shrink-0">
                                    <span className="hidden sm:inline">{note.sections.length} {note.sections.length === 1 ? 'section' : 'sections'}</span>
                                    <span className="text-text/80 group-hover:text-text transition-colors flex items-center gap-1 font-medium">
                                      Open <ChevronRight className="w-3.5 h-3.5" />
                                    </span>
                                    <button
                                      type="button"
                                      onClick={(e) => handleRemoveFromRecent(e, note.id)}
                                      className="p-1.5 rounded-lg text-neutral-500 hover:text-text hover:bg-white/10 transition-colors ml-1 cursor-pointer"
                                      title="Remove from recent notes"
                                      aria-label="Remove from recent notes"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="p-5 rounded-2xl bg-white/[0.02] border border-dashed border-white/10 text-center flex flex-col items-center justify-center py-6">
                              <p className="text-xs text-neutral-400 font-medium">Recent notes history cleared</p>
                              <p className="text-[11px] text-neutral-500 mt-1">Notes you open or edit will appear here</p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Knowledge Base Root Folders - Matching Image 1 */}
                      <div className="mb-12">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-wider">FOLDERS</h3>
                          <span className="text-xs text-neutral-400">
                            {allFolders.filter(isRootFolder).length} root folders
                          </span>
                        </div>
                        <div className="space-y-2">
                          {allFolders.filter(isRootFolder).map(folder => (
                            <FolderTreeItem key={folder.id} folder={folder} level={0} />
                          ))}
                          {allFolders.filter(isRootFolder).length === 0 && (
                            <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-white/10 rounded-3xl bg-white/[0.01]">
                              <FolderIcon className="w-8 h-8 text-neutral-600 mb-3" />
                              <p className="text-neutral-400 text-sm font-medium">No folders created yet.</p>
                              <button
                                onClick={() => {
                                  setIsCreating('folder');
                                  setCreateParentId(null);
                                  setCreateLevel(1);
                                }}
                                className="mt-3 text-accent text-sm font-bold hover:underline cursor-pointer"
                              >
                                Create your first folder
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  {/* INSIDE ANY FOLDER (Level 1, 2, or 3) */}
                  {path.length > 0 && (() => {
                    const currentFolder = path[path.length - 1];
                    const subfolders = allFolders.filter(f => f.parentId === currentParentId);

                    return (
                      <div className="space-y-8">
                        {/* Folder Title Header */}
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-4">
                          <div className="flex items-center gap-2.5">
                            <h1 className="text-2xl font-bold text-text tracking-tight">{currentFolder.name}</h1>
                            <button
                              type="button"
                              onClick={() => handleRenameFolder(currentFolder.id)}
                              className="p-1.5 rounded-lg text-text/50 hover:text-text hover:bg-white/10 transition-colors cursor-pointer"
                              title="Rename Folder"
                            >
                              <Edit2 size={16} />
                            </button>
                          </div>
                          <div className="flex items-center gap-2.5">
                            <button
                              onClick={() => {
                                setIsCreating('folder');
                                setCreateParentId(currentFolder.id);
                                setCreateLevel((currentFolder.level || 1) + 1);
                              }}
                              className="flex items-center gap-2 py-2 px-3.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-text text-sm font-semibold transition-all cursor-pointer"
                            >
                              <FolderIcon className="w-4 h-4 text-accent" />
                              <span>Subfolder</span>
                            </button>
                            <button
                              onClick={() => {
                                setIsCreating('note');
                                setCreateParentId(currentFolder.id);
                              }}
                              className="flex items-center gap-2 py-2 px-4 rounded-xl bg-accent text-on-accent text-sm font-bold hover:bg-accent/90 transition-all shadow-md cursor-pointer active:scale-95"
                            >
                              <Plus className="w-4 h-4 stroke-[3]" />
                              <span>New Note</span>
                            </button>
                          </div>
                        </div>

                        {/* Notes Section */}
                        <div>
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                              <h2 className="text-lg font-bold text-text">Notes</h2>
                              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-white/10 text-text/70">
                                {notes.length}
                              </span>
                            </div>
                            {notes.length > 0 && (
                              <button
                                onClick={() => {
                                  setIsCreating('note');
                                  setCreateParentId(currentFolder.id);
                                }}
                                className="text-xs font-bold text-accent hover:underline flex items-center gap-1 cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" /> Add Note
                              </button>
                            )}
                          </div>

                          {notes.length > 0 ? (
                            <div className="flex flex-col gap-2.5">
                              {notes.map((note) => (
                                <motion.div layout key={note.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="group relative">
                                  <div onClick={() => handleSelectNote(note, 0, 0)} className="w-full p-4 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-between cursor-pointer transition-all hover:bg-white/10 hover:border-white/10">
                                    <div className="flex items-center gap-3.5 min-w-0 flex-1 pr-24">
                                      <div className="w-9 h-9 bg-accent/10 rounded-xl flex items-center justify-center shrink-0">
                                        <FileText className="w-4 h-4 text-accent" />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 min-w-0">
                                          <h4 className="text-sm font-semibold text-text truncate">{note.title}</h4>
                                          {note.isImported && (
                                            <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-semibold">
                                                Imported
                                              </span>
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleKeepNoteById(note.id);
                                                }}
                                                className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500 hover:bg-amber-400 text-black font-bold transition-all shadow-sm flex items-center gap-1 cursor-pointer active:scale-95"
                                                title="Keep note permanently in your vault / account"
                                              >
                                                <CloudUpload className="w-3 h-3" />
                                                <span>Keep</span>
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                        <p className="text-xs text-text/40 mt-0.5 line-clamp-1">
                                          {cleanSnippet(note.sections?.[0]?.content)}
                                        </p>
                                      </div>
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1.5 opacity-60 group-hover:opacity-100 transition-all z-10">
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleRenameNote(note.id); }}
                                        className="admin-action-btn bg-black/60 backdrop-blur-md border border-white/10 hover:text-amber-400"
                                        title="Rename Note"
                                      >
                                        <Edit2 size={16} strokeWidth={2.5} />
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setMovingNote(note); }}
                                        className="admin-action-btn bg-black/60 backdrop-blur-md border border-white/10 hover:text-blue-400"
                                        title="Move Note"
                                      >
                                        <GripVertical size={16} strokeWidth={2.5} />
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteNote(note.id);
                                        }}
                                        className="admin-action-btn bg-black/60 backdrop-blur-md border border-white/10 hover:text-red-400"
                                        title="Delete Note"
                                      >
                                        <Trash2 size={16} strokeWidth={2.5} />
                                      </button>
                                    </div>
                                  </div>
                                </motion.div>
                              ))}
                            </div>
                          ) : (
                            <div className="flex flex-col items-center justify-center py-16 border border-dashed border-white/10 rounded-3xl text-center bg-white/[0.01]">
                              <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mb-3 text-text/40">
                                <FileText className="w-6 h-6" />
                              </div>
                              <h4 className="text-base font-semibold text-text">No notes in this folder yet</h4>
                              <p className="text-xs text-text/50 max-w-sm mt-1">
                                Create your first note or subfolder to begin organizing thoughts here.
                              </p>
                              <div className="flex items-center gap-3 mt-4">
                                <button
                                  onClick={() => {
                                    setIsCreating('note');
                                    setCreateParentId(currentFolder.id);
                                  }}
                                  className="flex items-center gap-2 py-2 px-4 rounded-xl bg-accent text-on-accent text-sm font-bold hover:bg-accent/90 transition-all shadow-md cursor-pointer"
                                >
                                  <Plus className="w-4 h-4 stroke-[3]" />
                                  <span>Create First Note</span>
                                </button>
                                <button
                                  onClick={() => {
                                    setIsCreating('folder');
                                    setCreateParentId(currentFolder.id);
                                    setCreateLevel((currentFolder.level || 1) + 1);
                                  }}
                                  className="flex items-center gap-2 py-2 px-3.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-text text-sm font-semibold transition-all cursor-pointer"
                                >
                                  <FolderIcon className="w-4 h-4 text-accent" />
                                  <span>Add Subfolder</span>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Subfolders Section */}
                        {subfolders.length > 0 && (
                          <div className="pt-4 border-t border-white/5">
                            <div className="flex items-center justify-between mb-4">
                              <div className="flex items-center gap-3">
                                <h3 className="text-base font-semibold text-text/90">Subfolders</h3>
                                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white/5 text-text/60">
                                  {subfolders.length}
                                </span>
                              </div>
                              <button
                                onClick={() => {
                                  setIsCreating('folder');
                                  setCreateParentId(currentFolder.id);
                                  setCreateLevel((currentFolder.level || 1) + 1);
                                }}
                                className="text-xs font-bold text-accent hover:underline flex items-center gap-1 cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" /> New Subfolder
                              </button>
                            </div>

                            <div className="flex flex-col gap-2">
                              {subfolders.map(sub => {
                                const childFolders = allFolders.filter(f => f.parentId === sub.id);
                                return (
                                  <div
                                    key={sub.id}
                                    onClick={() => navigateToFolder(sub)}
                                    className="w-full p-3.5 rounded-2xl bg-white/5 border border-white/5 hover:border-accent/30 hover:bg-white/10 transition-all cursor-pointer flex items-center justify-between group"
                                  >
                                    <div className="flex items-center gap-3 min-w-0">
                                      <FolderIcon className="w-5 h-5 text-accent/70 shrink-0" />
                                      <div className="min-w-0">
                                        <h4 className="text-sm font-medium text-text truncate group-hover:text-accent transition-colors">
                                          {sub.name}
                                        </h4>
                                        <p className="text-[11px] text-text/40">
                                          {childFolders.length > 0 ? `${childFolders.length} subfolders` : 'Click to open'}
                                        </p>
                                      </div>
                                    </div>
                                    <ChevronRight className="w-4 h-4 text-text/20 group-hover:text-accent group-hover:translate-x-0.5 transition-all shrink-0" />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {allFolders.length === 0 && notes.length === 0 && !isCreating && path.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                      <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center"><FolderIcon className="w-8 h-8 text-text/20" /></div>
                      <div>
                        <h3 className="text-lg font-medium text-text/80">Empty Space</h3>
                        <p className="text-text/40 text-sm max-w-[240px] mx-auto">Start by creating a folder.</p>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                selectedNote && (
                  <NoteEditor
                    key={selectedNote.id}
                    note={selectedNote}
                    user={activeUser as unknown as User}
                    isEditing={isEditingNote}
                    setIsEditing={setIsEditingNote}
                    onSave={handleSaveNote}
                    onThemeChange={applyTheme}
                    editorFlushRef={editorFlushRef}
                    onAsyncInsertion={handleAsyncInsertion}
                    onExportVault={handleExportVault}
                    isUploading={isUploading}
                    syncStatus={syncStatus}
                    setConfirmModal={setConfirmModal}
                    setPromptModal={setPromptModal}
                    initialSectionIndex={initialSectionIndex}
                    initialSearchQuery={selectedSearchQuery}
                    initialScrollY={initialScrollY}
                    onSectionChange={(idx) => setInitialSectionIndex(idx)}
                    onKeepNote={handleKeepNote}
                    onRenameNote={() => handleRenameNote(selectedNote.id)}
                    showToast={showToast}
                  />
                )
              )}
            </main>
          </motion.div>
        </AnimatePresence>
      {exportTarget && <div className="fixed inset-0 z-[250] bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Export notes">
        <div className="bg-surface text-text border border-subtle rounded-2xl p-6 w-full max-w-md space-y-4">
          <h2 className="font-bold text-xl">Export {exportTarget.notes.length} note(s)</h2>
          <p className="text-sm text-muted">JSON includes all selected notes, folders, timestamps and local image Blobs. Markdown and HTML include all selected sections. External URLs remain external.</p>
          {exportTarget.sectionIndex !== undefined && <label className="flex gap-2 text-sm"><input type="checkbox" checked={exportCurrentOnly} onChange={e => setExportCurrentOnly(e.target.checked)} />Current section only</label>}
          <div className="flex gap-2">{(['json', 'md', 'html'] as const).map(format => <button key={format} disabled={isExporting} className="p-3 rounded-lg bg-accent text-on-accent disabled:opacity-50" onClick={() => void exportNotes(format)}>{format.toUpperCase()}</button>)}</div>
          <button disabled={isExporting} className="underline text-sm" onClick={() => setExportTarget(null)}>Cancel</button>
        </div>
      </div>}
      {/* Move Folder Modal */}
      <AnimatePresence>
        {movingFolder && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMovingFolder(null)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[80]"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-surface border border-white/10 z-[90] p-8 rounded-3xl shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-text">Move Folder</h3>
                <button onClick={() => setMovingFolder(null)}><X className="w-5 h-5" /></button>
              </div>
              <p className="text-sm text-text/40 mb-6">Select a new parent for <span className="text-accent">"{movingFolder.name}"</span></p>

              <div className="max-h-[300px] overflow-y-auto space-y-2 no-scrollbar mb-8">
                <button
                  onClick={() => handleMoveFolder(movingFolder.id, null)}
                  className="w-full text-left p-3 rounded-xl bg-white/5 border border-transparent hover:border-accent/30 hover:bg-accent/5 transition-all text-sm font-medium"
                >
                  Root (Level 1)
                </button>
                {allFolders.filter(f => canMoveFolder(allFolders, movingFolder.id, f.id) && f.level < 3).map(folder => (
                  <button
                    key={folder.id}
                    onClick={() => handleMoveFolder(movingFolder.id, folder.id)}
                    className="w-full text-left p-3 rounded-xl bg-white/5 border border-transparent hover:border-accent/30 hover:bg-accent/5 transition-all text-sm font-medium flex items-center gap-2"
                  >
                    <FolderIcon className="w-4 h-4 text-accent/60" />
                    {folder.name}
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Move Note Modal */}
      <AnimatePresence>
        {movingNote && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMovingNote(null)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[80]"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-surface border border-white/10 z-[90] p-8 rounded-3xl shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-text">Move Note</h3>
                <button onClick={() => setMovingNote(null)}><X className="w-5 h-5" /></button>
              </div>
              <p className="text-sm text-text/40 mb-6">Select a new parent for <span className="text-accent">"{movingNote.title}"</span></p>

              <div className="max-h-[300px] overflow-y-auto space-y-2 no-scrollbar mb-8">
                <button
                  onClick={() => handleMoveNote(movingNote.id, null)}
                  className="w-full text-left p-3 rounded-xl bg-white/5 border border-transparent hover:border-accent/30 hover:bg-accent/5 transition-all text-sm font-medium"
                >
                  Root (Level 1)
                </button>
                {allFolders.map(folder => (
                  <button
                    key={folder.id}
                    onClick={() => handleMoveNote(movingNote.id, folder.id)}
                    className="w-full text-left p-3 rounded-xl bg-white/5 border border-transparent hover:border-accent/30 hover:bg-accent/5 transition-all text-sm font-medium flex items-center gap-2"
                  >
                    <FolderIcon className="w-4 h-4 text-accent/60" />
                    {folder.name}
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      {/* Modals */}
      <ConfirmModal
        isOpen={!!confirmModal?.isOpen}
        title={confirmModal?.title || ""}
        message={confirmModal?.message || ""}
        confirmLabel={confirmModal?.confirmLabel}
        cancelLabel={confirmModal?.cancelLabel}
        variant={confirmModal?.variant}
        onConfirm={confirmModal?.onConfirm || (() => {})}
        onCancel={() => {
          if (confirmModal?.title === "Export Vault") {
            // Special case for export: Cancel means "Current Only"
            const note = selectedNote;
            if (note) {
              const vaultData = {
                title: note.title,
                sections: [note.sections[0]], // Simplified for now, ideally we'd know currentSectionIndex
                exportedAt: Date.now(),
                appVersion: '1.0'
              };
              const blob = new Blob([JSON.stringify(vaultData)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `${note.title.replace(/\s+/g, '_')}_Section.json`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              URL.revokeObjectURL(url);
            }
          }
          setConfirmModal(null);
        }}
      />
      <PromptModal
        key={promptModal?.isOpen ? `${promptModal.title}_${promptModal.defaultValue}` : 'prompt_closed'}
        isOpen={!!promptModal?.isOpen}
        title={promptModal?.title || ""}
        defaultValue={promptModal?.defaultValue || ""}
        onConfirm={promptModal?.onConfirm || (() => {})}
        onCancel={() => setPromptModal(null)}
      />

      {/* Global Toast Notifications */}
      <div className="fixed bottom-6 right-6 z-[100000] flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 15, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className={cn(
                "pointer-events-auto flex items-center gap-3 p-3.5 rounded-2xl shadow-2xl border text-sm font-medium backdrop-blur-xl",
                t.type === 'error' ? "bg-red-950/95 border-red-500/30 text-red-200" :
                t.type === 'success' ? "bg-emerald-950/95 border-emerald-500/30 text-emerald-200" :
                "bg-surface/95 border-white/10 text-text"
              )}
            >
              {t.type === 'error' && <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />}
              {t.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
              {t.type === 'info' && <Sparkles className="w-4 h-4 text-accent shrink-0" />}
              <span className="flex-1 text-xs sm:text-sm leading-relaxed">{t.message}</span>
              <button
                type="button"
                onClick={() => setToasts(prev => prev.filter(item => item.id !== t.id))}
                className="p-1 text-text/40 hover:text-text rounded-lg hover:bg-white/10 shrink-0 cursor-pointer"
                aria-label="Dismiss notification"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

interface NoteEditorProps {
  note: Note;
  user: User | null;
  isEditing: boolean;
  setIsEditing: (val: boolean) => void;
  onSave: (sections: NoteSection[], noteId: string) => void;
  editorFlushRef: React.MutableRefObject<(() => void) | null>;
  onAsyncInsertion: (noteId: string, sectionId: string, base: string, start: number, end: number, insertion: string) => void;
  onThemeChange: (theme: ThemeId) => void;
  onExportVault: (note: Note, currentSectionIndex: number) => void;
  isUploading: boolean;
  syncStatus: 'synced' | 'local' | 'syncing' | 'error';
  setConfirmModal: (val: { isOpen: boolean, title: string, message: string, onConfirm: () => void } | null) => void;
  setPromptModal: (val: { isOpen: boolean, title: string, defaultValue: string, onConfirm: (value: string) => void } | null) => void;
  initialSectionIndex?: number;
  initialSearchQuery?: string;
  initialScrollY?: number;
  onSectionChange?: (index: number) => void;
  onKeepNote?: (currentSections?: NoteSection[]) => void;
  onRenameNote?: () => void;
  showToast?: (message: string, type?: 'info' | 'success' | 'error') => void;
}

interface AppSettings {
  fontSize: number;
  zoom: number;
  fontFamily: string;
  fontWeight: number;
  theme?: ThemeId;
}

interface MathSnippet {
  label: string;
  code: string;
  desc: string;
}

const MATH_SNIPPET_CATEGORIES: { category: string; items: MathSnippet[] }[] = [
  {
    category: "Basic",
    items: [
      { label: "\\frac{a}{b}", code: "\\frac{a}{b}", desc: "Fraction" },
      { label: "\\sqrt{x}", code: "\\sqrt{x}", desc: "Square Root" },
      { label: "x^{2}", code: "x^{2}", desc: "Exponent" },
      { label: "x_{i}", code: "x_{i}", desc: "Subscript" },
      { label: "\\pm", code: "\\pm ", desc: "Plus-minus" },
      { label: "\\times", code: "\\times ", desc: "Multiplication" },
      { label: "\\div", code: "\\div ", desc: "Division" },
      { label: "\\approx", code: "\\approx ", desc: "Approximately" },
      { label: "\\neq", code: "\\neq ", desc: "Not equal" },
      { label: "\\le", code: "\\le ", desc: "Less or equal" },
      { label: "\\ge", code: "\\ge ", desc: "Greater or equal" },
      { label: "\\infty", code: "\\infty ", desc: "Infinity" },
    ]
  },
  {
    category: "Calculus",
    items: [
      { label: "\\int", code: "\\int_{a}^{b} f(x)\\,dx", desc: "Definite Integral" },
      { label: "\\iint", code: "\\iint_D f(x, y)\\,dA", desc: "Double Integral" },
      { label: "\\sum", code: "\\sum_{i=1}^{n} x_i", desc: "Summation" },
      { label: "\\prod", code: "\\prod_{i=1}^{n} x_i", desc: "Product" },
      { label: "\\lim", code: "\\lim_{x \\to 0} f(x)", desc: "Limit" },
      { label: "\\frac{df}{dx}", code: "\\frac{df}{dx}", desc: "Derivative" },
      { label: "\\frac{\\partial f}{\\partial x}", code: "\\frac{\\partial f}{\\partial x}", desc: "Partial Derivative" },
      { label: "\\nabla", code: "\\nabla ", desc: "Del / Nabla" },
    ]
  },
  {
    category: "Linear Algebra",
    items: [
      { label: "\\vec{v}", code: "\\vec{v}", desc: "Vector" },
      { label: "\\mathbf{A}", code: "\\mathbf{A}", desc: "Matrix Bold" },
      { label: "\\det(A)", code: "\\det(A)", desc: "Determinant" },
      { label: "\\|x\\|", code: "\\|\\mathbf{x}\\|", desc: "Vector Norm" },
      { label: "2×2 Matrix", code: "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}", desc: "2x2 Matrix" },
      { label: "3×3 Matrix", code: "\\begin{pmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{pmatrix}", desc: "3x3 Matrix" },
      { label: "Cases", code: "\\begin{cases} a & x > 0 \\\\ b & \\text{otherwise} \\end{cases}", desc: "Piecewise Cases" },
    ]
  },
  {
    category: "Greek",
    items: [
      { label: "\\alpha", code: "\\alpha ", desc: "Alpha" },
      { label: "\\beta", code: "\\beta ", desc: "Beta" },
      { label: "\\gamma", code: "\\gamma ", desc: "Gamma" },
      { label: "\\theta", code: "\\theta ", desc: "Theta" },
      { label: "\\lambda", code: "\\lambda ", desc: "Lambda" },
      { label: "\\mu", code: "\\mu ", desc: "Mu" },
      { label: "\\pi", code: "\\pi ", desc: "Pi" },
      { label: "\\sigma", code: "\\sigma ", desc: "Sigma" },
      { label: "\\omega", code: "\\omega ", desc: "Omega" },
      { label: "\\Delta", code: "\\Delta ", desc: "Delta" },
      { label: "\\Psi", code: "\\Psi ", desc: "Psi" },
    ]
  },
  {
    category: "Blocks",
    items: [
      { label: "$$ Display Math $$", code: "$$\n\\hat{H}\\Psi = E\\Psi\n$$\n", desc: "Centered display math" },
      { label: "Aligned Equations", code: "$$\n\\begin{aligned}\n  f(x) &= 2x + 1 \\\\\n  g(x) &= x^2\n\\end{aligned}\n$$\n", desc: "Aligned block" },
    ]
  }
];

interface ActiveMediaTarget {
  mediaType: 'image' | 'video';
  identifier: string;
  align: 'left' | 'center' | 'right';
  size: 'small' | 'medium' | 'large' | 'full';
  index?: number;
}

interface MarkdownPreviewProps {
  content: string;
  isEditing: boolean;
  searchQuery?: string;
  searchMatchIndex?: number;
  onSelectMedia?: (target: ActiveMediaTarget) => void;
}

// Bulletproof detection for media lines (handles complex URLs, query params, parens in URLs)
export const LatexBlockView: React.FC<{ formula: string; displayMode?: boolean }> = React.memo(({ formula, displayMode = true }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const cleanFormula = formula
      .replace(/^(\$\$|\\\[|\$)/, '')
      .replace(/(\$\$|\\\]|\$)$/, '')
      .trim();

    try {
      if (containerRef.current) {
        katex.render(cleanFormula, containerRef.current, {
          displayMode: displayMode,
          throwOnError: false, trust: false, strict: 'ignore', maxExpand: 1000,
        });
      } else {
        containerRef.current.textContent = cleanFormula;
      }
    } catch (e) {
      containerRef.current.textContent = cleanFormula;
    }
  }, [formula, displayMode]);

  return <div ref={containerRef} className="overflow-x-auto py-1 text-center font-serif text-text/95 select-text" />;
});

// Memoized High-Performance Markdown Preview Component
const MarkdownPreview = React.memo(({ content, isEditing, searchQuery = '', searchMatchIndex = 0, onSelectMedia }: MarkdownPreviewProps) => {
  const mediaRevision = useMediaRevision();
  const renderRef = useRef<HTMLDivElement>(null);
  const prevBaseContentRef = useRef<string>('');
  const cachedHtmlRef = useRef<string>('');
  const lastBaseForHtmlRef = useRef<string>('');

  // Memoize base content (strip markers) so marked.parse and KaTeX only run when actual text or new media changes
  const normalizeBase = useCallback((str: string) => str.replace(/\s*@@(?:left|center|right)[:-](?:small|medium|large|full)@@/gi, ''), []);
  const currentBase = useMemo(() => `${normalizeBase(content)}:media-${mediaRevision}`, [content, normalizeBase, mediaRevision]);

  const htmlContent = useMemo(() => {
    return renderContent(content);
  }, [content, mediaRevision]);

  // Dedicated event listener for gear icon & media layout clicks (always attached regardless of fast-path)
  useEffect(() => {
    const container = renderRef.current;
    if (!container) return;

    const handleMediaClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target) return;

      const triggerBtn = target.closest('.media-adjust-trigger') as HTMLElement | null;
      const mediaWrapper = target.closest('.media-embed-wrapper') as HTMLElement | null;
      const img = target.closest('img') as HTMLImageElement | null;

      if (triggerBtn || mediaWrapper || img) {
        if (target.tagName === 'IFRAME') return;

        const wrapper = (triggerBtn ? triggerBtn.closest('.media-embed-wrapper') : (mediaWrapper || img?.closest('.media-embed-wrapper'))) as HTMLElement | null;

        let mediaType: 'image' | 'video' = 'image';
        let rawUrl = '';
        let align: 'left' | 'center' | 'right' = 'center';
        let size: 'small' | 'medium' | 'large' | 'full' = 'large';
        let index: number | undefined = undefined;

        if (wrapper) {
          mediaType = (wrapper.getAttribute('data-media-type') as any) || (wrapper.classList.contains('youtube-embed-wrapper') ? 'video' : 'image');
          rawUrl = wrapper.getAttribute('data-raw-url') || wrapper.getAttribute('data-video-id') || '';
          align = (wrapper.getAttribute('data-align') as any) || 'center';
          size = (wrapper.getAttribute('data-size') as any) || 'large';

          const wrappers = Array.from(container.querySelectorAll('.media-embed-wrapper'));
          const idx = wrappers.indexOf(wrapper);
          if (idx !== -1) index = idx;
        } else if (img) {
          mediaType = 'image';
          rawUrl = img.getAttribute('src') || '';
        }

        if (rawUrl) {
          e.preventDefault();
          e.stopPropagation();
          onSelectMedia?.({
            mediaType,
            identifier: rawUrl,
            align,
            size,
            index
          });
        }
      }
    };

    container.addEventListener('click', handleMediaClick, true);
    return () => {
      container.removeEventListener('click', handleMediaClick, true);
    };
  }, [onSelectMedia]);

  useEffect(() => { void hydrateMedia(content).catch(() => undefined); }, [content]);

  useEffect(() => {
    if (isEditing) return;
    const container = renderRef.current;
    if (!container) return;

    // High-Performance Fast-Path (0.1ms, 60fps): If only media layout markers changed, update layout in-place!
    // This avoids wiping the DOM, avoids reloading YouTube iframes, and avoids re-running KaTeX across the document.
    if (currentBase === prevBaseContentRef.current && container.children.length > 0) {
      const lines = content.split('\n');
      const existingWrappers = Array.from(container.querySelectorAll('.media-embed-wrapper')) as HTMLElement[];

      existingWrappers.forEach((exWrap, wrapIdx) => {
        const rawUrl = exWrap.getAttribute('data-raw-url') || '';
        const vId = exWrap.getAttribute('data-video-id') || '';
        const imgSrc = exWrap.querySelector('img')?.getAttribute('src') || '';
        const candidates = getMediaCandidates(rawUrl || vId || imgSrc);

        let matchingLine = lines.filter(isMediaLine)[wrapIdx] || lines.find(l => {
          if (!l) return false;
          return candidates.some(c => c && l.includes(c));
        });

        // Robust fallback: match by nth media line if URL matching missed due to special characters
        if (!matchingLine) {
          const mediaLines = lines.filter(l => isMediaLine(l));
          if (mediaLines[wrapIdx]) {
            matchingLine = mediaLines[wrapIdx];
          }
        }

        if (matchingLine) {
          const match = matchingLine.match(/@@(left|center|right)[:-](small|medium|large|full)@@/i);
          const align = (match ? match[1].toLowerCase() : 'center') as 'left' | 'center' | 'right';
          const size = (match ? match[2].toLowerCase() : 'large') as 'small' | 'medium' | 'large' | 'full';
          const isVid = exWrap.classList.contains('youtube-embed-wrapper');
          const { widthPercent, minWidth, marginLeft, marginRight } = getMediaLayoutStyles(align, size, isVid);

          exWrap.setAttribute('data-align', align);
          exWrap.setAttribute('data-size', size);
          exWrap.style.width = widthPercent;
          exWrap.style.minWidth = minWidth;
          exWrap.style.marginLeft = marginLeft;
          exWrap.style.marginRight = marginRight;

          const btn = exWrap.querySelector('.media-adjust-trigger') as HTMLElement | null;
          if (btn) {
            btn.setAttribute('data-align', align);
            btn.setAttribute('data-size', size);
            btn.setAttribute('title', `Adjust layout (${align}, ${size === 'small' ? '35%' : size === 'medium' ? '65%' : size === 'large' ? '85%' : '100%'})`);
          }
        }
      });
      highlightSearch(container, searchQuery, searchMatchIndex);
      return;
    }

    prevBaseContentRef.current = currentBase;

    // Reset container HTML to clean pre-styled content
    container.innerHTML = htmlContent || '<p class="text-text/20 italic">No content yet. Click edit to start writing.</p>';

    renderNoteMath(container);
    highlightSearch(container, searchQuery, searchMatchIndex);
  }, [htmlContent, isEditing, searchQuery, searchMatchIndex, content]);

  return (
    <div
      ref={renderRef}
      className="note-content-container"
      style={{ fontSize: 'inherit' }}
    />
  );
});

// Note Editor Component
const NoteEditor: React.FC<NoteEditorProps> = ({
  note, user, isEditing, setIsEditing, onSave, editorFlushRef, onAsyncInsertion, onThemeChange, onExportVault, isUploading, syncStatus,
  setConfirmModal, setPromptModal, initialSectionIndex = 0, initialScrollY = 0, initialSearchQuery = '', onSectionChange,
  onKeepNote, onRenameNote, showToast
}) => {
  const safeSections = Array.isArray(note.sections) && note.sections.length > 0
    ? note.sections
    : [{ id: 's1', title: 'Introduction', content: '' }];
  const [sections, setSections] = useState<NoteSection[]>(safeSections);
  const sectionsRef = useRef(sections);
  const [currentSectionIndex, setCurrentSectionIndex] = useState(() => {
    return Math.max(0, Math.min(safeSections.length - 1, initialSectionIndex || 0));
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isKeepingNote, setIsKeepingNote] = useState(false);

  const currentSectionIndexRef = useRef(currentSectionIndex);
  const lastSavedSectionsRef = useRef(JSON.stringify(safeSections));
  const ownSaveSignaturesRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  const onSaveRef = useRef<(value: NoteSection[]) => void>(() => {});
  onSaveRef.current = value => {
    sectionsRef.current = value;
    lastSavedSectionsRef.current = JSON.stringify(value);
    ownSaveSignaturesRef.current.add(lastSavedSectionsRef.current);
    if (ownSaveSignaturesRef.current.size > 100) ownSaveSignaturesRef.current.delete(ownSaveSignaturesRef.current.values().next().value!);
    void onSave(value, note.id);
  };

  const prevSectionIdxRef = useRef(currentSectionIndex);
  const [textBuffer, setRenderedContent] = useState(() => safeSections[currentSectionIndex]?.content || '');
  const pendingContentRef = useRef(textBuffer);

  // Synchronous whole-section authority. A textarea's DOM value is never read
  // here: structured inputs contain slices, not the full document.
  const setTextBuffer = (content: string) => {
    pendingContentRef.current = content;
    const index = currentSectionIndexRef.current;
    sectionsRef.current = sectionsRef.current.map((section, i) => i === index ? { ...section, content } : section);
    setSections(sectionsRef.current);
    setRenderedContent(content);
  };
  const flushPendingContent = useCallback(() => {
    const snapshot = JSON.stringify(sectionsRef.current);
    if (snapshot !== lastSavedSectionsRef.current) onSaveRef.current(sectionsRef.current);
  }, []);

  useLayoutEffect(() => {
    mountedRef.current = true;
    editorFlushRef.current = flushPendingContent;
    return () => {
      flushPendingContent();
      mountedRef.current = false;
      if (editorFlushRef.current === flushPendingContent) editorFlushRef.current = null;
    };
  }, [editorFlushRef, flushPendingContent]);

  useEffect(() => {
    const timer = setTimeout(flushPendingContent, 300);
    return () => clearTimeout(timer);
  }, [textBuffer, flushPendingContent]);

  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushPendingContent(); };
    window.addEventListener('beforeunload', flushPendingContent);
    window.addEventListener('pagehide', flushPendingContent);
    window.addEventListener('popstate', flushPendingContent);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', flushPendingContent);
      window.removeEventListener('pagehide', flushPendingContent);
      window.removeEventListener('popstate', flushPendingContent);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [flushPendingContent]);
  useMediaRevision();
  useEffect(() => {
    const incoming = JSON.stringify(note.sections);
    const current = JSON.stringify(sectionsRef.current);
    if (!ownSaveSignaturesRef.current.has(incoming) && incoming !== current && current === lastSavedSectionsRef.current) {
      sectionsRef.current = note.sections;
      lastSavedSectionsRef.current = incoming;
      const next = note.sections[currentSectionIndexRef.current]?.content || '';
      pendingContentRef.current = next;
      setSections(note.sections);
      setRenderedContent(next);
    }
  }, [note.sections]);


  // Undo/Redo Stacks with Selection Preservation
  interface HistorySnapshot {
    content: string;
    selectionStart: number;
    selectionEnd: number;
  }
  const [historyStack, setHistoryStack] = useState<HistorySnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<HistorySnapshot[]>([]);
  const lastSnapshotRef = useRef<HistorySnapshot>({
    content: note.sections[initialSectionIndex || 0]?.content || '',
    selectionStart: 0,
    selectionEnd: 0
  });
  const debounceHistoryTimer = useRef<NodeJS.Timeout | null>(null);
  const isUndoRedoActive = useRef(false);

  const pushHistoryImmediate = (previousContent: string, previousCursor: number = 0) => {
    if (debounceHistoryTimer.current) {
      clearTimeout(debounceHistoryTimer.current);
      debounceHistoryTimer.current = null;
    }
    setHistoryStack(prev => [...prev, { content: previousContent, selectionStart: previousCursor, selectionEnd: previousCursor }].slice(-40));
    setRedoStack([]);
    lastSnapshotRef.current = { content: previousContent, selectionStart: previousCursor, selectionEnd: previousCursor };
  };

  // Magic Format State
  const [activeAlign, setActiveAlign] = useState<'left' | 'center' | 'right'>('left');
  const [activeSize, setActiveSize] = useState<'small' | 'medium' | 'large' | 'full'>('large');
  const [highlightColor, setHighlightColor] = useState('#ffff00');
  const [isYouTubeModalOpen, setIsYouTubeModalOpen] = useState(false);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);

  // Structured Boxed Editor Mode ('structured' separates insertions with faint boxes; 'raw' shows plain markdown)
  const [editorMode, setEditorMode] = useState<'structured' | 'raw'>('raw');
  useEffect(() => { flushPendingContent(); }, [editorMode, settingsOpen, sidebarOpen, isYouTubeModalOpen, isImageModalOpen, flushPendingContent]);

  const parsedSegments = useMemo(() => {
    return parseContentIntoSegments(textBuffer);
  }, [textBuffer]);

  const hasMediaInsertions = useMemo(() => {
    return parsedSegments.some(s => s.type === 'media');
  }, [parsedSegments]);

  const hasLatexBlocks = useMemo(() => {
    return parsedSegments.some(s => s.type === 'latex');
  }, [parsedSegments]);

  const hasStructuredBlocks = useMemo(() => {
    return parsedSegments.some(s => s.type === 'media' || s.type === 'latex');
  }, [parsedSegments]);

  // Collapsed state for individual LaTeX blocks
  // Default is collapsed (folded) as requested ("But by default it's uncollectibsed as I rarely edit latex")
  const [expandedLatexBlocks, setExpandedLatexBlocks] = useState<Record<string, boolean>>({});
  const [globalLatexFolded, setGlobalLatexFolded] = useState<boolean>(true);

  const toggleLatexBlock = (id: string) => {
    setExpandedLatexBlocks(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const toggleAllLatex = () => {
    setGlobalLatexFolded(prev => {
      const next = !prev;
      const newMap: Record<string, boolean> = {};
      parsedSegments.forEach(s => {
        if (s.type === 'latex') {
          newMap[s.id] = !next;
        }
      });
      setExpandedLatexBlocks(newMap);
      return next;
    });
  };

  const handleDeleteSegmentLatex = (segIdx: number) => {
    pushHistoryImmediate(pendingContentRef.current);
    setTextBuffer(deleteSegment(pendingContentRef.current, segIdx));
    flushPendingContent();
  };

  const handleSegmentTextChange = (segIdx: number, newText: string) => {
    pushHistoryImmediate(pendingContentRef.current);
    setTextBuffer(replaceSegmentText(pendingContentRef.current, segIdx, newText));
  };

  const handleUpdateSegmentMedia = (mediaUrl: string, fallbackIdx: number, newAlign?: 'left' | 'center' | 'right', newSize?: 'small' | 'medium' | 'large' | 'full') => {
    const currentText = pendingContentRef.current || textBuffer;
    const lines = currentText.split('\n');
    let targetIdx = -1;

    if (fallbackIdx >= 0 && fallbackIdx < lines.length && isMediaLine(lines[fallbackIdx])) {
      if (!mediaUrl || lines[fallbackIdx].includes(mediaUrl)) {
        targetIdx = fallbackIdx;
      }
    }
    if (targetIdx === -1 && mediaUrl) {
      const candidates = getMediaCandidates(mediaUrl);
      targetIdx = lines.findIndex(l => isMediaLine(l) && candidates.some(c => c && l.includes(c)));
    }
    if (targetIdx === -1) targetIdx = fallbackIdx;
    if (targetIdx < 0 || targetIdx >= lines.length || !isMediaLine(lines[targetIdx])) return;

    const line = lines[targetIdx];
    const alignMatch = line.match(/@@(left|center|right)[:-](small|medium|large|full)@@/i);
    const currentAlign = alignMatch ? (alignMatch[1].toLowerCase() as any) : 'center';
    const currentSize = alignMatch ? (alignMatch[2].toLowerCase() as any) : 'large';

    const align = newAlign || currentAlign;
    const size = newSize || currentSize;

    const newLine = updateMediaMarker(line, align, size);

    lines[targetIdx] = newLine;
    const newContent = lines.join('\n');
    pushHistoryImmediate(currentText);

    pendingContentRef.current = newContent;
    setRenderedContent(newContent);
    if (newAlign) setActiveAlign(newAlign);
    if (newSize) setActiveSize(newSize);

    const secIdx = currentSectionIndexRef.current;
    const updated = sectionsRef.current.map((s, i) => i === secIdx ? { ...s, content: newContent } : s);
    sectionsRef.current = updated;
    setSections(updated);
    onSaveRef.current(updated);
  };

  const handleDeleteSegmentMedia = (mediaUrl: string, fallbackIdx: number) => {
    const lines = textBuffer.split('\n');
    let targetIdx = -1;

    if (fallbackIdx >= 0 && fallbackIdx < lines.length && isMediaLine(lines[fallbackIdx])) {
      if (!mediaUrl || lines[fallbackIdx].includes(mediaUrl)) {
        targetIdx = fallbackIdx;
      }
    }
    if (targetIdx === -1 && mediaUrl) {
      targetIdx = lines.findIndex(l => l.includes(mediaUrl) && isMediaLine(l));
    }
    if (targetIdx === -1) targetIdx = fallbackIdx;
    if (targetIdx < 0 || targetIdx >= lines.length) return;

    pushHistoryImmediate(textBuffer);
    lines.splice(targetIdx, 1);
    const newContent = lines.join('\n');
    handleTextBufferChange(newContent);
    setIsTargetingMedia(false);
    setActiveEditorMedia(null);

    const updated = [...sectionsRef.current];
    if (updated[currentSectionIndex]) {
      updated[currentSectionIndex] = { ...updated[currentSectionIndex], content: newContent };
      sectionsRef.current = updated;
      setSections(updated);
      onSaveRef.current(updated);
    }
  };

  // Search State (Floating Search Bar with live count and Next/Prev)
  const [isSearchOpen, setIsSearchOpen] = useState(Boolean(initialSearchQuery));
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Active Media Overlay (interactive click-to-adjust in preview)
  const [activeMediaOverlay, setActiveMediaOverlay] = useState<ActiveMediaTarget | null>(null);
  const [isTargetingMedia, setIsTargetingMedia] = useState(false);
  const [activeEditorMedia, setActiveEditorMedia] = useState<{
    lineIndex: number;
    type: 'image' | 'video';
    url: string;
    align: 'left' | 'center' | 'right';
    size: 'small' | 'medium' | 'large' | 'full';
    rawTag: string;
  } | null>(null);
  const prevTextBufferLengthRef = useRef(textBuffer.length);
  const saveMediaTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastEditorCursorRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const getEditorSelection = (element = textareaRef.current) => {
    if (!element?.isConnected) return lastEditorCursorRef.current;
    const index = element.dataset.segmentIndex;
    const offset = index === undefined ? 0 : (parseContentIntoSegments(pendingContentRef.current)[Number(index)]?.start || 0);
    return { start: offset + element.selectionStart, end: offset + element.selectionEnd };
  };
  const focusEditorSelection = (start: number, end: number) => {
    const elements = Array.from(document.querySelectorAll<HTMLTextAreaElement>('[data-section-input]'));
    const target = elements.find(element => {
      const index = element.dataset.segmentIndex;
      if (index === undefined) return true;
      const segment = parseContentIntoSegments(pendingContentRef.current)[Number(index)];
      return segment && start >= (segment.start || 0) && end <= (segment.end || 0);
    });
    if (!target) return;
    textareaRef.current = target;
    const segment = target.dataset.segmentIndex;
    const offset = segment === undefined ? 0 : (parseContentIntoSegments(pendingContentRef.current)[Number(segment)]?.start || 0);
    target.focus();
    target.setSelectionRange(Math.max(0, start - offset), Math.max(0, end - offset));
    lastEditorCursorRef.current = { start, end };
  };

  const lastTargetedMediaRef = useRef<{
    lineIndex: number;
    type: 'image' | 'video';
    url: string;
    align: 'left' | 'center' | 'right';
    size: 'small' | 'medium' | 'large' | 'full';
    rawTag: string;
  } | null>(null);

  const pendingFormatSelection = useRef<{ start: number; end: number; content: string } | null>(null);
  useLayoutEffect(() => {
    const selection = pendingFormatSelection.current;
    if (!selection) return;
    pendingFormatSelection.current = null;
    if (selection.content === pendingContentRef.current) focusEditorSelection(selection.start, selection.end);
  }, [textBuffer, editorMode]);
  const wrapSelection = (openTag: string, closeTag: string) => {
    if (!textareaRef.current) return;
    const { start, end } = getEditorSelection();
    const content = pendingContentRef.current;
    const newText = content.slice(0, start) + openTag + content.slice(start, end) + closeTag + content.slice(end);
    pushHistoryImmediate(content, start);
    pendingFormatSelection.current = { start: start + openTag.length, end: end + openTag.length, content: newText };
    handleTextBufferChange(newText);
  };

  // Math Formula Snippets Helper
  const [isMathModalOpen, setIsMathModalOpen] = useState(false);
  const [selectedMathCategory, setSelectedMathCategory] = useState<string>("Basic");

  // Outline / Table of Contents Drawer
  const [isOutlineOpen, setIsOutlineOpen] = useState(false);

  // Markdown Action Feedback
  const [copyFeedback, setCopyFeedback] = useState(false);

  const insertMathSnippet = (code: string) => {
    if (!textareaRef.current) return;
    const start = getEditorSelection().start;
    const end = getEditorSelection().end;
    const selected = textBuffer.substring(start, end);
    const insertion = selected ? code.replace(/a|x|f\(x\)/, selected) : code;
    const newText = textBuffer.substring(0, start) + insertion + textBuffer.substring(end);

    pushHistoryImmediate(textBuffer, start);
    handleTextBufferChange(newText);

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newPos = start + insertion.length;
        focusEditorSelection(newPos, newPos);
      }
    }, 10);
  };

  const handleCopyMarkdown = () => {
    flushPendingContent();
    const contentToCopy = pendingContentRef.current;
    navigator.clipboard.writeText(contentToCopy).then(() => { setCopyFeedback(true); setTimeout(() => setCopyFeedback(false), 2000); }).catch(() => showToast?.('Clipboard access was denied. Select and copy the source manually.', 'error'));
  };

  const handleExportMarkdown = async () => {
    flushPendingContent();
    try {
      const current = { ...note, sections: [sectionsRef.current[currentSectionIndexRef.current]] };
      const backup = await createVaultBackup([current], [], async id => (await getLocalMediaBlob(id)) || (user ? fetchVaultMediaFromFirestore(user.uid, id) : null));
      downloadFile(backupMarkdown(backup), `${note.title}.md`, 'text/markdown');
    } catch (error: any) { showToast?.(`Export failed: ${error.message}`, 'error'); }
  };

  const jumpToHeading = (headingText: string) => {
    if (isEditing) {
      if (!textareaRef.current) return;
      const lowerText = textBuffer.toLowerCase();
      const pos = lowerText.indexOf(headingText.toLowerCase());
      if (pos !== -1) {
        textareaRef.current.focus();
        focusEditorSelection(pos, pos + headingText.length);
      }
      return;
    }
    const container = document.querySelector('.note-content-container');
    if (!container) return;
    const allHeadings = Array.from(container.querySelectorAll('h1, h2, h3, h4'));
    const matched = allHeadings.find(h => (h.textContent || '').toLowerCase().includes(headingText.toLowerCase()));
    if (matched) {
      matched.scrollIntoView({ behavior: 'smooth', block: 'start' });
      matched.classList.add('heading-jump-highlight');
      setTimeout(() => matched.classList.remove('heading-jump-highlight'), 1800);
    }
  };

  const outlineHeadings = useMemo(() => {
    const content = sections[currentSectionIndex]?.content || '';
    if (!content) return [];
    const lines = content.split('\n');
    const items: { level: number; text: string }[] = [];
    lines.forEach((line) => {
      const match = line.match(/^(#{1,4})\s+(.+)$/);
      if (match) {
        items.push({
          level: match[1].length,
          text: match[2].replace(/[#*_`]/g, '').trim()
        });
      }
    });
    return items;
  }, [sections, currentSectionIndex]);

  const wordStats = useMemo(() => {
    const text = sections[currentSectionIndex]?.content || '';
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const readingTime = Math.max(1, Math.ceil(words / 180));
    return { words, readingTime };
  }, [sections, currentSectionIndex]);

  // App Settings
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem('aetheria_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          fontSize: (typeof parsed?.fontSize === 'number' && !isNaN(parsed.fontSize)) ? parsed.fontSize : 18,
          zoom: (typeof parsed?.zoom === 'number' && !isNaN(parsed.zoom) && parsed.zoom > 0) ? parsed.zoom : 100,
          fontFamily: parsed?.fontFamily || 'var(--font-gemini)',
          fontWeight: (typeof parsed?.fontWeight === 'number' && !isNaN(parsed.fontWeight)) ? parsed.fontWeight : 400,
          theme: normalizeTheme(parsed?.theme)
        };
      }
    } catch {}
    return { fontSize: 18, zoom: 100, fontFamily: 'var(--font-gemini)', fontWeight: 400, theme: 'dark' };
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    writeLocalValue('aetheria_settings', JSON.stringify(settings));
    document.documentElement.setAttribute('data-theme', settings.theme || 'dark');
  }, [settings]);

  // Section Selector Helper
  const handleSelectSection = (newIdx: number) => {
    const oldIdx = currentSectionIndexRef.current;
    if (sectionsRef.current[oldIdx] && pendingContentRef.current !== undefined) {
      sectionsRef.current = sectionsRef.current.map((s, i) => i === oldIdx ? { ...s, content: pendingContentRef.current } : s);
    }
    flushPendingContent();
    const effectiveSections = sectionsRef.current;
    const clamped = Math.max(0, Math.min(effectiveSections.length - 1, newIdx));
    const nextContent = effectiveSections[clamped]?.content || '';
    currentSectionIndexRef.current = clamped;
    prevSectionIdxRef.current = clamped;
    setCurrentSectionIndex(clamped);
    setSections([...effectiveSections]);
    pendingContentRef.current = nextContent;
    setRenderedContent(nextContent);
    textareaRef.current = null;
    lastEditorCursorRef.current = { start: 0, end: 0 };
    onSectionChange?.(clamped);
    setHistoryStack([]);
    setRedoStack([]);
    lastSnapshotRef.current = { content: nextContent, selectionStart: 0, selectionEnd: 0 };
    setSidebarOpen(false);

    const url = new URL(window.location.href);
    url.searchParams.set('noteId', note.id);
    url.searchParams.set('section', String(clamped));
    window.history.replaceState({}, '', url.toString());

    try {
      localStorage.setItem('uninote_reading_state', JSON.stringify({
        noteId: note.id,
        sectionIndex: clamped,
        scrollY: 0,
        timestamp: Date.now()
      }));
    } catch {}

    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    // Used by browser back/forward; ordinary section clicks already update refs.
    if (initialSectionIndex !== currentSectionIndexRef.current) handleSelectSection(initialSectionIndex);
  }, [initialSectionIndex]);

  const handleUndo = () => {
    if (historyStack.length === 0) return;
    if (debounceHistoryTimer.current) {
      clearTimeout(debounceHistoryTimer.current);
      debounceHistoryTimer.current = null;
    }
    isUndoRedoActive.current = true;

    const currentCursor = getEditorSelection().start;
    const currentSnapshot: HistorySnapshot = {
      content: textBuffer,
      selectionStart: currentCursor,
      selectionEnd: currentCursor
    };

    const prevSnapshot = historyStack[historyStack.length - 1];
    setHistoryStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [currentSnapshot, ...prev].slice(0, 40));

    setTextBuffer(prevSnapshot.content);
    lastSnapshotRef.current = prevSnapshot;


    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        focusEditorSelection(prevSnapshot.selectionStart, prevSnapshot.selectionEnd);
      }
    }, 10);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    if (debounceHistoryTimer.current) {
      clearTimeout(debounceHistoryTimer.current);
      debounceHistoryTimer.current = null;
    }
    isUndoRedoActive.current = true;

    const currentCursor = getEditorSelection().start;
    const currentSnapshot: HistorySnapshot = {
      content: textBuffer,
      selectionStart: currentCursor,
      selectionEnd: currentCursor
    };

    const nextSnapshot = redoStack[0];
    setRedoStack(prev => prev.slice(1));
    setHistoryStack(prev => [...prev, currentSnapshot].slice(-40));

    setTextBuffer(nextSnapshot.content);
    lastSnapshotRef.current = nextSnapshot;


    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        focusEditorSelection(nextSnapshot.selectionStart, nextSnapshot.selectionEnd);
      }
    }, 10);
  };

  // Case-Insensitive Search Matching
  useEffect(() => {
    const activeContent = isEditing ? textBuffer : (sections[currentSectionIndex]?.content || '');
    if (!searchQuery.trim()) {
      setSearchMatches([]);
      setSearchMatchIndex(0);
      return;
    }
    const q = searchQuery.toLowerCase();
    const lower = activeContent.toLowerCase();
    const indices: number[] = [];
    let pos = 0;
    while ((pos = lower.indexOf(q, pos)) !== -1) {
      indices.push(pos);
      pos += Math.max(1, q.length);
    }
    setSearchMatches(indices);
    setSearchMatchIndex(prev => indices.length === 0 ? 0 : Math.min(prev, indices.length - 1));
  }, [searchQuery, textBuffer, sections, currentSectionIndex, isEditing]);

  const scrollToCurrentMatch = (targetIdx: number, matches: number[]) => {
    if (matches.length === 0 || targetIdx < 0 || targetIdx >= matches.length) return;
    const matchStart = matches[targetIdx];
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      focusEditorSelection(matchStart, matchStart + searchQuery.length);
      const textBefore = textBuffer.substring(0, matchStart);
      const lineCount = textBefore.split('\n').length;
      const totalLines = textBuffer.split('\n').length;
      const scrollRatio = lineCount / Math.max(1, totalLines);
      const targetScroll = scrollRatio * textareaRef.current.scrollHeight - (window.innerHeight / 3);
      window.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
    }
  };

  const handleNextMatch = () => {
    if (searchMatches.length === 0) return;
    const next = (searchMatchIndex + 1) % searchMatches.length;
    setSearchMatchIndex(next);
    scrollToCurrentMatch(next, searchMatches);
  };

  const handlePrevMatch = () => {
    if (searchMatches.length === 0) return;
    const prev = (searchMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    setSearchMatchIndex(prev);
    scrollToCurrentMatch(prev, searchMatches);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || (event.target as HTMLElement)?.closest('[role="dialog"]') || document.querySelector('[aria-modal="true"]')) return;
      const target = event.target as HTMLElement;
      const unrelatedInput = target?.matches('input,textarea,[contenteditable="true"]') && !target.matches('textarea[data-section-input],textarea[data-segment-index]');
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 's') { event.preventDefault(); flushPendingContent(); showToast?.(hasPendingLocalWrites() ? 'Storage is full: changes remain in this tab. Export before closing.' : 'Saved to the local vault; cloud sync continues when signed in.', hasPendingLocalWrites() ? 'error' : 'info'); return; }
      if (unrelatedInput) return;
      if (event.altKey && ['arrowup', 'arrowdown'].includes(key)) { event.preventDefault(); handleSelectSection(currentSectionIndexRef.current + (key === 'arrowup' ? -1 : 1)); return; }
      if (!(event.ctrlKey || event.metaKey)) return;
      if (key === 'f') { event.preventDefault(); setIsSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 0); }
      if (isEditing && ['b', 'i', 'm'].includes(key)) {
        event.preventDefault();
        if (key === 'm') wrapSelection('$$\n', '\n$$'); else wrapSelection(key === 'b' ? '**' : '*', key === 'b' ? '**' : '*');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const handleCloseMediaOverlay = () => {
    setActiveMediaOverlay(null);
    if (saveMediaTimeoutRef.current) {
      clearTimeout(saveMediaTimeoutRef.current);
    }
    onSaveRef.current(sectionsRef.current);
  };

  const handleDeleteActiveMedia = () => {
    if (!activeMediaOverlay) return;
    const currentSections = sectionsRef.current;
    const currentContent = currentSections[currentSectionIndex]?.content || '';
    const lines = currentContent.split('\n');
    const cleanId = activeMediaOverlay.identifier.trim();
    const activeIdx = activeMediaOverlay.index;

    let updatedLines = [...lines];
    let deleted = false;

    // 1. Precise ordinal deletion by media line index
    if (typeof activeIdx === 'number' && activeIdx >= 0) {
      let mediaCounter = 0;
      for (let i = 0; i < lines.length; i++) {
        if (isMediaLine(lines[i])) {
          if (mediaCounter === activeIdx) {
            updatedLines.splice(i, 1);
            deleted = true;
            break;
          }
          mediaCounter++;
        }
      }
    }

    // 2. Fallback: delete only the first matching media line. (The previous
    // filter removed *every* line containing a candidate substring, which
    // could delete unrelated media/text sharing a URL fragment.)
    if (!deleted) {
      const candidates = getMediaCandidates(cleanId);
      const idx = lines.findIndex(line => isMediaLine(line) && candidates.some(c => c && line.includes(c)));
      if (idx !== -1) { updatedLines.splice(idx, 1); deleted = true; }
    }

    const updatedContent = updatedLines.join('\n');

    pushHistoryImmediate(currentContent, getEditorSelection().start);
    setTextBuffer(updatedContent);
    const newSections = [...currentSections];
    newSections[currentSectionIndex] = {
      ...newSections[currentSectionIndex],
      content: updatedContent
    };
    sectionsRef.current = newSections;
    setSections(newSections);
    onSaveRef.current(newSections);
    setActiveMediaOverlay(null);
  };

  // High-Performance Update Media Layout from interactive preview overlay
  const handleUpdateMediaLayout = (identifier: string, newAlign: 'left' | 'center' | 'right', newSize: 'small' | 'medium' | 'large' | 'full', targetIndex?: number) => {
    const activeIdx = typeof targetIndex === 'number' ? targetIndex : activeMediaOverlay?.index;
    setActiveMediaOverlay(prev => prev ? { ...prev, align: newAlign, size: newSize, index: activeIdx } : null);

    const secIdx = currentSectionIndexRef.current;
    const currentSections = sectionsRef.current;
    const currentContent = currentSections[secIdx]?.content || pendingContentRef.current || '';
    const lines = currentContent.split('\n');

    let found = false;

    // 1. Precise ordinal targeting by media line index
    if (typeof activeIdx === 'number' && activeIdx >= 0) {
      let mediaCounter = 0;
      for (let i = 0; i < lines.length; i++) {
        if (isMediaLine(lines[i])) {
          if (mediaCounter === activeIdx) {
            lines[i] = updateMediaMarker(lines[i], newAlign, newSize);
            found = true;
            break;
          }
          mediaCounter++;
        }
      }
    }

    // 2. Fallback candidate URL targeting
    if (!found) {
      const candidates = getMediaCandidates(identifier);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (candidates.some(c => c && line.includes(c))) {
          lines[i] = updateMediaMarker(line, newAlign, newSize);
          found = true;
          break;
        }
      }
    }

    // 3. No guessing: an unidentified target must not rewrite some other
    // media item's layout marker.
    if (!found) return;

    const updatedContent = lines.join('\n');

    pushHistoryImmediate(currentContent, getEditorSelection().start);

    pendingContentRef.current = updatedContent;
    setRenderedContent(updatedContent);
    const newSections = sectionsRef.current.map((s, i) => i === secIdx ? { ...s, content: updatedContent } : s);
    sectionsRef.current = newSections;
    setSections(newSections);

    // Instant save to disk/Firestore (guarantees persistence across section switches & page reloads)
    onSaveRef.current(newSections);

    // Instant direct DOM layout style transition on preview element (0ms)
    const container = document.querySelector('.note-content-container');
    if (container) {
      const wrappers = Array.from(container.querySelectorAll('.media-embed-wrapper')) as HTMLElement[];
      const targetWrap = typeof activeIdx === 'number' && wrappers[activeIdx] ? wrappers[activeIdx] : wrappers.find(w => {
        const rawUrl = w.getAttribute('data-raw-url') || '';
        const vId = w.getAttribute('data-video-id') || '';
        const imgSrc = w.querySelector('img')?.getAttribute('src') || '';
        return rawUrl.includes(identifier) || vId === identifier || imgSrc.includes(identifier);
      });

      if (targetWrap) {
        targetWrap.setAttribute('data-align', newAlign);
        targetWrap.setAttribute('data-size', newSize);
        const isVid = targetWrap.classList.contains('youtube-embed-wrapper');
        const { widthPercent, minWidth, marginLeft, marginRight } = getMediaLayoutStyles(newAlign, newSize, isVid);
        targetWrap.style.width = widthPercent;
        targetWrap.style.minWidth = minWidth;
        targetWrap.style.marginLeft = marginLeft;
        targetWrap.style.marginRight = marginRight;

        const triggerBtn = targetWrap.querySelector('.media-adjust-trigger') as HTMLElement | null;
        if (triggerBtn) {
          triggerBtn.setAttribute('data-align', newAlign);
          triggerBtn.setAttribute('data-size', newSize);
          triggerBtn.setAttribute('title', `Adjust layout (${newAlign}, ${newSize === 'small' ? '35%' : newSize === 'medium' ? '65%' : newSize === 'large' ? '85%' : '100%'})`);
        }
      }
    }
  };

  // Deep Linking & Exact Section State in URL
  useEffect(() => {
    if (!note?.id) return;
    const url = new URL(window.location.href);
    url.searchParams.set('noteId', note.id);
    url.searchParams.set('section', String(currentSectionIndex));
    window.history.replaceState({}, '', url.toString());

    try {
      localStorage.setItem('uninote_reading_state', JSON.stringify({
        noteId: note.id,
        sectionIndex: currentSectionIndex,
        scrollY: Math.round(window.scrollY),
        timestamp: Date.now()
      }));
    } catch {}

  }, [note.id, currentSectionIndex, onSectionChange]);

  // Exact Scroll Position Retention Per Section & Refresh Recovery
  useEffect(() => {
    if (isEditing || !note?.id) return;

    const scrollKey = `uninote_scroll_${note.id}_sec_${currentSectionIndex}`;
    const savedScroll = localStorage.getItem(scrollKey);
    const targetScroll = savedScroll ? parseInt(savedScroll, 10) : (currentSectionIndex === (initialSectionIndex || 0) ? (initialScrollY || 0) : 0);

    let observer: ResizeObserver | null = null;
    if (targetScroll > 0) {
      window.scrollTo({ top: targetScroll, behavior: 'instant' });
      observer = new ResizeObserver(() => {
        window.scrollTo({ top: targetScroll, behavior: 'instant' });
      });
      const container = document.querySelector('.note-content-container') || document.body;
      observer.observe(container);
      setTimeout(() => {
        if (observer) observer.disconnect();
      }, 1200);
    }

    let scrollTimeout: any;
    const handleScroll = () => {
      if (scrollTimeout) clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const y = Math.round(window.scrollY);
        localStorage.setItem(scrollKey, y.toString());
        try {
          localStorage.setItem('uninote_reading_state', JSON.stringify({
            noteId: note.id,
            sectionIndex: currentSectionIndex,
            scrollY: y,
            timestamp: Date.now()
          }));
        } catch {}
      }, 150);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (scrollTimeout) clearTimeout(scrollTimeout);
      if (observer) observer.disconnect();
    };
  }, [note.id, currentSectionIndex, isEditing, initialSectionIndex, initialScrollY]);

  useLayoutEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus(); // Focus lock only when entering edit mode
    }
  }, [isEditing]);

  useLayoutEffect(() => {
    if (isEditing && textareaRef.current) {
      const el = textareaRef.current;
      // Only reset height to auto if content length decreased (e.g. deletion)
      if (textBuffer.length < prevTextBufferLengthRef.current - 5) {
        el.style.height = 'auto';
      }
      prevTextBufferLengthRef.current = textBuffer.length;
      const targetHeight = Math.max(400, el.scrollHeight);
      if (Math.abs(el.clientHeight - targetHeight) > 8) {
        el.style.height = `${targetHeight}px`;
      }
    }
  }, [isEditing, textBuffer, currentSectionIndex]);

  const handleTextBufferChange = (val: string) => {
    setTextBuffer(val);
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value;
    const cursor = e.target.selectionStart;
    setTextBuffer(newVal);

    if (isUndoRedoActive.current) {
      isUndoRedoActive.current = false;
      return;
    }

    if (debounceHistoryTimer.current) {
      clearTimeout(debounceHistoryTimer.current);
    }

    const prevText = lastSnapshotRef.current.content;
    if (newVal !== prevText) {
      const isBoundary = newVal.length > prevText.length && (newVal.endsWith(' ') || newVal.endsWith('\n'));
      const delay = isBoundary ? 200 : 600;

      debounceHistoryTimer.current = setTimeout(() => {
        setHistoryStack(prev => [...prev, lastSnapshotRef.current].slice(-40));
        setRedoStack([]);
        lastSnapshotRef.current = { content: newVal, selectionStart: cursor, selectionEnd: cursor };
      }, delay);
    }
  };

  interface InsertionAnchor { sectionId: string; base: string; start: number; end: number }
  const captureInsertion = (): InsertionAnchor => ({
    sectionId: sectionsRef.current[currentSectionIndexRef.current].id,
    base: pendingContentRef.current,
    ...getEditorSelection(),
  });
  const insertForSection = (anchor: InsertionAnchor, insertion: string): boolean => {
    if (!mountedRef.current) {
      onAsyncInsertion(note.id, anchor.sectionId, anchor.base, anchor.start, anchor.end, insertion);
      return true;
    }
    const index = sectionsRef.current.findIndex(section => section.id === anchor.sectionId);
    if (index < 0) return false; // A section deleted while an upload was in flight stays deleted.
    const current = sectionsRef.current[index].content;
    const content = insertAtSelection(current, anchor.base, anchor.start, anchor.end, insertion);
    pushHistoryImmediate(current, anchor.start);
    if (index === currentSectionIndexRef.current) setTextBuffer(content);
    else {
      sectionsRef.current = sectionsRef.current.map((section, i) => i === index ? { ...section, content } : section);
      setSections(sectionsRef.current);
    }
    flushPendingContent();
    return true;
  };
  const handlePasteIntercept = async (event: ClipboardEvent) => {
    const file = Array.from(event.clipboardData.items).find(item => item.type.startsWith('image/'))?.getAsFile();
    const html = event.clipboardData.getData('text/html');
    const plain = event.clipboardData.getData('text/plain');
    if (!file && !html && !plain) return;
    event.preventDefault();
    const anchor = captureInsertion();
    flushPendingContent();
    try {
      if (file) {
        const fileToUpload = await compressImageFile(file);
        const reference = await uploadImageFile(user?.uid || 'guest', fileToUpload, file.name);
        insertForSection(anchor, `\n![Pasted Image](${reference}) @@center:medium@@\n`);
      } else {
        const text = html ? new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' }).turndown(html) : plain;
        insertForSection(anchor, text.includes('data:image/') ? await sanitizeContentImages(text) : text);
      }
    } catch (error: any) { showToast?.('Paste could not be saved: ' + error.message, 'error'); }
  };

  // Toggle Edit / Save
  const handleToggleEdit = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const savedScroll = window.scrollY;

    flushPendingContent();
    setIsEditing(!isEditing);

    setTimeout(() => {
      window.scrollTo({ top: savedScroll, behavior: 'instant' });
    }, 100);
  };

  const handleDeleteActiveMediaInEditor = () => {
    if (!textareaRef.current) return;
    const currentText = pendingContentRef.current;
    const lines = currentText.split('\n');
    let idx = -1;
    if (activeEditorMedia && activeEditorMedia.lineIndex >= 0 && activeEditorMedia.lineIndex < lines.length && isMediaLine(lines[activeEditorMedia.lineIndex])) {
      idx = activeEditorMedia.lineIndex;
    } else if (activeEditorMedia?.url) {
      idx = lines.findIndex(l => l.includes(activeEditorMedia.url));
    }
    if (idx === -1 && lastTargetedMediaRef.current && lastTargetedMediaRef.current.lineIndex >= 0 && lastTargetedMediaRef.current.lineIndex < lines.length) {
      idx = lastTargetedMediaRef.current.lineIndex;
    }
    if (idx >= 0 && idx < lines.length) {
      pushHistoryImmediate(currentText, getEditorSelection().start || 0);
      lines.splice(idx, 1);
      const newContent = lines.join('\n');

      handleTextBufferChange(newContent);
      const updated = [...sectionsRef.current];
      if (updated[currentSectionIndex]) {
        updated[currentSectionIndex] = { ...updated[currentSectionIndex], content: newContent };
      }
      sectionsRef.current = updated;
      setSections(updated);
      onSaveRef.current(updated);
      setIsTargetingMedia(false);
      setActiveEditorMedia(null);
      lastTargetedMediaRef.current = null;
    }
  };

  const handleMagicFormat = (align?: 'left' | 'center' | 'right', size?: 'small' | 'medium' | 'large' | 'full') => {
    if (!textareaRef.current) return;

    const newAlign = align || activeAlign;
    const newSize = size || activeSize;
    if (align) setActiveAlign(align);
    if (size) setActiveSize(size);

    const textarea = textareaRef.current;
    const currentText = pendingContentRef.current;
    let start = getEditorSelection(textarea).start;
    if ((start === 0 || document.activeElement !== textarea) && lastEditorCursorRef.current.start > 0) {
      start = lastEditorCursorRef.current.start;
    }

    pushHistoryImmediate(currentText, start);

    // Find line index at cursor
    const lines = currentText.split('\n');
    let currentPos = 0;
    let targetLineIdx = -1;

    for (let i = 0; i < lines.length; i++) {
      const lineEnd = currentPos + lines[i].length;
      if (start >= currentPos && start <= lineEnd) {
        targetLineIdx = i;
        break;
      }
      currentPos = lineEnd + 1; // +1 for \n
    }

    // Smart Media Targeting:
    let finalIdx = -1;
    // 1. Direct match on current line if cursor is on media
    if (targetLineIdx !== -1 && isMediaLine(lines[targetLineIdx])) {
      finalIdx = targetLineIdx;
    }
    // 2. If activeEditorMedia exists and its line is still media, prioritize it (seamless when clicking toolbar buttons)
    if (finalIdx === -1 && activeEditorMedia && activeEditorMedia.lineIndex >= 0 && activeEditorMedia.lineIndex < lines.length && isMediaLine(lines[activeEditorMedia.lineIndex])) {
      finalIdx = activeEditorMedia.lineIndex;
    }
    // 3. Active editor media URL match in document
    if (finalIdx === -1 && activeEditorMedia?.url) {
      const matchIdx = lines.findIndex(l => l.includes(activeEditorMedia.url));
      if (matchIdx !== -1 && isMediaLine(lines[matchIdx])) {
        finalIdx = matchIdx;
      }
    }
    // 4. Last targeted media line index
    if (finalIdx === -1 && lastTargetedMediaRef.current && lastTargetedMediaRef.current.lineIndex >= 0 && lastTargetedMediaRef.current.lineIndex < lines.length && isMediaLine(lines[lastTargetedMediaRef.current.lineIndex])) {
      finalIdx = lastTargetedMediaRef.current.lineIndex;
    }
    // 5. Last targeted media URL match in document
    if (finalIdx === -1 && lastTargetedMediaRef.current?.url) {
      const matchIdx = lines.findIndex(l => l.includes(lastTargetedMediaRef.current!.url));
      if (matchIdx !== -1 && isMediaLine(lines[matchIdx])) {
        finalIdx = matchIdx;
      }
    }
    // 6. Check adjacent lines around cursor (-1, +1, -2, +2)
    if (finalIdx === -1 && targetLineIdx !== -1) {
      const offsets = [-1, 1, -2, 2];
      for (const off of offsets) {
        const testIdx = targetLineIdx + off;
        if (testIdx >= 0 && testIdx < lines.length && isMediaLine(lines[testIdx])) {
          finalIdx = testIdx;
          break;
        }
      }
    }
    // 7. Closest media line in the entire section
    if (finalIdx === -1) {
      let closestIdx = -1;
      let minDistance = Infinity;
      const refIdx = targetLineIdx !== -1 ? targetLineIdx : 0;
      for (let i = 0; i < lines.length; i++) {
        if (isMediaLine(lines[i])) {
          const dist = Math.abs(i - refIdx);
          if (dist < minDistance) {
            minDistance = dist;
            closestIdx = i;
          }
        }
      }
      if (closestIdx !== -1) {
        finalIdx = closestIdx;
      }
    }

    if (finalIdx === -1 || finalIdx >= lines.length) return;

    const line = lines[finalIdx];

    // Clean existing marker and append new marker
    const newLine = updateMediaMarker(line, newAlign, newSize);

    lines[finalIdx] = newLine;
    const newContent = lines.join('\n');

    const isMedia = isMediaLine(newLine);
    setIsTargetingMedia(isMedia);

    let extractedUrl = activeEditorMedia?.url || lastTargetedMediaRef.current?.url || '';
    if (!extractedUrl) {
      const imgMatch = newLine.match(/!\[.*?\]\((.*?)\)/);
      if (imgMatch) extractedUrl = imgMatch[1];
      const ytMatch = newLine.match(/\[(?:youtube|video)\]\((.*?)\)/i);
      if (ytMatch) extractedUrl = ytMatch[1];
    }

    const updatedMediaState = {
      lineIndex: finalIdx,
      type: (newLine.includes('[youtube]') || newLine.includes('youtu') ? 'video' : 'image') as 'image' | 'video',
      url: extractedUrl,
      align: newAlign,
      size: newSize,
      rawTag: newLine
    };

    setActiveEditorMedia(updatedMediaState);
    lastTargetedMediaRef.current = updatedMediaState;

    // Instant direct DOM sync (0ms lag)

    handleTextBufferChange(newContent);

    // Keep sections in sync and save immediately
    const updatedSections = [...sectionsRef.current];
    if (updatedSections[currentSectionIndex]) {
      updatedSections[currentSectionIndex] = { ...updatedSections[currentSectionIndex], content: newContent };
    }
    sectionsRef.current = updatedSections;
    setSections(updatedSections);
    onSaveRef.current(updatedSections);

    let pos = 0;
    for (let i = 0; i < finalIdx; i++) pos += lines[i].length + 1;
    pos += newLine.length;
    lastEditorCursorRef.current = { start: pos, end: pos };

    focusEditorSelection(pos, pos);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        focusEditorSelection(pos, pos);
      }
    });
  };

  const checkActiveLineFormatting = () => {
    if (!textareaRef.current) return;

    // Do not clear active editor media if the user is interacting with toolbar or buttons outside textarea
    if (document.activeElement !== textareaRef.current && (isTargetingMedia || activeEditorMedia)) {
      return;
    }

    const start = getEditorSelection().start;
    const text = pendingContentRef.current;
    const lines = text.split('\n');
    let currentPos = 0;
    let targetIdx = -1;

    for (let i = 0; i < lines.length; i++) {
      const lineEnd = currentPos + lines[i].length;
      if (start >= currentPos && start <= lineEnd) {
        targetIdx = i;
        break;
      }
      currentPos = lineEnd + 1;
    }

    if (targetIdx === -1) return;

    let lineToCheck = lines[targetIdx];
    let mediaLineIdx = targetIdx;
    if (!isMediaLine(lineToCheck)) {
      if (targetIdx > 0 && isMediaLine(lines[targetIdx - 1])) {
        lineToCheck = lines[targetIdx - 1];
        mediaLineIdx = targetIdx - 1;
      } else if (targetIdx < lines.length - 1 && isMediaLine(lines[targetIdx + 1])) {
        lineToCheck = lines[targetIdx + 1];
        mediaLineIdx = targetIdx + 1;
      }
    }

    const hasMedia = isMediaLine(lineToCheck);
    setIsTargetingMedia(hasMedia);

    if (hasMedia) {
      const match = lineToCheck.match(/@@(left|center|right)[:-](small|medium|large|full)@@/i);
      const align = (match ? match[1].toLowerCase() : 'center') as 'left' | 'center' | 'right';
      const size = (match ? match[2].toLowerCase() : 'large') as 'small' | 'medium' | 'large' | 'full';
      setActiveAlign(align);
      setActiveSize(size);

      let extractedUrl = '';
      const imgMatch = lineToCheck.match(/!\[.*?\]\((.*?)\)/);
      if (imgMatch) extractedUrl = imgMatch[1];
      const ytMatch = lineToCheck.match(/\[(?:youtube|video)\]\((.*?)\)/i);
      if (ytMatch) extractedUrl = ytMatch[1];

      const mediaState = {
        lineIndex: mediaLineIdx,
        type: (lineToCheck.includes('[youtube]') || lineToCheck.includes('youtu') ? 'video' : 'image') as 'image' | 'video',
        url: extractedUrl,
        align,
        size,
        rawTag: lineToCheck
      };
      setActiveEditorMedia(mediaState);
      lastTargetedMediaRef.current = mediaState;
    } else {
      setActiveEditorMedia(null);
    }
  };

  const handleInsertYouTube = (url: string, align: 'left' | 'center' | 'right', size: 'small' | 'medium' | 'large' | 'full') => {
    const extracted = extractYouTubeId(url);
    if (!extracted) return;
    const standardUrl = `https://www.youtube.com/watch?v=${extracted.videoId}${extracted.startTime ? `&t=${extracted.startTime}s` : ''}`;
    if (insertForSection(captureInsertion(), `\n[youtube](${standardUrl}) @@${align}:${size}@@\n`)) setIsYouTubeModalOpen(false);
    else showToast?.('That section no longer exists, so the video was not inserted.', 'error');
  };

  const handleInsertImage = async (imageUrl: string, alt: string, align: 'left' | 'center' | 'right', size: 'small' | 'medium' | 'large' | 'full'): Promise<boolean> => {
    const anchor = captureInsertion();
    flushPendingContent();
    try {
      const reference = await registerLocalImage(imageUrl, alt);
      if (!insertForSection(anchor, `\n![${alt.replace(/[\[\]\r\n]/g, ' ')}](${reference}) @@${align}:${size}@@\n`)) {
        showToast?.('That section no longer exists, so the image was not inserted. Your photo is saved in the media vault.', 'error');
        return false;
      }
      return true;
    } catch (error: any) { showToast?.('Image could not be saved: ' + error.message, 'error'); return false; }
  };

  const handleAddSection = () => {
    flushPendingContent();
    const newCount = sections.length + 1;
    const numberWords = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty"];
    const sectionTitle = newCount < numberWords.length ? numberWords[newCount] : `Section ${newCount}`;

    const newSection: NoteSection = {
      id: crypto.randomUUID(),
      title: sectionTitle,
      content: ''
    };
    const newSections = [...sectionsRef.current, newSection];
    sectionsRef.current = newSections;
    setSections(newSections);
    onSaveRef.current(newSections);
    handleSelectSection(newSections.length - 1);
  };

  const handleRenameSection = (index: number) => {
    flushPendingContent();
    setPromptModal({
      isOpen: true,
      title: "Rename Section",
      defaultValue: sectionsRef.current[index]?.title || sections[index]?.title || "",
      onConfirm: (newTitle) => {
        if (newTitle) {
          const newSections = [...sectionsRef.current];
          if (newSections[index]) {
            newSections[index] = { ...newSections[index], title: newTitle };
            sectionsRef.current = newSections;
            setSections(newSections);
            onSaveRef.current(newSections);
          }
        }
        setPromptModal(null);
      },
      onCancel: () => setPromptModal(null)
    } as any);
  };

  const handleDeleteSection = (index: number) => {
    flushPendingContent();
    if (sectionsRef.current.length <= 1) {
      if (showToast) {
        showToast('Cannot delete the only section.', 'info');
      }
      return;
    }
    setConfirmModal({
      isOpen: true,
      title: "Delete Section",
      message: "Are you sure you want to delete this section? This action cannot be undone.",
      onConfirm: () => {
        const newSections = sectionsRef.current.filter((_, i) => i !== index);
        sectionsRef.current = newSections;
        setSections(newSections);
        const nextIndex = Math.max(0, index - 1);
        onSaveRef.current(newSections);
        handleSelectSection(nextIndex);
        setConfirmModal(null);
      },
      onCancel: () => setConfirmModal(null)
    } as any);
  };

  const moveSection = (index: number, direction: 'up' | 'down') => {
    // Logic removed as per user request
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  const handleExportVault = () => {
    flushPendingContent();
    onExportVault({ ...note, sections: sectionsRef.current }, currentSectionIndexRef.current);
  };

  const getDatabaseUsage = () => {
    const contentString = JSON.stringify(sections);
    const sizeInBytes = new TextEncoder().encode(contentString).length;
    return sizeInBytes;
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const currentSection = sections[currentSectionIndex];
  const safeZoom = (typeof settings?.zoom === 'number' && Number.isFinite(settings.zoom) && settings.zoom > 0) ? settings.zoom : 100;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="max-w-4xl mx-auto w-full pb-40"
      style={safeZoom !== 100 ? { zoom: `${safeZoom / 100}` } : undefined}
    >
      {/* Sticky Mobile-First Reading Top Bar */}
      <div
        className="sticky top-0 z-30 -mx-4 px-4 sm:-mx-6 sm:px-6 py-2.5 sm:py-3 mb-6 border-b transition-all duration-200 flex items-center justify-between gap-3 shadow-sm"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--bg-main) 94%, transparent)',
          borderColor: 'var(--border-subtle)',
          WebkitBackdropFilter: 'blur(16px)',
          backdropFilter: 'blur(16px)'
        }}
      >
        <div className="flex flex-col min-w-0 flex-1 pr-1">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-sm sm:text-base md:text-lg font-bold text-text tracking-tight truncate">
              {note.title}
            </h1>
            {onRenameNote && (
              <button
                type="button"
                onClick={onRenameNote}
                className="p-1 rounded-lg text-text/40 hover:text-text hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
                title="Rename Note"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            )}
            {syncStatus === 'synced' && <span title="Synced"><Cloud className="w-3.5 h-3.5 text-accent shrink-0" /></span>}
            {syncStatus === 'local' && <span title="Local Storage"><CloudOff className="w-3.5 h-3.5 text-text/30 shrink-0" /></span>}
            {syncStatus === 'syncing' && <span title="Syncing..."><Loader2 className="w-3.5 h-3.5 text-accent animate-spin shrink-0" /></span>}
            {syncStatus === 'error' && <span title="Sync Error"><CloudOff className="w-3.5 h-3.5 text-red-400 shrink-0" /></span>}
          </div>
          <div className="flex items-center gap-2 mt-0.5 min-w-0">
            <span className="text-[11px] sm:text-xs text-accent font-semibold truncate">
              {currentSection.title}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Keep Note Button for Imported Notes */}
          {note.isImported && onKeepNote && (
            <button
              type="button"
              disabled={isKeepingNote}
              onClick={async () => {
                flushPendingContent();
                setIsKeepingNote(true);
                const currentSections = [...sectionsRef.current];
                if (currentSections[currentSectionIndex]) {
                  currentSections[currentSectionIndex] = {
                    ...currentSections[currentSectionIndex],
                    content: textBuffer
                  };
                }
                sectionsRef.current = currentSections;
                setSections(currentSections);
                try {
                  await onKeepNote(currentSections);
                } finally {
                  setIsKeepingNote(false);
                }
              }}
              className="px-2.5 py-1.5 sm:px-3.5 sm:py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-75 text-black font-bold transition-all flex items-center gap-1.5 min-h-[36px] text-xs shadow-md shadow-amber-500/25 cursor-pointer active:scale-95 shrink-0"
              title="Keep this imported note permanently in your vault / account"
            >
              {isKeepingNote ? (
                <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin stroke-[2.5]" />
              ) : (
                <CloudUpload className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" />
              )}
              <span>{isKeepingNote ? "Keeping..." : "Keep note"}</span>
            </button>
          )}

          {/* Outline / TOC Button */}
          <button
            type="button"
            onClick={() => setIsOutlineOpen(prev => !prev)}
            className={cn(
              "px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-xl border text-xs font-semibold transition-all flex items-center gap-1.5 min-h-[36px]",
              isOutlineOpen ? "bg-accent text-on-accent border-accent font-bold shadow-md shadow-accent/20" : "bg-white/5 border-white/10 text-text/70 hover:text-text hover:bg-white/10"
            )}
            title="Table of Contents / Outline"
          >
            <List className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span className="hidden xs:inline sm:inline text-xs">Outline</span>
          </button>

          {/* Search Button */}
          <button
            type="button"
            onClick={() => {
              setIsSearchOpen(prev => !prev);
              if (!isSearchOpen) setTimeout(() => searchInputRef.current?.focus(), 50);
            }}
            className={cn(
              "p-2 sm:p-2.5 rounded-xl border transition-all flex items-center justify-center min-w-[36px] min-h-[36px]",
              isSearchOpen ? "bg-accent text-on-accent border-accent shadow-md shadow-accent/20" : "bg-white/5 border-white/10 text-text/60 hover:text-accent hover:bg-white/10"
            )}
            title="Search Note (Ctrl+F)"
          >
            <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>

          {/* Export Vault (.json) */}
          <button
            type="button"
            onClick={handleExportVault}
            className="p-2 sm:p-2.5 rounded-xl bg-white/5 border border-white/10 text-text/60 hover:text-accent hover:bg-white/10 transition-all flex items-center justify-center min-w-[36px] min-h-[36px]"
            title="Export Full Vault (.json)"
          >
            <FileJson className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>
        </div>
      </div>

      {/* Floating Search Bar (Mobile & Desktop) */}
      <AnimatePresence>
        {isSearchOpen && (
          <motion.div
            initial={{ opacity: 0, y: -25, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -25, scale: 0.95 }}
            transition={{ duration: 0.18 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[10001] w-[94%] max-w-lg bg-surface/95 backdrop-blur-2xl border border-white/20 rounded-2xl shadow-2xl p-2.5 flex items-center gap-2"
          >
            <Search className="w-4 h-4 text-accent shrink-0 ml-1.5" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (e.shiftKey) handlePrevMatch();
                  else handleNextMatch();
                } else if (e.key === 'Escape') {
                  setIsSearchOpen(false);
                }
              }}
              placeholder="Search text or numbers..."
              className="bg-transparent text-sm text-text placeholder:text-text/40 focus:outline-none flex-1 min-w-0 px-2"
              autoFocus
            />

            {searchQuery && (
              <span className="text-[11px] font-mono text-text/60 shrink-0 px-2 py-0.5 rounded-full bg-white/5 whitespace-nowrap">
                {searchMatches.length > 0
                  ? `${searchMatchIndex + 1} of ${searchMatches.length}`
                  : "0 found"}
              </span>
            )}

            <div className="flex items-center gap-1 shrink-0 border-l border-white/10 pl-2">
              <button
                type="button"
                onClick={handlePrevMatch}
                disabled={searchMatches.length === 0}
                className="w-10 h-10 min-w-[40px] flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 active:bg-white/20 text-text disabled:opacity-20 transition-colors"
                title="Previous match (Shift+Enter)"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleNextMatch}
                disabled={searchMatches.length === 0}
                className="w-10 h-10 min-w-[40px] flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 active:bg-white/20 text-text disabled:opacity-20 transition-colors"
                title="Next match (Enter)"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSearchOpen(false);
                  setSearchQuery('');
                }}
                className="w-10 h-10 min-w-[40px] flex items-center justify-center rounded-xl hover:bg-white/10 active:bg-white/20 text-text/40 hover:text-text transition-colors"
                title="Close search (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Interactive Media Layout Popover (Preview Mode) */}
      <AnimatePresence>
        {activeMediaOverlay && (
          <div
            className="fixed inset-0 z-[10002] flex items-end sm:items-center justify-center p-4 pointer-events-none"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              role="dialog" aria-label="Media layout"
              className="pointer-events-auto w-full max-w-sm bg-surface/98 backdrop-blur-2xl border border-white/20 rounded-3xl p-5 shadow-2xl space-y-4 mb-20 sm:mb-0"
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2">
                  <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center", activeMediaOverlay.mediaType === 'video' ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400")}>
                    {activeMediaOverlay.mediaType === 'video' ? <Youtube className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-text">
                      {activeMediaOverlay.mediaType === 'video' ? 'Video Layout' : 'Image Layout'}
                    </h4>
                    <p className="text-[11px] text-text/50">Size and alignment settings</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCloseMediaOverlay}
                  aria-label="Close media layout"
                  className="p-1.5 rounded-xl hover:bg-white/10 text-text/40 hover:text-text transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Alignment Selector */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-text/50 mb-2">
                  Alignment
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handleUpdateMediaLayout(activeMediaOverlay.identifier, 'left', activeMediaOverlay.size, activeMediaOverlay.index)}
                    className={cn(
                      "py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all min-h-[44px]",
                      activeMediaOverlay.align === 'left' ? "bg-accent text-on-accent border-accent shadow-md font-bold" : "bg-white/5 border-white/10 text-text/70 hover:bg-white/10 hover:text-text"
                    )}
                  >
                    <AlignLeft className="w-4 h-4" /> Left
                  </button>
                  <button
                    type="button"
                    onClick={() => handleUpdateMediaLayout(activeMediaOverlay.identifier, 'center', activeMediaOverlay.size, activeMediaOverlay.index)}
                    className={cn(
                      "py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all min-h-[44px]",
                      activeMediaOverlay.align === 'center' ? "bg-accent text-on-accent border-accent shadow-md font-bold" : "bg-white/5 border-white/10 text-text/70 hover:bg-white/10 hover:text-text"
                    )}
                  >
                    <AlignCenter className="w-4 h-4" /> Center
                  </button>
                  <button
                    type="button"
                    onClick={() => handleUpdateMediaLayout(activeMediaOverlay.identifier, 'right', activeMediaOverlay.size, activeMediaOverlay.index)}
                    className={cn(
                      "py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all min-h-[44px]",
                      activeMediaOverlay.align === 'right' ? "bg-accent text-on-accent border-accent shadow-md font-bold" : "bg-white/5 border-white/10 text-text/70 hover:bg-white/10 hover:text-text"
                    )}
                  >
                    <AlignRight className="w-4 h-4" /> Right
                  </button>
                </div>
              </div>

              {/* Size Selector */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-text/50 mb-2">
                  Display Size
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(['small', 'medium', 'large', 'full'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleUpdateMediaLayout(activeMediaOverlay.identifier, activeMediaOverlay.align, s, activeMediaOverlay.index)}
                      className={cn(
                        "py-2 px-2 rounded-xl border text-xs font-semibold flex flex-col items-center justify-center gap-0.5 transition-all min-h-[44px]",
                        activeMediaOverlay.size === s ? "bg-accent text-on-accent border-accent shadow-md font-bold" : "bg-white/5 border-white/10 text-text/70 hover:bg-white/10 hover:text-text"
                      )}
                    >
                      <span className="capitalize">{s}</span>
                      <span className={cn("text-[10px]", activeMediaOverlay.size === s ? "text-on-accent/70" : "text-text/40")}>
                        {s === 'small' ? '35%' : s === 'medium' ? '65%' : s === 'large' ? '85%' : '100%'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={handleDeleteActiveMedia}
                  className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1.5 py-1.5 px-2.5 rounded-xl hover:bg-red-500/10 transition-colors"
                  title="Remove this media from the note"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </button>
                <button
                  type="button"
                  onClick={handleCloseMediaOverlay}
                  className="px-6 py-2.5 rounded-xl bg-accent text-on-accent hover:bg-accent/90 text-xs font-bold transition-all min-h-[40px] shadow-lg shadow-accent/20"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="relative" style={{ fontSize: `${settings.fontSize}px`, fontFamily: settings.fontFamily || 'var(--font-gemini)', fontWeight: settings.fontWeight || 400, '--app-font-weight': settings.fontWeight || 400 } as React.CSSProperties}>
        {isUploading && (
          <div className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-black/80 backdrop-blur-md py-2 px-4 rounded-full border border-white/10 text-xs font-medium">
            <Loader2 className="w-3 h-3 animate-spin text-accent" />
            Uploading image...
          </div>
        )}

        {isEditing ? (
          <div className="space-y-4">
            {/* Magic Format Toolbar - Sticky Glassmorphic */}
            <div className="sticky-editor-toolbar -mx-4 px-4 flex justify-between">
              <div className="flex items-center">
                <div className="flex items-center gap-1 border-r border-white/10 pr-2">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleUndo}
                    disabled={historyStack.length === 0}
                    className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg transition-colors hover:bg-white/10 active:bg-white/20 disabled:opacity-20"
                    title="Undo (Ctrl+Z)"
                  >
                    <Undo size={20} strokeWidth={2.5} />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleRedo}
                    disabled={redoStack.length === 0}
                    className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg transition-colors hover:bg-white/10 active:bg-white/20 disabled:opacity-20"
                    title="Redo (Ctrl+Y)"
                  >
                    <Redo size={20} strokeWidth={2.5} />
                  </button>
                </div>
                <div className="flex items-center gap-1 border-r border-white/10 px-2">
                  {(isTargetingMedia || activeEditorMedia) && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-accent bg-accent/20 border border-accent/40 px-2 py-1 rounded-xl mr-1">
                      {activeEditorMedia?.type === 'video' ? <Youtube className="w-3.5 h-3.5 text-red-400" /> : <ImageIcon className="w-3.5 h-3.5 text-emerald-400" />}
                      <span className="hidden sm:inline">Media</span>
                    </span>
                  )}
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleMagicFormat(undefined, 'small')}
                    className={cn("w-10 h-10 min-w-[40px] min-h-[40px] flex items-center justify-center text-xs font-bold rounded-lg transition-all", activeSize === 'small' ? "bg-accent text-on-accent shadow-sm font-black scale-105" : "hover:bg-white/10 text-text/80")}
                    title="Small Size (35%)"
                  >
                    S
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleMagicFormat(undefined, 'medium')}
                    className={cn("w-10 h-10 min-w-[40px] min-h-[40px] flex items-center justify-center text-xs font-bold rounded-lg transition-all", activeSize === 'medium' ? "bg-accent text-on-accent shadow-sm font-black scale-105" : "hover:bg-white/10 text-text/80")}
                    title="Medium Size (65%)"
                  >
                    M
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleMagicFormat(undefined, 'large')}
                    className={cn("w-10 h-10 min-w-[40px] min-h-[40px] flex items-center justify-center text-xs font-bold rounded-lg transition-all", activeSize === 'large' ? "bg-accent text-on-accent shadow-sm font-black scale-105" : "hover:bg-white/10 text-text/80")}
                    title="Large Size (85%)"
                  >
                    L
                  </button>
                </div>
                <div className="flex items-center gap-1 pl-2">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleMagicFormat('left')}
                    className={cn("p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg transition-all", activeAlign === 'left' ? "bg-accent text-on-accent shadow-sm font-bold scale-105" : "hover:bg-white/10 text-text/80")}
                    title="Align Left"
                  >
                    <AlignLeft size={20} strokeWidth={2.5} />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleMagicFormat('center')}
                    className={cn("p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg transition-all", activeAlign === 'center' ? "bg-accent text-on-accent shadow-sm font-bold scale-105" : "hover:bg-white/10 text-text/80")}
                    title="Align Center"
                  >
                    <AlignCenter size={20} strokeWidth={2.5} />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleMagicFormat('right')}
                    className={cn("p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg transition-all", activeAlign === 'right' ? "bg-accent text-on-accent shadow-sm font-bold scale-105" : "hover:bg-white/10 text-text/80")}
                    title="Align Right"
                  >
                    <AlignRight size={20} strokeWidth={2.5} />
                  </button>
                </div>
                <div className="flex items-center gap-1 border-l border-white/10 ml-2 pl-2">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => wrapSelection(`<u>`, `</u>`)}
                    className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg transition-colors hover:bg-white/10"
                    title="Underline Text"
                  >
                    <Underline size={20} strokeWidth={2.5} />
                  </button>
                  <div className="flex items-center p-1 rounded-lg bg-white/5 border border-white/10 gap-1 ml-1" title="Highlight Text">
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => wrapSelection(`<mark style="background-color: ${highlightColor}; color: black; border-radius: 2px; padding: 0 4px;">`, `</mark>`)}
                      className="p-1 rounded transition-colors hover:bg-white/10"
                    >
                      <Highlighter size={20} strokeWidth={2.5} color={highlightColor} />
                    </button>
                    <input
                      type="color"
                      value={highlightColor}
                      onChange={(e) => setHighlightColor(e.target.value)}
                      className="w-5 h-5 rounded cursor-pointer border-none p-0 bg-transparent"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-1 border-l border-white/10 ml-2 pl-2">
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (textareaRef.current) {
                        lastEditorCursorRef.current = {
                          start: getEditorSelection().start,
                          end: getEditorSelection().end
                        };
                      }
                    }}
                    onClick={() => setIsMathModalOpen(prev => !prev)}
                    className={cn(
                      "p-2 min-w-[40px] min-h-[40px] rounded-lg transition-colors flex items-center justify-center font-bold",
                      isMathModalOpen ? "bg-accent text-on-accent font-bold" : "hover:bg-white/10 text-accent"
                    )}
                    title="Insert KaTeX Math Formula"
                  >
                    <span className="font-serif italic text-base leading-none">π</span>
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (textareaRef.current) {
                        lastEditorCursorRef.current = {
                          start: getEditorSelection().start,
                          end: getEditorSelection().end
                        };
                      }
                    }}
                    onClick={() => setIsImageModalOpen(true)}
                    className="p-2 min-w-[40px] min-h-[40px] rounded-lg transition-colors hover:bg-white/10 text-emerald-400 hover:text-emerald-300 flex items-center justify-center"
                    title="Insert Image (Upload or Web Link)"
                  >
                    <ImageIcon size={20} strokeWidth={2.5} />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (textareaRef.current) {
                        lastEditorCursorRef.current = {
                          start: getEditorSelection().start,
                          end: getEditorSelection().end
                        };
                      }
                    }}
                    onClick={() => setIsYouTubeModalOpen(true)}
                    className="p-2 min-w-[40px] min-h-[40px] rounded-lg transition-colors hover:bg-white/10 text-red-500 hover:text-red-400 flex items-center justify-center"
                    title="Insert YouTube Video"
                  >
                    <Youtube size={20} strokeWidth={2.5} />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {hasStructuredBlocks && (
                  <button
                    type="button"
                    onClick={() => setEditorMode(prev => prev === 'structured' ? 'raw' : 'structured')}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border shrink-0 cursor-pointer",
                      editorMode === 'structured'
                        ? "bg-accent/15 text-accent border-accent/40 shadow-sm"
                        : "bg-white/5 text-text/60 border-white/10 hover:text-text hover:bg-white/10"
                    )}
                    title={editorMode === 'structured' ? "Switch to Plain Text Markdown" : "Switch to Structured Box View"}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>{editorMode === 'structured' ? "Structured View" : "Raw Markdown"}</span>
                  </button>
                )}

                {hasLatexBlocks && editorMode === 'structured' && (
                  <button
                    type="button"
                    onClick={toggleAllLatex}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border shrink-0 cursor-pointer",
                      globalLatexFolded
                        ? "bg-sky-500/15 text-sky-300 border-sky-500/30 hover:bg-sky-500/25"
                        : "bg-sky-500/25 text-sky-200 border-sky-500/50 shadow-sm"
                    )}
                    title={globalLatexFolded ? "Unfold all LaTeX equations" : "Fold all LaTeX equations"}
                  >
                    <span className="font-serif font-bold text-xs">∑</span>
                    <span>{globalLatexFolded ? "Math: Folded" : "Math: Unfolded"}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleToggleEdit}
                  className="flex items-center gap-2 px-4 py-2 bg-accent text-on-accent rounded-full font-bold text-sm hover:bg-accent/90 transition-colors shadow-lg shadow-accent/20 cursor-pointer shrink-0"
                  title="Save Note"
                >
                  <Save size={16} strokeWidth={2.5} /> Save
                </button>
              </div>
            </div>

            {/* Active Media Layout Bar in Edit Mode */}
            <AnimatePresence>
              {(isTargetingMedia || activeEditorMedia) && (
                <motion.div
                  initial={{ opacity: 0, y: -6, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, y: -6, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="bg-surface/95 border border-accent/40 shadow-xl rounded-2xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs backdrop-blur-xl">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full bg-accent animate-pulse shrink-0" />
                      <div className="flex items-center gap-1.5 font-bold text-text truncate">
                        {activeEditorMedia?.type === 'video' ? (
                          <Youtube className="w-4 h-4 text-red-400 shrink-0" />
                        ) : (
                          <ImageIcon className="w-4 h-4 text-emerald-400 shrink-0" />
                        )}
                        <span>{activeEditorMedia?.type === 'video' ? 'Video Layout' : 'Image Layout'}:</span>
                      </div>
                      <span className="text-text/60 font-medium">
                        <span className="capitalize text-accent font-semibold">{activeAlign}</span> • <span className="capitalize text-accent font-semibold">{activeSize}</span> ({activeSize === 'small' ? '35%' : activeSize === 'medium' ? '65%' : activeSize === 'large' ? '85%' : '100%'})
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {/* Alignment */}
                      <div className="flex items-center gap-1 bg-white/5 rounded-xl p-1 border border-white/10">
                        {(['left', 'center', 'right'] as const).map(al => (
                          <button
                            key={al}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handleMagicFormat(al, undefined)}
                            className={cn(
                              "px-2.5 py-1 rounded-lg text-xs font-semibold capitalize transition-all cursor-pointer flex items-center gap-1",
                              activeAlign === al ? "bg-accent text-on-accent font-bold shadow-sm" : "text-text/60 hover:text-text hover:bg-white/10"
                            )}
                            title={`Align ${al}`}
                          >
                            {al === 'left' && <AlignLeft className="w-3 h-3" />}
                            {al === 'center' && <AlignCenter className="w-3 h-3" />}
                            {al === 'right' && <AlignRight className="w-3 h-3" />}
                            <span>{al}</span>
                          </button>
                        ))}
                      </div>

                      {/* Size */}
                      <div className="flex items-center gap-1 bg-white/5 rounded-xl p-1 border border-white/10">
                        {(['small', 'medium', 'large', 'full'] as const).map(sz => (
                          <button
                            key={sz}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handleMagicFormat(undefined, sz)}
                            className={cn(
                              "px-2.5 py-1 rounded-lg text-xs font-semibold capitalize transition-all cursor-pointer",
                              activeSize === sz ? "bg-accent text-on-accent font-bold shadow-sm" : "text-text/60 hover:text-text hover:bg-white/10"
                            )}
                            title={`${sz} Size (${sz === 'small' ? '35%' : sz === 'medium' ? '65%' : sz === 'large' ? '85%' : '100%'})`}
                          >
                            {sz === 'small' ? 'S (35%)' : sz === 'medium' ? 'M (65%)' : sz === 'large' ? 'L (85%)' : 'Full (100%)'}
                          </button>
                        ))}
                      </div>

                      {/* Remove Media */}
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={handleDeleteActiveMediaInEditor}
                        className="p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors ml-0.5"
                        title="Remove this media from note"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>

                      {/* Dismiss Bar */}
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setIsTargetingMedia(false);
                          setActiveEditorMedia(null);
                        }}
                        className="p-1.5 rounded-lg text-text/40 hover:text-text hover:bg-white/10 transition-colors"
                        title="Dismiss layout bar"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Math Formula Snippets Quick Dock */}
            <AnimatePresence>
              {isMathModalOpen && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden bg-surface/95 border border-white/15 rounded-2xl p-3 shadow-xl space-y-3"
                >
                  <div className="flex items-center justify-between border-b border-white/10 pb-2">
                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                      {MATH_SNIPPET_CATEGORIES.map(cat => (
                        <button
                          key={cat.category}
                          type="button"
                          onClick={() => setSelectedMathCategory(cat.category)}
                          className={cn(
                            "px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors",
                            selectedMathCategory === cat.category
                              ? "bg-accent text-on-accent"
                              : "bg-white/5 text-text/60 hover:text-text"
                          )}
                        >
                          {cat.category}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsMathModalOpen(false)}
                      className="p-1 rounded-lg text-text/40 hover:text-text hover:bg-white/10 ml-2 shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto pr-1">
                    {MATH_SNIPPET_CATEGORIES.find(c => c.category === selectedMathCategory)?.items.map((item, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => insertMathSnippet(item.code)}
                        className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-accent hover:text-on-accent border border-white/10 text-xs font-mono transition-all flex items-center gap-1.5 group"
                        title={item.desc}
                      >
                        <span className="font-semibold">{item.label}</span>
                        <span className="text-[10px] text-text/40 group-hover:text-on-accent/60 font-sans">({item.desc})</span>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {editorMode === 'structured' && hasStructuredBlocks ? (
              <div className="space-y-2">
                {parsedSegments.map((seg, idx) => {
                  if (seg.type === 'media' && seg.media) {
                    return (
                      <div
                        key={seg.id}
                        className="my-3 p-3 rounded-2xl bg-white/[0.025] border border-white/8 hover:border-white/20 transition-all flex flex-wrap items-center justify-between gap-3 group/mediabox shadow-sm backdrop-blur-sm"
                      >
                        {/* Clean faint colored icon badge and media held cleanly */}
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={cn(
                            "w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-sm border",
                            seg.media.type === 'video'
                              ? "bg-red-500/10 text-red-400 border-red-500/20"
                              : "bg-sky-500/10 text-sky-400 border-sky-500/20"
                          )}>
                            {seg.media.type === 'video' ? <Youtube className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />}
                          </div>

                          {/* Media preview held cleanly without noisy text */}
                          {seg.media.type === 'video' && seg.media.videoId ? (
                            <div className="relative rounded-xl overflow-hidden border border-white/10 shrink-0 h-14 sm:h-16 aspect-video bg-black flex items-center justify-center shadow-md">
                              <img
                                src={`https://img.youtube.com/vi/${seg.media.videoId}/mqdefault.jpg`}
                                alt="Video preview"
                                className="w-full h-full object-cover"
                              />
                              <div className="absolute inset-0 bg-black/25 flex items-center justify-center">
                                <Play className="w-4 h-4 text-text fill-white drop-shadow" />
                              </div>
                            </div>
                          ) : seg.media.type === 'image' && seg.media.url ? (
                            <div className="relative rounded-xl overflow-hidden border border-white/10 shrink-0 h-14 sm:h-16 max-w-[140px] bg-black/30 flex items-center justify-center shadow-md">
                              <img
                                src={resolveLocalImage(seg.media.url) || undefined}
                                alt={seg.media.alt || 'Image preview'}
                                className="h-full w-auto object-contain rounded-lg"
                              />
                            </div>
                          ) : (
                            <div className="h-12 px-3 rounded-xl bg-white/5 border border-white/10 flex items-center text-xs text-text/40 font-mono truncate">
                              {seg.media.url}
                            </div>
                          )}
                        </div>

                        {/* Minimalist icon layout & remove controls without text clutter */}
                        <div className="flex items-center gap-1 shrink-0">
                          {/* Minimal Alignment Buttons */}
                          <div className="flex items-center gap-0.5 bg-white/5 rounded-xl p-0.5 border border-white/10">
                            {(['left', 'center', 'right'] as const).map(al => (
                              <button
                                key={al}
                                type="button"
                                onClick={() => handleUpdateSegmentMedia(seg.media!.url, seg.media!.lineIndex, al, undefined)}
                                className={cn(
                                  "p-1.5 rounded-lg text-xs transition-all cursor-pointer",
                                  seg.media!.align === al ? "bg-accent text-on-accent font-bold shadow-sm" : "text-text/40 hover:text-text hover:bg-white/10"
                                )}
                                title={`Align ${al}`}
                              >
                                {al === 'left' ? <AlignLeft className="w-3.5 h-3.5" /> : al === 'center' ? <AlignCenter className="w-3.5 h-3.5" /> : <AlignRight className="w-3.5 h-3.5" />}
                              </button>
                            ))}
                          </div>

                          {/* Minimal Size Buttons */}
                          <div className="flex items-center gap-0.5 bg-white/5 rounded-xl p-0.5 border border-white/10">
                            {(['small', 'medium', 'large', 'full'] as const).map(sz => (
                              <button
                                key={sz}
                                type="button"
                                onClick={() => handleUpdateSegmentMedia(seg.media!.url, seg.media!.lineIndex, undefined, sz)}
                                className={cn(
                                  "px-2 py-1 rounded-lg text-[10px] font-bold uppercase transition-all cursor-pointer",
                                  seg.media!.size === sz ? "bg-accent text-on-accent shadow-sm" : "text-text/40 hover:text-text hover:bg-white/10"
                                )}
                                title={`Size: ${sz}`}
                              >
                                {sz === 'small' ? 'S' : sz === 'medium' ? 'M' : sz === 'large' ? 'L' : 'Full'}
                              </button>
                            ))}
                          </div>

                          <button
                            type="button"
                            onClick={() => handleDeleteSegmentMedia(seg.media!.url, seg.media!.lineIndex)}
                            className="p-1.5 rounded-lg text-text/40 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer ml-1"
                            title="Remove media"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  }

                  if (seg.type === 'latex') {
                    const isExpanded = !!expandedLatexBlocks[seg.id];

                    if (!isExpanded) {
                      // Collapsed by default: clean faint blue box with rendered KaTeX preview
                      return (
                        <div
                          key={seg.id}
                          onClick={() => toggleLatexBlock(seg.id)}
                          className="group/latex my-2.5 rounded-2xl bg-sky-500/[0.04] border border-sky-500/20 hover:border-sky-500/40 hover:bg-sky-500/[0.07] transition-all cursor-pointer p-3 sm:p-4 shadow-sm backdrop-blur-sm"
                          title="Click to view and edit LaTeX syntax"
                        >
                          <div className="flex items-center justify-between gap-2 border-b border-sky-500/10 pb-2 mb-2">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-lg bg-sky-500/15 text-sky-400 border border-sky-500/25 flex items-center justify-center text-xs font-serif font-bold">
                                ∑
                              </div>
                              <span className="text-xs font-semibold text-sky-300 tracking-wide">
                                LaTeX / KaTeX Equation
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-sky-400/80 group-hover/latex:text-sky-300 transition-colors">
                              <Pencil className="w-3.5 h-3.5" />
                              <span className="text-[11px] font-medium hidden sm:inline">Click to edit syntax</span>
                              <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover/latex:translate-x-0.5" />
                            </div>
                          </div>

                          {/* Clean rendered equation */}
                          <div className="py-2 px-3 overflow-x-auto text-center flex items-center justify-center text-text/95">
                            <LatexBlockView formula={seg.text} />
                          </div>
                        </div>
                      );
                    }

                    // Expanded: view and edit LaTeX / KaTeX syntax
                    return (
                      <div
                        key={seg.id}
                        className="my-3 rounded-2xl bg-sky-500/[0.05] border border-sky-500/35 p-3.5 sm:p-4 shadow-md transition-all"
                      >
                        <div className="flex items-center justify-between gap-2 border-b border-sky-500/15 pb-2.5 mb-3">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-lg bg-sky-500/20 text-sky-400 border border-sky-500/30 flex items-center justify-center text-xs font-serif font-bold">
                              ∑
                            </div>
                            <span className="text-xs font-bold text-sky-300">
                              Edit LaTeX Syntax
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => toggleLatexBlock(seg.id)}
                              className="px-2.5 py-1 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/20 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Done</span>
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSegmentLatex(idx)}
                              className="p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer"
                              title="Delete formula"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Raw syntax textarea */}
                        <textarea
                          data-section-input
                          data-segment-index={idx}
                          aria-label={`Formula block ${idx + 1}`}
                          onFocus={event => { textareaRef.current = event.currentTarget; }}
                          onPaste={handlePasteIntercept}
                          value={seg.text}
                          onChange={(e) => handleSegmentTextChange(idx, e.target.value)}
                          className="w-full font-mono text-sm p-3 rounded-xl bg-black/40 border border-sky-500/20 text-sky-200 focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/30 resize-y min-h-[90px]"
                          placeholder="$$ \text{Type LaTeX formula here} $$"
                          rows={Math.max(3, seg.text.split('\n').length)}
                        />

                        {/* Quick math symbols helpers */}
                        <div className="flex flex-wrap items-center gap-1.5 mt-2.5 pt-2 border-t border-sky-500/10">
                          <span className="text-[10px] font-semibold text-sky-400/60 uppercase tracking-wider mr-1">Insert:</span>
                          {[
                            { label: 'Fraction', insert: '\\frac{a}{b}' },
                            { label: 'Sqrt', insert: '\\sqrt{x}' },
                            { label: 'Partial', insert: '\\frac{\\partial y}{\\partial x}' },
                            { label: 'Integral', insert: '\\int_{a}^{b} f(x) \\, dx' },
                            { label: 'Sum', insert: '\\sum_{i=1}^{n}' },
                            { label: 'Matrix', insert: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' },
                            { label: 'Cases', insert: '\\begin{cases} x & \\text{if } a \\\\ y & \\text{otherwise} \\end{cases}' }
                          ].map((sym) => (
                            <button
                              key={sym.label}
                              type="button"
                              onClick={() => {
                                const currentFormula = seg.text;
                                const updated = currentFormula.replace(/\$\$$/, ` ${sym.insert} $$`);
                                handleSegmentTextChange(idx, updated.includes(sym.insert) ? updated : `${currentFormula} ${sym.insert}`);
                              }}
                              className="px-2 py-0.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 text-[11px] font-mono border border-sky-500/15 transition-all cursor-pointer"
                            >
                              {sym.label}
                            </button>
                          ))}
                        </div>

                        {/* Live KaTeX Preview beneath textarea */}
                        <div className="mt-3 p-3 rounded-xl bg-black/30 border border-sky-500/15">
                          <div className="text-[10px] font-semibold text-sky-400/50 uppercase tracking-wider mb-1">Live KaTeX Preview:</div>
                          <div className="py-1 overflow-x-auto text-center">
                            <LatexBlockView formula={seg.text} />
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={seg.id} className="relative">
                      <textarea
                        data-section-input
                        data-segment-index={idx}
                        aria-label={`Text block ${idx + 1}`}
                        value={seg.text}
                        onChange={(e) => handleSegmentTextChange(idx, e.target.value)}
                        onFocus={(e) => {
                          textareaRef.current = e.target;
                        }}
                        onClick={(e) => {
                          textareaRef.current = e.currentTarget;
                          lastEditorCursorRef.current = {
                            start: getEditorSelection(e.currentTarget).start,
                            end: getEditorSelection(e.currentTarget).end
                          };
                          checkActiveLineFormatting();
                        }}
                        onKeyUp={(e) => {
                          textareaRef.current = e.currentTarget;
                          lastEditorCursorRef.current = {
                            start: getEditorSelection(e.currentTarget).start,
                            end: getEditorSelection(e.currentTarget).end
                          };
                          checkActiveLineFormatting();
                        }}
                        onSelect={(e) => {
                          textareaRef.current = e.currentTarget;
                          lastEditorCursorRef.current = {
                            start: getEditorSelection(e.currentTarget).start,
                            end: getEditorSelection(e.currentTarget).end
                          };
                          checkActiveLineFormatting();
                        }}
                        onPaste={handlePasteIntercept}
                        placeholder="Type note content here... (Markdown & Math supported)"
                        className="textarea-edit-mode !min-h-[70px]"
                        rows={Math.max(2, seg.text.split('\n').length)}
                        style={{ fontSize: 'inherit' }}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <textarea
                data-section-input
                aria-label="Raw section Markdown"
                ref={textareaRef}
                value={textBuffer}
                onChange={handleTextareaChange}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
                    e.preventDefault();
                    handleUndo();
                  } else if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
                    e.preventDefault();
                    handleRedo();
                  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
                    e.preventDefault();
                    setIsSearchOpen(true);
                    setTimeout(() => searchInputRef.current?.focus(), 50);
                  }
                }}
                onClick={() => {
                  if (textareaRef.current) {
                    lastEditorCursorRef.current = {
                      start: getEditorSelection().start,
                      end: getEditorSelection().end
                    };
                  }
                  checkActiveLineFormatting();
                }}
                onKeyUp={() => {
                  if (textareaRef.current) {
                    lastEditorCursorRef.current = {
                      start: getEditorSelection().start,
                      end: getEditorSelection().end
                    };
                  }
                  checkActiveLineFormatting();
                }}
                onSelect={() => {
                  if (textareaRef.current) {
                    lastEditorCursorRef.current = {
                      start: getEditorSelection().start,
                      end: getEditorSelection().end
                    };
                  }
                  checkActiveLineFormatting();
                }}
                onPaste={handlePasteIntercept}
                onDragOver={(e) => e.preventDefault()}
                onDrop={async event => {
                  const file = event.dataTransfer.files?.[0];
                  if (!file?.type.startsWith('image/')) return;
                  event.preventDefault();
                  const anchor = captureInsertion();
                  flushPendingContent();
                  try {
                    const fileToUpload = await compressImageFile(file);
                    const reference = await uploadImageFile(user?.uid || 'guest', fileToUpload, file.name);
                    insertForSection(anchor, `\n![Dropped Image](${reference}) @@center:medium@@\n`);
                  } catch (error: any) { showToast?.('Image could not be saved: ' + error.message, 'error'); }
                }}
                placeholder="Start typing your note... (Markdown and Math supported)"
                className="textarea-edit-mode"
                style={{ fontSize: 'inherit' }}
              />
            )}
          </div>
        ) : (
          <MarkdownPreview
            content={textBuffer || currentSection?.content || ''}
            isEditing={isEditing}
            searchQuery={isSearchOpen ? searchQuery : ''}
            searchMatchIndex={searchMatchIndex}
            onSelectMedia={(media) => setActiveMediaOverlay(media)}
          />
        )}
      </div>

      {/* Section Navigation */}
      {!isEditing && sections.length > 1 && (
        <div className="flex items-center justify-between mt-12 pt-8 border-t border-white/5">
          {currentSectionIndex > 0 ? (
            <button
              onClick={() => handleSelectSection(currentSectionIndex - 1)}
              className="flex items-center gap-2 text-sm text-text/40 hover:text-accent transition-colors min-h-[44px] px-2 py-1"
            >
              <ChevronLeft className="w-4 h-4" /> {sections[currentSectionIndex - 1].title}
            </button>
          ) : <div />}

          {currentSectionIndex < sections.length - 1 ? (
            <button
              onClick={() => handleSelectSection(currentSectionIndex + 1)}
              className="flex items-center gap-2 text-sm text-text/40 hover:text-accent transition-colors min-h-[44px] px-2 py-1"
            >
              {sections[currentSectionIndex + 1].title} <ChevronRight className="w-4 h-4" />
            </button>
          ) : <div />}
        </div>
      )}

      {/* Generous bottom scroll clearance so text is never obscured by the bottom floating pill */}
      <div className="h-32 sm:h-24 pointer-events-none" aria-hidden="true" />

      {/* Floating Pill Bottom Navigation - Gemini Style */}
      <div className="bottom-nav-pill">
        {/* Left: Grid/Hamburger Icon */}
        <button
          onClick={() => setSidebarOpen(true)}
          title="Open Sections"
        >
          <Menu className="w-6 h-6" />
        </button>

        {/* Center: Section Navigation */}
        <div className="flex items-center gap-4 flex-1 justify-center">
          {!isEditing && (
            <>
              <button
                onClick={() => handleSelectSection(currentSectionIndex - 1)}
                disabled={currentSectionIndex === 0}
                className="disabled:opacity-20 hover:text-accent transition-colors p-1"
                title="Previous Section"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>

              <span className="text-xs font-mono text-text/40 select-none">
                {currentSectionIndex + 1} / {sections.length}
              </span>

              <button
                onClick={() => handleSelectSection(currentSectionIndex + 1)}
                disabled={currentSectionIndex === sections.length - 1}
                className="disabled:opacity-20 hover:text-accent transition-colors p-1"
                title="Next Section"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </>
          )}
        </div>

        {/* Right: Edit/Save Icon + Gear Icon */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleToggleEdit}
            className={cn(isEditing && "active-glow")}
            title={isEditing ? "Save Note" : "Edit Note"}
          >
            {isEditing ? <Check className="w-6 h-6" strokeWidth={3} /> : <Edit2 className="w-6 h-6" />}
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            title="Preferences & Themes"
          >
            <SettingsIcon className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Sections Sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              className="fixed left-0 top-0 bottom-0 w-full max-w-xs bg-surface backdrop-blur-[15px] border-r border-white/10 z-[70] p-6 flex flex-col"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-lg font-bold text-text">Sections</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleAddSection}
                    className="p-2 hover:text-accent transition-colors rounded-lg hover:bg-white/5"
                    title="Add New Section"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                  <button onClick={() => setSidebarOpen(false)} className="p-2 hover:bg-white/5 rounded-lg"><X className="w-5 h-5" /></button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 no-scrollbar">
                {sections.map((section, idx) => (
                  <div
                    key={section.id}
                    className={cn(
                      "group p-3 rounded-xl border transition-all flex items-center justify-between gap-2",
                      currentSectionIndex === idx ? "bg-accent/10 border-accent/30 text-accent" : "bg-white/5 border-transparent text-text/60 hover:bg-white/10"
                    )}
                  >
                    <button
                      onClick={() => handleSelectSection(idx)}
                      className="flex-1 text-left text-sm font-medium truncate py-1"
                    >
                      {idx + 1}. {section.title}
                    </button>
                    <div className="flex items-center gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleRenameSection(idx)}
                        className="admin-action-btn hover:text-amber-400"
                        title="Rename Section"
                      >
                        <Edit2 size={20} strokeWidth={4} />
                      </button>
                      <button
                        onClick={() => handleDeleteSection(idx)}
                        className="admin-action-btn hover:text-red-400"
                        title="Delete Section"
                      >
                        <Trash2 size={20} strokeWidth={4} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={handleAddSection}
                className="mt-6 w-full py-3 rounded-xl bg-white/5 border border-white/10 text-text text-sm font-bold flex items-center justify-center gap-2 hover:bg-white/10 transition-all"
              >
                <Plus className="w-4 h-4" /> Add Section
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Outline / Table of Contents Drawer */}
      <AnimatePresence>
        {isOutlineOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOutlineOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[75]"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 240 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-xs sm:max-w-sm bg-surface backdrop-blur-[20px] border-l border-white/10 z-[80] p-6 flex flex-col shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6 border-b border-white/10 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
                    <List className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-text">Table of Contents</h3>
                    <p className="text-xs text-text/50">
                      {outlineHeadings.length > 0 ? `${outlineHeadings.length} headings in this section` : 'Current section structure'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setIsOutlineOpen(false)}
                  className="p-2 rounded-xl text-text/40 hover:text-text hover:bg-white/10 transition-colors"
                  title="Close Outline"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-1.5 no-scrollbar pr-1">
                {outlineHeadings.length > 0 ? (
                  outlineHeadings.map((heading, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        jumpToHeading(heading.text);
                        setIsOutlineOpen(false);
                      }}
                      className={cn(
                        "w-full text-left rounded-xl p-2.5 transition-all flex items-center gap-2 group hover:bg-white/10 text-sm",
                        heading.level === 1 && "font-bold text-text bg-white/5",
                        heading.level === 2 && "font-semibold text-text/90 pl-5",
                        heading.level === 3 && "font-normal text-text/70 pl-8 text-xs",
                        heading.level >= 4 && "font-normal text-text/50 pl-11 text-xs"
                      )}
                    >
                      <span className={cn(
                        "w-2 h-2 rounded-full shrink-0 transition-colors",
                        heading.level === 1 ? "bg-accent" : heading.level === 2 ? "bg-accent/60" : "bg-white/20 group-hover:bg-accent"
                      )} />
                      <span className="truncate group-hover:text-accent transition-colors flex-1">
                        {heading.text}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-text/20 group-hover:text-accent group-hover:translate-x-0.5 transition-all shrink-0" />
                    </button>
                  ))
                ) : (
                  <div className="py-16 text-center space-y-3 px-4">
                    <div className="w-12 h-12 rounded-2xl bg-white/5 mx-auto flex items-center justify-center text-text/30">
                      <Hash className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-medium text-text/80">No Headings Found</p>
                    <p className="text-xs text-text/40 leading-relaxed">
                      Use markdown headings in your notes (e.g. <code className="text-accent bg-white/5 px-1 py-0.5 rounded"># Heading 1</code> or <code className="text-accent bg-white/5 px-1 py-0.5 rounded">## Heading 2</code>) to automatically generate an interactive table of contents.
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {settingsOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSettingsOpen(false)}
              className="fixed inset-0 z-[99999] flex items-center justify-center p-4"
              style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-surface backdrop-blur-[15px] border border-white/10 z-[100000] p-8 rounded-3xl shadow-2xl max-h-[90vh] overflow-y-auto no-scrollbar"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-text">Preferences</h3>
                <button onClick={() => setSettingsOpen(false)} className="p-1 rounded-lg text-text/40 hover:text-text"><X className="w-5 h-5" /></button>
              </div>

              <div className="space-y-6">
                {/* Theme Selector */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-text/60">
                    <Palette className="w-4 h-4" /> Color Theme
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {THEMES.map(t => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => { setSettings({ ...settings, theme: t.id }); onThemeChange(t.id); }}
                        className={cn(
                          "p-2.5 rounded-xl border text-left transition-all flex items-center gap-2.5",
                          (settings.theme || 'dark') === t.id
                            ? "border-accent bg-accent/15 shadow-sm"
                            : "border-white/10 bg-white/5 hover:bg-white/10"
                        )}
                      >
                        <span
                          className="w-4 h-4 rounded-full border border-white/20 shrink-0 shadow-inner"
                          style={{ backgroundColor: t.accent }}
                        />
                        <div className="min-w-0">
                          <p className={cn("text-xs font-semibold truncate", (settings.theme || 'dark') === t.id ? "text-accent" : "text-text")}>
                            {t.name}
                          </p>
                          <p className="text-[10px] text-text/40 truncate">{t.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-text/60">
                      <Type className="w-4 h-4" /> Font Style
                    </div>
                  </div>
                  <select
                    value={settings.fontFamily || 'var(--font-gemini)'}
                    onChange={(e) => setSettings({ ...settings, fontFamily: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-text focus:outline-none focus:border-accent transition-colors"
                  >
                    <option value="var(--font-gemini)">Sans-Serif (Default)</option>
                    <option value="'Merriweather', serif">Serif (Academic)</option>
                    <option value="'JetBrains Mono', monospace">Monospace (Technical)</option>
                    <option value="'Comic Sans MS', 'Comic Sans', cursive">Comic Sans</option>
                  </select>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-text/60">
                      <Type className="w-4 h-4" /> Font Size
                    </div>
                    <span className="text-accent font-bold">{settings.fontSize || 18}px</span>
                  </div>
                  <input
                    type="range" min="12" max="32" step="1"
                    value={settings.fontSize || 18}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setSettings(prev => ({ ...prev, fontSize: isNaN(val) ? 18 : val }));
                    }}
                    className="w-full accent-accent"
                  />
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-text/60">
                      <Type className="w-4 h-4" /> Font Weight
                    </div>
                    <span className="text-accent font-bold">{settings.fontWeight || 400}</span>
                  </div>
                  <input
                    type="range" min="100" max="900" step="100"
                    value={settings.fontWeight || 400}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setSettings(prev => ({ ...prev, fontWeight: isNaN(val) ? 400 : val }));
                    }}
                    className="w-full accent-accent"
                  />
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-text/60">
                      <Maximize className="w-4 h-4" /> Zoom Level
                    </div>
                    <span className="text-accent font-bold">{(typeof settings?.zoom === 'number' && !isNaN(settings.zoom)) ? settings.zoom : 100}%</span>
                  </div>
                  <input
                    type="range" min="50" max="150" step="5"
                    value={(typeof settings?.zoom === 'number' && !isNaN(settings.zoom)) ? settings.zoom : 100}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setSettings(prev => ({ ...prev, zoom: isNaN(val) ? 100 : val }));
                    }}
                    className="w-full accent-accent"
                  />
                </div>

                <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-text/30 uppercase tracking-widest">
                    <span>Database Usage</span>
                    <span className={cn(
                      "normal-case tracking-normal",
                      getDatabaseUsage() > 1024 * 1024 ? "text-red-400" : "text-accent"
                    )}>
                      {formatSize(getDatabaseUsage())} / 1MB
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full transition-all duration-500",
                        getDatabaseUsage() > 1024 * 1024 ? "bg-red-400" : "bg-accent"
                      )}
                      style={{ width: `${Math.min(100, (getDatabaseUsage() / (1024 * 1024)) * 100)}%` }}
                    />
                  </div>
                </div>

                <button
                  onClick={toggleFullscreen}
                  className="w-full py-4 rounded-2xl bg-white/5 border border-white/10 text-text font-bold flex items-center justify-center gap-3 hover:bg-white/10 transition-all"
                >
                  <Maximize className="w-5 h-5" /> Toggle Fullscreen
                </button>

                <button
                  onClick={handleExportVault}
                  className="w-full py-4 rounded-2xl bg-accent text-on-accent font-bold flex items-center justify-center gap-3 hover:bg-accent/90 transition-all"
                >
                  <FileJson className="w-5 h-5" /> Vault Export (.json)
                </button>

                <div className="text-center">
                  <p className="text-xs text-text/40">Add to Home Screen for Native Fullscreen.</p>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <YouTubeModal
        isOpen={isYouTubeModalOpen}
        onClose={() => setIsYouTubeModalOpen(false)}
        onInsert={handleInsertYouTube}
      />

      <ImageModal
        isOpen={isImageModalOpen}
        onClose={() => setIsImageModalOpen(false)}
        userId={user?.uid || 'guest'}
        onInsert={handleInsertImage}
      />
    </motion.div>
  );
}
