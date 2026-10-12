import { describe, expect, it } from 'vitest';
import { barPath } from './bars';

describe('barPath', () => {
  it('rounds the top corners and keeps the base square on the axis', () => {
    expect(barPath(10, 20, 20, 100)).toBe('M10.0,120.0V24.0Q10.0,20.0 14.0,20.0H26.0Q30.0,20.0 30.0,24.0V120.0Z');
  });

  it('shrinks the corner radius for bars too thin or too short for it', () => {
    // 4px wide: radius 2. 1px tall: radius 1.
    expect(barPath(0, 0, 4, 10)).toContain('Q0.0,0.0 2.0,0.0');
    expect(barPath(0, 9, 20, 1)).toBe('M0.0,10.0V10.0Q0.0,9.0 1.0,9.0H19.0Q20.0,9.0 20.0,10.0V10.0Z');
  });
});
