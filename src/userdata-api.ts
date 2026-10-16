// Where profile CSV files are read from and written to. In order of preference:
//   1. the local save service (server/userdata-plugin.ts), which keeps testdata/<slug>-*.csv;
//      it only exists under npm run dev / preview;
//   2. a folder the user picked in the browser (src/folder-store.ts), on a hosted site;
//   3. the user's Google Drive (src/drive-store.ts), on a hosted site, in any browser.
// Without any of them the app asks the user to choose (see renderGate in ui.ts).
// The folder belongs to the logged-in account (see openAccount): each login remembers its own.
// All three hold the same files (src/profile-files.ts).
// A "Continue with Google" login is different: it always uses that account's Drive, even when running locally.

import {
  currentToken,
  DRIVE_FOLDER_NAME,
  DriveAuthError,
  driveConfigured,
  driveUser,
  type DriveState,
  driveTextStore,
  ensureFolder,
  forgetDrive,
  rememberDrive,
  rememberedDrive,
  preloadGoogle,
  signIn,
  signOut,
} from './drive-store';
import {
  folderSupported,
  folderTextStore,
  forgetFolder,
  hasPermission,
  pickFolder,
  rememberedFolder,
  rememberFolder,
} from './folder-store';
import { profileSlug } from './names';
import * as files from './profile-files';
import type { FileProfile, FileProfileData, UserData } from './types';

/**
 * unknown: not asked yet; connected: the local save service answered; offline: it existed but can't be
 * reached now (dev server stopped). Without a service: folder: saving to a picked folder;
 * folder-permission: a folder is remembered but the browser needs a click to allow access again;
 * drive: saving to Google Drive; drive-signin: Google Drive is chosen but needs signing in (each visit,
 * and when the hour-long sign-in runs out); unavailable: nothing chosen yet; unsupported: nothing chosen
 * and nothing to offer (no folder support and Google Drive isn't set up).
 */
export type UserdataStatus =
  | 'unknown'
  | 'connected'
  | 'offline'
  | 'folder'
  | 'folder-permission'
  | 'drive'
  | 'drive-signin'
  | 'unavailable'
  | 'unsupported';

type Service = 'unknown' | 'connected' | 'offline' | 'absent';
let service: Service = 'unknown';
let account: string | null = null;
let servicePath: string | null = null;
let folder: FileSystemDirectoryHandle | null = null;
let folderAccess = false;
let drive: DriveState | null = null;
/** True while a "Continue with Google" profile is open: its Drive is the only data store. */
let google = false;
let driveStore: files.TextStore | null = null;
let storesLoaded: Promise<void> | null = null;
let status: UserdataStatus = 'unknown';
const listeners = new Set<() => void>();

function updateStatus(): void {
  const next: UserdataStatus =
    google ? (drive && driveStore && currentToken() ? 'drive' : 'drive-signin')
    : service !== 'absent' ? service
    : folder ? (folderAccess ? 'folder' : 'folder-permission')
    : drive ? (driveStore && currentToken() ? 'drive' : 'drive-signin')
    : folderSupported() || driveConfigured() ? 'unavailable'
    : 'unsupported';
  if (next === status) return;
  status = next;
  listeners.forEach((fn) => fn());
}

export const userdataStatus = () => status;
/** The data folder: the absolute testdata/ path for the local service, a picked folder's name, or the Drive folder. */
export const userdataPath = () =>
  google ? `Google Drive › ${DRIVE_FOLDER_NAME}`
  : service === 'connected' ? servicePath
  : folder ? folder.name
  : drive ? `Google Drive › ${DRIVE_FOLDER_NAME}`
  : null;
/** The Google account whose Drive is used, if any. */
export const driveAccount = () => drive?.email ?? null;
/** True while a "Continue with Google" profile is open. */
export const googleLogin = () => google;
export function onUserdataStatusChange(fn: () => void): void {
  listeners.add(fn);
}

const url = (slug?: string, suffix = '') =>
  `${import.meta.env.BASE_URL}api/userdata${slug ? `/${encodeURIComponent(slug)}${suffix}` : ''}`;

