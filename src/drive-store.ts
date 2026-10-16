// Google Drive as the data folder: the same CSV files, kept in a "Banban's Weight Tracker Data" folder in the user's
// own Drive. Works in any browser, phones included. Everything runs in the page: Google Identity
// Services signs the user in and hands out a short-lived access token (kept in memory only), and the
// Drive REST API is called with fetch. The drive.file permission only lets the app see files it created.

import { del, get, set } from 'idb-keyval';
import type { TextStore } from './profile-files';

// The parts of Google Identity Services used here.
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}
interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void;
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (response: TokenResponse) => void;
            error_callback?: (error: { type: string }) => void;
          }): TokenClient;
          revoke(token: string, done?: () => void): void;
        };
      };
    };
  }
}

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? '';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GIS_URL = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const DRIVE_FOLDER_NAME = "Banban's Weight Tracker Data";
const STATE_KEY = 'driveState';

/** True when this build has a Google client ID (VITE_GOOGLE_CLIENT_ID), so Drive can be offered. */
export const driveConfigured = () => CLIENT_ID !== '';

/** Thrown when Google no longer accepts the sign-in, so the user has to sign in again. */
export class DriveAuthError extends Error {
  constructor(message = 'Google Drive sign-in expired') {
    super(message);
    this.name = 'DriveAuthError';
  }
}

/** What's remembered between visits: which Drive folder holds the files, and whose Drive it is. */
export interface DriveState {
  folderId: string;
  email: string;
}

export async function rememberedDrive(): Promise<DriveState | null> {
  try {
    return (await get<DriveState>(STATE_KEY)) ?? null;
  } catch {
    return null;
  }
}
export const rememberDrive = (state: DriveState) => set(STATE_KEY, state);
export const forgetDrive = () => del(STATE_KEY);

// --- Sign-in (Google Identity Services)

let gis: Promise<void> | null = null;
function loadGis(): Promise<void> {
  return (gis ??= new Promise<void>((resolve, reject) => {
    if (window.google?.accounts) return resolve();
    const script = document.createElement('script');
    script.src = GIS_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gis = null;
      reject(new Error("Couldn't load Google sign-in. Are you online?"));
    };
    document.head.append(script);
  }));
}

/** Starts loading Google's sign-in script early, so the sign-in pop-up can open right on the click. */
export function preloadGoogle(): void {
  if (CLIENT_ID) loadGis().catch(() => {});
}

let token: { value: string; expires: number } | null = null;

/** The current access token, if it has more than a minute left. */
export const currentToken = () => (token && token.expires - Date.now() > 60_000 ? token.value : null);

/**
 * Signs in and returns an access token. Opens Google's pop-up, so call it from a click.
 * `hint` pre-selects the account used last time.
 */
export async function signIn(hint?: string): Promise<string> {
  if (!CLIENT_ID) throw new Error('Google Drive is not set up for this site');
  if (!window.google?.accounts) await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (response) => {
        if (!response.access_token) return reject(new DriveAuthError(response.error ?? 'Google sign-in failed'));
        token = { value: response.access_token, expires: Date.now() + (response.expires_in ?? 3600) * 1000 };
        resolve(response.access_token);
      },
      error_callback: (error) => reject(new DriveAuthError(error.type === 'popup_closed' ? 'Google sign-in was closed' : 'Google sign-in failed')),
    });
    client.requestAccessToken({ prompt: '', ...(hint ? { login_hint: hint } : {}) });
  });
}

/** Signs out: revokes the token and forgets the Drive folder. Files in Drive are left as they are. */
export async function signOut(): Promise<void> {
  const value = token?.value;
  token = null;
  await forgetDrive();
  if (value && window.google?.accounts) window.google.accounts.oauth2.revoke(value);
}

// --- Drive REST API

type GetToken = () => Promise<string>;

/** fetch with the access token. On 401 it gets a new token once and retries; a second 401 is a DriveAuthError. */
async function driveFetch(getToken: GetToken, url: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${await getToken()}` } });
  if (res.status === 401) {
    if (retried) throw new DriveAuthError();
    token = null;
    return driveFetch(getToken, url, init, true);
  }
  return res;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`Google Drive ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

const quote = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** The signed-in account's email address and name (Drive's "about" call, so no extra permission is needed). */
export async function driveUser(getToken: GetToken): Promise<{ email: string; displayName: string }> {
  const body = await json<{ user?: { emailAddress?: string; displayName?: string } }>(
    await driveFetch(getToken, `${API}/about?fields=user(emailAddress,displayName)`),
  );
  return { email: body.user?.emailAddress ?? '', displayName: body.user?.displayName ?? '' };
}

