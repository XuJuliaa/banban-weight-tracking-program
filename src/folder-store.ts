// A folder the user picks on their computer, used as the data folder when there's no local save
// service (e.g. on a hosted site). Uses the File System Access API: Chrome, Edge and other
// Chromium browsers on desktop only. The folder is remembered in IndexedDB between visits; the
// browser may ask for permission again, which needs a click.

import { del, get, set } from 'idb-keyval';
import type { TextStore } from './profile-files';

// The parts of the File System Access API used here, which TypeScript's DOM types don't include yet.
type Permission = 'granted' | 'denied' | 'prompt';
interface PermissionDescriptor {
  mode: 'read' | 'readwrite';
}
declare global {
  interface FileSystemHandle {
    queryPermission(desc: PermissionDescriptor): Promise<Permission>;
    requestPermission(desc: PermissionDescriptor): Promise<Permission>;
  }
  interface FileSystemDirectoryHandle {
    values(): AsyncIterableIterator<FileSystemHandle>;
  }
  interface Window {
    showDirectoryPicker(options?: { id?: string; mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>;
  }
}

const FOLDER_KEY = 'dataFolder';
const READ_WRITE: PermissionDescriptor = { mode: 'readwrite' };

export const folderSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/** Asks the user to pick a folder (must be called from a click) and remembers it. Null if they cancel. */
export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await window.showDirectoryPicker({ id: 'weight-tracker', mode: 'readwrite' });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
  await set(FOLDER_KEY, handle);
  return handle;
}

export async function rememberedFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return (await get<FileSystemDirectoryHandle>(FOLDER_KEY)) ?? null;
  } catch {
    return null;
  }
}

/** Forgets the folder (e.g. when switching to Google Drive). Its files are left untouched. */
export const forgetFolder = () => del(FOLDER_KEY);

/** Whether the page may read and write the folder. With `ask`, shows the browser's prompt (needs a click). */
export async function hasPermission(handle: FileSystemDirectoryHandle, ask: boolean): Promise<boolean> {
  if ((await handle.queryPermission(READ_WRITE)) === 'granted') return true;
  return ask && (await handle.requestPermission(READ_WRITE)) === 'granted';
}

/** The folder as a TextStore. createWritable() writes to a temporary copy that replaces the file on close(). */
export function folderTextStore(handle: FileSystemDirectoryHandle): TextStore {
  return {
    async read(name) {
      try {
        return await (await (await handle.getFileHandle(name)).getFile()).text();
      } catch (err) {
        if (err instanceof DOMException && err.name === 'NotFoundError') return null;
        throw err;
      }
    },
    async write(name, text) {
      const writable = await (await handle.getFileHandle(name, { create: true })).createWritable();
      await writable.write(text);
      await writable.close();
    },
    async remove(name) {
      await handle.removeEntry(name).catch(() => {});
    },
    async list() {
      const names: string[] = [];
      for await (const entry of handle.values()) if (entry.kind === 'file') names.push(entry.name);
      return names;
    },
  };
}
