import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { applyMerge, detectCsvKind, mergeImport, planImport, unzipCsvs, zipFiles } from './backup';
import { toExerciseCsv, toFoodCsv, toWeightCsv } from './csv';
import type { UserData } from './types';
import { makeEntry } from './units';

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

describe('mergeImport and applyMerge', () => {
  const at = (day: number, hour = 8, min = 0, sec = 0) => new Date(2026, 9, day, hour, min, sec).getTime();
  const profile = (): UserData => ({
    version: 1,
    userId: 'u1',
    name: 'Juju',
    unit: 'lb',
    entries: [makeEntry('w1', at(1), 150, 'lb'), makeEntry('w2', at(2), 149, 'lb')],
    foods: [{ id: 'f1', timestamp: at(1, 12), text: 'Oatmeal', category: 'grains' }],
    exercises: [{ id: 'x1', timestamp: at(1, 18), name: 'Morning run', category: 'cardio', minutes: 30 }],
  });
  const plan = (files: Record<string, string>) =>
    planImport(Object.entries(files).map(([name, text]) => ({ name, text })), 'lb');
  const exportOf = (user: UserData) => ({ 'w.csv': toWeightCsv(user), 'f.csv': toFoodCsv(user), 'e.csv': toExerciseCsv(user) });
  let n = 0;
  const ids = () => `new${n++}`;

  it('finds nothing new in a re-import of our own export', () => {
    const user = profile();
    const merge = mergeImport(user, plan(exportOf(user)));
    expect([merge.weight?.add, merge.food?.add, merge.exercise?.add]).toEqual([[], [], []]);
    expect([merge.weight?.duplicates, merge.food?.duplicates, merge.exercise?.duplicates]).toEqual([2, 1, 1]);
    expect(merge.conflicts).toEqual([]);
  });

  it('adds only what an older backup has that the profile lacks', () => {
    const backup = profile();
    backup.entries.push(makeEntry('w0', at(5), 147, 'lb'));
    const user = profile();
    user.entries.push(makeEntry('w9', at(9), 146, 'lb'));
    const merge = mergeImport(user, plan(exportOf(backup)));
    expect(merge.weight?.add.map((r) => r.timestamp)).toEqual([at(5)]);
    const merged = applyMerge(user, merge, new Set(), ids);
    expect(merged.entries.map((e) => e.timestamp).sort()).toEqual([at(1), at(2), at(5), at(9)]);
  });

  it('treats a weigh-in in the same minute as the same one, and a different weight as a conflict', () => {
    const user = profile();
    const csv = 'timestamp,weight,unit\n2026-10-01T08:00:42,150,lb\n2026-10-02T08:00:00,151.4,lb\n';
    const merge = mergeImport(user, plan({ 'w.csv': csv }));
    expect(merge.weight).toEqual({ add: [], duplicates: 1 });
    expect(merge.conflicts).toHaveLength(1);
    expect(merge.conflicts[0]).toMatchObject({ id: 'weight:w2', kind: 'weight', existing: { lb: 149 }, incoming: { lb: 151.4 } });
  });

  it('keeps logged entries unless the file is chosen, and keeps their ids', () => {
    const user = profile();
    const merge = mergeImport(user, plan({ 'w.csv': 'timestamp,weight,unit\n2026-10-01T08:00:00,152,lb\n2026-10-02T08:00:00,151,lb\n' }));
    expect(merge.conflicts.map((c) => c.id)).toEqual(['weight:w1', 'weight:w2']);
    const kept = applyMerge(user, merge, new Set(), ids);
    expect(kept.entries.map((e) => e.lb)).toEqual([150, 149]);
    const mixed = applyMerge(user, merge, new Set(['weight:w2']), ids);
    expect(mixed.entries.map((e) => [e.id, e.lb])).toEqual([['w1', 150], ['w2', 151]]);
    const all = applyMerge(user, merge, new Set(merge.conflicts.map((c) => c.id)), ids);
    expect(all.entries.map((e) => e.lb)).toEqual([152, 151]);
  });

  it('adds a different food at the same time and skips the same food in another case', () => {
    const user = profile();
    const merge = mergeImport(user, plan({ 'f.csv': 'timestamp,food\n2026-10-01T12:00:00,OATMEAL \n2026-10-01T12:00:00,Banana\n' }));
    expect(merge.food).toEqual({ add: [{ timestamp: at(1, 12), text: 'Banana' }], duplicates: 1 });
    expect(merge.conflicts).toEqual([]);
  });

  it('lists an exercise with the same time and activity but other minutes as a conflict', () => {
    const user = profile();
    const merge = mergeImport(user, plan({ 'e.csv': 'timestamp,activity,category,minutes\n2026-10-01T18:00:00,morning run,Cardio,45\n' }));
    expect(merge.exercise).toEqual({ add: [], duplicates: 0 });
    expect(merge.conflicts).toMatchObject([{ id: 'exercise:x1', existing: { minutes: 30 }, incoming: { minutes: 45 } }]);
    expect(applyMerge(user, merge, new Set(['exercise:x1']), ids).exercises[0]).toMatchObject({ id: 'x1', minutes: 45 });
  });

  it('adds rows repeated within a file once', () => {
    const user = { ...profile(), entries: [], foods: [], exercises: [] };
    const merge = mergeImport(
      user,
      plan({
        'w.csv': 'timestamp,weight,unit\n2026-10-03T08:00:00,150,lb\n2026-10-03T08:00:00,150,lb\n',
        'f.csv': 'timestamp,food\n2026-10-03T12:00:00,Soup\n2026-10-03T12:00:00,soup\n',
      }),
    );
    expect([merge.weight?.add.length, merge.weight?.duplicates, merge.food?.add.length, merge.food?.duplicates]).toEqual([1, 1, 1, 1]);
  });
});
