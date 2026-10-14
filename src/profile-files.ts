// A folder of profile CSV files, independent of where the folder lives:
//   profiles.csv          name,unit
//   <slug>-weight.csv     timestamp,weight_kg,weight_lb,entered_unit
//   <slug>-food.csv       timestamp,food,category
//   <slug>-exercise.csv   timestamp,activity,category,minutes
// Used by the local save service (server/userdata-files.ts, Node fs) and by a folder the user picks
// in the browser (src/folder-store.ts, File System Access API).

import {
  csvField,
  parseCsvRows,
  parseExerciseCsv,
  parseFoodCsv,
  parseWeightCsv,
  toExerciseCsv,
  toFoodCsv,
  toWeightCsv,
} from './csv.ts';
import { exerciseCategoryFromText, validMinutes } from './exercise.ts';
import { categoryFromText } from './food.ts';
import { profileSlug } from './names.ts';
import type { ExerciseEntry, FileProfile, FileProfileData, FoodEntry, UserData, WeightEntry, WeightUnit } from './types.ts';

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
}

export const INDEX = 'profiles.csv';

/** Slugs as made by profileSlug; anything else (e.g. "../x") is refused before touching the disk. */
export const VALID_SLUG = /^[a-z0-9-]{1,60}$/;

export const weightFile = (slug: string) => `${slug}-weight.csv`;
export const foodFile = (slug: string) => `${slug}-food.csv`;
export const exerciseFile = (slug: string) => `${slug}-exercise.csv`;
export const profileFiles = (slug: string) => [weightFile(slug), foodFile(slug), exerciseFile(slug)];

/** The unit the first weigh-in was entered in (either CSV format), or kg. Used as a default display unit. */
export function detectUnit(weightCsv: string | null): WeightUnit {
  if (!weightCsv) return 'kg';
  try {
    return parseWeightCsv(weightCsv, 'kg').entries[0]?.entered ?? 'kg';
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

/** One profile's data, or null if it has no files. Entry ids are made from row order, since CSV rows have none. */
export async function readProfile(store: TextStore, slug: string): Promise<FileProfileData | null> {
  const weightCsv = await store.read(weightFile(slug));
  const foodCsv = await store.read(foodFile(slug));
  const exerciseCsv = await store.read(exerciseFile(slug));
  if (weightCsv === null && foodCsv === null && exerciseCsv === null) return null;
  const meta = (await readIndex(store)).find((p) => p.slug === slug) ?? {
    slug,
    name: nameFromSlug(slug),
    unit: detectUnit(weightCsv),
  };
  const entries: WeightEntry[] = weightCsv
    ? parseWeightCsv(weightCsv, meta.unit).entries.map((e, i) => ({ id: `w${i}-${e.timestamp}`, ...e }))
    : [];
  const foods: FoodEntry[] = foodCsv ? parseFoodCsv(foodCsv).map((f, i) => ({ id: `f${i}-${f.timestamp}`, ...f })) : [];
  const exercises: ExerciseEntry[] = exerciseCsv
    ? parseExerciseCsv(exerciseCsv).map((x, i) => ({ id: `x${i}-${x.timestamp}`, ...x }))
    : [];
  return { ...meta, entries, foods, exercises };
}

/**
 * Writes a profile's CSVs and its profiles.csv row. Returns the slug. The exercise file is only written
 * when the record has an exercise list, so a record from before exercise logging can't empty it.
 */
export async function writeProfile(
  store: TextStore,
  user: Pick<UserData, 'name' | 'unit' | 'entries' | 'foods' | 'exercises'>,
): Promise<string> {
  const slug = profileSlug(user.name);
  const record: UserData = { version: 1, userId: slug, ...user };
  await store.write(weightFile(slug), toWeightCsv(record));
  await store.write(foodFile(slug), toFoodCsv(record));
  if (user.exercises) await store.write(exerciseFile(slug), toExerciseCsv(record));
  const index = (await readIndex(store)).filter((p) => p.slug !== slug);
  await writeIndex(store, [...index, { slug, name: user.name.trim(), unit: user.unit }]);
  return slug;
}

export async function removeProfile(store: TextStore, slug: string): Promise<void> {
  for (const f of profileFiles(slug)) await store.remove(f);
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
    d.entries.every(
      (e) => Number.isFinite(e?.timestamp) && Number.isFinite(e?.kg) && Number.isFinite(e?.lb) && (e?.entered === 'kg' || e?.entered === 'lb'),
    ) &&
    (d.foods === undefined ||
      (Array.isArray(d.foods) &&
        d.foods.every(
          (f) =>
            Number.isFinite(f?.timestamp) &&
            typeof f?.text === 'string' &&
            (f.category === undefined || categoryFromText(f.category) !== null),
        ))) &&
    (d.exercises === undefined ||
      (Array.isArray(d.exercises) &&
        d.exercises.every(
          (x) =>
            Number.isFinite(x?.timestamp) &&
            typeof x?.name === 'string' &&
            x.name.trim().length > 0 &&
            exerciseCategoryFromText(x.category) !== null &&
            validMinutes(x.minutes),
        )));
  if (!ok) throw new Error('Invalid user record');
  return d as UserData;
}
