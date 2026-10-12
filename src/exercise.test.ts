import { describe, expect, it } from 'vitest';
import {
  dailyMinutes,
  daysInRange,
  exerciseCategoryFromText,
  exerciseSummary,
  formatMinutes,
  validMinutes,
} from './exercise';
import type { ExerciseEntry } from './types';

const at = (d: number, h: number) => new Date(2026, 9, d, h).getTime();
const ex = (d: number, h: number, category: ExerciseEntry['category'], minutes: number, name = 'x'): ExerciseEntry => ({
  id: `${d}-${h}`,
  timestamp: at(d, h),
  name,
  category,
  minutes,
});

describe('exercise categories', () => {
  it('accepts labels and ids in any case, and rejects unknown or blank values', () => {
    expect(exerciseCategoryFromText('Cardio')).toBe('cardio');
    expect(exerciseCategoryFromText(' STRENGTH ')).toBe('strength');
    expect(exerciseCategoryFromText('yoga')).toBeNull();
    expect(exerciseCategoryFromText('')).toBeNull();
  });

  it('accepts durations from 1 minute to a full day', () => {
    expect(validMinutes(1)).toBe(true);
    expect(validMinutes(1440)).toBe(true);
    expect(validMinutes(0)).toBe(false);
    expect(validMinutes(1441)).toBe(false);
    expect(validMinutes(NaN)).toBe(false);
    expect(validMinutes('30')).toBe(false);
  });
});

describe('exerciseSummary', () => {
  const log = [
    ex(1, 7, 'cardio', 30),
    ex(1, 18, 'strength', 45),
    ex(3, 7, 'cardio', 40),
    ex(7, 23, 'cardio', 20), // last moment of the range
    ex(8, 0, 'cardio', 99), // just after the range
    ex(30, 9, 'flexibility', 15), // well outside
  ];

  it('totals minutes and sessions per category over whole calendar days, including empty categories', () => {
    const s = exerciseSummary(log, at(1, 12), at(7, 12));
    expect(s.days).toBe(7);
    expect(s.sessions).toBe(4);
    expect(s.minutes).toBe(135);
    expect(s.categories.map((c) => [c.id, c.minutes, c.sessions])).toEqual([
      ['cardio', 90, 3],
      ['strength', 45, 1],
      ['flexibility', 0, 0],
    ]);
    expect(s.categories[0].avgPerDay).toBeCloseTo(90 / 7);
  });

  it('counts a single day as one day', () => {
    expect(daysInRange(at(3, 1), at(3, 23))).toBe(1);
    expect(exerciseSummary(log, at(3, 0), at(3, 0)).categories[0].minutes).toBe(40);
  });
});

describe('dailyMinutes', () => {
  it('has one row per day, adds up same-day sessions, and fills rest days with 0', () => {
    const log = [ex(1, 7, 'cardio', 30, 'Run'), ex(1, 18, 'cardio', 15, 'Bike'), ex(2, 8, 'strength', 40), ex(3, 7, 'cardio', 25, 'Swim')];
    const days = dailyMinutes(log, 'cardio', at(1, 0), at(4, 0));
    expect(days.map((d) => d.minutes)).toEqual([45, 0, 25, 0]);
    expect(days[0].activities).toEqual(['Run', 'Bike']);
    expect(days.map((d) => new Date(d.day).getDate())).toEqual([1, 2, 3, 4]);
  });

  it('steps across a daylight-saving change one calendar day at a time', () => {
    const days = dailyMinutes([], 'cardio', new Date(2026, 2, 7).getTime(), new Date(2026, 2, 10).getTime());
    expect(days.map((d) => new Date(d.day).getDate())).toEqual([7, 8, 9, 10]);
    expect(days.every((d) => new Date(d.day).getHours() === 0)).toBe(true);
  });
});

describe('formatMinutes', () => {
  it('uses minutes under an hour and hours with minutes above', () => {
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(135)).toBe('2 h 15 min');
  });
});
