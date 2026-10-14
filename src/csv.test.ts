import { describe, expect, it } from 'vitest';
import { mergeNew, parseCsvRows, parseExerciseCsv, parseFoodCsv, parseTimestamp, parseWeightCsv, toExerciseCsv, toFoodCsv, toWeightCsv } from './csv';
import type { UserData } from './types';

describe('parseTimestamp', () => {
  it('reads a timestamp without an offset as local time', () => {
    expect(parseTimestamp('2026-08-13T07:42:00')).toBe(new Date(2026, 7, 13, 7, 42).getTime());
    expect(parseTimestamp('2026-08-13 07:42')).toBe(new Date(2026, 7, 13, 7, 42).getTime());
  });

  it('reads a timestamp with an offset as that exact instant', () => {
    expect(parseTimestamp('2026-08-13T07:42:00Z')).toBe(Date.UTC(2026, 7, 13, 7, 42));
    expect(parseTimestamp('2026-08-13T07:42:00+02:00')).toBe(Date.UTC(2026, 7, 13, 5, 42));
  });

  it('rejects impossible or malformed dates', () => {
    expect(parseTimestamp('2026-02-31T08:00:00')).toBeNull();
    expect(parseTimestamp('13/08/2026 07:42')).toBeNull();
    expect(parseTimestamp('')).toBeNull();
  });
});

describe('parseWeightCsv', () => {
  const t = (d: number, h = 7, m = 42) => new Date(2026, 7, d, h, m).getTime();

  it('requires a header with timestamp and a weight column', () => {
    expect(() => parseWeightCsv('2026-08-13T07:42:00,72.1\n', 'kg')).toThrow(/header/);
  });

  it('reads the current format with both units', () => {
    const csv = 'timestamp,weight_kg,weight_lb,entered_unit\n2026-08-13T07:42:00,70,154.32,kg\n2026-08-14T07:42:00,69.85,154,lb\n';
    expect(parseWeightCsv(csv, 'kg').entries).toEqual([
      { timestamp: t(13), kg: 70, lb: 154.32, entered: 'kg' },
      { timestamp: t(14), kg: 69.85, lb: 154, entered: 'lb' },
    ]);
  });

  it('fills in a blank unit column by converting the other', () => {
    const csv = 'timestamp,weight_kg,weight_lb\n2026-08-13T07:42:00,70,\n2026-08-14T07:42:00,,154.32\n';
    expect(parseWeightCsv(csv, 'kg').entries).toEqual([
      { timestamp: t(13), kg: 70, lb: 154.32, entered: 'kg' },
      { timestamp: t(14), kg: 70, lb: 154.32, entered: 'lb' },
    ]);
  });

  it('reads the older single-weight format, in any column order', () => {
    const csv = 'Unit,Weight,Timestamp\nlb,154.32,2026-08-13T07:42:00\n,70,2026-08-14T07:42:00\nstone,11,2026-08-15T07:42:00\n';
    const result = parseWeightCsv(csv, 'kg');
    expect(result.entries).toEqual([
      { timestamp: t(13), kg: 70, lb: 154.32, entered: 'lb' },
      { timestamp: t(14), kg: 70, lb: 154.32, entered: 'kg' },
    ]);
    expect(result.skipped).toEqual([4]);
  });

  it('ignores blank lines and reports bad rows by line number', () => {
    const csv = 'timestamp,weight\r\n2026-08-13T07:42:00,72.1\r\n\r\nnot-a-date,70\r\n2026-08-14T07:40:00,-1\r\n';
    const result = parseWeightCsv(csv, 'kg');
    expect(result.entries).toHaveLength(1);
    expect(result.skipped).toEqual([4, 5]);
  });

  it('round-trips with toWeightCsv', () => {
    const user: UserData = {
      version: 1,
      userId: 'u1',
      name: 'Juju',
      unit: 'lb',
      entries: [
        { id: 'b', timestamp: new Date(2026, 7, 14, 7, 5, 9).getTime(), kg: 71.85, lb: 158.4, entered: 'lb' },
        { id: 'a', timestamp: new Date(2026, 7, 13, 6, 30).getTime(), kg: 72, lb: 158.73, entered: 'kg' },
      ],
    };
    const csv = toWeightCsv(user);
    expect(csv.split('\n').slice(0, 2)).toEqual(['timestamp,weight_kg,weight_lb,entered_unit', '2026-08-13T06:30:00,72,158.73,kg']);
    expect(parseWeightCsv(csv, 'kg').entries).toEqual([...user.entries].reverse().map(({ id: _id, ...rest }) => rest));
  });
});

