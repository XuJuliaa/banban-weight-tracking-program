import { describe, expect, it } from 'vitest';
import { categoryCounts, categoryFromText, categoryLabel } from './food';
import type { FoodEntry } from './types';

const at = (d: number, h: number) => new Date(2026, 9, d, h).getTime();
const food = (d: number, h: number, category?: FoodEntry['category']): FoodEntry => ({
  id: `${d}-${h}`,
  timestamp: at(d, h),
  text: 'x',
  ...(category ? { category } : {}),
});

describe('categoryFromText', () => {
  it('accepts labels and ids in any case, and rejects unknown or blank values', () => {
    expect(categoryFromText('Protein')).toBe('protein');
    expect(categoryFromText(' vegetables & FRUIT ')).toBe('produce');
    expect(categoryFromText('drinks')).toBe('drinks');
    expect(categoryFromText('Pizza')).toBeNull();
    expect(categoryFromText('')).toBeNull();
    expect(categoryLabel(undefined)).toBe('Uncategorized');
  });
});

describe('categoryCounts', () => {
  const foods = [
    food(1, 8, 'grains'),
    food(1, 13, 'protein'),
    food(2, 19, 'protein'),
    food(3, 10),
    food(5, 0, 'drinks'), // just outside the range below
    food(1, 0, 'dairy'), // first moment of the range
  ];

  it('counts entries per category within whole local days, in the fixed category order', () => {
    const { total, counts } = categoryCounts(foods, at(1, 15), at(4, 9));
    expect(total).toBe(5);
    expect(counts.map((c) => [c.id, c.count])).toEqual([
      ['protein', 2],
      ['grains', 1],
      ['dairy', 1],
      ['uncategorized', 1],
    ]);
    expect(counts[0].pct).toBe(40);
    expect(counts.reduce((sum, c) => sum + c.pct, 0)).toBeCloseTo(100);
  });

  it('is empty when nothing falls in the range', () => {
    expect(categoryCounts(foods, at(20, 0), at(21, 0))).toEqual({ total: 0, counts: [] });
  });
});
