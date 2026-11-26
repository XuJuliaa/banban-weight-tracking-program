import { describe, expect, it } from 'vitest';
import { monotonePath, monthLabel, monthTicks, niceTicks } from './chart';

/** Every number in the path's control points, as [x, y] pairs. */
function points(d: string): number[][] {
  return [...d.matchAll(/-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/g)].map((m) => m[0].split(',').map(Number));
}

describe('monotonePath', () => {
  it('draws straight segments for fewer than three points', () => {
    expect(monotonePath([{ x: 0, y: 10 }, { x: 10, y: 20 }])).toBe('M0.0,10.0L10.0,20.0');
  });

  it('passes through every point and never overshoots between them', () => {
    const pts = [
      { x: 0, y: 50 }, { x: 10, y: 40 }, { x: 20, y: 40 }, { x: 30, y: 10 }, { x: 40, y: 12 }, { x: 50, y: 60 },
    ];
    const d = monotonePath(pts);
    const coords = points(d);
    for (const p of pts) expect(coords).toContainEqual([p.x, p.y]);
    // Each cubic's control points stay within its segment's y range, so the curve can't bulge past the data.
    const segments = d.split('C').slice(1).map(points);
    segments.forEach(([c1, c2, end], i) => {
      const lo = Math.min(pts[i].y, end[1]);
      const hi = Math.max(pts[i].y, end[1]);
      for (const c of [c1, c2]) {
        expect(c[1]).toBeGreaterThanOrEqual(lo - 0.05);
        expect(c[1]).toBeLessThanOrEqual(hi + 0.05);
      }
    });
  });
});

describe('month axis', () => {
  const t = (y: number, m: number, d = 1) => new Date(y, m - 1, d).getTime();

  it("labels a month like Jan'26", () => {
    expect(monthLabel(t(2026, 1))).toBe("Jan'26");
    expect(monthLabel(t(2025, 12, 15))).toBe("Dec'25");
  });

  it('puts a tick on the first of each month in the range', () => {
    // The past 90 days up to Nov 20, 2026: Aug 23 – Nov 20.
    expect(monthTicks(t(2026, 8, 23), t(2026, 11, 20), 600)).toEqual([t(2026, 9), t(2026, 10), t(2026, 11)]);
    // A range starting on the 1st includes that month.
    expect(monthTicks(t(2026, 9, 1), t(2026, 10, 5), 600)).toEqual([t(2026, 9), t(2026, 10)]);
  });

  it('gives a range inside one month a single tick at its start', () => {
    expect(monthTicks(t(2026, 11, 3), t(2026, 11, 20), 600)).toEqual([t(2026, 11, 3)]);
  });

  it('skips months on long ranges so the labels fit', () => {
    // About three years: every 6 months (Jan and Jul) with room for 6 labels, yearly with room for 5.
    expect(monthTicks(t(2024, 1, 10), t(2026, 11, 20), 360).map(monthLabel)).toEqual(["Jul'24", "Jan'25", "Jul'25", "Jan'26", "Jul'26"]);
    expect(monthTicks(t(2024, 1, 10), t(2026, 11, 20), 300).map(monthLabel)).toEqual(["Jan'25", "Jan'26"]);
  });
});

describe('niceTicks', () => {
  it('covers the range with round steps, including 0 when it is part of the range', () => {
    // The slope chart adds 0 to its values, so the zero line is always on the axis.
    const ticks = niceTicks(-4.2, 0);
    expect(ticks[0]).toBeLessThanOrEqual(-4.2);
    expect(ticks).toContain(0);
    expect(niceTicks(-1.3, 2.1)).toContain(0);
  });
});