describe('toFoodCsv', () => {
  it('writes food entries oldest first and quotes text with commas, quotes, or line breaks', () => {
    const user: UserData = {
      version: 1,
      userId: 'u1',
      name: 'Juju',
      unit: 'kg',
      entries: [],
      foods: [
        { id: 'b', timestamp: new Date(2026, 9, 11, 12, 30).getTime(), text: 'Salad, "light" dressing\nand tea', category: 'produce' },
        { id: 'a', timestamp: new Date(2026, 9, 11, 7, 45).getTime(), text: 'Oatmeal' },
      ],
    };
    expect(toFoodCsv(user)).toBe(
      'timestamp,food,category\n2026-10-11T07:45:00,Oatmeal,\n2026-10-11T12:30:00,"Salad, ""light"" dressing\nand tea",Vegetables & fruit\n',
    );
  });

  it('writes just the header for a user without a food log', () => {
    expect(toFoodCsv({ version: 1, userId: 'u1', name: 'Juju', unit: 'kg', entries: [] })).toBe('timestamp,food,category\n');
  });
});

describe('parseCsvRows', () => {
  it('handles quoted commas, escaped quotes, line breaks, and CRLF', () => {
    expect(parseCsvRows('a,b\r\n1,"x, ""y""\nz"\r\n')).toEqual([['a', 'b'], ['1', 'x, "y"\nz']]);
  });
});

describe('parseFoodCsv', () => {
  it('reads back what toFoodCsv writes, including categories', () => {
    const foods = [
      { id: 'a', timestamp: new Date(2026, 9, 11, 7, 45).getTime(), text: 'Oatmeal', category: 'grains' as const },
      { id: 'b', timestamp: new Date(2026, 9, 11, 12, 30).getTime(), text: 'Salad, "light" dressing\nand tea' },
    ];
    const csv = toFoodCsv({ version: 1, userId: 'u', name: 'J', unit: 'kg', entries: [], foods });
    expect(parseFoodCsv(csv)).toEqual(foods.map(({ id: _id, ...rest }) => rest));
  });

  it('reads older files without a category column, and treats unknown categories as uncategorized', () => {
    expect(parseFoodCsv('timestamp,food\n2026-10-11T23:21:23,beef brisket\n')).toEqual([
      { timestamp: new Date(2026, 9, 11, 23, 21, 23).getTime(), text: 'beef brisket' },
    ]);
    expect(parseFoodCsv('timestamp,food,category\n2026-10-11T08:00:00,toast,Pastry\n')[0].category).toBeUndefined();
  });

  it('skips rows with a bad timestamp or no text', () => {
    expect(parseFoodCsv('timestamp,food\nnope,toast\n2026-10-11T08:00:00,\n')).toEqual([]);
  });
});

describe('exercise CSV', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 11, h, m).getTime();
  const user = {
    version: 1 as const,
    userId: 'u',
    name: 'Juju',
    unit: 'kg' as const,
    entries: [],
    exercises: [
      { id: '2', timestamp: at(18), name: 'Weights, upper body', category: 'strength' as const, minutes: 40 },
      { id: '1', timestamp: at(7, 15), name: 'Morning run', category: 'cardio' as const, minutes: 30 },
    ],
  };

  it('writes timestamp,activity,category,minutes oldest first and reads it back', () => {
    const csv = toExerciseCsv(user);
    expect(csv).toBe(
      'timestamp,activity,category,minutes\n2026-10-11T07:15:00,Morning run,Cardio,30\n2026-10-11T18:00:00,"Weights, upper body",Strength,40\n',
    );
    expect(parseExerciseCsv(csv)).toEqual([
      { timestamp: at(7, 15), name: 'Morning run', category: 'cardio', minutes: 30 },
      { timestamp: at(18), name: 'Weights, upper body', category: 'strength', minutes: 40 },
    ]);
  });

  it('skips rows with an unknown category, a bad duration, or no activity', () => {
    const csv = [
      'timestamp,activity,category,minutes',
      '2026-10-11T07:00,Run,cardio,30',
      '2026-10-11T08:00,Dance,party,30',
      '2026-10-11T09:00,Yoga,Flexibility,0',
      '2026-10-11T10:00,Yoga,Flexibility,',
      '2026-10-11T11:00,,Strength,20',
    ].join('\n');
    expect(parseExerciseCsv(csv).map((e) => e.name)).toEqual(['Run']);
    expect(() => parseExerciseCsv('timestamp,activity\n')).toThrow(/minutes/);
  });
});


describe('mergeNew', () => {
  it('keeps only rows not already logged, and drops repeats within the file', () => {
    const existing = [{ timestamp: 1, text: 'a' }];
    const rows = [
      { timestamp: 1, text: 'a' }, // already logged
      { timestamp: 1, text: 'b' }, // same time, different food
      { timestamp: 2, text: 'c' },
      { timestamp: 2, text: 'c' }, // repeated in the file
    ];
    expect(mergeNew(existing, rows, (f) => `${f.timestamp}|${f.text}`)).toEqual([
      { timestamp: 1, text: 'b' },
      { timestamp: 2, text: 'c' },
    ]);
  });
});
