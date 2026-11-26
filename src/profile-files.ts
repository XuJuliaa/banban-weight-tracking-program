// A folder of profile CSV files, independent of where the folder lives:
//   profiles.csv          name,unit
//   <slug>-weight.csv     date,weight_kg  or  date,weight_lb   (one row per date, in the profile's unit)
// Used by the local save service (server/userdata-files.ts, Node fs) and by a folder the user picks
// in the browser (src/folder-store.ts, File System Access API).

import { csvField, parseCsvRows, parseWeightCsv, toWeightCsv } from './csv.ts';
import { profileSlug } from './names.ts';
import { isDateKey } from './units.ts';
import type { FileProfile, FileProfileData, UserData, WeightEntry, WeightUnit } from './types.ts';

/** Plain-text files in one folder, by file name. */
export interface TextStore {
  /** The file's text, or null if it doesn't exist. */
  read(name: string): Promise<string | null>;
  /** Replaces the whole file (creating it, and the folder, if needed). */
  write(name: string, text: string): Promise<void>;
  /** Deletes the file; does nothing if it isn't there. */
  remove(name: string): Promise<void>;
  /** Names of the files in the folder (empty if the folder doesn't exist). */
  list(): Promise<string[]>;
  /** A web link that opens the file for editing (Google Drive only), or null if it doesn't exist yet. */
  link?(name: string): Promise<string | null>;
}

export const INDEX = 'profiles.csv';

/** Slugs as made by profileSlug; anything else (e.g. "../x") is refused before touching the disk. */
export const VALID_SLUG = /^[a-z0-9-]{1,60}$/;

export const weightFile = (slug: string) => `${slug}-weight.csv`;
/** Where the weight file's previous text is kept when it's cleaned up (see cleanWeightFile). */
export const weightBackupFile = (slug: string) => `${slug}-weight.backup.csv`;
/** The files a profile's data lives in, as shown under "Edit data…". */
export const profileFiles = (slug: string) => [weightFile(slug)];
/**
 * Food and exercise logs written by older versions, which had food and exercise tracking. They're no longer
 * read or written, and are left in the folder untouched; they're only deleted along with their profile.
 */
const oldLogFiles = (slug: string) => [`${slug}-food.csv`, `${slug}-exercise.csv`];

/** The weight file's unit (from its header, or an older file's first row), or kg. Used when profiles.csv has no row. */
export function detectUnit(weightCsv: string | null): WeightUnit {
  if (!weightCsv) return 'kg';
  try {
    return parseWeightCsv(weightCsv, 'kg').fileUnit ?? 'kg';
  } catch {
    return 'kg';
  }
}

/** "juju" → "Juju", "ana-maria" → "Ana Maria": a display name for files with no profiles.csv row. */
export const nameFromSlug = (slug: string) => slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

async function readIndex(store: TextStore): Promise<FileProfile[]> {
  const text = await store.read(INDEX);
  if (!text) return [];
  const [, ...rows] = parseCsvRows(text);
  return rows
    .filter((r) => r[0]?.trim())
    .map(([name, unit]) => ({ slug: profileSlug(name), name: name.trim(), unit: unit?.trim() === 'lb' ? 'lb' : 'kg' }));
}

async function writeIndex(store: TextStore, profiles: FileProfile[]): Promise<void> {
  const rows = [...profiles].sort((a, b) => a.name.localeCompare(b.name)).map((p) => `${csvField(p.name)},${p.unit}`);
  await store.write(INDEX, ['name,unit', ...rows].join('\n') + '\n');
}

/** Every profile in the folder: those in profiles.csv, plus any *-weight.csv without a row there. */
export async function listProfiles(store: TextStore): Promise<FileProfile[]> {
  const index = await readIndex(store);
  const known = new Set(index.map((p) => p.slug));
  for (const f of await store.list()) {
    const slug = /^(.+)-weight\.csv$/.exec(f)?.[1];
    if (slug && VALID_SLUG.test(slug) && !known.has(slug)) {
      known.add(slug);
      index.push({ slug, name: nameFromSlug(slug), unit: detectUnit(await store.read(f)) });
    }
  }
  return index;
}

/**
 * One profile's data, or null if it has no weight file. Entry ids are made from row order, since CSV rows have none.
 * A weight file that needs cleaning up (older format, another unit, duplicate dates, unrounded weights) is
 * rewritten first; see cleanWeightFile.
 */
export async function readProfile(store: TextStore, slug: string): Promise<FileProfileData | null> {
  let weightCsv = await store.read(weightFile(slug));
  if (weightCsv === null) return null;
  const meta = (await readIndex(store)).find((p) => p.slug === slug) ?? {
    slug,
    name: nameFromSlug(slug),
    unit: detectUnit(weightCsv),
  };
  if (await cleanWeightFile(store, slug, meta.unit, weightCsv)) weightCsv = (await store.read(weightFile(slug))) ?? '';
  const entries: WeightEntry[] = weightCsv
    ? parseWeightCsv(weightCsv, meta.unit).entries.map((e, i) => ({ id: `w${i}-${e.date}`, ...e }))
    : [];
  return { ...meta, entries };
}

/**
 * Rewrites `<slug>-weight.csv` as one row per date in `unit`, up to 2 decimals, when it isn't already:
 * an older format with times, another unit, or several rows on one date (averaged into one). The previous
 * text is saved as `<slug>-weight.backup.csv` first. Returns true if the file was rewritten.
 */
export async function cleanWeightFile(store: TextStore, slug: string, unit: WeightUnit, text?: string): Promise<boolean> {
  const original = text ?? (await store.read(weightFile(slug)));
  if (original === null) return false;
  let parsed;
  try {
    parsed = parseWeightCsv(original, unit);
  } catch {
    return false; // No usable header: leave the file for the user to fix rather than overwrite it.
  }
  if (!parsed.needsCleanup) return false;
  await store.write(weightBackupFile(slug), original);
  await store.write(weightFile(slug), toWeightCsv({ unit, entries: parsed.entries.map((e, i) => ({ id: String(i), ...e })) }));
  return true;
}

/** Writes a profile's weight CSV and its profiles.csv row. Returns the slug. */
export async function writeProfile(store: TextStore, user: Pick<UserData, 'name' | 'unit' | 'entries'>): Promise<string> {
  const slug = profileSlug(user.name);
  await store.write(weightFile(slug), toWeightCsv(user));
  const index = (await readIndex(store)).filter((p) => p.slug !== slug);
  await writeIndex(store, [...index, { slug, name: user.name.trim(), unit: user.unit }]);
  return slug;
}

export async function removeProfile(store: TextStore, slug: string): Promise<void> {
  for (const f of [weightFile(slug), weightBackupFile(slug), ...oldLogFiles(slug)]) await store.remove(f);
  const index = await readIndex(store);
  if (index.some((p) => p.slug === slug)) await writeIndex(store, index.filter((p) => p.slug !== slug));
}

/** Checks the shape of a user record before it's written. Throws with a readable message. */
export function validateUser(raw: unknown, slug: string): UserData {
  const d = raw as Partial<UserData> | null;
  const ok =
    d &&
    typeof d.name === 'string' &&
    d.name.trim().length > 0 &&
    d.name.length <= 100 &&
    profileSlug(d.name) === slug &&
    (d.unit === 'kg' || d.unit === 'lb') &&
    Array.isArray(d.entries) &&
    d.entries.every((e) => typeof e?.id === 'string' && isDateKey(e.date) && Number.isFinite(e.weight) && e.weight > 0);
  if (!ok) throw new Error('Invalid user record');
  return d as UserData;
}
