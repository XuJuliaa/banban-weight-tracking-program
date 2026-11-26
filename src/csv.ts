import type { UserData, WeightEntry, WeightUnit } from './types.ts';
import { dayKey } from './stats.ts';
import { convertExact, mergeSameDay, round2 } from './units.ts';

export type CsvRow = Omit<WeightEntry, 'id'>;

export interface CsvParseResult {
  /** One entry per date, oldest first, in the unit asked for, rounded to 0.01. */
  entries: CsvRow[];
  /** 1-based line numbers of rows that could not be read. */
  skipped: number[];
  /** Dates that had more than one row; their weights were averaged into one entry. */
  merged: string[];
  /** The file's own unit: from a "weight_kg" / "weight_lb" header, else the first row's unit; null if unknown. */
  fileUnit: WeightUnit | null;
  /**
   * True when the text isn't already exactly what toWeightCsv would write for these entries in this unit:
   * an older format, another unit, duplicate dates, or more than 2 decimals. The file should be rewritten.
   */
  needsCleanup: boolean;
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

// Also what Google Sheets exports once it has read a cell as a date: "2026-08-13 7:42:00", "2026-08-13 7:42:00 AM",
// or just "2026-08-13" (read as midnight).
const LOCAL_TIME = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:\s*([AaPp])\.?[Mm]\.?)?)?$/;
const WITH_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/** Reads a timestamp with no offset as device-local time; one with an offset as that exact instant. */
export function parseTimestamp(value: string): number | null {
  const local = LOCAL_TIME.exec(value);
  if (local) {
    const [y, mo, d, h = 0, mi = 0, s = 0] = local.slice(1, 7).map((v) => (v === undefined ? undefined : Number(v))) as number[];
    const meridiem = local[7]?.toLowerCase();
    if (meridiem && (h < 1 || h > 12)) return null;
    const hour = meridiem ? (h % 12) + (meridiem === 'p' ? 12 : 0) : h;
    if (hour > 23 || mi > 59 || s > 59) return null;
    const date = new Date(y, mo - 1, d, hour, mi, s);
    // Reject impossible dates such as 2026-02-31, which Date would roll over.
    return date.getMonth() === mo - 1 && date.getDate() === d ? date.getTime() : null;
  }
  if (WITH_OFFSET.test(value)) {
    const t = Date.parse(value.replace(' ', 'T'));
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/** A number cell, also as Google Sheets exports it in locales with a decimal comma ("72,3"). NaN if it isn't one. */
export function parseNumber(value: string): number {
  const v = value.trim();
  return v === '' ? NaN : Number(/^\d+,\d+$/.test(v) ? v.replace(',', '.') : v);
}

const UNITS: WeightUnit[] = ['kg', 'lb'];
const asUnit = (v: string | undefined): WeightUnit | null => (v === 'kg' || v === 'lb' ? v : null);

/** The weight file's header for a profile in `unit`. */
export const weightHeader = (unit: WeightUnit) => `date,weight_${unit}`;

/**
 * Parses weight CSV into one entry per date with weights in `unit`, rounded to 0.01. Reads:
 *   current: date,weight_kg   or   date,weight_lb
 *   older:   timestamp,weight_kg,weight_lb,entered_unit   (either weight column may be blank)
 *   oldest:  timestamp,weight[,unit]                       (unit defaults to `unit`)
 * Times of day are dropped. Weights in the other unit are converted. Rows on the same date are averaged.
 * Throws if the header is missing; skips (and reports) bad rows.
 */
export function parseWeightCsv(text: string, unit: WeightUnit): CsvParseResult {
  const lines = parseCsvRows(text);
  const header = lines[0]?.map((h) => h.trim().toLowerCase()) ?? [];
  const col = {
    date: header.includes('date') ? header.indexOf('date') : header.indexOf('timestamp'),
    kg: header.indexOf('weight_kg'),
    lb: header.indexOf('weight_lb'),
    entered: header.indexOf('entered_unit'),
    weight: header.indexOf('weight'),
    unit: header.indexOf('unit'),
  };
  if (col.date < 0 || (col.weight < 0 && col.kg < 0 && col.lb < 0)) {
    throw new Error('The CSV needs a header row with "date" and "weight_kg" or "weight_lb" columns.');
  }
  const current = header.length === 2 && header[0] === 'date' && asUnit(header[1].replace(/^weight_/, '')) !== null;
  let fileUnit: WeightUnit | null = current ? (header[1] === 'weight_lb' ? 'lb' : 'kg') : null;
  let unrounded = false;

  const rows: CsvRow[] = [];
  const skipped: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].every((c) => !c.trim())) continue;
    const cells = lines[i].map((c) => c.trim());
    const cell = (index: number) => (index >= 0 ? cells[index] ?? '' : '');
    const timestamp = parseTimestamp(cell(col.date));
    const value: Partial<Record<WeightUnit, number>> = {};
    let rowUnit: WeightUnit | null;

    if (col.kg >= 0 || col.lb >= 0) {
      for (const u of UNITS) {
        const n = parseNumber(cell(col[u]));
        if (cell(col[u]) !== '' && Number.isFinite(n) && n > 0) value[u] = n;
      }
      rowUnit = asUnit(cell(col.entered).toLowerCase()) ?? (value.kg !== undefined ? 'kg' : value.lb !== undefined ? 'lb' : null);
    } else {
      const unitCell = cell(col.unit).toLowerCase();
      rowUnit = unitCell === '' ? unit : asUnit(unitCell);
      const n = parseNumber(cell(col.weight));
      if (rowUnit && cell(col.weight) !== '' && Number.isFinite(n) && n > 0) value[rowUnit] = n;
    }

    // The column in the wanted unit if the row has it, else the other one converted.
    const from: WeightUnit | null = value[unit] !== undefined ? unit : rowUnit !== null && value[rowUnit] !== undefined ? rowUnit : null;
    if (timestamp === null || from === null) {
      skipped.push(i + 1);
      continue;
    }
    fileUnit ??= rowUnit;
    const weight = from === unit ? value[unit]! : convertExact(value[from]!, from, unit);
    if (weight !== round2(weight)) unrounded = true;
    rows.push({ date: dayKey(timestamp), weight });
  }

  const { entries, merged } = mergeSameDay(rows.map((r, i) => ({ id: String(i), ...r })));
  const needsCleanup = !current || fileUnit !== unit || merged.length > 0 || unrounded;
  return { entries: entries.map(({ id: _id, ...e }) => e), skipped, merged, fileUnit, needsCleanup };
}

/** A user's weigh-ins as "date,weight_<unit>" CSV, one row per date, oldest first, up to 2 decimals. */
export function toWeightCsv(user: Pick<UserData, 'unit' | 'entries'>): string {
  const rows = mergeSameDay(user.entries).entries.map((e) => `${e.date},${e.weight}`);
  return [weightHeader(user.unit), ...rows].join('\n') + '\n';
}

/** Quotes a CSV field when it contains a comma, quote, or line break. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
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
