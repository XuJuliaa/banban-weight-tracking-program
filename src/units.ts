// Weights are kept in one unit per profile (UserData.unit), one entry per calendar date. Weights the user types
// are rounded to 0.1; stored weights keep up to 2 decimals, so converting between kg and lb loses almost nothing.
// These helpers convert, round and merge entries, and turn them into points for stats and charts.

import { dayKey } from './stats.ts';
import type { WeightEntry, WeightPoint, WeightUnit } from './types.ts';

export const LB_PER_KG = 2.20462;

/** Rounds to the nearest 0.1: the precision of a weight the user types. */
export const round1 = (n: number) => Math.round(n * 10) / 10;

/** Rounds to the nearest 0.01: the most decimals a stored weight keeps (after a unit conversion or an average). */
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Converts a weight between units, without rounding. */
export function convertExact(weight: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return weight;
  return from === 'kg' ? weight * LB_PER_KG : weight / LB_PER_KG;
}

/** Converts a weight between units, rounded to 0.01. */
export function convertWeight(weight: number, from: WeightUnit, to: WeightUnit): number {
  return round2(convertExact(weight, from, to));
}

/** Every entry converted from `from` to `to` and rounded to 0.01, for when the profile's unit changes. */
export function convertEntries(entries: WeightEntry[], from: WeightUnit, to: WeightUnit): WeightEntry[] {
  return entries.map((e) => ({ ...e, weight: convertWeight(e.weight, from, to) }));
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written "YYYY-MM-DD". */
export function isDateKey(value: unknown): value is string {
  const m = typeof value === 'string' ? DATE.exec(value) : null;
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return dayKey(d.getTime()) === value;
}

/** Local noon of a "YYYY-MM-DD" date: where a whole-day weight sits on the time axis of charts and stats. */
export function dateToTime(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 12).getTime();
}

/** A new entry for `date` with a weight the user typed, rounded to 0.1. */
export const makeEntry = (id: string, date: string, weight: number): WeightEntry => ({ id, date, weight: round1(weight) });

export interface MergeResult {
  /** One entry per date, oldest first. */
  entries: WeightEntry[];
  /** Dates that had more than one entry and were averaged into one. */
  merged: string[];
}

/**
 * Keeps one entry per date: several entries on the same date are replaced by one with their average
 * (it keeps the first entry's id). Every weight is rounded to 0.01. Sorted oldest first.
 */
export function mergeSameDay(entries: WeightEntry[]): MergeResult {
  const byDate = new Map<string, WeightEntry[]>();
  for (const e of entries) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  const merged: string[] = [];
  const result: WeightEntry[] = [];
  for (const [date, group] of byDate) {
    if (group.length > 1) merged.push(date);
    const average = group.reduce((sum, e) => sum + e.weight, 0) / group.length;
    result.push({ id: group[0].id, date, weight: round2(average) });
  }
  result.sort((a, b) => a.date.localeCompare(b.date));
  return { entries: result, merged: merged.sort() };
}

/** Entries as points for stats and charts, each placed at noon of its date. */
export function pointsIn(entries: WeightEntry[]): WeightPoint[] {
  return entries.map((e) => ({ id: e.id, timestamp: dateToTime(e.date), weight: e.weight }));
}

/**
 * Reads an entry saved in this browser by this or an older version, as a weight in `unit`:
 *   current:  { id, date, weight }                     (weight already in `unit`)
 *   older:    { id, timestamp, kg, lb, entered }       (the `unit` column is used)
 *   oldest:   { id, timestamp, weight }                (weight in `unit`)
 * Returns null if it isn't a valid entry. Same-date duplicates are left for mergeSameDay.
 */
export function normalizeEntry(raw: unknown, unit: WeightUnit): WeightEntry | null {
  const e = raw as { id?: unknown; date?: unknown; timestamp?: unknown; weight?: unknown; kg?: unknown; lb?: unknown } | null;
  if (!e || typeof e.id !== 'string') return null;
  const date = isDateKey(e.date) ? e.date : typeof e.timestamp === 'number' && Number.isFinite(e.timestamp) ? dayKey(e.timestamp) : null;
  const value = typeof e[unit] === 'number' ? e[unit] : e.weight;
  if (date === null || typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return { id: e.id, date, weight: round2(value) };
}
