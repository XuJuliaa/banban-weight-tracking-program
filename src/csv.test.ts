import { describe, expect, it } from 'vitest';
import { parseCsvRows, parseTimestamp, parseWeightCsv, toWeightCsv } from './csv';
import type { UserData } from './types';

describe('parseTimestamp', () => {
  it('reads a timestamp without an offset as local time', () => {
    expect(parseTimestamp('2026-08-13T07:42:00')).toBe(new Date(2026, 7, 13, 7, 42).getTime());
    expect(parseTimestamp('2026-08-13 07:42')).toBe(new Date(2026, 7, 13, 7, 42).getTime());
  });

  it('reads a timestamp with an offset as that exact instant', () => {
    expect(parseTimestamp('2026-08-13T07:42:00Z')).toBe(Date.UTC(2026, 7, 13, 7, 42));
    expect(parseTimestamp('2026-08-13T07:42:00+02:00')).toBe(Date.UTC(2026, 7, 13, 5, 42));
  });

  it('reads dates the way Google Sheets exports them after a user edits the file', () => {
    expect(parseTimestamp('2026-08-13 7:42:00')).toBe(new Date(2026, 7, 13, 7, 42).getTime());
    expect(parseTimestamp('2026-8-3 7:42')).toBe(new Date(2026, 7, 3, 7, 42).getTime());
    expect(parseTimestamp('2026-08-13 7:42:00 PM')).toBe(new Date(2026, 7, 13, 19, 42).getTime());
    expect(parseTimestamp('2026-08-13 12:05 AM')).toBe(new Date(2026, 7, 13, 0, 5).getTime());
    expect(parseTimestamp('2026-08-13')).toBe(new Date(2026, 7, 13).getTime());
  });

  it('rejects impossible or malformed dates', () => {
    expect(parseTimestamp('2026-02-31T08:00:00')).toBeNull();
    expect(parseTimestamp('2026-08-13 25:00')).toBeNull();
    expect(parseTimestamp('2026-08-13 13:00 PM')).toBeNull();
    expect(parseTimestamp('13/08/2026 07:42')).toBeNull();
    expect(parseTimestamp('')).toBeNull();
  });
});

