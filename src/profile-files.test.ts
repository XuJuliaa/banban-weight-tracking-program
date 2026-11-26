import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './settings';
import { listProfiles, readProfile, removeProfile, type TextStore, validateUser, writeProfile } from './profile-files';

/** A folder kept in memory, standing in for testdata/ or a folder picked in the browser. */
function memoryStore(initial: Record<string, string> = {}): TextStore & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    read: async (name) => files.get(name) ?? null,
    write: async (name, text) => void files.set(name, text),
    remove: async (name) => void files.delete(name),
    list: async () => [...files.keys()],
  };
}

const juju = {
  name: 'Juju',
  unit: 'lb' as const,
  entries: [{ id: 'e1', date: '2026-10-11', weight: 154.8 }],
};

/** Profile list rows without their settings, which have their own tests. */
const withoutSettings = <T extends { settings?: unknown }>(rows: T[]) => rows.map(({ settings: _settings, ...rest }) => rest);

describe('profile files over any TextStore', () => {
  it('writes the same layout as testdata/ and reads it back', async () => {
    const store = memoryStore();
    expect(await writeProfile(store, juju)).toBe('juju');
    expect([...store.files.keys()].sort()).toEqual(['juju-weight.csv', 'profiles.csv']);
    expect(store.files.get('profiles.csv')).toBe('name,unit,palette,average_days,slope_days,slope_min_pct\nJuju,lb,coral,10,60,30\n');

    const data = await readProfile(store, 'juju');
    expect(data?.unit).toBe('lb');
    expect(store.files.get('juju-weight.csv')).toBe('date,weight_lb\n2026-10-11,154.8\n');
    expect(data?.entries.map((e) => [e.date, e.weight])).toEqual([['2026-10-11', 154.8]]);
    expect(Object.keys(data ?? {}).sort()).toEqual(['entries', 'name', 'settings', 'slug', 'unit']);
    expect(data?.settings).toEqual(DEFAULT_SETTINGS);
    expect(await readProfile(store, 'nobody')).toBeNull();
  });

  it('leaves food and exercise files from older versions untouched, and ignores them', async () => {
    const food = 'timestamp,food,category\n2026-10-11T08:00:00,Toast,Grains & starches\n';
    const exercise = 'timestamp,activity,category,minutes\n2026-10-11T06:00:00,Run,Cardio,30\n';
    const store = memoryStore({ 'juju-food.csv': food, 'juju-exercise.csv': exercise });
    // Without a weight file there's no profile to open.
    expect(await readProfile(store, 'juju')).toBeNull();
    await writeProfile(store, juju);
    await readProfile(store, 'juju');
    expect(store.files.get('juju-food.csv')).toBe(food);
    expect(store.files.get('juju-exercise.csv')).toBe(exercise);
  });

  it('lists profiles from profiles.csv plus weight files without a row', async () => {
    const store = memoryStore({ 'ana-maria-weight.csv': 'timestamp,weight,unit\n2026-10-01T08:00,60,kg\n' });
    await writeProfile(store, juju);
    expect(withoutSettings(await listProfiles(store))).toEqual([
      { slug: 'juju', name: 'Juju', unit: 'lb' },
      { slug: 'ana-maria', name: 'Ana Maria', unit: 'kg' },
    ]);
  });

  it('removes a profile’s files and its row, leaving others alone', async () => {
    const store = memoryStore();
    await writeProfile(store, juju);
    await writeProfile(store, { ...juju, name: 'Ana' });
    await removeProfile(store, 'juju');
    expect([...store.files.keys()].sort()).toEqual(['ana-weight.csv', 'profiles.csv']);
    expect(store.files.get('profiles.csv')).toBe('name,unit,palette,average_days,slope_days,slope_min_pct\nAna,lb,coral,10,60,30\n');
  });

  it('cleans up a weight file with duplicate dates or an older format once, keeping a backup', async () => {
    const old = 'timestamp,weight_kg,weight_lb,entered_unit\n2026-10-11T07:00:00,70,154.32,kg\n2026-10-11T20:00:00,70.5,155.43,kg\n';
    const store = memoryStore({ 'profiles.csv': 'name,unit\nJuju,kg\n', 'juju-weight.csv': old });
    const data = await readProfile(store, 'juju');
    expect(data?.entries.map((e) => [e.date, e.weight])).toEqual([['2026-10-11', 70.25]]);
    expect(store.files.get('juju-weight.csv')).toBe('date,weight_kg\n2026-10-11,70.25\n');
    expect(store.files.get('juju-weight.backup.csv')).toBe(old);

    // A clean file is left alone.
    store.files.delete('juju-weight.backup.csv');
    await readProfile(store, 'juju');
    expect(store.files.has('juju-weight.backup.csv')).toBe(false);
  });

  it('leaves a weight file it cannot read untouched', async () => {
    const store = memoryStore({ 'juju-weight.csv': 'nonsense\n1,2\n' });
    await expect(readProfile(store, 'juju')).rejects.toThrow(/header/);
    expect(store.files.get('juju-weight.csv')).toBe('nonsense\n1,2\n');
    expect(store.files.has('juju-weight.backup.csv')).toBe(false);
  });

  it("saves each profile's settings in profiles.csv and reads them back", async () => {
    const store = memoryStore();
    const settings = { palette: 'mint' as const, averageDays: 7, slopeDays: 30, slopeMinPct: 50 };
    await writeProfile(store, { ...juju, settings });
    expect(store.files.get('profiles.csv')).toBe('name,unit,palette,average_days,slope_days,slope_min_pct\nJuju,lb,mint,7,30,50\n');
    expect((await readProfile(store, 'juju'))?.settings).toEqual(settings);
    // A record without settings (from an older version) keeps the ones already saved.
    await writeProfile(store, { name: 'Juju', unit: 'lb', entries: [] });
    expect((await readProfile(store, 'juju'))?.settings).toEqual(settings);
  });

  it('reads a profiles.csv from before settings existed with the defaults', async () => {
    const store = memoryStore({ 'profiles.csv': 'name,unit\nJuju,lb\n', 'juju-weight.csv': 'date,weight_lb\n2026-10-11,154.8\n' });
    const data = await readProfile(store, 'juju');
    expect(data).toMatchObject({ unit: 'lb', settings: DEFAULT_SETTINGS });
    // Unreadable values fall back to their defaults one by one.
    store.files.set('profiles.csv', 'name,unit,palette,average_days,slope_days,slope_min_pct\nJuju,lb,neon,abc,30,500\n');
    expect((await readProfile(store, 'juju'))?.settings).toEqual({ ...DEFAULT_SETTINGS, slopeDays: 30 });
  });

  it('validates records before they are written', () => {
    expect(validateUser({ version: 1, userId: 'u', ...juju }, 'juju').name).toBe('Juju');
    expect(() => validateUser({ ...juju, entries: [{ id: 'e', date: '2026-10-11T07:00', weight: 70 }] }, 'juju')).toThrow(/Invalid/);
    expect(() => validateUser({ ...juju, entries: [{ id: 'e', timestamp: 1, kg: 70, lb: 154.3, entered: 'kg' }] }, 'juju')).toThrow(/Invalid/);
    expect(validateUser({ ...juju, settings: DEFAULT_SETTINGS }, 'juju').settings).toEqual(DEFAULT_SETTINGS);
    expect(() => validateUser({ ...juju, settings: { ...DEFAULT_SETTINGS, averageDays: 0 } }, 'juju')).toThrow(/Invalid/);
    expect(() => validateUser({ ...juju, settings: { ...DEFAULT_SETTINGS, palette: 'neon' } }, 'juju')).toThrow(/Invalid/);
  });
});
