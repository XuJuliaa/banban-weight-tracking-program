// Talks to the local save service (server/userdata-plugin.ts), which keeps each profile in
// userdata/<slug>-weight.csv and -food.csv. That service only exists under npm run dev / preview;
// on a static host the first call fails and the app stops trying for the rest of the session.

import { profileSlug } from './names';
import type { FileProfile, FileProfileData, UserData } from './types';

/**
 * connected: the save service answered; unavailable: no service here (static host, phone);
 * offline: it existed but can't be reached now (dev server stopped); unknown: not asked yet.
 */
export type UserdataStatus = 'unknown' | 'connected' | 'unavailable' | 'offline';

let status: UserdataStatus = 'unknown';
let folderPath: string | null = null;
const listeners = new Set<() => void>();

function setStatus(next: UserdataStatus): void {
  if (next === status) return;
  status = next;
  listeners.forEach((fn) => fn());
}

export const userdataStatus = () => status;
/** Absolute path of the userdata/ folder on this computer, once known. */
export const userdataPath = () => folderPath;
export function onUserdataStatusChange(fn: () => void): void {
  listeners.add(fn);
}

const url = (slug?: string) => `${import.meta.env.BASE_URL}api/userdata${slug ? `/${encodeURIComponent(slug)}` : ''}`;

/** Returns the response, or null when the service isn't there (static host) or can't be reached right now. */
async function call(slug: string | undefined, init?: RequestInit): Promise<Response | null> {
  if (status === 'unavailable') return null;
  let res: Response;
  try {
    res = await fetch(url(slug), { cache: 'no-store', ...init });
  } catch {
    // Server stopped, or offline. Try again next time.
    setStatus('offline');
    return null;
  }
  // A static host answers 404/405, or serves index.html (not JSON) for unknown paths.
  const isHtml = res.headers.get('Content-Type')?.includes('text/html');
  if (res.status === 404 || res.status === 405 || res.status === 501 || isHtml) {
    setStatus('unavailable');
    return null;
  }
  setStatus('connected');
  if (!res.ok) throw new Error(`userdata ${res.status}: ${await res.text()}`);
  return res;
}

/** Profiles in userdata/, or null when the save service isn't available. */
export async function fetchProfileList(): Promise<FileProfile[] | null> {
  const res = await call(undefined);
  if (!res) return null;
  const body = (await res.json()) as { dir: string; profiles: FileProfile[] };
  folderPath = body.dir;
  return body.profiles;
}

/** A profile's data from userdata/: null if it has no files, undefined if the service isn't available. */
export async function fetchProfile(name: string): Promise<FileProfileData | null | undefined> {
  const res = await call(profileSlug(name));
  return res ? ((await res.json()) as FileProfileData | null) : undefined;
}

export async function pushUserFiles(user: UserData): Promise<void> {
  await call(profileSlug(user.name), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user),
  });
}
