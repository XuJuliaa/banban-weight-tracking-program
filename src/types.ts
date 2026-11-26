export type WeightUnit = 'kg' | 'lb';

/**
 * The weight for one calendar date. A profile has at most one entry per date, and every weight is in
 * the profile's unit (UserData.unit). Switching the unit converts all entries.
 */
export interface WeightEntry {
  id: string;
  /** Local calendar date, "YYYY-MM-DD". No time of day is kept. */
  date: string;
  /** In the profile's unit. Typed weights are rounded to 0.1; converted or averaged ones keep up to 2 decimals. */
  weight: number;
}

/** A weight in one chosen unit, as the stats and charts use it. */
export interface WeightPoint {
  id?: string;
  timestamp: number;
  weight: number;
}

/** Everything stored for one user. Saved as a single IndexedDB record. */
export interface UserData {
  version: 1;
  userId: string;
  name: string;
  /** The unit every weight is stored, shown and typed in. Switching it converts all entries. */
  unit: WeightUnit;
  entries: WeightEntry[];
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
}
