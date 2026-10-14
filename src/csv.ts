import type { ExerciseEntry, FoodEntry, UserData, WeightEntry, WeightUnit } from './types.ts';
import { exerciseCategoryFromText, exerciseCategoryLabel, validMinutes } from './exercise.ts';
import { categoryFromText, categoryLabel } from './food.ts';
import { convertWeight } from './units.ts';

export type CsvRow = Omit<WeightEntry, 'id'>;

export interface CsvParseResult {
  entries: CsvRow[];
  /** 1-based line numbers of rows that could not be read. */
  skipped: number[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local time as "YYYY-MM-DDTHH:MM:SS" with no offset, e.g. "2026-08-13T07:42:00". */
export function localIso(timestamp: number): string {
  const d = new Date(timestamp);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const WITH_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/** Reads a timestamp with no offset as device-local time; one with an offset as that exact instant. */
export function parseTimestamp(value: string): number | null {
  const local = LOCAL_TIME.exec(value);
  if (local) {
    const [, y, mo, d, h, mi, s] = local.map(Number);
    const date = new Date(y, mo - 1, d, h, mi, s || 0);
    // Reject impossible dates such as 2026-02-31, which Date would roll over.
    return date.getMonth() === mo - 1 && date.getDate() === d ? date.getTime() : null;
  }
  if (WITH_OFFSET.test(value)) {
    const t = Date.parse(value.replace(' ', 'T'));
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

const UNITS: WeightUnit[] = ['kg', 'lb'];
const asUnit = (v: string | undefined): WeightUnit | null => (v === 'kg' || v === 'lb' ? v : null);

/**
 * Parses weight CSV in either format:
 *   current: timestamp,weight_kg,weight_lb,entered_unit   (either weight column may be blank)
 *   older:   timestamp,weight[,unit]                       (unit defaults to `defaultUnit`)
 * Each row becomes an entry with both units. Throws if the header is missing; skips (and reports) bad rows.
 */
export function parseWeightCsv(text: string, defaultUnit: WeightUnit): CsvParseResult {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const header = lines[0]?.split(',').map((h) => h.trim().toLowerCase()) ?? [];
  const col = {
    timestamp: header.indexOf('timestamp'),
    kg: header.indexOf('weight_kg'),
    lb: header.indexOf('weight_lb'),
    entered: header.indexOf('entered_unit'),
    weight: header.indexOf('weight'),
    unit: header.indexOf('unit'),
  };
  if (col.timestamp < 0 || (col.weight < 0 && col.kg < 0 && col.lb < 0)) {
    throw new Error('The CSV needs a header row with "timestamp" and "weight" (or "weight_kg" / "weight_lb") columns.');
  }

  const entries: CsvRow[] = [];
  const skipped: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = lines[i].split(',').map((c) => c.trim());
    const cell = (index: number) => (index >= 0 ? cells[index] ?? '' : '');
    const timestamp = parseTimestamp(cell(col.timestamp));
    const value: Partial<Record<WeightUnit, number>> = {};
    let entered: WeightUnit | null;

    if (col.kg >= 0 || col.lb >= 0) {
      for (const u of UNITS) {
        const n = Number(cell(col[u]));
        if (cell(col[u]) !== '' && Number.isFinite(n) && n > 0) value[u] = n;
      }
      entered = asUnit(cell(col.entered).toLowerCase()) ?? (value.kg !== undefined ? 'kg' : value.lb !== undefined ? 'lb' : null);
    } else {
      const unitCell = cell(col.unit).toLowerCase();
      entered = unitCell === '' ? defaultUnit : asUnit(unitCell);
      const n = Number(cell(col.weight));
      if (entered && cell(col.weight) !== '' && Number.isFinite(n) && n > 0) value[entered] = n;
    }

    const base = entered !== null ? value[entered] : undefined;
    if (timestamp === null || entered === null || base === undefined) {
      skipped.push(i + 1);
      continue;
    }
    const other: WeightUnit = entered === 'kg' ? 'lb' : 'kg';
    const both = { [entered]: base, [other]: value[other] ?? convertWeight(base, entered, other) } as Record<WeightUnit, number>;
    entries.push({ timestamp, kg: both.kg, lb: both.lb, entered });
  }
  return { entries, skipped };
}

/** All of a user's weigh-ins as CSV with both units, oldest first, in the format `parseWeightCsv` reads. */
export function toWeightCsv(user: UserData): string {
  const rows = [...user.entries]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((e) => `${localIso(e.timestamp)},${e.kg},${e.lb},${e.entered}`);
  return ['timestamp,weight_kg,weight_lb,entered_unit', ...rows].join('\n') + '\n';
}

/** Quotes a CSV field when it contains a comma, quote, or line break. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** A user's food log as "timestamp,food,category" CSV, oldest first. Uncategorized entries leave the category blank. */
export function toFoodCsv(user: UserData): string {
  const rows = [...(user.foods ?? [])]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((f) => `${localIso(f.timestamp)},${csvField(f.text)},${f.category ? csvField(categoryLabel(f.category)) : ''}`);
  return ['timestamp,food,category', ...rows].join('\n') + '\n';
}

/** Splits CSV text into rows of fields, honouring quoted fields (with commas, "" escapes, and line breaks). */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export type FoodRow = Omit<FoodEntry, 'id'>;

/**
 * Reads food CSV as written by `toFoodCsv`. The category column is optional (older files have
 * just "timestamp,food"); unknown or blank categories become uncategorized. Unreadable rows are skipped.
 */
export function parseFoodCsv(text: string): FoodRow[] {
  const [header = [], ...rows] = parseCsvRows(text);
  const names = header.map((h) => h.trim().toLowerCase());
  const col = { timestamp: names.indexOf('timestamp'), food: names.indexOf('food'), category: names.indexOf('category') };
  if (col.timestamp < 0 || col.food < 0) throw new Error('The CSV needs a header row with "timestamp" and "food" columns.');
  const foods: FoodRow[] = [];
  for (const cells of rows) {
    const timestamp = parseTimestamp((cells[col.timestamp] ?? '').trim());
    const text = cells[col.food] ?? '';
    const category = col.category >= 0 ? categoryFromText(cells[col.category]) : null;
    if (timestamp !== null && text.trim()) foods.push({ timestamp, text, ...(category ? { category } : {}) });
  }
  return foods;
}

/** A user's exercise log as "timestamp,activity,category,minutes" CSV, oldest first. */
export function toExerciseCsv(user: UserData): string {
  const rows = [...(user.exercises ?? [])]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((e) => `${localIso(e.timestamp)},${csvField(e.name)},${exerciseCategoryLabel(e.category)},${e.minutes}`);
  return ['timestamp,activity,category,minutes', ...rows].join('\n') + '\n';
}

export type ExerciseRow = Omit<ExerciseEntry, 'id'>;

/** Reads exercise CSV as written by `toExerciseCsv`. Rows without a known category or a valid duration are skipped. */
export function parseExerciseCsv(text: string): ExerciseRow[] {
  const [header = [], ...rows] = parseCsvRows(text);
  const names = header.map((h) => h.trim().toLowerCase());
  const col = {
    timestamp: names.indexOf('timestamp'),
    activity: names.indexOf('activity'),
    category: names.indexOf('category'),
    minutes: names.indexOf('minutes'),
  };
  if (Object.values(col).some((i) => i < 0)) {
    throw new Error('The CSV needs a header row with "timestamp", "activity", "category" and "minutes" columns.');
  }
  const exercises: ExerciseRow[] = [];
  for (const cells of rows) {
    const timestamp = parseTimestamp((cells[col.timestamp] ?? '').trim());
    const name = (cells[col.activity] ?? '').trim();
    const category = exerciseCategoryFromText(cells[col.category]);
    const minutesCell = (cells[col.minutes] ?? '').trim();
    const minutes = minutesCell === '' ? NaN : Number(minutesCell);
    if (timestamp !== null && name && category && validMinutes(minutes)) exercises.push({ timestamp, name, category, minutes });
  }
  return exercises;
}
