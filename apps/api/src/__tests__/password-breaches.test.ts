import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { breachCountOf, createPwnedPasswordsCheck, PasswordCheckUnavailable } from '../password-breaches';

const PASSWORD = 'une phrase de passe inventée';
const SHA1 = createHash('sha1').update(PASSWORD).digest('hex').toUpperCase();

function answering(body: string, status = 200) {
  const calls: string[] = [];
  const fetch = (url: string) => {
    calls.push(url);
    return Promise.resolve(new Response(body, { status }));
  };
  return { calls, fetch };
}

describe('password breach check (ADR 0046 § 4)', () => {
  it('sends only the first five characters of the SHA-1, never the password', async () => {
    const service = answering(`${SHA1.slice(5)}:3\r\n0000000000000000000000000000000000A:0`);
    const check = createPwnedPasswordsCheck({ fetch: service.fetch });
    await expect(check(PASSWORD)).resolves.toBe(true);
    expect(service.calls).toEqual([`https://api.pwnedpasswords.com/range/${SHA1.slice(0, 5)}`]);
    expect(service.calls[0]).not.toContain(SHA1.slice(5));
  });

  it('accepts a password whose suffix is absent or only padding', async () => {
    const absent = createPwnedPasswordsCheck({
      fetch: answering('0000000000000000000000000000000000A:2').fetch,
    });
    await expect(absent(PASSWORD)).resolves.toBe(false);
    const padding = createPwnedPasswordsCheck({ fetch: answering(`${SHA1.slice(5).toLowerCase()}:0`).fetch });
    await expect(padding(PASSWORD)).resolves.toBe(false);
  });

  it('refuses rather than accepts when the service cannot answer', async () => {
    const down = createPwnedPasswordsCheck({ fetch: answering('', 503).fetch });
    await expect(down(PASSWORD)).rejects.toBeInstanceOf(PasswordCheckUnavailable);
    const unreachable = createPwnedPasswordsCheck({ fetch: () => Promise.reject(new Error('offline')) });
    await expect(unreachable(PASSWORD)).rejects.toMatchObject({ code: 'service_unavailable' });
    const garbled = createPwnedPasswordsCheck({ fetch: answering(`${SHA1.slice(5)}:many`).fetch });
    await expect(garbled(PASSWORD)).rejects.toBeInstanceOf(PasswordCheckUnavailable);
  });

  it('reads counts line by line', () => {
    expect(breachCountOf('AAA:1\nBBB:42\n', 'BBB')).toBe(42);
    expect(breachCountOf('AAA:1', 'BBB')).toBe(0);
  });
});
