// Weights are stored in both kg and lb (see WeightEntry). These helpers make entries and read them in one unit.

import type { WeightEntry, WeightPoint, WeightUnit } from './types.ts';

export const LB_PER_KG = 2.20462;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Converts a weight between units, rounded to 0.01. */
export function convertWeight(weight: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return weight;
  return round2(from === 'kg' ? weight * LB_PER_KG : weight / LB_PER_KG);
}

/** An entry for a weight typed in `unit`: that value is kept exactly, the other unit is converted. */
export function makeEntry(id: string, timestamp: number, weight: number, unit: WeightUnit): WeightEntry {
  return unit === 'kg'
    ? { id, timestamp, kg: weight, lb: convertWeight(weight, 'kg', 'lb'), entered: 'kg' }
    : { id, timestamp, kg: convertWeight(weight, 'lb', 'kg'), lb: weight, entered: 'lb' };
}

export const weightIn = (entry: WeightEntry, unit: WeightUnit): number => entry[unit];

/** Entries as plain weights in `unit`, for stats and charts. */
export function pointsIn(entries: WeightEntry[], unit: WeightUnit): WeightPoint[] {
  return entries.map((e) => ({ id: e.id, timestamp: e.timestamp, weight: e[unit] }));
}

/**
 * Reads an entry saved by this or an older version: older entries have a single `weight`
 * in the profile's unit (`legacyUnit`). Returns null if it isn't a valid entry.
 */
export function normalizeEntry(raw: unknown, legacyUnit: WeightUnit): WeightEntry | null {
  const e = raw as Partial<WeightEntry> & { weight?: number };
  if (!e || typeof e.id !== 'string' || !Number.isFinite(e.timestamp)) return null;
  if (Number.isFinite(e.kg) && Number.isFinite(e.lb) && e.kg! > 0 && e.lb! > 0) {
    return { id: e.id, timestamp: e.timestamp!, kg: e.kg!, lb: e.lb!, entered: e.entered === 'lb' ? 'lb' : 'kg' };
  }
  if (Number.isFinite(e.weight) && e.weight! > 0) return makeEntry(e.id, e.timestamp!, e.weight!, legacyUnit);
  return null;
}
