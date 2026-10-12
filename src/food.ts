// Food categories and the counts behind the "Food breakdown" pie.

import type { FoodEntry } from './types.ts';

/** Fixed order: it sets the pie's slice order and each category's colour, so neither depends on the counts. */
export const FOOD_CATEGORIES = [
  { id: 'protein', label: 'Protein' },
  { id: 'produce', label: 'Vegetables & fruit' },
  { id: 'grains', label: 'Grains & starches' },
  { id: 'dairy', label: 'Dairy' },
  { id: 'snacks', label: 'Snacks & sweets' },
  { id: 'drinks', label: 'Drinks' },
] as const;

export type FoodCategoryId = (typeof FOOD_CATEGORIES)[number]['id'];

export const UNCATEGORIZED = { id: 'uncategorized', label: 'Uncategorized' } as const;

export function categoryLabel(id: FoodCategoryId | undefined): string {
  return FOOD_CATEGORIES.find((c) => c.id === id)?.label ?? UNCATEGORIZED.label;
}

/** A category from a label or id, ignoring case and spacing ("Protein", "protein", "vegetables & fruit"). */
export function categoryFromText(value: string | undefined): FoodCategoryId | null {
  const v = (value ?? '').trim().toLowerCase();
  if (!v) return null;
  return FOOD_CATEGORIES.find((c) => c.id === v || c.label.toLowerCase() === v)?.id ?? null;
}

export interface CategoryCount {
  id: FoodCategoryId | typeof UNCATEGORIZED.id;
  label: string;
  count: number;
  /** 0–100 */
  pct: number;
}

/**
 * How many food entries fall in each category between the start of `fromDay` and the end of `toDay`
 * (local calendar days). Categories with no entries are left out; uncategorized entries come last.
 */
export function categoryCounts(foods: FoodEntry[], fromDay: number, toDay: number): { total: number; counts: CategoryCount[] } {
  const from = new Date(fromDay).setHours(0, 0, 0, 0);
  const to = new Date(toDay).setHours(23, 59, 59, 999);
  const inRange = foods.filter((f) => f.timestamp >= from && f.timestamp <= to);
  const total = inRange.length;
  const tally = new Map<string, number>();
  for (const f of inRange) {
    const id = f.category ?? UNCATEGORIZED.id;
    tally.set(id, (tally.get(id) ?? 0) + 1);
  }
  const counts: CategoryCount[] = [...FOOD_CATEGORIES, UNCATEGORIZED]
    .filter((c) => tally.has(c.id))
    .map((c) => ({ id: c.id, label: c.label, count: tally.get(c.id)!, pct: (tally.get(c.id)! / total) * 100 }));
  return { total, counts };
}
