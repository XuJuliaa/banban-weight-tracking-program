import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listProfiles, migrate, readProfile, removeProfile, upgradeWeightFiles, validateUser, writeProfile } from './userdata-files';

const juju = {
  name: 'Juju',
  unit: 'kg' as const,
  entries: [{ id: 'e1', date: '2026-10-11', weight: 70.2 }],
};

let dir: string;
beforeEach(async () => {
  dir = join(await mkdtemp(join(tmpdir(), 'testdata-')), 'testdata');
});
afterEach(async () => {
  await rm(join(dir, '..'), { recursive: true, force: true });
});

/** Profile list rows without their settings, which have their own tests. */
const withoutSettings = <T extends { settings?: unknown }>(rows: T[]) => rows.map(({ settings: _settings, ...rest }) => rest);

describe('userdata files', () => {
  it('deletes a profile along with food and exercise files left by older versions', async () => {
    await writeProfile(dir, juju);
    await writeFile(join(dir, 'juju-food.csv'), 'timestamp,food\n');
    await writeFile(join(dir, 'juju-exercise.csv'), 'timestamp,activity,category,minutes\n');
    await removeProfile(dir, 'juju');
    expect(await readdir(dir)).toEqual(['profiles.csv']);
  });

  it('writes <slug>-weight.csv and a profiles.csv row', async () => {
    expect(await writeProfile(dir, juju)).toBe('juju');
    expect((await readdir(dir)).sort()).toEqual(['juju-weight.csv', 'profiles.csv']);
    expect(await readFile(join(dir, 'juju-weight.csv'), 'utf8')).toBe('date,weight_kg\n2026-10-11,70.2\n');
    expect(await readFile(join(dir, 'profiles.csv'), 'utf8')).toBe('name,unit,palette,average_days,slope_days,slope_min_pct\nJuju,kg,coral,10,60,30\n');
  });

  it('reads a profile back by name, from any browser', async () => {
    await writeProfile(dir, juju);
    const data = await readProfile(dir, 'juju');
    expect(data).toMatchObject({ slug: 'juju', name: 'Juju', unit: 'kg' });
    expect(data?.entries.map(({ id: _id, ...rest }) => rest)).toEqual([{ date: '2026-10-11', weight: 70.2 }]);
    expect(await readProfile(dir, 'nobody')).toBeNull();
  });

  it('treats names that differ only in case or punctuation as the same profile', async () => {
    await writeProfile(dir, juju);
    await writeProfile(dir, { ...juju, name: 'JUJU', entries: [] });
    expect(withoutSettings(await listProfiles(dir))).toEqual([{ slug: 'juju', name: 'JUJU', unit: 'kg' }]);
  });

  it('reads weight files still in the older single-weight format, as dates in the file\'s unit', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'old-weight.csv'), 'timestamp,weight,unit\n2026-10-11T07:00:00,154,lb\n');
    const data = await readProfile(dir, 'old');
    expect(data?.unit).toBe('lb');
    expect(data?.entries.map(({ id: _id, ...rest }) => rest)).toEqual([{ date: '2026-10-11', weight: 154 }]);
  });

  it('cleans up older or duplicated weight files on start, once, keeping the originals', async () => {
    const old = 'timestamp,weight_kg,weight_lb,entered_unit\n2026-10-11T07:00:00,70,154.32,kg\n2026-10-11T20:00:00,70.5,155.43,kg\n';
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'profiles.csv'), 'name,unit\nJuju,lb\n');
    await writeFile(join(dir, 'juju-weight.csv'), old);
    await writeFile(join(dir, 'juju-food.csv'), 'timestamp,food\n');
    expect(await upgradeWeightFiles(dir)).toEqual(['juju']);
    // The profile is in lb, so the lb column is used; the two weigh-ins on Oct 11 are averaged.
    expect(await readFile(join(dir, 'juju-weight.csv'), 'utf8')).toBe('date,weight_lb\n2026-10-11,154.88\n');
    expect(await readFile(join(dir, 'juju-weight.backup.csv'), 'utf8')).toBe(old);
    const kept = await readdir(join(dir, '.migrated'));
    expect(kept).toHaveLength(1);
    expect(await readFile(join(dir, '.migrated', kept[0]), 'utf8')).toBe(old);
    expect(await upgradeWeightFiles(dir)).toEqual([]);
  });

  it('lists profiles from profiles.csv plus weight files without a row', async () => {
    await writeProfile(dir, juju);
    await writeFile(join(dir, 'ana-weight.csv'), 'timestamp,weight,unit\n2026-10-11T07:00:00,150,lb\n');
    expect(withoutSettings(await listProfiles(dir))).toEqual([
      { slug: 'juju', name: 'Juju', unit: 'kg' },
      { slug: 'ana', name: 'Ana', unit: 'lb' },
    ]);
  });

  it('removes a profile\'s files and its row', async () => {
    await writeProfile(dir, juju);
    await writeProfile(dir, { ...juju, name: 'Ana' });
    await removeProfile(dir, 'juju');
    expect((await readdir(dir)).sort()).toEqual(['ana-weight.csv', 'profiles.csv']);
    expect(withoutSettings(await listProfiles(dir))).toEqual([{ slug: 'ana', name: 'Ana', unit: 'kg' }]);
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
      '.migrated', 'banban-weight.csv', 'juju-weight.csv', 'profiles.csv',
    ]);
    expect((await readdir(join(dir, '.migrated'))).length).toBe(6);
    const merged = await readProfile(dir, 'juju');
    expect(merged?.entries).toHaveLength(2);
    expect(withoutSettings(await listProfiles(dir))).toEqual([
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
    expect(() => validateUser({ ...juju, entries: [{ id: 'e', date: 'x', weight: 70 }] }, 'juju')).toThrow(/Invalid/);
    expect(() => validateUser({ ...juju, entries: [{ id: 'e', timestamp: 1, weight: 70 }] }, 'juju')).toThrow(/Invalid/);
    expect(() => validateUser({ ...juju, entries: [{ id: 'e', date: '2026-10-11', weight: 0 }] }, 'juju')).toThrow(/Invalid/);
    expect(validateUser(juju, 'juju')).toBe(juju);
  });
});
