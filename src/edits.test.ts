import { describe, expect, it } from 'vitest';
import { overrideDay } from './edits';
import { convertEntries, convertWeight, dateToTime, isDateKey, makeEntry, mergeSameDay, normalizeEntry, pointsIn, round1, round2 } from './units';

const entries = [makeEntry('a', '2026-10-10', 70.4), makeEntry('b', '2026-10-11', 70.9)];

describe('overrideDay', () => {
  it("replaces the date's entry, keeping its id, and reports what it had", () => {
    const result = overrideDay(entries, '2026-10-11', 69.8, 'new');
    expect(result.replaced).toEqual({ id: 'b', date: '2026-10-11', weight: 70.9 });
    expect(result.entry).toEqual({ id: 'b', date: '2026-10-11', weight: 69.8 });
    expect(result.entries).toEqual([entries[0], result.entry]);
  });

  it('adds an entry for a date with none, kept in date order', () => {
    const result = overrideDay(entries, '2026-10-09', 70.6, 'new');
    expect(result.replaced).toBeNull();
    expect(result.entries.map((e) => e.date)).toEqual(['2026-10-09', '2026-10-10', '2026-10-11']);
  });

  it('rounds a typed weight to 0.1', () => {
    expect(overrideDay(entries, '2026-10-12', 69.94, 'new').entry.weight).toBe(69.9);
    expect(overrideDay(entries, '2026-10-12', 69.95, 'new').entry.weight).toBe(70);
  });
});

describe('units', () => {
  it('rounds typed weights to 0.1 and stored weights to 0.01', () => {
    expect([round1(70.04), round1(70.05), round1(154.32), round1(70)]).toEqual([70, 70.1, 154.3, 70]);
    expect([round2(70.004), round2(70.005), round2(154.324), round2(70)]).toEqual([70, 70.01, 154.32, 70]);
    expect(makeEntry('x', '2026-10-11', 70.04).weight).toBe(70);
  });

  it('converts kg and lb both ways, rounded to 0.01', () => {
    expect(convertWeight(70, 'kg', 'lb')).toBe(154.32);
    expect(convertWeight(154.32, 'lb', 'kg')).toBe(70);
    expect(convertWeight(70.004, 'kg', 'kg')).toBe(70);
  });

  it('converts every entry when the profile changes unit, and back again to the same kg values', () => {
    const lb = convertEntries(entries, 'kg', 'lb');
    expect(lb.map((e) => e.weight)).toEqual([155.21, 156.31]);
    expect(convertEntries(lb, 'lb', 'kg')).toEqual(entries);
  });

  it('keeps lb weights within 0.01 of the typed value however often the unit is switched', () => {
    for (let tenths = 900; tenths <= 3500; tenths++) {
      const typed = tenths / 10;
      let lb = [makeEntry('x', '2026-10-11', typed)];
      for (let i = 0; i < 10; i++) lb = convertEntries(convertEntries(lb, 'lb', 'kg'), 'kg', 'lb');
      expect(Math.abs(lb[0].weight - typed)).toBeLessThanOrEqual(0.0100001);
      expect(round1(lb[0].weight)).toBe(typed);
    }
  });

  it('keeps one entry per date, averaging duplicates and rounding to 0.01', () => {
    const result = mergeSameDay([
      makeEntry('c', '2026-10-11', 71),
      makeEntry('a', '2026-10-10', 70.4),
      { id: 'b', date: '2026-10-11', weight: 70.25 },
      { id: 'd', date: '2026-10-11', weight: 70.2 },
    ]);
    expect(result.entries).toEqual([
      { id: 'a', date: '2026-10-10', weight: 70.4 },
      { id: 'c', date: '2026-10-11', weight: 70.48 },
    ]);
    expect(result.merged).toEqual(['2026-10-11']);
  });

  it('places each date at local noon for stats and charts', () => {
    expect(dateToTime('2026-10-11')).toBe(new Date(2026, 9, 11, 12).getTime());
    expect(pointsIn([makeEntry('x', '2026-10-11', 155)])).toEqual([{ id: 'x', timestamp: dateToTime('2026-10-11'), weight: 155 }]);
  });

  it('accepts only real dates written YYYY-MM-DD', () => {
    expect(['2026-10-11', '2024-02-29'].map(isDateKey)).toEqual([true, true]);
    expect(['2026-02-30', '2026-1-5', '2026-10-11T08:00', 20261011].map(isDateKey)).toEqual([false, false, false, false]);
  });

  it('upgrades entries saved in this browser by older versions', () => {
    const t = new Date(2026, 9, 11, 7, 30).getTime();
    expect(normalizeEntry({ id: 'x', timestamp: t, weight: 70.004 }, 'kg')).toEqual({ id: 'x', date: '2026-10-11', weight: 70 });
    expect(normalizeEntry({ id: 'x', timestamp: t, kg: 70, lb: 154.32, entered: 'kg' }, 'lb')).toEqual({ id: 'x', date: '2026-10-11', weight: 154.32 });
    expect(normalizeEntry({ id: 'x', date: '2026-10-11', weight: 70.1 }, 'kg')).toEqual({ id: 'x', date: '2026-10-11', weight: 70.1 });
    expect(normalizeEntry({ id: 'x', timestamp: t, weight: -2 }, 'kg')).toBeNull();
    expect(normalizeEntry({ id: 'x', date: 'soon', weight: 70 }, 'kg')).toBeNull();
  });
});
