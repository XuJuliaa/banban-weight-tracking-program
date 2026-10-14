// Logging in by username: a username is a profile name, so logging in opens that profile from its data folder.
// Instead of a password, the user types a weight close to what they've logged (see loginRange).
// The session only remembers who is logged in on this tab.

import { dayKey } from './stats';
import type { WeightEntry, WeightUnit } from './types';

const SESSION_KEY = 'session';

/**
 * The weights (in `unit`, both ends included) that unlock a profile, or null when nothing is logged yet.
 * Whole numbers only: from the lowest weigh-in rounded down to the highest rounded up, so 130 and 130.8
 * give 130–131. With weigh-ins on just one day, it's also at least the nearest whole number ± 1, so a
 * single 128.6 gives 128–130.
 */
export function loginRange(entries: WeightEntry[], unit: WeightUnit): { min: number; max: number } | null {
  if (!entries.length) return null;
  const weights = entries.map((e) => e[unit]);
  const low = Math.min(...weights);
  const high = Math.max(...weights);
  let min = Math.floor(low);
  let max = Math.ceil(high);
  if (new Set(entries.map((e) => dayKey(e.timestamp))).size < 2) {
    min = Math.min(min, Math.round(low) - 1);
    max = Math.max(max, Math.round(high) + 1);
  }
  return { min, max };
}

/** True when `weight` (in `unit`) is in the login range; also true when nothing is logged yet, as there's nothing to check. */
export function weightMatches(entries: WeightEntry[], weight: number, unit: WeightUnit): boolean {
  const range = loginRange(entries, unit);
  if (!range) return true;
  return Number.isFinite(weight) && weight >= range.min && weight <= range.max;
}

/** Why a username can't be used, or null if it's fine. */
export function usernameProblem(name: string): string | null {
  if (!name.trim()) return 'Enter a username';
  if (!/[a-z0-9]/i.test(name)) return 'Use at least one letter or number in the username';
  return null;
}

/** The username logged in on this tab: survives a reload, ends when the tab or browser closes. */
export function currentSession(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function startSession(name: string): void {
  try {
    sessionStorage.setItem(SESSION_KEY, name);
  } catch {
    // Private mode can block storage; the login still works until the page is reloaded.
  }
}

export function endSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing was stored.
  }
}
