import type { ExerciseCategoryId } from './exercise.ts';
import type { FoodCategoryId } from './food.ts';

export type WeightUnit = 'kg' | 'lb';

/**
 * One weigh-in, stored in both units. The unit it was entered in holds the exact value typed;
 * the other is converted from it and rounded to 0.01.
 */
export interface WeightEntry {
  id: string;
  /** Epoch milliseconds, taken from the device clock when the entry was saved. */
  timestamp: number;
  kg: number;
  lb: number;
  entered: WeightUnit;
}

/** A weight in one chosen unit, as the stats and charts use it. */
export interface WeightPoint {
  id?: string;
  timestamp: number;
  weight: number;
}

export interface FoodEntry {
  id: string;
  /** Epoch milliseconds, taken from the device clock when the entry was saved. */
  timestamp: number;
  text: string;
  /** Missing for entries logged before categories existed ("Uncategorized"). */
  category?: FoodCategoryId;
}

export interface ExerciseEntry {
  id: string;
  /** Epoch milliseconds, taken from the device clock when the entry was saved. */
  timestamp: number;
  /** What the user did, e.g. "Morning run". */
  name: string;
  category: ExerciseCategoryId;
  /** Duration in minutes. */
  minutes: number;
}

/** Everything stored for one user. Saved as a single IndexedDB record. */
export interface UserData {
  version: 1;
  userId: string;
  name: string;
  /** Unit the page shows weights in (and new weights are typed in). Switching it doesn't change stored data. */
  unit: WeightUnit;
  entries: WeightEntry[];
  /** Food log. Missing in data saved before food logging existed. */
  foods?: FoodEntry[];
  /** Exercise log. Missing in data saved before exercise logging existed. */
  exercises?: ExerciseEntry[];
  /** Epoch ms of the last save in this browser. */
  updatedAt?: number;
  /** Set for a profile opened with "Continue with Google": the account's email. Its data is saved in that Drive. */
  googleEmail?: string;
}

export interface ProfileSummary {
  userId: string;
  name: string;
  /** The Google account of a "Continue with Google" profile; such profiles can't be opened by username. */
  googleEmail?: string;
}

/** A profile as stored in the testdata/ CSV files (no browser id). */
export interface FileProfile {
  slug: string;
  name: string;
  unit: WeightUnit;
}

export interface FileProfileData extends FileProfile {
  entries: WeightEntry[];
  foods: FoodEntry[];
  exercises: ExerciseEntry[];
}
