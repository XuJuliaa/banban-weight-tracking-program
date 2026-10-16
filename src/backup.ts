import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { type CsvRow, type ExerciseRow, type FoodRow, parseCsvRows, parseExerciseCsv, parseFoodCsv, parseWeightCsv } from './csv';
import type { ExerciseEntry, FoodEntry, UserData, WeightEntry, WeightUnit } from './types';

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

// --- Merging an import into the profile: new entries are added, ones already logged are skipped, and entries at
// the same time with a different value are conflicts for the user to resolve (keep theirs or use the file's).

/** A logged entry and the file's row for the same time (and activity) with a different value. */
export type Conflict =
  | { id: string; kind: 'weight'; existing: WeightEntry; incoming: CsvRow }
  | { id: string; kind: 'exercise'; existing: ExerciseEntry; incoming: ExerciseRow };

export interface MergePart<R> {
  /** Rows not logged yet. */
  add: R[];
  /** Rows already logged with the same value, or repeated in the file. */
  duplicates: number;
}

export interface MergeResult {
  weight?: MergePart<CsvRow>;
  food?: MergePart<FoodRow>;
  exercise?: MergePart<ExerciseRow>;
  conflicts: Conflict[];
}

/** Times are compared to the minute, so a re-export that only differs in seconds still matches. */
const minute = (timestamp: number) => Math.floor(timestamp / 60_000);
const textKey = (text: string) => text.trim().toLowerCase();

/** Sorts each planned file's rows into new rows, duplicates and conflicts with what `user` has logged. */
export function mergeImport(user: UserData, plan: ImportPlan): MergeResult {
  const result: MergeResult = { conflicts: [] };

  if (plan.weight) {
    const logged = new Map<number, WeightEntry>();
    for (const e of user.entries) if (!logged.has(minute(e.timestamp))) logged.set(minute(e.timestamp), e);
    const taken = new Set<number>();
    const part: MergePart<CsvRow> = { add: [], duplicates: 0 };
    for (const row of plan.weight.rows) {
      const m = minute(row.timestamp);
      const existing = logged.get(m);
      if (taken.has(m)) part.duplicates++;
      else if (!existing) part.add.push(row);
      else if (Math.abs(existing.kg - row.kg) < 0.01) part.duplicates++;
      else result.conflicts.push({ id: `weight:${existing.id}`, kind: 'weight', existing, incoming: row });
      taken.add(m);
    }
    result.weight = part;
  }

  if (plan.food) {
    const seen = new Set((user.foods ?? []).map((f) => `${minute(f.timestamp)}|${textKey(f.text)}`));
    const part: MergePart<FoodRow> = { add: [], duplicates: 0 };
    for (const row of plan.food.rows) {
      const key = `${minute(row.timestamp)}|${textKey(row.text)}`;
      if (seen.has(key)) part.duplicates++;
      else part.add.push(row);
      seen.add(key);
    }
    result.food = part;
  }

  if (plan.exercise) {
    const logged = new Map<string, ExerciseEntry>();
    for (const x of user.exercises ?? []) logged.set(`${minute(x.timestamp)}|${textKey(x.name)}`, x);
    const taken = new Set<string>();
    const part: MergePart<ExerciseRow> = { add: [], duplicates: 0 };
    for (const row of plan.exercise.rows) {
      const key = `${minute(row.timestamp)}|${textKey(row.name)}`;
      const existing = logged.get(key);
      if (taken.has(key)) part.duplicates++;
      else if (!existing) part.add.push(row);
      else if (existing.minutes === row.minutes && existing.category === row.category) part.duplicates++;
      else result.conflicts.push({ id: `exercise:${existing.id}`, kind: 'exercise', existing, incoming: row });
      taken.add(key);
    }
    result.exercise = part;
  }
  return result;
}

/**
 * The profile's logs after a merge: new rows added (with fresh ids), and the conflicts in `useFile` overwritten
 * with the file's values (keeping the entry's id). Every other conflict keeps the logged entry.
 */
export function applyMerge(
  user: UserData,
  merge: MergeResult,
  useFile: ReadonlySet<string>,
  newId: () => string = () => crypto.randomUUID(),
): { entries: WeightEntry[]; foods: FoodEntry[]; exercises: ExerciseEntry[] } {
  const chosen = new Map(merge.conflicts.filter((c) => useFile.has(c.id)).map((c) => [c.id, c]));
  const entries = user.entries.map((e) => {
    const c = chosen.get(`weight:${e.id}`);
    return c?.kind === 'weight' ? { ...c.incoming, id: e.id } : e;
  });
  const exercises = (user.exercises ?? []).map((x) => {
    const c = chosen.get(`exercise:${x.id}`);
    return c?.kind === 'exercise' ? { ...c.incoming, id: x.id } : x;
  });
  return {
    entries: [...entries, ...(merge.weight?.add ?? []).map((r) => ({ id: newId(), ...r }))],
    foods: [...(user.foods ?? []), ...(merge.food?.add ?? []).map((r) => ({ id: newId(), ...r }))],
    exercises: [...exercises, ...(merge.exercise?.add ?? []).map((r) => ({ id: newId(), ...r }))],
  };
}
