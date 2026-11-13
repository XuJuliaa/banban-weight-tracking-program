import { zipSync, strToU8 } from 'fflate';

/** A zip of text files, e.g. { "weight-Juju-2026-10-14.csv": "timestamp,…" }. */
export function zipFiles(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));
}
