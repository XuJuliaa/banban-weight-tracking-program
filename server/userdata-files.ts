// Stores each profile as CSV files on this computer, keyed by the profile's name:
//   userdata/profiles.csv          name,unit
//   userdata/<slug>-weight.csv     timestamp,weight_kg,weight_lb,entered_unit
//   userdata/<slug>-food.csv       timestamp,food,category
//   userdata/<slug>-exercise.csv   timestamp,activity,category,minutes
// These files are the source of truth while the app runs locally: any browser that opens
// a profile loads it from here (see userdata-plugin.ts for the HTTP routes).
// The file layout itself lives in src/profile-files.ts, shared with the browser's folder picker;
// this module is its Node adapter plus the one-time file migrations.

import { copyFile, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseFoodCsv, parseWeightCsv, toWeightCsv } from '../src/csv.ts';
import * as files from '../src/profile-files.ts';
import { detectUnit, nameFromSlug, type TextStore, VALID_SLUG } from '../src/profile-files.ts';
import type { FileProfile, FileProfileData, FoodEntry, UserData, WeightEntry } from '../src/types.ts';

export { VALID_SLUG, validateUser } from '../src/profile-files.ts';

const MIGRATED = '.migrated';

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

/** The folder `dir` as a TextStore. Writes go through a temp file and a rename, so a crash can't leave half a file. */
export function nodeStore(dir: string): TextStore {
  return {
    read: (name) => readText(join(dir, name)),
    async write(name, text) {
      await mkdir(dir, { recursive: true });
      await writeAtomic(join(dir, name), text);
    },
    remove: (name) => unlink(join(dir, name)).catch(() => {}),
    list: () => readdir(dir).catch(() => []),
  };
}

export const listProfiles = (dir: string): Promise<FileProfile[]> => files.listProfiles(nodeStore(dir));
export const readProfile = (dir: string, slug: string): Promise<FileProfileData | null> => files.readProfile(nodeStore(dir), slug);
export const writeProfile = (dir: string, user: Pick<UserData, 'name' | 'unit' | 'entries' | 'foods' | 'exercises'>): Promise<string> =>
  files.writeProfile(nodeStore(dir), user);
export const removeProfile = (dir: string, slug: string): Promise<void> => files.removeProfile(nodeStore(dir), slug);

/** The text of userdata/<slug>-account.csv, or null if that account doesn't exist. */
export const readAccount = (dir: string, slug: string): Promise<string | null> => nodeStore(dir).read(files.accountFile(slug));

/** Writes userdata/<slug>-account.csv after checking it's a valid account file for that slug. */
export async function writeAccount(dir: string, slug: string, text: string): Promise<void> {
  if (!files.parseAccountCsv(text, slug)) throw new Error('Invalid account file');
  await nodeStore(dir).write(files.accountFile(slug), text);
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
