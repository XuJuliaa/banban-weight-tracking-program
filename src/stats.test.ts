import { describe, expect, it } from 'vitest';
import { chartPeriod, linearSlope, loggingFrequency30d, slopeSeries, movingAverage, movingAverageSeries, weightSeries } from './stats';
import type { WeightPoint } from './types';

// "Now" is 2026-10-11 at 12:00 local time. Months are 0-based in Date.
const NOW = new Date(2026, 9, 11, 12, 0).getTime();

let nextId = 0;
function entry(day: number, hour: number, weight: number, month = 9): WeightPoint {
  return { id: String(nextId++), timestamp: new Date(2026, month, day, hour).getTime(), weight };
}

describe('movingAverage', () => {
  it('returns null with no entries', () => {
    expect(movingAverage([], NOW, 10)).toBeNull();
  });

  it('averages one value per day', () => {
    const entries = [entry(11, 8, 60), entry(10, 8, 62), entry(9, 8, 64)];
    expect(movingAverage(entries, NOW, 10)).toBe(62);
  });

  it('averages several entries on the same day before averaging days', () => {
    // Oct 11: (60 + 70) / 2 = 65; Oct 10: 61. Result is (65 + 61) / 2 = 63, not (60+70+61)/3.
    const entries = [entry(11, 7, 60), entry(11, 11, 70), entry(10, 8, 61)];
    expect(movingAverage(entries, NOW, 10)).toBe(63);
  });

  it('includes the whole first day of the window and excludes the day before it', () => {
    // The window is Oct 2 – Oct 11.
    const entries = [entry(2, 0, 60), entry(1, 23, 100)];
    expect(movingAverage(entries, NOW, 10)).toBe(60);
  });

  it('ignores entries after now', () => {
    const entries = [entry(11, 8, 60), entry(11, 18, 100)];
    expect(movingAverage(entries, NOW, 10)).toBe(60);
  });

  it('handles gaps by averaging only the days that were logged', () => {
    const entries = [entry(11, 8, 60), entry(3, 8, 66)];
    expect(movingAverage(entries, NOW, 10)).toBe(63);
  });

  it('uses the number of days chosen in Settings', () => {
    const entries = [entry(11, 8, 60), entry(9, 8, 62), entry(5, 8, 70)];
    // 3 days: Oct 9–11; 7 days: Oct 5–11.
    expect(movingAverage(entries, NOW, 3)).toBe(61);
    expect(movingAverage(entries, NOW, 7)).toBe(64);
    expect(movingAverage(entries, NOW, 1)).toBe(60);
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
    const series = movingAverageSeries(entries, new Date(2026, 8, 30).getTime(), new Date(2026, 9, 2).getTime(), 10);
    expect(series.map((p) => p.y)).toEqual([null, 60, 61]);
  });

  it('returns null once the last entry falls out of the 10-day window', () => {
    const entries = [entry(1, 8, 60)];
    const series = movingAverageSeries(entries, new Date(2026, 9, 10).getTime(), new Date(2026, 9, 11).getTime(), 10);
    expect(series.map((p) => p.y)).toEqual([60, null]);
  });
});

describe('chartPeriod', () => {
  const day = (m: number, d: number) => new Date(2026, m - 1, d).getTime();
  const NOW = new Date(2026, 10, 24, 15).getTime();
  const dates = ['2026-11-20', '2026-03-02', '2026-10-01'];

  it('ends the past 90 days on the last weigh-in, not today', () => {
    expect(chartPeriod(dates, '90', NOW)).toEqual({ start: day(8, 23), end: day(11, 20) });
  });

  it('runs all time from the first weigh-in to the last', () => {
    expect(chartPeriod(dates, 'all', NOW)).toEqual({ start: day(3, 2), end: day(11, 20) });
  });

  it('shows the 90 days up to today when nothing is logged', () => {
    expect(chartPeriod([], '90', NOW)).toEqual({ start: day(8, 27), end: day(11, 24) });
    expect(chartPeriod([], 'all', NOW)).toEqual({ start: day(8, 27), end: day(11, 24) });
  });
});

