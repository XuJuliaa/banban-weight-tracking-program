// Weight changes that replace a date's entry: logging today's weight and the "Correct a weight" section.
// Pure functions; the page asks for confirmation (showing `replaced`) before saving the result.

import type { WeightEntry } from './types';
import { makeEntry, round1 } from './units';

export interface DayOverride {
  /** The profile's entries afterwards, oldest first. */
  entries: WeightEntry[];
  /** The entry that date had before, which will be overwritten; null when the date had none. */
  replaced: WeightEntry | null;
  /** The date's entry afterwards. */
  entry: WeightEntry;
}

/**
 * Sets the weight for one date ("YYYY-MM-DD"), in the profile's unit, rounded to 0.1. A date has at most
 * one entry, so an existing entry on that date is replaced (it keeps its id).
 */
export function overrideDay(entries: WeightEntry[], date: string, weight: number, id: string): DayOverride {
  const replaced = entries.find((e) => e.date === date) ?? null;
  const entry = replaced ? { ...replaced, weight: round1(weight) } : makeEntry(id, date, weight);
  const others = entries.filter((e) => e.date !== date);
  return { entries: [...others, entry].sort((a, b) => a.date.localeCompare(b.date)), replaced, entry };
}
