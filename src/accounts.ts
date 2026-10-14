// Username + password logins, with no server: the password is checked on this device against a salted
// PBKDF2-SHA256 hash. The hash is kept in this browser and as <slug>-account.csv in the account's data
// folder, so the same login works from another browser that opens that folder. This keeps other people
// on the same computer out of a profile; it doesn't encrypt the CSV files.

import { get, set } from 'idb-keyval';
import { profileSlug } from './names';
import type { AccountRecord } from './profile-files';

export const PASSWORD_MIN = 8;
const ITERATIONS = 210_000;
const SESSION_KEY = 'session';
const accountKey = (slug: string) => `account:${slug}`;

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

/** A new account record for `name` with a fresh random salt. */
export async function createAccount(name: string, password: string, iterations = ITERATIONS): Promise<AccountRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, iterations);
  return { name: name.trim(), slug: profileSlug(name), salt: toBase64(salt), hash: toBase64(hash), iterations };
}

export async function verifyPassword(account: AccountRecord, password: string): Promise<boolean> {
  const actual = await derive(password, fromBase64(account.salt), account.iterations);
  const expected = fromBase64(account.hash);
  // Compare every byte, so the time taken doesn't depend on where they differ.
  let diff = actual.length ^ expected.length;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ (expected[i] ?? 0);
  return diff === 0;
}

/** Why a username can't be used, or null if it's fine. */
export function usernameProblem(name: string): string | null {
  if (!name.trim()) return 'Enter a username';
  if (!/[a-z0-9]/i.test(name)) return 'Use at least one letter or number in the username';
  return null;
}

export async function findAccount(slug: string): Promise<AccountRecord | undefined> {
  try {
    return await get<AccountRecord>(accountKey(slug));
  } catch {
    return undefined;
  }
}

export const saveAccount = (account: AccountRecord) => set(accountKey(account.slug), account);

/** The logged-in account's slug for this tab: survives a reload, ends when the tab or browser closes. */
export function currentSession(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function startSession(slug: string): void {
  try {
    sessionStorage.setItem(SESSION_KEY, slug);
  } catch {
    // Private mode can block storage; the login still works until the page is reloaded.
  }
}

export function endSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing was stored.
  }
}
