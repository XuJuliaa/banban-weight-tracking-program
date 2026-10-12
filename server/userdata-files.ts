// Stores each profile as CSV files on this computer, keyed by the profile's name:
//   userdata/profiles.csv          name,unit
//   userdata/<slug>-weight.csv     timestamp,weight_kg,weight_lb,entered_unit
//   userdata/<slug>-food.csv       timestamp,food,category
//   userdata/<slug>-exercise.csv   timestamp,activity,category,minutes
// These files are the source of truth while the app runs locally: any browser that opens
// a profile loads it from here (see userdata-plugin.ts for the HTTP routes).

import { copyFile, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  csvField,
  parseCsvRows,
  parseExerciseCsv,
  parseFoodCsv,
  parseWeightCsv,
  toExerciseCsv,
  toFoodCsv,
  toWeightCsv,
} from '../src/csv.ts';
import { exerciseCategoryFromText, validMinutes } from '../src/exercise.ts';
import { categoryFromText } from '../src/food.ts';
import { profileSlug } from '../src/names.ts';
import type { ExerciseEntry, FileProfile, FileProfileData, FoodEntry, UserData, WeightEntry, WeightUnit } from '../src/types.ts';

const INDEX = 'profiles.csv';
const MIGRATED = '.migrated';

/** Slugs as made by profileSlug; anything else (e.g. "../x") is refused before touching the disk. */
export const VALID_SLUG = /^[a-z0-9-]{1,60}$/;

const weightFile = (slug: string) => `${slug}-weight.csv`;
const foodFile = (slug: string) => `${slug}-food.csv`;
const exerciseFile = (slug: string) => `${slug}-exercise.csv`;

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function writeAtomic(path: string, text: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, path);
}

/** The unit the first weigh-in was entered in (either CSV format), or kg. Used as a default display unit. */
function detectUnit(weightCsv: string | null): WeightUnit {
  if (!weightCsv) return 'kg';
  try {
    return parseWeightCsv(weightCsv, 'kg').entries[0]?.entered ?? 'kg';
  } catch {
    return 'kg';
  }
}

/** "juju" → "Juju", "ana-maria" → "Ana Maria": a display name for files with no profiles.csv row. */
const nameFromSlug = (slug: string) => slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

async function readIndex(dir: string): Promise<FileProfile[]> {
  const text = await readText(join(dir, INDEX));
  if (!text) return [];
  const [, ...rows] = parseCsvRows(text);
  return rows
    .filter((r) => r[0]?.trim())
    .map(([name, unit]) => ({ slug: profileSlug(name), name: name.trim(), unit: unit?.trim() === 'lb' ? 'lb' : 'kg' }));
}

async function writeIndex(dir: string, profiles: FileProfile[]): Promise<void> {
  const rows = [...profiles].sort((a, b) => a.name.localeCompare(b.name)).map((p) => `${csvField(p.name)},${p.unit}`);
  await writeAtomic(join(dir, INDEX), ['name,unit', ...rows].join('\n') + '\n');
}

/** Every profile in the folder: those in profiles.csv, plus any *-weight.csv without a row there. */
export async function listProfiles(dir: string): Promise<FileProfile[]> {
  const index = await readIndex(dir);
  const known = new Set(index.map((p) => p.slug));
  let files: string[] = [];
  try {
    files = await readdir(dir);
  } catch {
    return index;
  }
  for (const f of files) {
    const slug = /^(.+)-weight\.csv$/.exec(f)?.[1];
    if (slug && VALID_SLUG.test(slug) && !known.has(slug)) {
      known.add(slug);
      index.push({ slug, name: nameFromSlug(slug), unit: detectUnit(await readText(join(dir, f))) });
    }
  }
  return index;
}

