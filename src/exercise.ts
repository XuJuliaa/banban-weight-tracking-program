// Exercise categories and the numbers behind the "Exercise" card: per-category totals for the
// Summary tab and minutes per day for each category's bar chart.

import { addDays, dayKey, startOfDay } from './stats.ts';
import type { ExerciseEntry } from './types.ts';

/** Fixed order: it sets the tab order and each category's colour. */
export const EXERCISE_CATEGORIES = [
  { id: 'cardio', label: 'Cardio' },
  { id: 'strength', label: 'Strength' },
  { id: 'flexibility', label: 'Flexibility' },
] as const;

export type ExerciseCategoryId = (typeof EXERCISE_CATEGORIES)[number]['id'];

/** Longest session accepted, in minutes (a whole day). */
export const MAX_EXERCISE_MINUTES = 1440;

export function exerciseCategoryLabel(id: ExerciseCategoryId): string {
  return EXERCISE_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

/** A category from a label or id, ignoring case and spacing ("Cardio", " strength "). */
export function exerciseCategoryFromText(value: string | undefined): ExerciseCategoryId | null {
  const v = (value ?? '').trim().toLowerCase();
  if (!v) return null;
  return EXERCISE_CATEGORIES.find((c) => c.id === v || c.label.toLowerCase() === v)?.id ?? null;
}

/** True for a whole or fractional number of minutes between 1 and a day. */
export function validMinutes(minutes: unknown): minutes is number {
  return typeof minutes === 'number' && Number.isFinite(minutes) && minutes >= 1 && minutes <= MAX_EXERCISE_MINUTES;
}

/** Entries between the start of `fromDay` and the end of `toDay` (local calendar days). */
export function exercisesIn(exercises: ExerciseEntry[], fromDay: number, toDay: number): ExerciseEntry[] {
  const from = startOfDay(fromDay);
  const to = addDays(startOfDay(toDay), 1);
  return exercises.filter((e) => e.timestamp >= from && e.timestamp < to);
}

/** Calendar days from `fromDay` to `toDay`, inclusive (at least 1). */
export function daysInRange(fromDay: number, toDay: number): number {
  let n = 0;
  for (let d = startOfDay(fromDay), last = startOfDay(toDay); d <= last; d = addDays(d, 1)) n++;
  return Math.max(1, n);
}

export interface CategoryTotal {
  id: ExerciseCategoryId;
  label: string;
  minutes: number;
  sessions: number;
  /** Minutes per calendar day in the range, counting days with no exercise. */
  avgPerDay: number;
}

export interface ExerciseSummary {
  days: number;
  minutes: number;
  sessions: number;
  categories: CategoryTotal[];
}

/** Total minutes and sessions per category (all three, even with nothing logged) over a range of days. */
export function exerciseSummary(exercises: ExerciseEntry[], fromDay: number, toDay: number): ExerciseSummary {
  const inRange = exercisesIn(exercises, fromDay, toDay);
  const days = daysInRange(fromDay, toDay);
  const categories = EXERCISE_CATEGORIES.map((c) => {
    const mine = inRange.filter((e) => e.category === c.id);
    const minutes = mine.reduce((sum, e) => sum + e.minutes, 0);
    return { id: c.id, label: c.label, minutes, sessions: mine.length, avgPerDay: minutes / days };
  });
  return {
    days,
    minutes: categories.reduce((sum, c) => sum + c.minutes, 0),
    sessions: inRange.length,
    categories,
  };
}

export interface DayMinutes {
  /** Local midnight. */
  day: number;
  minutes: number;
  /** Names of that day's sessions, in the order they were logged. */
  activities: string[];
}

/** Minutes of one category for every day from `fromDay` to `toDay`, with 0 on days without any. */
export function dailyMinutes(exercises: ExerciseEntry[], category: ExerciseCategoryId, fromDay: number, toDay: number): DayMinutes[] {
  const byDay = new Map<string, ExerciseEntry[]>();
  const mine = exercisesIn(exercises, fromDay, toDay)
    .filter((e) => e.category === category)
    .sort((a, b) => a.timestamp - b.timestamp);
  for (const e of mine) {
    const key = dayKey(e.timestamp);
    byDay.set(key, [...(byDay.get(key) ?? []), e]);
  }
  const days: DayMinutes[] = [];
  for (let d = startOfDay(fromDay), last = startOfDay(toDay); d <= last; d = addDays(d, 1)) {
    const list = byDay.get(dayKey(d)) ?? [];
    days.push({ day: d, minutes: list.reduce((sum, e) => sum + e.minutes, 0), activities: list.map((e) => e.name) });
  }
  return days;
}

/** "45 min", "1 h", "2 h 15 min". */
export function formatMinutes(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}
