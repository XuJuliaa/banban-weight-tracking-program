import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { detectCsvKind, planImport, unzipCsvs, zipFiles } from './backup';

const WEIGHT = 'timestamp,weight_kg,weight_lb,entered_unit\n2026-10-01T08:00:00,70,154.32,kg\n2026-10-02T08:00:00,69.5,153.22,kg\n';
const FOOD = 'timestamp,food,category\n2026-10-01T12:00:00,"rice, beans",Grains & starches\n';
const EXERCISE = 'timestamp,activity,category,minutes\n2026-10-01T18:00:00,run,Cardio,30\n';

describe('detectCsvKind', () => {
  it('recognises each export from its header row', () => {
    expect(detectCsvKind(WEIGHT)).toBe('weight');
    expect(detectCsvKind('timestamp,weight,unit\n2026-10-01T08:00:00,70,kg\n')).toBe('weight');
    expect(detectCsvKind(FOOD)).toBe('food');
    expect(detectCsvKind('timestamp,food\n')).toBe('food');
    expect(detectCsvKind(EXERCISE)).toBe('exercise');
    expect(detectCsvKind('﻿Timestamp, Weight_KG\n')).toBe('weight');
  });

  it('returns null for anything else', () => {
    expect(detectCsvKind('')).toBeNull();
    expect(detectCsvKind('date,steps\n2026-10-01,9000\n')).toBeNull();
    expect(detectCsvKind('weight_kg,weight_lb\n70,154\n')).toBeNull();
  });
});

describe('zipFiles and unzipCsvs', () => {
  it('round-trips the files', () => {
    const files = { 'weight-Juju.csv': WEIGHT, 'food-Juju.csv': FOOD, 'exercise-Juju.csv': EXERCISE };
    expect(unzipCsvs(zipFiles(files))).toEqual(Object.entries(files).map(([name, text]) => ({ name, text })));
  });

  it('reads compressed zips in folders and skips non-CSV and macOS extra files', () => {
    const zip = zipSync(
      {
        'backup/food.csv': strToU8(FOOD),
        'backup/notes.txt': strToU8('hi'),
        'backup/.hidden.csv': strToU8(FOOD),
        '__MACOSX/backup/._food.csv': strToU8('junk'),
      },
      { level: 9 },
    );
    expect(unzipCsvs(zip)).toEqual([{ name: 'food.csv', text: FOOD }]);
  });
});

describe('planImport', () => {
  it('parses one file per kind found and leaves the other kinds out', () => {
    const plan = planImport([{ name: 'f.csv', text: FOOD }], 'kg');
    expect(plan.food?.rows).toEqual([{ timestamp: new Date(2026, 9, 1, 12).getTime(), text: 'rice, beans', category: 'grains' }]);
    expect(plan.weight).toBeUndefined();
    expect(plan.exercise).toBeUndefined();

    const all = planImport(
      [
        { name: 'w.csv', text: WEIGHT },
        { name: 'f.csv', text: FOOD },
        { name: 'e.csv', text: EXERCISE },
      ],
      'kg',
    );
    expect([all.weight?.rows.length, all.food?.rows.length, all.exercise?.rows.length]).toEqual([2, 1, 1]);
    expect(all.ignored).toEqual([]);
  });

  it('refuses two files of the same kind', () => {
    expect(() => planImport([{ name: 'a.csv', text: WEIGHT }, { name: 'b.csv', text: WEIGHT }], 'kg')).toThrow(
      'Pick only one weight file',
    );
  });

  it('ignores unrecognised or unreadable files and keeps the rest', () => {
    const plan = planImport(
      [
        { name: 'steps.csv', text: 'date,steps\n' },
        { name: 'bad-exercise.csv', text: 'timestamp,activity,minutes\n' },
        { name: 'w.csv', text: WEIGHT },
      ],
      'kg',
    );
    expect(plan.weight?.rows).toHaveLength(2);
    expect(plan.ignored.map((i) => i.fileName)).toEqual(['steps.csv', 'bad-exercise.csv']);
  });

  it('gives no rows for a header-only file and reports unreadable weight lines', () => {
    expect(planImport([{ name: 'e.csv', text: 'timestamp,activity,category,minutes\n' }], 'kg').exercise?.rows).toEqual([]);
    const plan = planImport([{ name: 'w.csv', text: `${WEIGHT}not-a-date,70,,kg\n` }], 'kg');
    expect(plan.weight?.rows).toHaveLength(2);
    expect(plan.weight?.unreadable).toEqual([4]);
  });
});
