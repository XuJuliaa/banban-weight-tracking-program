// Stores each profile as CSV files on this computer, keyed by the profile's name:
//   testdata/profiles.csv          name,unit and the profile's settings (see src/profile-files.ts)
//   testdata/<slug>-weight.csv     date,weight_kg  or  date,weight_lb
// These files are the source of truth while the app runs locally: any browser that opens
// a profile loads it from here (see userdata-plugin.ts for the HTTP routes).
// The file layout itself lives in src/profile-files.ts, shared with the browser's folder picker;
// this module is its Node adapter plus the one-time file migrations.

import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseWeightCsv } from '../src/csv.ts';
import * as files from '../src/profile-files.ts';
import { detectUnit, nameFromSlug, type TextStore, VALID_SLUG } from '../src/profile-files.ts';
import type { FileProfile, FileProfileData, WeightEntry } from '../src/types.ts';

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
export const writeProfile = (dir: string, user: Parameters<typeof files.writeProfile>[1]): Promise<string> =>
  files.writeProfile(nodeStore(dir), user);
export const removeProfile = (dir: string, slug: string): Promise<void> => files.removeProfile(nodeStore(dir), slug);

/**
 * One-time move from the old "<slug>-<id8>-weight.csv" naming to "<slug>-weight.csv".
 * Files with the same slug are merged (duplicate rows dropped); the originals go to testdata/.migrated/.
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
      for (const e of parseWeightCsv(text, unit).entries) entries.set(`${e.date}|${e.weight}`, e);
    }

    const existing = await readProfile(dir, slug);
    await writeProfile(dir, {
      name: existing?.name ?? nameFromSlug(slug),
      unit: existing?.unit ?? unit,
      entries: [...(existing?.entries ?? []), ...[...entries.values()].map((e, i) => ({ id: String(i), ...e }))],
    });
    for (const f of group) await rename(join(dir, f), join(dir, MIGRATED, f));
  }
  return [...groups.keys()];
}

/**
 * Cleans up every profile's weight file when the server starts (see cleanWeightFile in src/profile-files.ts):
 * older formats with times become one row per date in the profile's unit, duplicate dates are averaged, and
 * weights keep at most 2 decimals. Each original is copied to testdata/.migrated/<name>.<time>.csv as well as
 * <slug>-weight.backup.csv. Safe to run on every start: clean files are left alone. Returns the slugs changed.
 */
export async function upgradeWeightFiles(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const store = nodeStore(dir);
  const profiles = await listProfiles(dir);
  const upgraded: string[] = [];
  for (const f of names) {
    const slug = /^(.+)-weight\.csv$/.exec(f)?.[1];
    if (!slug || !VALID_SLUG.test(slug)) continue;
    const text = (await readText(join(dir, f))) ?? '';
    const unit = profiles.find((p) => p.slug === slug)?.unit ?? detectUnit(text);
    if (!(await files.cleanWeightFile(store, slug, unit, text))) continue;
    await mkdir(join(dir, MIGRATED), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await writeFile(join(dir, MIGRATED, f.replace(/\.csv$/, `.${stamp}.csv`)), text, 'utf8');
    upgraded.push(slug);
  }
  return upgraded;
}
