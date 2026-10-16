import { get, set } from 'idb-keyval';
import { profileSlug } from './names';
import type { FileProfileData, ProfileSummary, UserData, WeightEntry, WeightUnit } from './types';
import { normalizeEntry } from './units';
import { fetchProfile, fetchProfileList, pushUserFiles } from './userdata-api';

const PROFILES_KEY = 'profiles';

let onSyncError: (err: unknown) => void = (err) => console.error(err);

/** Called when a save reached the browser database but the testdata/ CSV files could not be updated. */
export function setSyncErrorHandler(handler: (err: unknown) => void): void {
  onSyncError = handler;
}

/** Runs a testdata/ write; a failure is reported but never loses the browser save. */
async function mirror(task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (err) {
    onSyncError(err);
  }
}

const userKey = (userId: string) => `user:${userId}`;

export async function listProfiles(): Promise<ProfileSummary[]> {
  return (await get<ProfileSummary[]>(PROFILES_KEY)) ?? [];
}

async function upsertProfile(summary: ProfileSummary): Promise<void> {
  const profiles = (await listProfiles()).filter((p) => p.userId !== summary.userId);
  profiles.push(summary);
  await set(PROFILES_KEY, profiles);
}

/**
 * The browser's username profile with this name (same rule as file names: case and punctuation don't matter).
 * Google profiles are left out: they only open by signing in to their Google account.
 */
export async function findProfileByName(name: string): Promise<ProfileSummary | undefined> {
  const slug = profileSlug(name);
  return (await listProfiles()).find((p) => !p.googleEmail && profileSlug(p.name) === slug);
}

/** Stores a profile loaded from testdata/ in this browser, reusing the browser's id if it already has it. */
async function storeFromFiles(data: FileProfileData, userId: string, updatedAt?: number, googleEmail?: string): Promise<UserData> {
  const user: UserData = {
    version: 1,
    userId,
    name: data.name,
    unit: data.unit,
    entries: data.entries,
    foods: data.foods,
    exercises: data.exercises,
    updatedAt: updatedAt ?? Date.now(),
    ...(googleEmail ? { googleEmail } : {}),
  };
  await set(userKey(userId), user);
  await upsertProfile(summaryOf(user));
  return user;
}

const summaryOf = (user: UserData): ProfileSummary => ({
  userId: user.userId,
  name: user.name,
  ...(user.googleEmail ? { googleEmail: user.googleEmail } : {}),
});

/**
 * Opens the profile of a Google account, saved in its Drive: the Drive files win if there are any (as with a
 * folder); otherwise this browser's copy of the same account, or a new profile, is written to Drive.
 * A username profile with the same name is never used.
 */
export async function openGoogleProfile(name: string, email: string): Promise<{ user: UserData; existed: boolean }> {
  const local = (await listProfiles()).find((p) => p.googleEmail === email);
  const localUser = local && (await loadUser(local.userId));
  const fromFiles = await fetchProfile(localUser?.name ?? name);
  if (fromFiles) return { user: await storeFromFiles(fromFiles, localUser?.userId ?? crypto.randomUUID(), undefined, email), existed: true };
  if (localUser) {
    await saveUser(localUser);
    return { user: localUser, existed: true };
  }
  const data: UserData = { version: 1, userId: crypto.randomUUID(), name, unit: 'kg', entries: [], foods: [], exercises: [], googleEmail: email };
  await saveUser(data);
  return { user: data, existed: false };
}

/**
 * Creates a profile, unless one with the same name exists here or in testdata/:
 * then that one is returned with `existed: true` instead of making a duplicate.
 */
export async function createProfile(name: string, unit: WeightUnit): Promise<{ user: UserData; existed: boolean }> {
  const local = await findProfileByName(name);
  const localUser = local && (await loadUser(local.userId));
  if (localUser) return { user: localUser, existed: true };

  const fromFiles = await fetchProfile(name).catch(() => undefined);
  if (fromFiles) return { user: await storeFromFiles(fromFiles, crypto.randomUUID()), existed: true };

  const data: UserData = { version: 1, userId: crypto.randomUUID(), name, unit, entries: [], foods: [], exercises: [] };
  await saveUser(data);
  return { user: data, existed: false };
}

/**
 * Brings this browser's profile list in line with testdata/: profiles that exist only as files are added,
 * and profiles that exist only here are written out. Does nothing when the save service isn't available.
 */
export async function syncProfileListFromFiles(): Promise<void> {
  let files;
  try {
    files = await fetchProfileList();
  } catch (err) {
    onSyncError(err);
    return;
  }
  if (!files) return;
  const onDisk = new Set(files.map((f) => f.slug));
  for (const f of files) {
    if (await findProfileByName(f.name)) continue;
    const data = await fetchProfile(f.name).catch(() => undefined);
    if (data) await storeFromFiles(data, crypto.randomUUID());
  }
  for (const p of await listProfiles()) {
    const user = !onDisk.has(profileSlug(p.name)) && (await loadUser(p.userId));
    if (user) await mirror(() => pushUserFiles(user));
  }
}

/**
 * Loads a profile's latest data from testdata/ (the files win over this browser's copy).
 * If it has no files yet they are written from this copy. Without the save service, returns `user` unchanged.
 */
export async function loadUserFromFiles(user: UserData): Promise<UserData> {
  let data;
  try {
    data = await fetchProfile(user.name);
  } catch (err) {
    onSyncError(err);
    return user;
  }
  if (data === undefined) return user;
  if (data === null) {
    await mirror(() => pushUserFiles(user));
    return user;
  }
  return storeFromFiles(data, user.userId, user.updatedAt, user.googleEmail);
}

/** A profile from this browser. Entries saved before both units were stored are upgraded as they're read. */
export async function loadUser(userId: string): Promise<UserData | undefined> {
  const user = await get<UserData>(userKey(userId));
  if (!user) return undefined;
  const entries = user.entries.map((e) => normalizeEntry(e, user.unit)).filter((e): e is WeightEntry => e !== null);
  return { ...user, entries };
}

/** Writes the user's whole record, keeps the profile list in sync, and writes their testdata/ CSV files. */
export async function saveUser(data: UserData): Promise<void> {
  data.updatedAt = Date.now();
  await set(userKey(data.userId), data);
  await upsertProfile(summaryOf(data));
  await mirror(() => pushUserFiles(data));
}

/** Asks the browser not to evict this site's data under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