/** Returns the response, or null when the service isn't there (static host) or can't be reached right now. */
async function call(slug: string | undefined, init?: RequestInit, suffix = ''): Promise<Response | null> {
  if (google || service === 'absent') return null;
  let res: Response;
  try {
    res = await fetch(url(slug, suffix), { cache: 'no-store', ...init });
  } catch {
    // Never reached it (e.g. a hosted site opened offline): treat as no service. Reached before: try again next time.
    service = service === 'unknown' ? 'absent' : 'offline';
    updateStatus();
    return null;
  }
  // A static host answers 404/405, or serves index.html (not JSON) for unknown paths.
  const isHtml = res.headers.get('Content-Type')?.includes('text/html');
  if (res.status === 404 || res.status === 405 || res.status === 501 || isHtml) {
    service = 'absent';
    updateStatus();
    return null;
  }
  service = 'connected';
  updateStatus();
  if (!res.ok) throw new Error(`userdata ${res.status}: ${await res.text()}`);
  return res;
}

/** Restores the account's folder, or the Google Drive chosen on an earlier visit (once per login). */
function loadStores(): Promise<void> {
  return (storesLoaded ??= (async () => {
    if (google) {
      drive ??= await rememberedDrive();
      preloadGoogle();
      return;
    }
    if (folderSupported() && account) {
      folder = await rememberedFolder(account);
      folderAccess = folder ? await hasPermission(folder, false).catch(() => false) : false;
    }
    if (!folder && driveConfigured()) {
      drive = await rememberedDrive();
      // Load Google's sign-in script ahead of the click that needs it.
      if (drive || !folderSupported()) preloadGoogle();
    }
  })());
}

/** A token for Drive calls. Signing in again needs a click, so a missing token means "ask the user". */
async function driveToken(): Promise<string> {
  const value = currentToken();
  if (value) return value;
  throw new DriveAuthError();
}

/** The data store to use right now, if there's no service and the user's choice is ready (never prompts). */
async function activeStore(): Promise<files.TextStore | null> {
  if (google) {
    await loadStores();
    updateStatus();
    return drive && driveStore && currentToken() ? driveStore : null;
  }
  if (service !== 'absent') return null;
  await loadStores();
  updateStatus();
  if (folder) return folderAccess ? folderTextStore(folder) : null;
  if (drive && driveStore && currentToken()) return driveStore;
  return null;
}

/** Runs a Drive call; when Google no longer accepts the sign-in, switches to "drive-signin" so the app asks again. */
async function guarded<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (err) {
    if (err instanceof DriveAuthError) {
      driveStore = null;
      updateStatus();
    }
    throw err;
  }
}

/** Profiles in the data folder, or null when there's no data folder. */
export async function fetchProfileList(): Promise<FileProfile[] | null> {
  const res = await call(undefined);
  if (res) {
    const body = (await res.json()) as { dir: string; profiles: FileProfile[] };
    servicePath = body.dir;
    return body.profiles;
  }
  const store = await activeStore();
  return store ? guarded(() => files.listProfiles(store)) : null;
}

/** A profile's data from the data folder: null if it has no files, undefined if there's no data folder. */
export async function fetchProfile(name: string): Promise<FileProfileData | null | undefined> {
  const res = await call(profileSlug(name));
  if (res) return (await res.json()) as FileProfileData | null;
  const store = await activeStore();
  return store ? guarded(() => files.readProfile(store, profileSlug(name))) : undefined;
}

/** Rewrites the user's CSV files in the data folder. Does nothing when there's no data folder. */
export async function pushUserFiles(user: UserData): Promise<void> {
  const slug = profileSlug(user.name);
  const res = await call(slug, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user),
  });
  if (res) return;
  const store = await activeStore();
  if (store) await guarded(() => files.writeProfile(store, files.validateUser(user, slug)));
}

/** Lets the user pick a data folder (call from a click). Returns its name, or null if they cancelled. */
export async function chooseFolder(): Promise<string | null> {
  const picked = await pickFolder();
  if (!picked) return null;
  if (account) await rememberFolder(account, picked);
  folder = picked;
  folderAccess = await hasPermission(picked, true);
  // One data store at a time: a folder replaces Google Drive.
  if (drive) await stopDrive();
  storesLoaded = Promise.resolve();
  updateStatus();
  return picked.name;
}

async function stopDrive(): Promise<void> {
  drive = null;
  driveStore = null;
  await signOut();
}

/**
 * Signs in to Google (call from a click) and uses the "Banban's Weight Tracker Data" folder in that Drive.
 * Returns the account's email. Replaces a chosen folder.
 */
