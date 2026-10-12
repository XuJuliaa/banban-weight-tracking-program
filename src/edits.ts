// Data changes made from the "Correct a weight" section. Pure functions; the page asks for
// confirmation (showing the returned summary) before saving the result.

import { dayKey, startOfDay } from './stats';
import type { WeightEntry, WeightUnit } from './types';
import { makeEntry } from './units';

export interface DayOverride {
  /** The profile's entries after the override. */
  entries: WeightEntry[];
  /** Entries on that date that will be replaced (empty when the date had none). */
  replaced: WeightEntry[];
  /** The single entry the date will have afterwards. */
  entry: WeightEntry;
}

/**
 * Sets the weight for one local calendar date: every entry on that date is replaced by a single
 * entry with `weight` (typed in `unit`, stored in both units). It keeps the time of the earliest
 * replaced entry; a date with no entries gets the current time if it's today, otherwise noon.
 */
export function overrideDay(
  entries: WeightEntry[],
  day: number,
  weight: number,
  unit: WeightUnit,
  now: number,
  id: string,
): DayOverride {
  const key = dayKey(day);
  const replaced = entries.filter((e) => dayKey(e.timestamp) === key).sort((a, b) => a.timestamp - b.timestamp);
  const timestamp = replaced[0]?.timestamp ?? (key === dayKey(now) ? now : new Date(startOfDay(day)).setHours(12, 0, 0, 0));
  const entry = makeEntry(id, timestamp, weight, unit);
  return { entries: [...entries.filter((e) => dayKey(e.timestamp) !== key), entry], replaced, entry };
}
