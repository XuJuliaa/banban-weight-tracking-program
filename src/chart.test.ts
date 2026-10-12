import { describe, expect, it } from 'vitest';
import { monotonePath } from './chart';

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