export async function useGoogleDrive(): Promise<string> {
  // Sign in first, straight from the click: browsers (Safari especially) block pop-ups opened later.
  await signIn(drive?.email);
  await loadStores();
  const folderId = drive?.folderId ?? (await ensureFolder(driveToken));
  const { email } = await driveUser(driveToken);
  drive = { folderId, email };
  driveStore = driveTextStore(driveToken, folderId);
  await rememberDrive(drive);
  if (folder) {
    if (account) await forgetFolder(account);
    folder = null;
    folderAccess = false;
  }
  storesLoaded = Promise.resolve();
  updateStatus();
  return email;
}

/**
 * "Continue with Google" (call from a click): signs in, finds or creates the "Banban's Weight Tracker Data" folder in that
 * Drive, and makes it the only data store until log out. Returns the account's email and name.
 */
export async function signInWithGoogle(): Promise<{ email: string; displayName: string }> {
  // Sign in first, straight from the click: browsers (Safari especially) block pop-ups opened later.
  await signIn(drive?.email);
  const user = await driveUser(driveToken);
  const remembered = await rememberedDrive();
  const folderId = remembered?.email === user.email ? remembered.folderId : await ensureFolder(driveToken);
  drive = { folderId, email: user.email };
  driveStore = driveTextStore(driveToken, folderId);
  await rememberDrive(drive);
  google = true;
  account = null;
  folder = null;
  folderAccess = false;
  storesLoaded = Promise.resolve();
  updateStatus();
  return user;
}

/** After a reload of a Google login's tab: back to its Drive, which needs signing in again (see reconnectGoogle). */
export async function resumeGoogle(): Promise<void> {
  google = true;
  account = null;
  folder = null;
  storesLoaded = null;
  await loadStores();
  updateStatus();
}

/**
 * Signs in again to the Google login's Drive (call from a click), after a reload or when the hour-long sign-in
 * runs out. Refuses a different Google account than the one the profile belongs to.
 */
export async function reconnectGoogle(): Promise<void> {
  await signIn(drive?.email);
  const { email } = await driveUser(driveToken);
  if (drive && email !== drive.email) {
    await signOut();
    throw new Error(`That's ${email}. This profile is saved in ${drive.email}'s Drive; sign in with that account.`);
  }
  drive = { folderId: drive?.folderId ?? (await ensureFolder(driveToken)), email };
  driveStore = driveTextStore(driveToken, drive.folderId);
  await rememberDrive(drive);
  updateStatus();
}

/** Signs out of Google Drive. The files stay in Drive; the app asks where to save next. */
export async function signOutDrive(): Promise<void> {
  await stopDrive();
  await forgetDrive();
  updateStatus();
}

/** Asks the browser to allow the remembered folder again (call from a click). */
export async function reconnectFolder(): Promise<boolean> {
  if (!folder) return false;
  folderAccess = await hasPermission(folder, true);
  updateStatus();
  return folderAccess;
}

/** True when the local save service (npm run dev / preview) is there; then the data folder is always testdata/. */
export async function localService(): Promise<boolean> {
  await call(undefined).catch(() => null);
  return service === 'connected';
}

/** Lets the user pick a folder for a login that isn't open yet (call from a click). Null if they cancel. */
export const pickAccountFolder = pickFolder;

/**
 * A profile's data from its files before logging in: from testdata/ when running locally, else from `handle`
 * (a folder picked at login). Null when it has no files or there's nowhere to look.
 */
export async function findProfileData(name: string, handle?: FileSystemDirectoryHandle | null): Promise<FileProfileData | null> {
  const res = await call(profileSlug(name));
  if (res) return (await res.json()) as FileProfileData | null;
  return handle ? files.readProfile(folderTextStore(handle), profileSlug(name)) : null;
}

/**
 * Opens a login's data folder: `handle` if one was just picked (it's remembered for next time), otherwise
 * the folder remembered for this account. With `ask`, the browser may ask to allow the folder again,
 * which needs a click (the Log in button); without it, a folder needing permission shows "Reconnect".
 */
export async function openAccount(slug: string, handle: FileSystemDirectoryHandle | null, ask: boolean): Promise<void> {
  account = slug;
  if (handle) await rememberFolder(slug, handle);
  storesLoaded = null;
  await loadStores();
  if (folder && !folderAccess && ask) folderAccess = await hasPermission(folder, true).catch(() => false);
  updateStatus();
}

/** Closes the login's folder (log out). Nothing is deleted; logging in again reopens it. */
export function closeAccount(): void {
  if (google) {
    // Log out of a Google login also signs out of Google; the files stay in Drive.
    google = false;
    drive = null;
    driveStore = null;
    void signOut();
  }
  account = null;
  folder = null;
  folderAccess = false;
  storesLoaded = null;
  updateStatus();
}
