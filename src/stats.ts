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

/** The weight chart's period: the past 90 days, or all time. */
export type ChartRange = '90' | 'all';
export const CHART_DAYS = 90;

/**
 * The weight chart's first and last days (local midnight) for weigh-ins on `dates` ("YYYY-MM-DD", any order).
 * Both periods end on the last weigh-in's date, not today: "90" is the 90 days up to it, "all" starts on the
 * first weigh-in. With nothing logged, it's the 90 days up to `now`.
 */
export function chartPeriod(dates: string[], range: ChartRange, now: number): { start: number; end: number } {
  const sorted = [...dates].sort();
  const dayOf = (date: string) => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  };
  const end = sorted.length ? dayOf(sorted[sorted.length - 1]) : startOfDay(now);
  const start = range === 'all' && sorted.length ? dayOf(sorted[0]) : addDays(end, -(CHART_DAYS - 1));
  return { start, end };
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

/** Whole calendar days from `from` to `to` (local dates), so daylight-saving shifts don't skew a fit. */
const daysBetween = (from: number, to: number) => Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);

/**
 * Least-squares slope of `points` (x in epoch ms), in y per calendar day. Null with fewer than two
 * different days, since there's no slope to fit.
 */
export function linearSlope(points: { x: number; y: number }[]): number | null {
  if (points.length < 2) return null;
  const xs = points.map((p) => daysBetween(points[0].x, p.x));
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = points.reduce((a, p) => a + p.y, 0) / points.length;
  let sxx = 0;
  let sxy = 0;
  xs.forEach((x, i) => {
    sxx += (x - meanX) ** 2;
    sxy += (x - meanX) * (points[i].y - meanY);
  });
  return sxx === 0 ? null : sxy / sxx;
}

/** The slope chart: a linear fit over the 60 calendar days ending on each weigh-in… */
export const SLOPE_WINDOW_DAYS = 60;
/** …shown only when at least 30% of those days (18 of 60) have a weigh-in… */
export const SLOPE_MIN_DAYS = Math.ceil(SLOPE_WINDOW_DAYS * 0.3);
/** …as the change over 30 days at that pace. */
export const SLOPE_PER_DAYS = 30;

/**
 * The 30-day pace for each weigh-in between the start of `startDay` and the end of `endDay`, oldest first:
 * the least-squares slope of the weigh-ins in the 60 calendar days ending on that weigh-in's date (which may
 * reach back before `startDay`), times 30. It's null (a gap in the line) when fewer than 18 of those days
 * have a weigh-in. Negative means losing weight.
 */
export function slopeSeries(entries: WeightPoint[], startDay: number, endDay: number): SeriesPoint[] {
  const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);
  return weightSeries(sorted, startDay, endDay).map((p) => {
    const from = windowStart(p.x, SLOPE_WINDOW_DAYS);
    const to = addDays(startOfDay(p.x), 1);
    const window = sorted.filter((e) => e.timestamp >= from && e.timestamp < to);
    const days = new Set(window.map((e) => dayKey(e.timestamp))).size;
    const slope = days >= SLOPE_MIN_DAYS ? linearSlope(window.map((e) => ({ x: e.timestamp, y: e.weight }))) : null;
    return { x: p.x, y: slope === null ? null : slope * SLOPE_PER_DAYS, id: p.id };
  });
}