describe('linearSlope', () => {
  const at = (day: number, hour = 12) => new Date(2026, 0, 1 + day, hour).getTime();

  it('fits a straight line by least squares, in units per calendar day', () => {
    expect(linearSlope([0, 1, 2].map((d) => ({ x: at(d), y: 80 - d })))).toBeCloseTo(-1, 9);
    // 70, 72, 71, 73 on four days: +0.8 a day.
    expect(linearSlope([70, 72, 71, 73].map((y, d) => ({ x: at(d), y })))).toBeCloseTo(0.8, 9);
    // The time of day doesn't matter, only the date (so daylight saving can't skew it).
    expect(linearSlope([{ x: at(0, 7), y: 80 }, { x: at(1, 23), y: 79 }])).toBeCloseTo(-1, 9);
  });

  it('needs at least two different days', () => {
    expect(linearSlope([])).toBeNull();
    expect(linearSlope([{ x: at(0), y: 70 }])).toBeNull();
    expect(linearSlope([{ x: at(0, 8), y: 70 }, { x: at(0, 20), y: 71 }])).toBeNull();
  });
});

describe('slopeSeries', () => {
  const DEFAULTS = { windowDays: 60, minDays: 18 };
  /** Local noon, `n` days after Jan 1, 2026: where a dated weigh-in sits. */
  const noon = (n: number) => new Date(2026, 0, 1 + n, 12).getTime();
  const midnight = (n: number) => new Date(2026, 0, 1 + n).getTime();
  /** Weigh-ins on days `days`, losing `perDay` a day from 200. */
  const logged = (days: number[], perDay = 1): WeightPoint[] => days.map((d) => ({ id: `d${d}`, timestamp: noon(d), weight: 200 - perDay * d }));
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

  it('gives the change over 30 days at the pace of the last 60 days: losing 1 a day is −30', () => {
    const points = slopeSeries(logged(range(0, 99)), midnight(80), midnight(99), DEFAULTS);
    expect(points).toHaveLength(20);
    for (const p of points) expect(p.y).toBeCloseTo(-30, 9);
  });

  it('needs weigh-ins on at least 18 of the 60 days ending on that date', () => {
    // 17 weigh-ins, then an 18th on day 59: the 60-day window for day 59 is days 0–59.
    const days = [...range(0, 16), 59];
    const points = slopeSeries(logged(days), midnight(0), midnight(59), DEFAULTS);
    expect(points.map((p) => p.y === null)).toEqual([...Array(17).fill(true), false]);
    expect(points.at(-1)!.y).toBeCloseTo(-30, 9);
    // A weigh-in on day 61: its window is days 2–61, so days 0 and 1 drop out and only 17 days are left.
    expect(slopeSeries(logged([...days, 61]), midnight(61), midnight(61), DEFAULTS)[0].y).toBeNull();
  });

  it('leaves weigh-ins older than 60 days out of the fit', () => {
    // A flat 200 on days 0–39, then losing 1 a day from day 40 to day 99: the window for day 99 is days 40–99.
    const entries: WeightPoint[] = range(0, 99).map((d) => ({ id: `d${d}`, timestamp: noon(d), weight: d < 40 ? 200 : 200 - (d - 40) }));
    expect(slopeSeries(entries, midnight(99), midnight(99), DEFAULTS)[0].y).toBeCloseTo(-30, 9);
  });

  it('has a point only on logged dates inside the range, using history from before it', () => {
    const entries = logged([...range(0, 39), 45, 50]);
    const points = slopeSeries(entries, midnight(42), midnight(50), DEFAULTS);
    expect(points.map((p) => p.x)).toEqual([noon(45), noon(50)]);
    // Both windows reach back before the range start (day 42) and have 40+ days logged.
    for (const p of points) expect(p.y).toBeCloseTo(-30, 9);
  });

  it('uses the window and minimum days chosen in Settings', () => {
    // Weigh-ins on days 0–14 losing 1 a day, then flat from day 15 to 29.
    const entries: WeightPoint[] = range(0, 29).map((d) => ({ id: `d${d}`, timestamp: noon(d), weight: d < 15 ? 200 - d : 186 }));
    // A 15-day window ending on day 29 only sees the flat part.
    expect(slopeSeries(entries, midnight(29), midnight(29), { windowDays: 15, minDays: 15 })[0].y).toBeCloseTo(0, 9);
    // Needing 16 of 15 days can never be met.
    expect(slopeSeries(entries, midnight(29), midnight(29), { windowDays: 15, minDays: 16 })[0].y).toBeNull();
    // A 30-day window sees both parts: a negative slope.
    expect(slopeSeries(entries, midnight(29), midnight(29), { windowDays: 30, minDays: 9 })[0].y).toBeLessThan(0);
  });

  it('is positive when gaining', () => {
    const points = slopeSeries(logged(range(0, 59), -0.1), midnight(59), midnight(59), DEFAULTS);
    expect(points[0].y).toBeCloseTo(3, 9);
  });
});
