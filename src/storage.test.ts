import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileProfileData, UserData } from './types';

// The browser database, in memory.
const db = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  get: async (key: string) => db.get(key),
  set: async (key: string, value: unknown) => void db.set(key, structuredClone(value)),
}));

// The data store (here: the Google login's Drive): files by profile name, and what was written.
const driveFiles = new Map<string, FileProfileData>();
const pushed: UserData[] = [];
vi.mock('./userdata-api', () => ({
  fetchProfile: async (name: string) => driveFiles.get(name.toLowerCase()) ?? null,
  fetchProfileList: async () => null,
  pushUserFiles: async (user: UserData) => void pushed.push(structuredClone(user)),
}));

const { createProfile, findProfileByName, openGoogleProfile } = await import('./storage');

const entry = (id: string, kg: number) => ({ id, timestamp: new Date(2026, 9, 1).getTime(), kg, lb: kg * 2.20462, entered: 'kg' as const });

beforeEach(() => {
  db.clear();
  driveFiles.clear();
  pushed.length = 0;
});

describe('openGoogleProfile', () => {
  it('starts a new profile for a new account and writes it to Drive', async () => {
    const { user, existed } = await openGoogleProfile('Juliet', 'juliet@example.com');
    expect(existed).toBe(false);
    expect(user).toMatchObject({ name: 'Juliet', googleEmail: 'juliet@example.com', entries: [] });
    expect(pushed.map((u) => u.name)).toEqual(['Juliet']);
  });

  it("loads the account's Drive files, which win over this browser's copy", async () => {
    const first = (await openGoogleProfile('Juliet', 'juliet@example.com')).user;
    driveFiles.set('juliet', { slug: 'juliet', name: 'Juliet', unit: 'lb', entries: [entry('a', 60)], foods: [], exercises: [] });
    const { user, existed } = await openGoogleProfile('Juliet', 'juliet@example.com');
    expect(existed).toBe(true);
    expect(user).toMatchObject({ userId: first.userId, unit: 'lb', googleEmail: 'juliet@example.com' });
    expect(user.entries).toHaveLength(1);
  });

  it("reuses this browser's copy of the same account when Drive has no files", async () => {
    const first = (await openGoogleProfile('Juliet', 'juliet@example.com')).user;
    const { user, existed } = await openGoogleProfile('Juliet', 'juliet@example.com');
    expect(existed).toBe(true);
    expect(user.userId).toBe(first.userId);
  });

  it('never opens a username profile with the same name, and stays out of username logins', async () => {
    const username = (await createProfile('Juliet', 'kg')).user;
    const google = (await openGoogleProfile('Juliet', 'juliet@example.com')).user;
    expect(google.userId).not.toBe(username.userId);
    expect(google.entries).toEqual([]);
    expect((await findProfileByName('Juliet'))?.userId).toBe(username.userId);
  });
});
