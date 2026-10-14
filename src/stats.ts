import type { WeightPoint } from './types.ts';

export const MOVING_AVERAGE_DAYS = 10;
export const FREQUENCY_DAYS = 30;

/** Local calendar date key, e.g. "2026-10-11". */
export function dayKey(timestamp: number): string {
  const d = new Date(timestamp);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Local midnight that starts a window of `days` calendar days ending today
 * (today included). Uses setDate so daylight-saving shifts are handled.
 */
export function windowStart(now: number, days: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d.getTime();
}

function entriesInWindow(entries: WeightPoint[], now: number, days: number): WeightPoint[] {
  const start = windowStart(now, days);
  return entries.filter((e) => e.timestamp >= start && e.timestamp <= now);
}

/**
 * Average weight over the last 10 calendar days (today included).
 * Several entries on the same day are averaged first, so each day counts once.
 * Returns null when there are no entries in the window.
 */
export function movingAverage10d(entries: WeightPoint[], now: number): number | null {
  const byDay = new Map<string, number[]>();
  for (const e of entriesInWindow(entries, now, MOVING_AVERAGE_DAYS)) {
    const key = dayKey(e.timestamp);
    const list = byDay.get(key) ?? [];
    list.push(e.weight);
    byDay.set(key, list);
  }
  if (byDay.size === 0) return null;

  let sum = 0;
  for (const weights of byDay.values()) {
    sum += weights.reduce((a, b) => a + b, 0) / weights.length;
  }
  return sum / byDay.size;
}

export interface LoggingFrequency {
  daysLogged: number;
  totalDays: number;
  /** 0–100 */
  pct: number;
}

/** How many of the last 30 calendar days (today included) have at least one entry. */
export function loggingFrequency30d(entries: WeightPoint[], now: number): LoggingFrequency {
  const days = new Set(entriesInWindow(entries, now, FREQUENCY_DAYS).map((e) => dayKey(e.timestamp)));
  return {
    daysLogged: days.size,
    totalDays: FREQUENCY_DAYS,
    pct: (days.size / FREQUENCY_DAYS) * 100,
  };
}

export interface SeriesPoint {
  /** Epoch ms. */
  x: number;
  /** null breaks the line (no data for that point). */
  y: number | null;
  /** Entry id, for points that are single entries. */
  id?: string;
}

/** Local midnight of the day containing `timestamp`. */
export function startOfDay(timestamp: number): number {
  const d = new Date(timestamp);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(timestamp: number, days: number): number {
  const d = new Date(timestamp);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** Raw entries between the start of `startDay` and the end of `endDay`, oldest first. */
export function weightSeries(entries: WeightPoint[], startDay: number, endDay: number): SeriesPoint[] {
  const from = startOfDay(startDay);
  const to = addDays(startOfDay(endDay), 1);
  return entries
    .filter((e) => e.timestamp >= from && e.timestamp < to)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((e) => ({ x: e.timestamp, y: e.weight, id: e.id }));
}

/**
 * The 10-day moving average as it stood at the end of each day from `startDay` to `endDay`.
 * Days with no entries in their 10-day window are null.
 */
export function movingAverageSeries(entries: WeightPoint[], startDay: number, endDay: number): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  const last = startOfDay(endDay);
  for (let day = startOfDay(startDay); day <= last; day = addDays(day, 1)) {
    const endOfDay = addDays(day, 1) - 1;
    points.push({ x: day, y: movingAverage10d(entries, endOfDay) });
  }
  return points;
}

const DAY_MS = 86_400_000;

/** Number of calendar days from `startDay` to `endDay`, both included (a 30-day preset gives 30). */
export function daysInRange(startDay: number, endDay: number): number {
  return Math.round((startOfDay(endDay) - startOfDay(startDay)) / DAY_MS) + 1;
}

export interface Trend {
  /** Change per day, in the points' unit. */
  slopePerDay: number;
  /** The fitted line's value at `x` (epoch ms). */
  at: (x: number) => number;
}

/**
 * Least-squares straight line through the points (x in epoch ms). Null with fewer than two points,
 * or when they're all at the same moment (no slope to fit).
 */
export function linearTrend(points: { x: number; y: number }[]): Trend | null {
  if (points.length < 2) return null;
  const x0 = points[0].x;
  // Days from the first point, so the sums stay small and the slope comes out per day.
  const xs = points.map((p) => (p.x - x0) / DAY_MS);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = points.reduce((a, p) => a + p.y, 0) / points.length;
  let sxx = 0;
  let sxy = 0;
  xs.forEach((x, i) => {
    sxx += (x - meanX) ** 2;
    sxy += (x - meanX) * (points[i].y - meanY);
  });
  if (sxx === 0) return null;
  const slopePerDay = sxy / sxx;
  return { slopePerDay, at: (x) => meanY + slopePerDay * ((x - x0) / DAY_MS - meanX) };
}

const UNIT_WORDS = { kg: ['kilogram', 'kilograms'], lb: ['pound', 'pounds'] } as const;

/**
 * How much the trend line falls or rises from the first to the last of `points` (oldest first), or null
 * without a trend. Measured only where there are weigh-ins, so the line is never extended past the data.
 */
export function trendChange(trend: Trend | null, points: { x: number }[]): number | null {
  if (!trend || points.length < 2) return null;
  return trend.at(points[points.length - 1].x) - trend.at(points[0].x);
}

/**
 * The sentence above the weight chart, in whole numbers, e.g. "You have lost 3 pounds over the past 30
 * days. Congrats!" or "…gained… Work harder!!". `change` is from trendChange; `days` is the length of the chosen range. `endsToday` is false for
 * a range that ends before today, which reads "over these 30 days" instead.
 */
export function trendSentence(change: number | null, days: number, unit: 'kg' | 'lb', endsToday = true): string {
  if (change === null) return 'Log at least two weigh-ins in this period to see your trend.';
  const span = `${endsToday ? 'the past' : 'these'} ${days} ${days === 1 ? 'day' : 'days'}`;
  const amount = Math.round(Math.abs(change));
  if (amount === 0) return `You have held your weight steady over ${span}.`;
  const [one, many] = UNIT_WORDS[unit];
  return change < 0
    ? `You have lost ${amount} ${amount === 1 ? one : many} over ${span}. Congrats!`
    : `You have gained ${amount} ${amount === 1 ? one : many} over ${span}. Work harder!!`;
}
