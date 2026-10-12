import { describe, expect, it } from 'vitest';
import { formatPct, slicePath } from './pie';

describe('pie', () => {
  it('formats percents as whole numbers, with <1% for tiny slices', () => {
    expect(formatPct(24.4)).toBe('24%');
    expect(formatPct(9)).toBe('9%');
    expect(formatPct(0.4)).toBe('<1%');
    expect(formatPct(100)).toBe('100%');
  });

  it('draws a quarter slice from 12 to 3 o\'clock, and uses the large arc past half a turn', () => {
    expect(slicePath(0, Math.PI / 2, 100, 110, 110)).toBe('M110,110L110.00,10.00A100,100 0 0 1 210.00,110.00Z');
    expect(slicePath(0, Math.PI * 1.5, 100, 110, 110)).toContain('A100,100 0 1 1');
  });
});
