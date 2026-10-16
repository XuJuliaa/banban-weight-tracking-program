import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentSession, endSession, googleProfileName, loginRange, startSession, usernameProblem, weightMatches } from './accounts';
import { makeEntry } from './units';

const DAY = 24 * 60 * 60 * 1000;
const day = (n: number, hour = 8) => new Date(2026, 9, 1 + n, hour).getTime();
/** One weigh-in per day, in lb, starting on day 0. */
const loggedLb = (...lbs: number[]) => lbs.map((lb, i) => makeEntry(`e${i}`, day(i), lb, 'lb'));
const accepts = (entries: ReturnType<typeof loggedLb>, unit: 'kg' | 'lb', ...weights: number[]) =>
  weights.map((w) => weightMatches(entries, w, unit));

describe('accounts', () => {
  it('checks usernames', () => {
    expect(usernameProblem('Juju')).toBeNull();
    expect(usernameProblem('  ')).toMatch(/Enter/);
    expect(usernameProblem('!!!')).toMatch(/letter or number/);
  });

  it('uses whole numbers from the lowest (rounded down) to the highest (rounded up), both ends included', () => {
    const entries = loggedLb(120, 130, 126);
    expect(loginRange(entries, 'lb')).toEqual({ min: 120, max: 130 });
    expect(accepts(entries, 'lb', 120, 125, 130)).toEqual([true, true, true]);
    expect(accepts(entries, 'lb', 119.9, 130.1)).toEqual([false, false]);

    const close = loggedLb(130, 130.8);
    expect(loginRange(close, 'lb')).toEqual({ min: 130, max: 131 });
    expect(accepts(close, 'lb', 130, 130.5, 131)).toEqual([true, true, true]);
    expect(accepts(close, 'lb', 129.9, 131.1)).toEqual([false, false]);
  });

  it('allows the nearest whole number ± 1 with only one weigh-in', () => {
    const one = loggedLb(128.6);
    expect(loginRange(one, 'lb')).toEqual({ min: 128, max: 130 });
    expect(accepts(one, 'lb', 128, 129, 130)).toEqual([true, true, true]);
    expect(accepts(one, 'lb', 127.9, 130.1)).toEqual([false, false]);
    expect(loginRange(loggedLb(128.4), 'lb')).toEqual({ min: 127, max: 129 });
  });

  it('treats several weigh-ins on the same day like one day of logging', () => {
    const sameDay = [makeEntry('a', day(0, 7), 128.6, 'lb'), makeEntry('b', day(0, 21), 129.2, 'lb')];
    expect(loginRange(sameDay, 'lb')).toEqual({ min: 128, max: 130 });
    // A second day brings back the plain whole-number range.
    expect(loginRange([...sameDay, makeEntry('c', day(0, 7) + DAY, 129, 'lb')], 'lb')).toEqual({ min: 128, max: 130 });
    expect(loginRange(loggedLb(128.6, 129.2), 'lb')).toEqual({ min: 128, max: 130 });
    expect(loginRange(loggedLb(128.2, 128.6), 'lb')).toEqual({ min: 128, max: 129 });
  });

  it('applies the same rules in kg', () => {
    // 120, 130 and 126 lb are 54.43, 58.97 and 57.15 kg.
    const entries = loggedLb(120, 130, 126);
    expect(loginRange(entries, 'kg')).toEqual({ min: 54, max: 59 });
    expect(accepts(entries, 'kg', 54, 56.5, 59)).toEqual([true, true, true]);
    expect(accepts(entries, 'kg', 53.9, 59.1, NaN)).toEqual([false, false, false]);
  });

  it('lets a profile with no weigh-ins in, since there is nothing to check', () => {
    expect(loginRange([], 'kg')).toBeNull();
    expect(weightMatches([], NaN, 'kg')).toBe(true);
  });
});

describe('sessions', () => {
  afterEach(() => vi.unstubAllGlobals());
  const fakeSessionStorage = () => {
    const items = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
    });
    return items;
  };

  it('remembers the name and how the user logged in', () => {
    fakeSessionStorage();
    expect(currentSession()).toBeNull();
    startSession('Juliet', 'google');
    expect(currentSession()).toEqual({ name: 'Juliet', kind: 'google' });
    startSession('Juju');
    expect(currentSession()).toEqual({ name: 'Juju', kind: 'username' });
    endSession();
    expect(currentSession()).toBeNull();
  });

  it('reads a session saved as a plain name as a username login', () => {
    fakeSessionStorage().set('session', 'Juju');
    expect(currentSession()).toEqual({ name: 'Juju', kind: 'username' });
  });
});

describe('googleProfileName', () => {
  const none = () => false;

  it("uses the account's first name", () => {
    expect(googleProfileName('Juliet ShoeMaker', 'juliet@example.com', none)).toBe('Juliet');
    expect(googleProfileName('  Ana   Maria Lopez ', 'ana@example.com', none)).toBe('Ana');
  });

  it('falls back to the full name, then the email, when a username profile has the name', () => {
    const taken = (...names: string[]) => (n: string) => names.includes(n);
    expect(googleProfileName('Juliet ShoeMaker', 'jshoe@example.com', taken('Juliet'))).toBe('Juliet ShoeMaker');
    expect(googleProfileName('Juliet ShoeMaker', 'jshoe@example.com', taken('Juliet', 'Juliet ShoeMaker'))).toBe('jshoe');
  });

  it('uses the email when the account has no usable name', () => {
    expect(googleProfileName('', 'jshoe@example.com', none)).toBe('jshoe');
    expect(googleProfileName('—', 'jshoe@example.com', none)).toBe('jshoe');
  });
});
