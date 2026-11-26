import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, parseSetting, slopeMinDays, validSettings } from './settings';

describe('settings', () => {
  it('defaults to coral, a 10-day average and a 60-day slope needing 30% of days', () => {
    expect(DEFAULT_SETTINGS).toEqual({ palette: 'coral', averageDays: 10, slopeDays: 60, slopeMinPct: 30 });
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values, from numbers or CSV text, and replaces invalid ones with their defaults', () => {
    expect(normalizeSettings({ palette: 'mint', averageDays: '7', slopeDays: 30, slopeMinPct: ' 50 ' })).toEqual({
      palette: 'mint',
      averageDays: 7,
      slopeDays: 30,
      slopeMinPct: 50,
    });
    expect(normalizeSettings({ palette: 'neon', averageDays: 0, slopeDays: 13, slopeMinPct: 101 })).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ averageDays: 7.5, slopeDays: 'abc', slopeMinPct: '' })).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ palette: 'indigo' }).palette).toBe('blue');
  });

  it('accepts whole numbers in each range, both ends included', () => {
    expect([parseSetting('averageDays', '1'), parseSetting('averageDays', '90'), parseSetting('averageDays', '91')]).toEqual([1, 90, null]);
    expect([parseSetting('slopeDays', '14'), parseSetting('slopeDays', '365'), parseSetting('slopeDays', '13')]).toEqual([14, 365, null]);
    expect([parseSetting('slopeMinPct', '5'), parseSetting('slopeMinPct', '100'), parseSetting('slopeMinPct', '4')]).toEqual([5, 100, null]);
    expect(parseSetting('averageDays', '2.5')).toBeNull();
  });

  it('checks a whole settings object before it is saved', () => {
    expect(validSettings(DEFAULT_SETTINGS)).toBe(true);
    expect(validSettings({ ...DEFAULT_SETTINGS, slopeMinPct: 0 })).toBe(false);
    expect(validSettings({ palette: 'coral' })).toBe(false);
    expect(validSettings(null)).toBe(false);
  });

  it('turns the threshold percent into logged days, rounding up', () => {
    expect(slopeMinDays(DEFAULT_SETTINGS)).toBe(18);
    expect(slopeMinDays({ slopeDays: 30, slopeMinPct: 50 })).toBe(15);
    expect(slopeMinDays({ slopeDays: 14, slopeMinPct: 30 })).toBe(5);
    expect(slopeMinDays({ slopeDays: 365, slopeMinPct: 100 })).toBe(365);
  });
});