describe('parseWeightCsv', () => {
  const clean = { skipped: [], merged: [], needsCleanup: false };

  it('reads the current format: one row per date in the profile\'s unit', () => {
    const csv = 'date,weight_kg\n2026-08-13,70\n2026-08-14,69.9\n';
    expect(parseWeightCsv(csv, 'kg')).toEqual({
      entries: [
        { date: '2026-08-13', weight: 70 },
        { date: '2026-08-14', weight: 69.9 },
      ],
      fileUnit: 'kg',
      ...clean,
    });
  });

  it('converts a file in the other unit, rounded to 0.01, and asks for a rewrite', () => {
    const result = parseWeightCsv('date,weight_lb\n2026-08-13,154.3\n', 'kg');
    expect(result.entries).toEqual([{ date: '2026-08-13', weight: 69.99 }]);
    expect(result).toMatchObject({ fileUnit: 'lb', needsCleanup: true });
  });

  it('averages rows on the same date into one, rounded to 0.01', () => {
    const result = parseWeightCsv('date,weight_kg\n2026-08-13,70\n2026-08-14,69\n2026-08-13,70.25\n', 'kg');
    expect(result.entries).toEqual([
      { date: '2026-08-13', weight: 70.13 },
      { date: '2026-08-14', weight: 69 },
    ]);
    expect(result).toMatchObject({ merged: ['2026-08-13'], needsCleanup: true });
  });

  it('keeps 2 decimals as they are, and rounds and asks for a rewrite when there are more', () => {
    expect(parseWeightCsv('date,weight_kg\n2026-08-13,70.04\n', 'kg')).toMatchObject({ entries: [{ date: '2026-08-13', weight: 70.04 }], needsCleanup: false });
    const result = parseWeightCsv('date,weight_kg\n2026-08-13,70.046\n', 'kg');
    expect(result.entries).toEqual([{ date: '2026-08-13', weight: 70.05 }]);
    expect(result.needsCleanup).toBe(true);
  });

  it('reads a Google Sheets export: quoted decimal commas and blank rows', () => {
    const csv = 'date,weight_kg\r\n2026-08-13,"72,1"\r\n,\r\n';
    expect(parseWeightCsv(csv, 'kg')).toMatchObject({ entries: [{ date: '2026-08-13', weight: 72.1 }], needsCleanup: false });
  });

  it('requires a header with a date and a weight column', () => {
    expect(() => parseWeightCsv('2026-08-13,72.1\n', 'kg')).toThrow(/header/);
  });

  it('reads the older format with times and both units, dropping the times', () => {
    const csv = 'timestamp,weight_kg,weight_lb,entered_unit\n2026-08-13T07:42:00,70,154.32,kg\n2026-08-14T07:42:00,69.85,154,lb\n';
    expect(parseWeightCsv(csv, 'lb')).toMatchObject({
      entries: [
        { date: '2026-08-13', weight: 154.32 },
        { date: '2026-08-14', weight: 154 },
      ],
      fileUnit: 'kg',
      needsCleanup: true,
    });
  });

  it('averages several weigh-ins on one day from the older format', () => {
    const csv = 'timestamp,weight_kg,weight_lb,entered_unit\n2026-08-13T07:00:00,70,,kg\n2026-08-13T21:00:00,70.5,,kg\n';
    expect(parseWeightCsv(csv, 'kg')).toMatchObject({ entries: [{ date: '2026-08-13', weight: 70.25 }], merged: ['2026-08-13'] });
  });

  it('fills in a blank unit column by converting the other', () => {
    const csv = 'timestamp,weight_kg,weight_lb\n2026-08-13T07:42:00,70,\n2026-08-14T07:42:00,,154.32\n';
    expect(parseWeightCsv(csv, 'kg').entries).toEqual([
      { date: '2026-08-13', weight: 70 },
      { date: '2026-08-14', weight: 70 },
    ]);
  });

  it('reads the oldest single-weight format, in any column order', () => {
    const csv = 'Unit,Weight,Timestamp\nlb,154.32,2026-08-13T07:42:00\n,70,2026-08-14T07:42:00\nstone,11,2026-08-15T07:42:00\n';
    const result = parseWeightCsv(csv, 'kg');
    expect(result.entries).toEqual([
      { date: '2026-08-13', weight: 70 },
      { date: '2026-08-14', weight: 70 },
    ]);
    expect(result.skipped).toEqual([4]);
  });

  it('ignores blank lines and reports bad rows by line number', () => {
    const csv = 'date,weight_kg\r\n2026-08-13,72.1\r\n\r\nnot-a-date,70\r\n2026-08-14,-1\r\n';
    const result = parseWeightCsv(csv, 'kg');
    expect(result.entries).toHaveLength(1);
    expect(result.skipped).toEqual([4, 5]);
  });

  it('round-trips with toWeightCsv, one row per date, oldest first', () => {
    const user: UserData = {
      version: 1,
      userId: 'u1',
      name: 'Juju',
      unit: 'lb',
      entries: [
        { id: 'b', date: '2026-08-14', weight: 158.4 },
        { id: 'a', date: '2026-08-13', weight: 158.7 },
      ],
    };
    const csv = toWeightCsv(user);
    expect(csv).toBe('date,weight_lb\n2026-08-13,158.7\n2026-08-14,158.4\n');
    expect(parseWeightCsv(csv, 'lb')).toEqual({
      entries: [
        { date: '2026-08-13', weight: 158.7 },
        { date: '2026-08-14', weight: 158.4 },
      ],
      fileUnit: 'lb',
      ...clean,
    });
  });

  it('never writes two rows for one date', () => {
    const entries = [
      { id: 'a', date: '2026-08-13', weight: 70 },
      { id: 'b', date: '2026-08-13', weight: 71 },
    ];
    expect(toWeightCsv({ unit: 'kg', entries })).toBe('date,weight_kg\n2026-08-13,70.5\n');
    expect(toWeightCsv({ unit: 'lb', entries: [{ id: 'a', date: '2026-08-13', weight: 155.21 }] })).toBe('date,weight_lb\n2026-08-13,155.21\n');
  });
});

describe('parseCsvRows', () => {
  it('handles quoted commas, escaped quotes, line breaks, and CRLF', () => {
    expect(parseCsvRows('a,b\r\n1,"x, ""y""\nz"\r\n')).toEqual([['a', 'b'], ['1', 'x, "y"\nz']]);
  });
});
