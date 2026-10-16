import { afterEach, describe, expect, it, vi } from 'vitest';
import { DriveAuthError, driveTextStore, driveUser, ensureFolder, nameFolder } from './drive-store';

/** A tiny fake of the Drive REST API: one folder of files, with every request recorded. */
function fakeDrive(initial: Record<string, string> = {}, folders: Record<string, string> = {}) {
  const folderNames = new Map(Object.entries(folders));
  const files = new Map(Object.entries(initial).map(([name, text], i) => [`id${i}`, { name, text }]));
  let next = files.size;
  const calls: { method: string; url: string; auth: string; body?: string; type?: string }[] = [];
  let unauthorized = 0;
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const method = init.method ?? 'GET';
    calls.push({ method, url, auth: headers.Authorization, body: init.body as string, type: headers['Content-Type'] });
    if (unauthorized > 0) {
      unauthorized--;
      return new Response('expired', { status: 401 });
    }
    const u = new URL(url);
    const id = /\/files\/([^/?]+)/.exec(u.pathname)?.[1];
    if (u.pathname.endsWith('/about')) return Response.json({ user: { emailAddress: 'juliet@example.com', displayName: 'Juliet ShoeMaker' } });
    if (method === 'GET' && !id) {
      const q = u.searchParams.get('q') ?? '';
      if (q.includes("mimeType='application/vnd.google-apps.folder'")) {
        const matches = [...folderNames].filter(([, name]) => q.includes(`name='${name.replace(/'/g, "\\'")}'`));
        return Response.json({ files: matches.map(([fid, name]) => ({ id: fid, name })) });
      }
      return Response.json({ files: [...files].map(([fid, f]) => ({ id: fid, name: f.name })) });
    }
    if (method === 'GET' && id) {
      const f = files.get(id);
      return f ? new Response(f.text) : new Response('', { status: 404 });
    }
    if (method === 'POST' && u.pathname.startsWith('/upload/')) {
      const body = init.body as string;
      const meta = JSON.parse(/\r\n\r\n(\{.*?\})\r\n--/s.exec(body)![1]);
      const text = /text\/csv; charset=UTF-8\r\n\r\n([\s\S]*)\r\n--[^\r\n]*--$/.exec(body)![1];
      const fid = `id${next++}`;
      files.set(fid, { name: meta.name, text });
      return Response.json({ id: fid });
    }
    if (method === 'POST') return Response.json({ id: 'folder1' });
    if (method === 'PATCH' && id && !u.pathname.startsWith('/upload/')) {
      if (!folderNames.has(id)) return new Response('not found', { status: 404 });
      folderNames.set(id, JSON.parse(init.body as string).name);
      return Response.json({ id });
    }
    if (method === 'PATCH' && id) {
      files.get(id)!.text = init.body as string;
      return Response.json({ id });
    }
    if (method === 'DELETE' && id) {
      files.delete(id);
      return new Response(null, { status: 204 });
    }
    return new Response('unexpected', { status: 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { files, folderNames, calls, expireNext: (n = 1) => (unauthorized = n) };
}

afterEach(() => vi.unstubAllGlobals());

const token = async () => 'tok';

describe('driveTextStore', () => {
  it('lists, reads, creates, updates and removes files in the folder', async () => {
    const drive = fakeDrive({ 'profiles.csv': 'name,unit\nJuju,kg\n' });
    const store = driveTextStore(token, 'folder1');

    expect(await store.list()).toEqual(['profiles.csv']);
    expect(await store.read('profiles.csv')).toBe('name,unit\nJuju,kg\n');
    expect(await store.read('missing.csv')).toBeNull();

    await store.write('juju-weight.csv', 'timestamp,weight_kg\n');
    const create = drive.calls.at(-1)!;
    expect(create.method).toBe('POST');
    expect(create.url).toContain('/upload/drive/v3/files?uploadType=multipart');
    expect(create.type).toMatch(/^multipart\/related; boundary=/);
    expect(create.body).toContain('"parents":["folder1"]');

    await store.write('juju-weight.csv', 'v2');
    expect(drive.calls.at(-1)!.method).toBe('PATCH');
    expect(await store.read('juju-weight.csv')).toBe('v2');

    await store.remove('juju-weight.csv');
    expect(await store.list()).toEqual(['profiles.csv']);
    expect(drive.calls.every((c) => c.auth === 'Bearer tok')).toBe(true);
  });

  it('retries once with a new token after a 401, and gives up with DriveAuthError on a second', async () => {
    const drive = fakeDrive({ 'a.csv': 'x' });
    const getToken = vi.fn(async () => 'tok');
    drive.expireNext(1);
    expect(await driveTextStore(getToken, 'folder1').list()).toEqual(['a.csv']);
    expect(getToken).toHaveBeenCalledTimes(2);

    drive.expireNext(2);
    await expect(driveTextStore(getToken, 'folder1').list()).rejects.toBeInstanceOf(DriveAuthError);
  });

  it('creates the BanBan Weight Tracker folder when it does not exist', async () => {
    const drive = fakeDrive();
    expect(await ensureFolder(token)).toBe('folder1');
    expect(decodeURIComponent(drive.calls[0].url)).toContain("name='BanBan Weight Tracker'");
    expect(JSON.parse(drive.calls[1].body!)).toEqual({ name: 'BanBan Weight Tracker', mimeType: 'application/vnd.google-apps.folder' });
  });

  it('reuses the folder, renaming one that still has an older name', async () => {
    const current = fakeDrive({}, { f2: 'BanBan Weight Tracker' });
    expect(await ensureFolder(token)).toBe('f2');
    expect(current.calls).toHaveLength(1);

    const old = fakeDrive({}, { f3: 'Weight Tracker' });
    expect(await ensureFolder(token)).toBe('f3');
    expect(old.folderNames.get('f3')).toBe('BanBan Weight Tracker');

    const previous = fakeDrive({}, { f4: "Banban's Weight Tracker Data" });
    expect(await ensureFolder(token)).toBe('f4');
    expect(previous.folderNames.get('f4')).toBe('BanBan Weight Tracker');
  });

  it('renames a remembered folder, and says when it is gone', async () => {
    const drive = fakeDrive({}, { f3: 'Weight Tracker' });
    expect(await nameFolder(token, 'f3')).toBe(true);
    expect(drive.folderNames.get('f3')).toBe('BanBan Weight Tracker');
    expect(await nameFolder(token, 'deleted')).toBe(false);
  });
});

describe('driveUser', () => {
  it("reads the account's email and name", async () => {
    const drive = fakeDrive();
    expect(await driveUser(token)).toEqual({ email: 'juliet@example.com', displayName: 'Juliet ShoeMaker' });
    expect(drive.calls[0].url).toContain('about?fields=user(emailAddress,displayName)');
  });
});
