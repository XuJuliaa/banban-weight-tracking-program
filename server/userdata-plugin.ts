// Adds a small local API to `npm run dev` and `npm run preview`, backed by ./testdata (see userdata-files.ts):
//   GET    <base>api/userdata          → { dir, profiles: [{ slug, name, unit }] }
//   GET    <base>api/userdata/<slug>   → { slug, name, unit, entries, foods, exercises } or null
//   PUT    <base>api/userdata/<slug>   body: the user's JSON record → rewrites their CSV files
//   DELETE <base>api/userdata/<slug>   removes their CSV files
// On a static host such as GitHub Pages this API doesn't exist; the app notices and stops calling it.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import {
  listProfiles,
  migrate,
  readProfile,
  removeProfile,
  upgradeWeightFiles,
  VALID_SLUG,
  validateUser,
  writeProfile,
} from './userdata-files.ts';

const ROUTE = /\/api\/userdata(?:\/([^/?#]+))?\/?$/;
const MAX_BODY = 5 * 1024 * 1024;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Request too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  res.statusCode = status;
  if (body === undefined) return void res.end();
  const json = typeof body !== 'string';
  res.setHeader('Content-Type', json ? 'application/json' : 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(json ? JSON.stringify(body) : body);
}

export function userdataPlugin(dir: string): Plugin {
  let ready: Promise<void> | null = null;
  const migrateOnce = () =>
    (ready ??= (async () => {
      try {
        const moved = await migrate(dir);
        if (moved.length) console.log(`[userdata] moved to name-based files: ${moved.join(', ')} (originals in testdata/.migrated/)`);
        const upgraded = await upgradeWeightFiles(dir);
        if (upgraded.length) console.log(`[userdata] weight files now store kg and lb: ${upgraded.join(', ')} (originals in testdata/.migrated/)`);
      } catch (err) {
        console.error('[userdata] migration failed:', err);
      }
    })());

  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const match = ROUTE.exec((req.url ?? '').split('?')[0]);
    if (!match) return next();
    await migrateOnce();
    const slug = match[1] ? decodeURIComponent(match[1]) : null;
    try {
      if (slug === null) {
        if (req.method === 'GET') return send(res, 200, { dir, profiles: await listProfiles(dir) });
        res.setHeader('Allow', 'GET');
        return send(res, 405, 'Method not allowed');
      }
      if (!VALID_SLUG.test(slug)) return send(res, 400, 'Invalid profile name');
      if (req.method === 'GET') return send(res, 200, await readProfile(dir, slug));
      if (req.method === 'PUT') {
        await writeProfile(dir, validateUser(JSON.parse(await readBody(req)), slug));
        return send(res, 204);
      }
      if (req.method === 'DELETE') {
        await removeProfile(dir, slug);
        return send(res, 204);
      }
      res.setHeader('Allow', 'GET, PUT, DELETE');
      return send(res, 405, 'Method not allowed');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[userdata] ${req.method} ${slug}: ${message}`);
      return send(res, err instanceof SyntaxError || message.startsWith('Invalid') ? 400 : 500, message);
    }
  };

  return {
    name: 'userdata-files',
    configureServer(server) {
      void migrateOnce();
      server.middlewares.use((req, res, next) => void handle(req, res, next));
    },
    configurePreviewServer(server) {
      void migrateOnce();
      server.middlewares.use((req, res, next) => void handle(req, res, next));
    },
  };
}
