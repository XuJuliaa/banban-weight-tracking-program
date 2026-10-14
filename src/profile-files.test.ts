import { describe, expect, it } from 'vitest';
import { listProfiles, readProfile, removeProfile, type TextStore, validateUser, writeProfile } from './profile-files';

/** A folder kept in memory, standing in for userdata/ or a folder picked in the browser. */
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

const at = (h: number, m = 0) => new Date(2026, 9, 11, h, m).getTime();
const juju = {
  name: 'Juju',
  unit: 'lb' as const,
  entries: [{ id: 'e1', timestamp: at(7, 30), kg: 70.2, lb: 154.76, entered: 'lb' as const }],
  foods: [{ id: 'f1', timestamp: at(8), text: 'Toast', category: 'grains' as const }],
  exercises: [{ id: 'x1', timestamp: at(6), name: 'Run', category: 'cardio' as const, minutes: 30 }],
};

describe('profile files over any TextStore', () => {
  it('writes the same layout as userdata/ and reads it back', async () => {
    const store = memoryStore();
    expect(await writeProfile(store, juju)).toBe('juju');
    expect([...store.files.keys()].sort()).toEqual(['juju-exercise.csv', 'juju-food.csv', 'juju-weight.csv', 'profiles.csv']);
    expect(store.files.get('profiles.csv')).toBe('name,unit\nJuju,lb\n');

    const data = await readProfile(store, 'juju');
    expect(data?.unit).toBe('lb');
    expect(data?.entries.map((e) => e.lb)).toEqual([154.76]);
    expect(data?.foods.map((f) => f.text)).toEqual(['Toast']);
    expect(data?.exercises.map((x) => [x.name, x.minutes])).toEqual([['Run', 30]]);
    expect(await readProfile(store, 'nobody')).toBeNull();
  });

  it('lists profiles from profiles.csv plus weight files without a row', async () => {
    const store = memoryStore({ 'ana-maria-weight.csv': 'timestamp,weight,unit\n2026-10-01T08:00,60,kg\n' });
    await writeProfile(store, juju);
    expect(await listProfiles(store)).toEqual([
      { slug: 'juju', name: 'Juju', unit: 'lb' },
      { slug: 'ana-maria', name: 'Ana Maria', unit: 'kg' },
    ]);
  });

  it('removes a profile’s files and its row, leaving others alone', async () => {
    const store = memoryStore();
    await writeProfile(store, juju);
    await writeProfile(store, { ...juju, name: 'Ana' });
    await removeProfile(store, 'juju');
    expect([...store.files.keys()].sort()).toEqual(['ana-exercise.csv', 'ana-food.csv', 'ana-weight.csv', 'profiles.csv']);
    expect(store.files.get('profiles.csv')).toBe('name,unit\nAna,lb\n');
  });

  it('validates records before they are written', () => {
    expect(validateUser({ version: 1, userId: 'u', ...juju }, 'juju').name).toBe('Juju');
    expect(() => validateUser({ ...juju, exercises: [{ ...juju.exercises[0], minutes: -5 }] }, 'juju')).toThrow(/Invalid/);
  });
});
