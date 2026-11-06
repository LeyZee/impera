import { z } from 'zod';

import type { Server } from '../../server';

import { secretOf, totpCode } from './totp';

export const DASHBOARD_ORIGIN = 'http://localhost:5173';

/** The authenticator secret of each account the helpers activated, by e-mail (a test database lives per file). */
const secrets = new Map<string, string>();

const SetupSchema = z.object({ totpURI: z.string(), backupCodes: z.array(z.string()) });

/** The `name=value` pairs of a response's cookies, to send back as one `cookie` header. */
export function cookiesOf(headers: Record<string, unknown>): string {
  const setCookie = headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : [typeof setCookie === 'string' ? setCookie : ''];
  return cookies
    .map((cookie: unknown) => (typeof cookie === 'string' ? cookie.split(';')[0] : ''))
    .filter((pair) => pair !== '' && !pair?.endsWith('='))
    .join('; ');
}

async function post(server: Server, url: string, payload: Record<string, unknown>, cookie?: string) {
  return server.inject({
    method: 'POST',
    url,
    payload,
    headers: { origin: DASHBOARD_ORIGIN, ...(cookie === undefined ? {} : { cookie }) },
  });
}

function expectOk(response: { statusCode: number; body: string }, step: string): void {
  if (response.statusCode !== 200) {
    throw new Error(`${step} failed with ${String(response.statusCode)}: ${response.body}`);
  }
}

/** The codes each account has given, with when the server forgets them (recette SEC-03: a code is taken once). */
const given = new Map<string, Map<string, number>>();
/** How long the server remembers a code taken (`SPENT_CODE_SECONDS`, auth.ts), with a margin. */
const REMEMBERED_MS = 125_000;
const PERIOD_MS = 30_000;

/** Waits without the event loop: between two requests, nothing of the server runs meanwhile. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Takes the first code the server accepts now (this period, the next, the one before) that this account never gave. */
function freshCode(email: string, secret: string): string {
  const taken = given.get(email) ?? new Map<string, number>();
  given.set(email, taken);
  for (;;) {
    const now = Date.now();
    for (const offset of [0, 1, -1]) {
      const code = totpCode(secret, offset, now);
      if ((taken.get(code) ?? 0) <= now) {
        taken.set(code, now + REMEMBERED_MS);
        return code;
      }
    }
    // As a person would: the three codes accepted now are spent, the next period brings a new one.
    pause(PERIOD_MS - (now % PERIOD_MS) + 50);
  }
}

/**
 * A code of the account's authenticator it has not given yet, as a person types the one their app shows (recette
 * SEC-03: the server takes each code once); `offset` asks for the code that many periods away, untracked, for a test
 * that needs one exact code. Throws for an account the helpers never activated.
 */
export function codeFor(email: string, offset?: number): string {
  const secret = secrets.get(email);
  if (secret === undefined) throw new Error(`no authenticator for ${email}`);
  return offset === undefined ? freshCode(email, secret) : totpCode(secret, offset);
}

/**
 * Activates the second factor on a session of an account that has none yet (ADR 0046): the password, the secret, the
 * first code. Returns the cookie of the session the activation leaves, and the backup codes.
 */
export async function activateSecondFactor(
  server: Server,
  email: string,
  password: string,
  cookie: string,
): Promise<{ cookie: string; backupCodes: readonly string[] }> {
  const enabled = await post(server, '/v1/auth/two-factor/enable', { password }, cookie);
  expectOk(enabled, 'two-factor enable');
  const setup = SetupSchema.parse(enabled.json());
  const secret = secretOf(setup.totpURI);
  secrets.set(email, secret);
  const verified = await post(server, '/v1/auth/two-factor/verify-totp', { code: codeFor(email) }, cookie);
  expectOk(verified, 'two-factor activation');
  return { cookie: cookiesOf(verified.headers), backupCodes: setup.backupCodes };
}

/**
 * Signs in through the dashboard's own routes, code included, and returns the `cookie` header to send afterwards. An
 * account without a second factor activates one on the way (every account has one, ADR 0046), so the session it
 * returns opens every route its role allows; the password and the code were just given, so a sensitive action passes.
 */
export async function signIn(server: Server, email: string, password: string): Promise<string> {
  const response = await post(server, '/v1/auth/sign-in/email', { email, password });
  expectOk(response, 'Sign-in');
  const cookie = cookiesOf(response.headers);
  const body: unknown = response.json();
  if (typeof body === 'object' && body !== null && 'twoFactorRedirect' in body) {
    const verified = await post(server, '/v1/auth/two-factor/verify-totp', { code: codeFor(email) }, cookie);
    expectOk(verified, 'Sign-in code');
    return cookiesOf(verified.headers);
  }
  await activateSecondFactor(server, email, password, cookie);
  const again = await post(server, '/v1/auth/sign-in/email', { email, password });
  expectOk(again, 'Sign-in after activation');
  const verified = await post(
    server,
    '/v1/auth/two-factor/verify-totp',
    { code: codeFor(email) },
    cookiesOf(again.headers),
  );
  expectOk(verified, 'Sign-in code');
  return cookiesOf(verified.headers);
}

/** Signs in with the password only: the session of an account whose second factor is not active yet. */
export async function signInWithoutCode(server: Server, email: string, password: string): Promise<string> {
  const response = await post(server, '/v1/auth/sign-in/email', { email, password });
  expectOk(response, 'Sign-in');
  return cookiesOf(response.headers);
}
