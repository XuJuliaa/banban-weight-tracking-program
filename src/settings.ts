// A profile's settings, kept with the profile in profiles.csv so they follow it to any browser or device.
// The kg/lb unit is a setting too, but it lives on UserData.unit because switching it converts the weights.

import { PALETTES, type Palette } from './theme.ts';

export interface ProfileSettings {
  /** Color scheme. */
  palette: Palette;
  /** Days in the trailing average shown on the stat card and the weight chart. */
  averageDays: number;
  /** Days in the window each slope point is fitted over. */
  slopeDays: number;
  /** Share of the slope window (percent) that needs a weigh-in before a slope is shown. */
  slopeMinPct: number;
}

export const DEFAULT_SETTINGS: ProfileSettings = { palette: 'coral', averageDays: 10, slopeDays: 60, slopeMinPct: 30 };

/** Allowed values for the number settings, whole numbers, both ends included. */
export const SETTING_RANGES = {
  averageDays: { min: 1, max: 90 },
  slopeDays: { min: 14, max: 365 },
  slopeMinPct: { min: 5, max: 100 },
} as const;

export type NumberSetting = keyof typeof SETTING_RANGES;

export const isPalette = (value: unknown): value is Palette => typeof value === 'string' && value in PALETTES;

/** True when `value` is a whole number in the setting's range. */
export function validSetting(key: NumberSetting, value: unknown): value is number {
  const { min, max } = SETTING_RANGES[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** Reads a number setting from a number or a CSV cell; null if it isn't a whole number in range. */
export function parseSetting(key: NumberSetting, value: unknown): number | null {
  const n = typeof value === 'string' ? (value.trim() === '' ? NaN : Number(value.trim())) : value;
  return validSetting(key, n) ? n : null;
}

/** Settings from a stored record or a profiles.csv row: anything missing or invalid takes its default. */
export function normalizeSettings(raw: unknown): ProfileSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const palette = r.palette === 'indigo' ? 'blue' : r.palette; // renamed theme
  return {
    palette: isPalette(palette) ? palette : DEFAULT_SETTINGS.palette,
    averageDays: parseSetting('averageDays', r.averageDays) ?? DEFAULT_SETTINGS.averageDays,
    slopeDays: parseSetting('slopeDays', r.slopeDays) ?? DEFAULT_SETTINGS.slopeDays,
    slopeMinPct: parseSetting('slopeMinPct', r.slopeMinPct) ?? DEFAULT_SETTINGS.slopeMinPct,
  };
}

/** True when `raw` is a complete, valid settings object (for checking records before they're written). */
export function validSettings(raw: unknown): raw is ProfileSettings {
  const r = raw as Partial<ProfileSettings> | null;
  return (
    !!r &&
    isPalette(r.palette) &&
    validSetting('averageDays', r.averageDays) &&
    validSetting('slopeDays', r.slopeDays) &&
    validSetting('slopeMinPct', r.slopeMinPct)
  );
}

/** Logged days a slope needs: the threshold percent of the window, rounded up (30% of 60 is 18). */
export const slopeMinDays = (s: Pick<ProfileSettings, 'slopeDays' | 'slopeMinPct'>) => Math.ceil((s.slopeDays * s.slopeMinPct) / 100);
