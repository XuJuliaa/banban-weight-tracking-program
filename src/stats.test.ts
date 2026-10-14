import { describe, expect, it } from 'vitest';
import { loggingFrequency30d, movingAverage10d, movingAverageSeries, weightSeries } from './stats';
import type { WeightPoint } from './types';

// "Now" is 2026-10-11 at 12:00 local time. Months are 0-based in Date.
const NOW = new Date(2026, 9, 11, 12, 0).getTime();

let nextId = 0;
function entry(day: number, hour: number, weight: number, month = 9): WeightPoint {
  return { id: String(nextId++), timestamp: new Date(2026, month, day, hour).getTime(), weight };
}

describe('movingAverage10d', () => {
  it('returns null with no entries', () => {
    expect(movingAverage10d([], NOW)).toBeNull();
  });

  it('averages one value per day', () => {
    const entries = [entry(11, 8, 60), entry(10, 8, 62), entry(9, 8, 64)];
    expect(movingAverage10d(entries, NOW)).toBe(62);
  });

  it('averages several entries on the same day before averaging days', () => {
    // Oct 11: (60 + 70) / 2 = 65; Oct 10: 61. Result is (65 + 61) / 2 = 63, not (60+70+61)/3.
    const entries = [entry(11, 7, 60), entry(11, 11, 70), entry(10, 8, 61)];
    expect(movingAverage10d(entries, NOW)).toBe(63);
  });

  it('includes the whole first day of the window and excludes the day before it', () => {
    // The window is Oct 2 – Oct 11.
    const entries = [entry(2, 0, 60), entry(1, 23, 100)];
    expect(movingAverage10d(entries, NOW)).toBe(60);
  });

  it('ignores entries after now', () => {
    const entries = [entry(11, 8, 60), entry(11, 18, 100)];
    expect(movingAverage10d(entries, NOW)).toBe(60);
  });

  it('handles gaps by averaging only the days that were logged', () => {
    const entries = [entry(11, 8, 60), entry(3, 8, 66)];
    expect(movingAverage10d(entries, NOW)).toBe(63);
  });
});

describe('loggingFrequency30d', () => {
  it('reports zero with no entries', () => {
    expect(loggingFrequency30d([], NOW)).toEqual({ daysLogged: 0, totalDays: 30, pct: 0 });
  });

  it('counts each day once, however many entries it has', () => {
    const entries = [entry(11, 7, 60), entry(11, 9, 60), entry(10, 8, 60)];
    expect(loggingFrequency30d(entries, NOW).daysLogged).toBe(2);
  });

  it('includes the first day of the 30-day window and excludes the day before it', () => {
    // The window is Sep 12 – Oct 11.
    const entries = [entry(12, 0, 60, 8), entry(11, 23, 60, 8)];
    expect(loggingFrequency30d(entries, NOW).daysLogged).toBe(1);
  });

  it('computes the percentage', () => {
    const entries = Array.from({ length: 15 }, (_, i) => entry(11 - i, 8, 60));
    expect(loggingFrequency30d(entries, NOW)).toEqual({ daysLogged: 15, totalDays: 30, pct: 50 });
  });
});

describe('weightSeries', () => {
  it('keeps entries from the start of the first day to the end of the last day, oldest first', () => {
    const entries = [entry(5, 23, 63), entry(1, 0, 61), entry(30, 23, 99, 8), entry(6, 0, 99)];
    const series = weightSeries(entries, new Date(2026, 9, 1, 15).getTime(), new Date(2026, 9, 5).getTime());
    expect(series.map((p) => p.y)).toEqual([61, 63]);
  });
});

describe('movingAverageSeries', () => {
  it('gives one point per day, using each day as the end of its own window', () => {
    const entries = [entry(1, 8, 60), entry(2, 8, 62)];
    const series = movingAverageSeries(entries, new Date(2026, 8, 30).getTime(), new Date(2026, 9, 2).getTime());
    expect(series.map((p) => p.y)).toEqual([null, 60, 61]);
  });

  it('returns null once the last entry falls out of the 10-day window', () => {
    const entries = [entry(1, 8, 60)];
    const series = movingAverageSeries(entries, new Date(2026, 9, 10).getTime(), new Date(2026, 9, 11).getTime());
    expect(series.map((p) => p.y)).toEqual([60, null]);
  });
});