/** Names the app's Drive folder had before; such a folder is renamed and reused rather than starting a new one. */
const OLD_FOLDER_NAMES = ['Weight Tracker'];
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/**
 * The app's "Banban's Weight Tracker Data" folder in the user's Drive, created on first use. Returns its id.
 * A folder the app made under an older name is renamed and used instead.
 */
export async function ensureFolder(getToken: GetToken): Promise<string> {
  const names = [DRIVE_FOLDER_NAME, ...OLD_FOLDER_NAMES].map((n) => `name=${quote(n)}`).join(' or ');
  const q = `mimeType='${FOLDER_MIME}' and (${names}) and trashed=false`;
  const found = await json<{ files: { id: string; name: string }[] }>(
    await driveFetch(getToken, `${API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`),
  );
  const current = found.files.find((f) => f.name === DRIVE_FOLDER_NAME) ?? found.files[0];
  if (current) {
    if (current.name !== DRIVE_FOLDER_NAME) await nameFolder(getToken, current.id);
    return current.id;
  }
  const created = await json<{ id: string }>(
    await driveFetch(getToken, `${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: FOLDER_MIME }),
    }),
  );
  return created.id;
}

/**
 * Gives the app's folder `folderId` its current name (it may have an older one). False when the folder is
 * gone, so the caller can look for or create it again.
 */
export async function nameFolder(getToken: GetToken, folderId: string): Promise<boolean> {
  const res = await driveFetch(getToken, `${API}/files/${folderId}?fields=id`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME }),
  });
  if (res.status === 404) return false;
  await json(res);
  return true;
}

/** The Drive folder `folderId` as a TextStore. File ids are looked up by name and cached. */
export function driveTextStore(getToken: GetToken, folderId: string): TextStore {
  let ids: Map<string, string> | null = null;

  async function index(): Promise<Map<string, string>> {
    if (ids) return ids;
    const q = `${quote(folderId)} in parents and trashed=false`;
    const map = new Map<string, string>();
    let page = '';
    do {
      const body = await json<{ files: { id: string; name: string }[]; nextPageToken?: string }>(
        await driveFetch(getToken, `${API}/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name)&pageSize=1000${page ? `&pageToken=${page}` : ''}`),
      );
      for (const f of body.files) map.set(f.name, f.id);
      page = body.nextPageToken ?? '';
    } while (page);
    return (ids = map);
  }

  return {
    async list() {
      ids = null; // A fresh listing, so files written from another device show up.
      return [...(await index()).keys()];
    },
    async read(name) {
      const id = (await index()).get(name);
      if (!id) return null;
      const res = await driveFetch(getToken, `${API}/files/${id}?alt=media`);
      if (res.status === 404) {
        ids?.delete(name);
        return null;
      }
      if (!res.ok) throw new Error(`Google Drive ${res.status}: ${await res.text()}`);
      return res.text();
    },
    async write(name, text) {
      const map = await index();
      const id = map.get(name);
      if (id) {
        await json(
          await driveFetch(getToken, `${UPLOAD}/files/${id}?uploadType=media&fields=id`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'text/csv' },
            body: text,
          }),
        );
        return;
      }
      const boundary = `wt-${Math.random().toString(36).slice(2)}`;
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify({ name, parents: [folderId], mimeType: 'text/csv' }) +
        `\r\n--${boundary}\r\nContent-Type: text/csv; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
      const created = await json<{ id: string }>(
        await driveFetch(getToken, `${UPLOAD}/files?uploadType=multipart&fields=id`, {
          method: 'POST',
          headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
          body,
        }),
      );
      map.set(name, created.id);
    },
    async remove(name) {
      const map = await index();
      const id = map.get(name);
      if (!id) return;
      await driveFetch(getToken, `${API}/files/${id}`, { method: 'DELETE' });
      map.delete(name);
    },
  };
}
