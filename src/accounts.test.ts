import { describe, expect, it } from 'vitest';
import { createAccount, usernameProblem, verifyPassword } from './accounts';
import { accountCsv, parseAccountCsv } from './profile-files';

// Few iterations keep the tests fast; the app uses 210,000.
const ROUNDS = 1000;

describe('accounts', () => {
  it('accepts the right password and refuses a wrong one', async () => {
    const account = await createAccount('Juju', 'correct horse', ROUNDS);
    expect(account).toMatchObject({ name: 'Juju', slug: 'juju', iterations: ROUNDS });
    expect(account.hash).not.toContain('correct');
    expect(await verifyPassword(account, 'correct horse')).toBe(true);
    expect(await verifyPassword(account, 'Correct horse')).toBe(false);
    expect(await verifyPassword(account, '')).toBe(false);
  });

  it('salts each account, so the same password gives a different hash', async () => {
    const a = await createAccount('Juju', 'same password', ROUNDS);
    const b = await createAccount('Juju', 'same password', ROUNDS);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('round-trips through <slug>-account.csv', async () => {
    const account = await createAccount('Ana, María', 'pass word 1', ROUNDS);
    const text = accountCsv(account);
    expect(text.startsWith('username,salt,hash,iterations\n"Ana, María",')).toBe(true);
    expect(parseAccountCsv(text, account.slug)).toEqual(account);
  });

  it('refuses an account file that is damaged or belongs to another name', async () => {
    const text = accountCsv(await createAccount('Juju', 'secret123', ROUNDS));
    expect(parseAccountCsv(text, 'someone-else')).toBeNull();
    expect(parseAccountCsv('', 'juju')).toBeNull();
    expect(parseAccountCsv('username,salt,hash,iterations\n', 'juju')).toBeNull();
    expect(parseAccountCsv('username,salt,hash,iterations\nJuju,not base64!,abc=,1000\n', 'juju')).toBeNull();
    expect(parseAccountCsv(text.replace(/,\d+\n$/, ',0\n'), 'juju')).toBeNull();
  });

  it('checks usernames', () => {
    expect(usernameProblem('Juju')).toBeNull();
    expect(usernameProblem('  ')).toMatch(/Enter/);
    expect(usernameProblem('!!!')).toMatch(/letter or number/);
  });
});
