import { describe, expect, it } from 'vitest';
import { daysInRange, daysToUnlock, linearTrend, loggingFrequency30d, movingAverage10d, movingAverageSeries, trendChange, trendSentence, weightSeries } from './stats';
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

describe('daysToUnlock', () => {
  // One weigh-in on each of the last `n` days, Oct 11 backwards (day 0 and below roll into September).
  const loggedDays = (n: number) => Array.from({ length: n }, (_, i) => entry(11 - i, 8, 60));
  const missing = (entries: WeightPoint[]) => daysToUnlock(loggingFrequency30d(entries, NOW));

  it('unlocks at exactly 80% (24 of 30 days) and above', () => {
    expect(missing(loggedDays(24))).toBe(0);
    expect(missing(loggedDays(30))).toBe(0);
  });

  it('counts the days still needed below 80%', () => {
    expect(missing(loggedDays(23))).toBe(1);
    expect(missing(loggedDays(19))).toBe(5);
    expect(missing([])).toBe(24);
  });

  it('counts a day with several weigh-ins once', () => {
    const entries = [...loggedDays(23), entry(11, 20, 61), entry(11, 21, 62)];
    expect(missing(entries)).toBe(1);
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

describe('linearTrend and trendSentence', () => {
  const DAY = 86_400_000;
  const at = (day: number, hour = 8) => new Date(2026, 9, 1 + day, hour).getTime();

  it('fits a straight line by least squares', () => {
    // 80, 79, 78 kg on three days: exactly -1 kg/day.
    const trend = linearTrend([0, 1, 2].map((d) => ({ x: at(d), y: 80 - d })))!;
    expect(trend.slopePerDay).toBeCloseTo(-1, 6);
    expect(trend.at(at(0))).toBeCloseTo(80, 6);
    expect(trend.at(at(2))).toBeCloseTo(78, 6);
    // Noisy data: the line goes between the points.
    const noisy = linearTrend([
      { x: at(0), y: 70 },
      { x: at(1), y: 72 },
      { x: at(2), y: 71 },
      { x: at(3), y: 73 },
    ])!;
    expect(noisy.slopePerDay).toBeCloseTo(0.8, 6);
    expect(noisy.at(at(0))).toBeCloseTo(70.3, 6);
  });

  it('needs at least two moments in time', () => {
    expect(linearTrend([])).toBeNull();
    expect(linearTrend([{ x: at(0), y: 70 }])).toBeNull();
    expect(linearTrend([{ x: at(0), y: 70 }, { x: at(0), y: 71 }])).toBeNull();
  });

  it('counts the days in a range, both ends included', () => {
    expect(daysInRange(at(0), at(29))).toBe(30);
    expect(daysInRange(at(5), at(5, 20))).toBe(1);
    expect(daysInRange(at(0) - 300 * DAY, at(0))).toBe(301);
  });

  it('measures the change along the trend line from the first to the last weigh-in only', () => {
    const points = [
      { x: at(0), y: 130 },
      { x: at(10), y: 128 },
      { x: at(20), y: 126.5 },
    ];
    const change = trendChange(linearTrend(points), points)!;
    expect(change).toBeCloseTo(-3.5, 6);
    expect(trendChange(null, points)).toBeNull();
  });

  it('says lost or gained, in whole numbers and the chosen unit', () => {
    expect(trendSentence(-7.6, 30, 'lb')).toBe('You have lost 8 pounds over the past 30 days. Congrats!');
    expect(trendSentence(2.5, 30, 'kg')).toBe('You have gained 3 kilograms over the past 30 days. Work harder!!');
    expect(trendSentence(1.2, 10, 'kg')).toBe('You have gained 1 kilogram over the past 10 days. Work harder!!');
    expect(trendSentence(-0.4, 4, 'kg')).toBe('You have held your weight steady over the past 4 days.');
    expect(trendSentence(2.5, 30, 'kg', false)).toBe('You have gained 3 kilograms over these 30 days. Work harder!!');
    expect(trendSentence(null, 30, 'kg')).toBe('Log at least two weigh-ins in this period to see your trend.');
  });
});