/** One profile's data, or null if it has no files. Entry ids are made from row order, since CSV rows have none. */
export async function readProfile(dir: string, slug: string): Promise<FileProfileData | null> {
  const weightCsv = await readText(join(dir, weightFile(slug)));
  const foodCsv = await readText(join(dir, foodFile(slug)));
  const exerciseCsv = await readText(join(dir, exerciseFile(slug)));
  if (weightCsv === null && foodCsv === null && exerciseCsv === null) return null;
  const meta = (await readIndex(dir)).find((p) => p.slug === slug) ?? {
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
  dir: string,
  user: Pick<UserData, 'name' | 'unit' | 'entries' | 'foods' | 'exercises'>,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const slug = profileSlug(user.name);
  const record: UserData = { version: 1, userId: slug, ...user };
  await writeAtomic(join(dir, weightFile(slug)), toWeightCsv(record));
  await writeAtomic(join(dir, foodFile(slug)), toFoodCsv(record));
  if (user.exercises) await writeAtomic(join(dir, exerciseFile(slug)), toExerciseCsv(record));
  const index = (await readIndex(dir)).filter((p) => p.slug !== slug);
  await writeIndex(dir, [...index, { slug, name: user.name.trim(), unit: user.unit }]);
  return slug;
}

export async function removeProfile(dir: string, slug: string): Promise<void> {
  for (const f of [weightFile(slug), foodFile(slug), exerciseFile(slug)]) await unlink(join(dir, f)).catch(() => {});
  const index = await readIndex(dir);
  if (index.some((p) => p.slug === slug)) await writeIndex(dir, index.filter((p) => p.slug !== slug));
}

/**
 * One-time move from the old "<slug>-<id8>-weight.csv" naming to "<slug>-weight.csv".
 * Files with the same slug are merged (duplicate rows dropped); the originals go to userdata/.migrated/.
 * Runs once per folder: the .migrated/ directory marks it as done.
 */
export async function migrate(dir: string): Promise<string[]> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  if (files.includes(MIGRATED)) return [];
  const legacy = /^(.+)-[0-9a-f]{8}-(weight|food)\.csv$/;
  const groups = new Map<string, string[]>();
  for (const f of files) {
    const slug = legacy.exec(f)?.[1];
    if (slug) groups.set(slug, [...(groups.get(slug) ?? []), f]);
  }
  await mkdir(join(dir, MIGRATED), { recursive: true });

  for (const [slug, group] of groups) {
    const texts = await Promise.all(group.map(async (f) => ({ f, text: (await readText(join(dir, f))) ?? '' })));
    const weightTexts = texts.filter((t) => t.f.endsWith('-weight.csv')).map((t) => t.text);
    const unit = detectUnit(weightTexts.find((t) => t.split(/\r?\n/).length > 2) ?? null);

    const entries = new Map<string, Omit<WeightEntry, 'id'>>();
    for (const text of weightTexts) {
      for (const e of parseWeightCsv(text, unit).entries) entries.set(`${e.timestamp}|${e.kg}`, e);
    }
    const foods = new Map<string, Omit<FoodEntry, 'id'>>();
    for (const t of texts.filter((t) => t.f.endsWith('-food.csv'))) {
      for (const f of parseFoodCsv(t.text)) foods.set(`${f.timestamp}|${f.text}`, f);
    }

    const existing = await readProfile(dir, slug);
    await writeProfile(dir, {
      name: existing?.name ?? nameFromSlug(slug),
      unit: existing?.unit ?? unit,
      entries: [...(existing?.entries ?? []), ...[...entries.values()].map((e, i) => ({ id: String(i), ...e }))],
      foods: [...(existing?.foods ?? []), ...[...foods.values()].map((f, i) => ({ id: String(i), ...f }))],
    });
    for (const f of group) await rename(join(dir, f), join(dir, MIGRATED, f));
  }
  return [...groups.keys()];
}

/**
 * Rewrites weight files still in the older "timestamp,weight,unit" format into the current
 * "timestamp,weight_kg,weight_lb,entered_unit" format. Each original is copied to
 * userdata/.migrated/<name>.v1.csv first. Safe to run on every start: current files are left alone.
 */
export async function upgradeWeightFiles(dir: string): Promise<string[]> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const upgraded: string[] = [];
  for (const f of files) {
    const slug = /^(.+)-weight\.csv$/.exec(f)?.[1];
    if (!slug || !VALID_SLUG.test(slug)) continue;
    const text = (await readText(join(dir, f))) ?? '';
    const header = text.split(/\r?\n/, 1)[0].toLowerCase();
    if (header.includes('weight_kg') || header.includes('weight_lb')) continue;
    const profile = await readProfile(dir, slug);
    if (!profile) continue;
    await mkdir(join(dir, MIGRATED), { recursive: true });
    await copyFile(join(dir, f), join(dir, MIGRATED, f.replace(/\.csv$/, '.v1.csv')));
    await writeAtomic(join(dir, f), toWeightCsv({ version: 1, userId: slug, ...profile }));
    upgraded.push(slug);
  }
  return upgraded;
}

/** Checks the shape of a user record sent by the browser. Throws with a readable message. */
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
