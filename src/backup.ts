import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { type CsvRow, type ExerciseRow, type FoodRow, parseCsvRows, parseExerciseCsv, parseFoodCsv, parseWeightCsv } from './csv';
import type { WeightUnit } from './types';

export type DataKind = 'weight' | 'food' | 'exercise';

/**
 * Which of the three exported CSVs `text` is, from its header row (file names are ignored, so renamed
 * files still work). The columns are the ones parseWeightCsv, parseFoodCsv and parseExerciseCsv require.
 */
export function detectCsvKind(text: string): DataKind | null {
  const [header = []] = parseCsvRows(text.split(/\r?\n/, 1)[0] ?? '');
  const names = new Set(header.map((h) => h.trim().toLowerCase()));
  if (!names.has('timestamp')) return null;
  if (names.has('weight_kg') || names.has('weight_lb') || names.has('weight')) return 'weight';
  if (names.has('food')) return 'food';
  if (names.has('activity') && names.has('minutes')) return 'exercise';
  return null;
}

/** A zip of text files, e.g. { "weight-Juju-2026-10-14.csv": "timestamp,…" }. */
export function zipFiles(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));
}

/** The CSV files in a zip, skipping folders, macOS "__MACOSX/" copies and hidden files. */
export function unzipCsvs(bytes: Uint8Array): { name: string; text: string }[] {
  const entries = unzipSync(bytes, {
    filter: (file) => {
      const base = file.name.split('/').pop() ?? '';
      return /\.csv$/i.test(base) && !base.startsWith('.') && !file.name.startsWith('__MACOSX/');
    },
  });
  return Object.entries(entries).map(([path, data]) => ({ name: path.split('/').pop() ?? path, text: strFromU8(data) }));
}

export interface ImportPart<R> {
  fileName: string;
  rows: R[];
  /** Line numbers that couldn't be read (weight files only). */
  unreadable: number[];
}

export interface ImportPlan {
  weight?: ImportPart<CsvRow>;
  food?: ImportPart<FoodRow>;
  exercise?: ImportPart<ExerciseRow>;
  /** Files that won't be imported, each with the reason. */
  ignored: { fileName: string; reason: string }[];
}

/**
 * What importing `files` would replace: at most one file per kind, each parsed in full. Throws when two
 * files are the same kind, so it's never unclear which one wins.
 */
export function planImport(files: { name: string; text: string }[], defaultUnit: WeightUnit): ImportPlan {
  const plan: ImportPlan = { ignored: [] };
  for (const { name, text } of files) {
    const kind = detectCsvKind(text);
    if (!kind) {
      plan.ignored.push({ fileName: name, reason: 'not a weight, food or exercise CSV' });
      continue;
    }
    if (plan[kind]) throw new Error(`Pick only one ${kind} file (got ${plan[kind].fileName} and ${name}).`);
    try {
      if (kind === 'weight') {
        const parsed = parseWeightCsv(text, defaultUnit);
        plan.weight = { fileName: name, rows: parsed.entries, unreadable: parsed.skipped };
      } else if (kind === 'food') {
        plan.food = { fileName: name, rows: parseFoodCsv(text), unreadable: [] };
      } else {
        plan.exercise = { fileName: name, rows: parseExerciseCsv(text), unreadable: [] };
      }
    } catch (err) {
      plan.ignored.push({ fileName: name, reason: err instanceof Error ? err.message : 'unreadable' });
    }
  }
  return plan;
}
