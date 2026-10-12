import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listProfiles, migrate, readProfile, removeProfile, upgradeWeightFiles, validateUser, writeProfile } from './userdata-files';

const at = (h: number, m = 0) => new Date(2026, 9, 11, h, m).getTime();
const juju = {
  name: 'Juju',
  unit: 'kg' as const,
  entries: [{ id: 'e1', timestamp: at(7, 30), kg: 70.2, lb: 154.76, entered: 'kg' as const }],
  foods: [{ id: 'f1', timestamp: at(8), text: 'Oatmeal, berries', category: 'grains' as const }],
};

let dir: string;
beforeEach(async () => {
  dir = join(await mkdtemp(join(tmpdir(), 'userdata-')), 'userdata');
});
afterEach(async () => {
  await rm(join(dir, '..'), { recursive: true, force: true });
});

describe('userdata files', () => {
  it('writes <slug>-exercise.csv when the record has exercises, and reads it back', async () => {
    const exercises = [{ id: 'x1', timestamp: at(6, 45), name: 'Morning run', category: 'cardio' as const, minutes: 30 }];
    await writeProfile(dir, { ...juju, exercises });
    expect(await readFile(join(dir, 'juju-exercise.csv'), 'utf8')).toBe('timestamp,activity,category,minutes\n2026-10-11T06:45:00,Morning run,Cardio,30\n');
    const data = await readProfile(dir, 'juju');
    expect(data?.exercises.map((x) => [x.name, x.category, x.minutes])).toEqual([['Morning run', 'cardio', 30]]);

    // A record without an exercise list (from before exercise logging) leaves the file alone.
    await writeProfile(dir, juju);
    expect((await readProfile(dir, 'juju'))?.exercises).toHaveLength(1);
    await removeProfile(dir, 'juju');
    expect(await readdir(dir)).toEqual(['profiles.csv']);
  });

  it('validates exercise entries', () => {
    const ok = { id: 'x', timestamp: 1, name: 'Run', category: 'cardio', minutes: 30 };
    expect(validateUser({ ...juju, exercises: [ok] }, 'juju')).toBeTruthy();
    expect(() => validateUser({ ...juju, exercises: [{ ...ok, category: 'dance' }] }, 'juju')).toThrow(/Invalid/);
    expect(() => validateUser({ ...juju, exercises: [{ ...ok, minutes: 0 }] }, 'juju')).toThrow(/Invalid/);
    expect(() => validateUser({ ...juju, exercises: [{ ...ok, name: ' ' }] }, 'juju')).toThrow(/Invalid/);
  });

  it('writes <slug>-weight.csv, <slug>-food.csv, and a profiles.csv row', async () => {
    expect(await writeProfile(dir, juju)).toBe('juju');
    expect((await readdir(dir)).sort()).toEqual(['juju-food.csv', 'juju-weight.csv', 'profiles.csv']);
    expect(await readFile(join(dir, 'juju-weight.csv'), 'utf8')).toBe('timestamp,weight_kg,weight_lb,entered_unit\n2026-10-11T07:30:00,70.2,154.76,kg\n');
    expect(await readFile(join(dir, 'juju-food.csv'), 'utf8')).toBe('timestamp,food,category\n2026-10-11T08:00:00,"Oatmeal, berries",Grains & starches\n');
    expect(await readFile(join(dir, 'profiles.csv'), 'utf8')).toBe('name,unit\nJuju,kg\n');
  });

  it('reads a profile back by name, from any browser', async () => {
    await writeProfile(dir, juju);
    const data = await readProfile(dir, 'juju');
    expect(data).toMatchObject({ slug: 'juju', name: 'Juju', unit: 'kg' });
    expect(data?.entries.map(({ id: _id, ...rest }) => rest)).toEqual([{ timestamp: at(7, 30), kg: 70.2, lb: 154.76, entered: 'kg' }]);
    expect(data?.foods.map((f) => [f.text, f.category])).toEqual([['Oatmeal, berries', 'grains']]);
    expect(await readProfile(dir, 'nobody')).toBeNull();
  });

  it('treats names that differ only in case or punctuation as the same profile', async () => {
    await writeProfile(dir, juju);
    await writeProfile(dir, { ...juju, name: 'JUJU', entries: [] });
    expect(await listProfiles(dir)).toEqual([{ slug: 'juju', name: 'JUJU', unit: 'kg' }]);
  });

  it('reads weight files still in the older single-weight format', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'old-weight.csv'), 'timestamp,weight,unit\n2026-10-11T07:00:00,154,lb\n');
    const data = await readProfile(dir, 'old');
    expect(data?.unit).toBe('lb');
    expect(data?.entries.map(({ id: _id, ...rest }) => rest)).toEqual([{ timestamp: at(7), kg: 69.85, lb: 154, entered: 'lb' }]);
  });

  it('upgrades older weight files to kg + lb columns once, keeping the original', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'profiles.csv'), 'name,unit\nJuju,kg\n');
    await writeFile(join(dir, 'juju-weight.csv'), 'timestamp,weight,unit\n2026-10-11T07:00:00,70,kg\n');
    await writeFile(join(dir, 'juju-food.csv'), 'timestamp,food\n');
    expect(await upgradeWeightFiles(dir)).toEqual(['juju']);
    expect(await readFile(join(dir, 'juju-weight.csv'), 'utf8')).toBe('timestamp,weight_kg,weight_lb,entered_unit\n2026-10-11T07:00:00,70,154.32,kg\n');
    expect(await readFile(join(dir, '.migrated', 'juju-weight.v1.csv'), 'utf8')).toBe('timestamp,weight,unit\n2026-10-11T07:00:00,70,kg\n');
    expect(await upgradeWeightFiles(dir)).toEqual([]);
  });

  it('lists profiles from profiles.csv plus weight files without a row', async () => {
    await writeProfile(dir, juju);
    await writeFile(join(dir, 'ana-weight.csv'), 'timestamp,weight,unit\n2026-10-11T07:00:00,150,lb\n');
    expect(await listProfiles(dir)).toEqual([
      { slug: 'juju', name: 'Juju', unit: 'kg' },
      { slug: 'ana', name: 'Ana', unit: 'lb' },
    ]);
  });

  it('removes a profile\'s files and its row', async () => {
    await writeProfile(dir, juju);
    await writeProfile(dir, { ...juju, name: 'Ana' });
    await removeProfile(dir, 'juju');
    expect((await readdir(dir)).sort()).toEqual(['ana-food.csv', 'ana-weight.csv', 'profiles.csv']);
    expect(await listProfiles(dir)).toEqual([{ slug: 'ana', name: 'Ana', unit: 'kg' }]);
  });

  it('migrates id-named files once, merging duplicates per name and keeping the originals', async () => {
    await mkdir(dir, { recursive: true });
    const w = 'timestamp,weight,unit\n';
    await writeFile(join(dir, 'juju-2dddfbfd-weight.csv'), `${w}2026-10-10T07:00:00,70.5,kg\n2026-10-11T07:00:00,70.1,kg\n`);
    await writeFile(join(dir, 'juju-2dddfbfd-food.csv'), 'timestamp,food\n2026-10-11T08:00:00,"toast, jam"\n');
    await writeFile(join(dir, 'juju-4ecffc4a-weight.csv'), `${w}2026-10-11T07:00:00,70.1,kg\n`);
    await writeFile(join(dir, 'juju-4ecffc4a-food.csv'), 'timestamp,food\n');
    await writeFile(join(dir, 'banban-f485d5cd-weight.csv'), w);
    await writeFile(join(dir, 'banban-f485d5cd-food.csv'), 'timestamp,food\n');

    expect((await migrate(dir)).sort()).toEqual(['banban', 'juju']);
    expect((await readdir(dir)).sort()).toEqual([
      '.migrated', 'banban-food.csv', 'banban-weight.csv', 'juju-food.csv', 'juju-weight.csv', 'profiles.csv',
    ]);
    expect((await readdir(join(dir, '.migrated'))).length).toBe(6);
    const merged = await readProfile(dir, 'juju');
    expect(merged?.entries).toHaveLength(2);
    expect(merged?.foods.map((f) => f.text)).toEqual(['toast, jam']);
    expect(await listProfiles(dir)).toEqual([
      { slug: 'banban', name: 'Banban', unit: 'kg' },
      { slug: 'juju', name: 'Juju', unit: 'kg' },
    ]);

    // Second run does nothing, even if a new-style name happens to look like an old one.
    await writeProfile(dir, { ...juju, name: 'Juju deadbeef' });
    expect(await migrate(dir)).toEqual([]);
    expect(await readProfile(dir, 'juju-deadbeef')).not.toBeNull();
  });

  it('rejects records whose name doesn\'t match the URL, or with bad entries', () => {
    expect(() => validateUser(juju, 'someone-else')).toThrow(/Invalid/);
    expect(() => validateUser({ ...juju, entries: [{ timestamp: 'x', kg: 1, lb: 2.2, entered: 'kg' }] }, 'juju')).toThrow(/Invalid/);
    expect(() => validateUser({ ...juju, entries: [{ timestamp: 1, weight: 70 }] }, 'juju')).toThrow(/Invalid/);
    expect(() => validateUser({ ...juju, foods: [{ id: 'f', timestamp: 1, text: 'x', category: 'pizza' }] }, 'juju')).toThrow(/Invalid/);
    expect(validateUser(juju, 'juju')).toBe(juju);
  });
});
