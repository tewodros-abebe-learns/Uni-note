import type { Note, Folder } from '../firebase';
import { getMediaReferences } from './mediaPromotion';
import { dataUrlToBlob } from '../utils/mediaStore';
export interface VaultBackup { format: 'uninote-vault'; version: 2; exportedAt: number; notes: Note[]; folders: Folder[]; media: Record<string, string> }
export interface ImportPlan { notes: Note[]; folders: Folder[]; media: Record<string, string> }
const object = (value: any) => value && typeof value === 'object' && !Array.isArray(value);
const string = (value: any, fallback: string) => typeof value === 'string' ? value : fallback;
const timestamp = (value: any, fallback: number) => {
  if (value == null) return fallback;
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (object(value) && typeof value.seconds === 'number' && Number.isFinite(value.seconds) && (value.nanoseconds == null || Number.isInteger(value.nanoseconds) && value.nanoseconds >= 0 && value.nanoseconds < 1e9)) return { seconds: value.seconds, nanoseconds: value.nanoseconds || 0 };
  throw new Error('Invalid backup timestamp');
};
/** Validate the entire document before committing any notes. Every source identity is remapped. */
export function planVaultImport(input: unknown, destination: string, makeId: () => string = () => crypto.randomUUID(), now = Date.now()): ImportPlan {
  const notes: any[] = []; const folders: any[] = []; const media: Record<string, string> = {};
  const addNote = (note: any, folderId?: string) => { if (notes.length >= 2000) throw new Error('Backup exceeds 2,000 notes'); if (!object(note)) throw new Error('Invalid note record'); notes.push({ ...note, folderId: folderId ?? note.folderId }); };
  const addFolders = (items: any[], parentId?: string, depth = 0) => {
    if (depth > 50) throw new Error('Folder nesting exceeds 50 levels');
    for (const folder of items) {
      if (folders.length >= 2000) throw new Error('Backup exceeds 2,000 folders');
      if (!object(folder) || folder.id != null && typeof folder.id !== 'string' || folder.parentId != null && typeof folder.parentId !== 'string') throw new Error('Invalid folder record');
      const id = string(folder.id, `source_folder_${folders.length}`);
      folders.push({ ...folder, id, parentId: parentId ?? folder.parentId ?? null });
      if (folder.notes != null) { if (!Array.isArray(folder.notes)) throw new Error('Invalid folder notes'); folder.notes.forEach((note: any) => addNote(note, id)); }
      const children = folder.folders ?? folder.children;
      if (children != null) { if (!Array.isArray(children)) throw new Error('Invalid subfolders'); addFolders(children, id, depth + 1); }
    }
  };
  if (Array.isArray(input)) input.forEach(note => addNote(note));
  else if (object(input)) {
    const data = input as any;
    if (data.version != null && data.format === 'uninote-vault' && data.version !== 2) throw new Error('Unsupported backup version');
    if (data.notes != null || data.folders != null) {
      if (data.notes != null && !Array.isArray(data.notes) || data.folders != null && !Array.isArray(data.folders)) throw new Error('Invalid vault collections');
      (data.notes || []).forEach((note: any) => addNote(note)); addFolders(data.folders || []);
    } else addNote(data);
    if (data.media != null) {
      if (!object(data.media)) throw new Error('Invalid media archive');
      for (const [id, value] of Object.entries(data.media)) {
        if (!/^media_[a-zA-Z0-9._-]+$/.test(id) || typeof value !== 'string') throw new Error('Invalid media archive entry');
        const blob = dataUrlToBlob(value);
        if (blob.size > 25 * 1024 * 1024) throw new Error('Archived image exceeds 25 MB');
        media[id] = value;
      }
    }
  } else throw new Error('Expected a note, note array or vault backup');
  if (notes.length > 2000 || folders.length > 2000) throw new Error('Backup exceeds 2,000 notes or folders');
  if (!notes.length && !folders.length) throw new Error('Backup is empty');
  const folderMap = new Map<string, string>(); const sourceFolders = new Map<string, any>();
  for (const folder of folders) {
    if (folderMap.has(folder.id)) throw new Error('Duplicate folder ID');
    folderMap.set(folder.id, `folder_${makeId()}`); sourceFolders.set(folder.id, folder);
  }
  const importedFolders = folders.map(folder => {
    let parent = folder.parentId; let level = 0; const visited = new Set<string>([folder.id]);
    while (parent && sourceFolders.has(parent)) {
      if (visited.has(parent)) throw new Error('Backup contains a folder cycle');
      visited.add(parent); level++; parent = sourceFolders.get(parent).parentId;
    }
    return { id: folderMap.get(folder.id)!, name: string(folder.name, 'Imported Folder').slice(0, 200), parentId: folderMap.get(folder.parentId) || null, level, createdAt: timestamp(folder.createdAt, now), updatedAt: timestamp(folder.updatedAt, now) };
  });
  const noteIds = new Set<string>();
  const importedNotes = notes.map(note => {
    if (note.id != null) { if (typeof note.id !== 'string' || noteIds.has(note.id)) throw new Error('Invalid or duplicate note ID'); noteIds.add(note.id); }
    const sections = note.sections ?? note.sectionsArray ?? (typeof note.content === 'string' ? [{ title: 'Introduction', content: note.content }] : null);
    if (!Array.isArray(sections) || !sections.length || sections.length > 500) throw new Error('Each note must contain 1–500 sections');
    const sectionIds = new Set<string>();
    return { id: `note_${makeId()}`, folderId: folderMap.get(note.folderId) || destination, title: string(note.title ?? note.name, 'Imported Note').slice(0, 300), createdAt: timestamp(note.createdAt, now), updatedAt: timestamp(note.updatedAt, now), isImported: true, isLocalOnly: true,
      sections: sections.map((section: any, index: number) => {
        if (!object(section) || typeof section.content !== 'string') throw new Error('Invalid section content');
        const id = string(section.id, `s_${index}`); if (sectionIds.has(id)) throw new Error('Duplicate section ID'); sectionIds.add(id);
        return { id, title: string(section.title, `Section ${index + 1}`), content: section.content };
      }) } as Note;
  });
  return { notes: importedNotes, folders: importedFolders, media };
}
export async function createVaultBackup(notes: Note[], folders: Folder[], readBlob: (id: string) => Promise<Blob | null>): Promise<VaultBackup> {
  const media: Record<string, string> = {};
  let bytes = new TextEncoder().encode(JSON.stringify({ notes, folders })).length;
  for (const id of new Set(notes.flatMap(note => note.sections.flatMap(section => getMediaReferences(section.content))))) {
    const blob = await readBlob(id); if (!blob) throw new Error(`Cannot export missing image ${id}; restore it before backing up.`);
    bytes += Math.ceil(blob.size / 3) * 4 + id.length + blob.type.length + 64;
    if (bytes > 50 * 1024 * 1024 - 1024) throw new Error('Portable backup exceeds 50 MB. Export fewer notes or individual sections instead.');
    media[id] = await blobDataUrl(blob);
  }
  return { format: 'uninote-vault', version: 2, exportedAt: Date.now(), notes: structuredClone(notes), folders: structuredClone(folders), media };
}
export async function blobDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return `data:${blob.type};base64,${btoa(binary)}`;
}
export function backupMarkdown(backup: VaultBackup): string {
  return backup.notes.map(note => `# ${note.title}\n\n` + note.sections.map(section => `## ${section.title}\n\n${section.content.replace(/(^|[\s(])(media_[a-zA-Z0-9._-]+)(?=[\s)"']|$)/gm, (_, prefix, id) => prefix + (backup.media[id] || id))}`).join('\n\n')).join('\n\n---\n\n');
}
export function downloadFile(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a');
  link.href = url; link.download = filename.replace(/[\\/:*?"<>|]/g, '_'); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
