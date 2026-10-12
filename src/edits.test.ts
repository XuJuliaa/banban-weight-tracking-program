import { describe, expect, it } from 'vitest';
import { overrideDay } from './edits';
import { convertWeight, makeEntry, normalizeEntry, pointsIn } from './units';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
const NOW = at(12, 15);
const entries = [
  makeEntry('a', at(10, 7), 70.4, 'kg'),
  makeEntry('b', at(11, 21, 30), 70.9, 'kg'),
  makeEntry('c', at(11, 7, 5), 70.1, 'kg'),
];

describe('overrideDay', () => {
  it('replaces every entry on that date with one entry at the earliest replaced time', () => {
    const result = overrideDay(entries, at(11, 0), 69.8, 'kg', NOW, 'new');
    expect(result.replaced.map((e) => e.id)).toEqual(['c', 'b']);
    expect(result.entry).toEqual({ id: 'new', timestamp: at(11, 7, 5), kg: 69.8, lb: 153.88, entered: 'kg' });
    expect(result.entries.map((e) => e.id).sort()).toEqual(['a', 'new']);
  });

  it('stores a weight typed in lb exactly, with kg converted', () => {
    expect(overrideDay(entries, at(11, 0), 154, 'lb', NOW, 'new').entry).toMatchObject({ kg: 69.85, lb: 154, entered: 'lb' });
  });

  it('adds an entry at noon for a past date with no entries', () => {
    const result = overrideDay(entries, at(9, 0), 70.6, 'kg', NOW, 'new');
    expect(result.replaced).toEqual([]);
    expect(result.entry.timestamp).toBe(at(9, 12));
    expect(result.entries).toHaveLength(4);
  });

  it('uses the current time for today when today has no entry', () => {
    expect(overrideDay(entries, at(12, 0), 69.5, 'kg', NOW, 'new').entry.timestamp).toBe(NOW);
  });
});

describe('units', () => {
  it('converts kg and lb both ways, rounded to 0.01', () => {
    expect(convertWeight(70, 'kg', 'lb')).toBe(154.32);
    expect(convertWeight(154.32, 'lb', 'kg')).toBe(70);
    expect(convertWeight(70, 'kg', 'kg')).toBe(70);
  });

  it('keeps the typed value exact and converts the other unit', () => {
    expect(makeEntry('x', 1, 70.1, 'kg')).toEqual({ id: 'x', timestamp: 1, kg: 70.1, lb: 154.54, entered: 'kg' });
    expect(makeEntry('x', 1, 155, 'lb')).toEqual({ id: 'x', timestamp: 1, kg: 70.31, lb: 155, entered: 'lb' });
  });

  it('reads the chosen unit\'s column for stats and charts', () => {
    expect(pointsIn([makeEntry('x', 1, 155, 'lb')], 'kg')).toEqual([{ id: 'x', timestamp: 1, weight: 70.31 }]);
    expect(pointsIn([makeEntry('x', 1, 155, 'lb')], 'lb')).toEqual([{ id: 'x', timestamp: 1, weight: 155 }]);
  });

  it('upgrades entries saved before both units were stored', () => {
    expect(normalizeEntry({ id: 'x', timestamp: 1, weight: 70 }, 'kg')).toEqual(makeEntry('x', 1, 70, 'kg'));
    expect(normalizeEntry({ id: 'x', timestamp: 1, kg: 70, lb: 154.32, entered: 'kg' }, 'lb')).toEqual(makeEntry('x', 1, 70, 'kg'));
    expect(normalizeEntry({ id: 'x', timestamp: 1, weight: -2 }, 'kg')).toBeNull();
  });
});
