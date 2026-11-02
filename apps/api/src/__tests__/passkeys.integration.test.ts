import { AccountsSecuritySchema, PasskeySchema, PasskeysSchema } from '@nirvana/contracts';
import { and, eq, schema, sql } from '@nirvana/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { resetAccountSecondFactor } from '../ops';

import { FakePasskey } from './support/fake-passkey';
import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';
import { cookiesOf, DASHBOARD_ORIGIN } from './support/sign-in';

/**
 * Passkeys (ADR 0053, CR-01 lot c): added after a fresh confirmation, a sign-in by one gesture, a sensitive action
 * confirmed by a gesture, the alerts, the refusals that count, and every way keys are removed. The phone is a key pair
 * in memory (`FakePasskey`); every account is invented.
 */

const LAPTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const PHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

const ErrorBodySchema = z.object({ error: z.object({ code: z.string() }) });
const codeOf = (response: { body: string }) => ErrorBodySchema.parse(JSON.parse(response.body)).error.code;
const OptionsSchema = z.looseObject({ challenge: z.string(), userVerification: z.string().optional() });

/** Merges the cookies a response sets into the ones already held (a later value wins). */
function withCookies(held: string, headers: Record<string, unknown>): string {
  const pairs = new Map<string, string>();
  for (const pair of [...held.split('; '), ...cookiesOf(headers).split('; ')]) {
    const at = pair.indexOf('=');
    if (at > 0) pairs.set(pair.slice(0, at), pair.slice(at + 1));
  }
  return [...pairs].map(([name, value]) => `${name}=${value}`).join('; ');
}

describe('passkeys (ADR 0053)', () => {
  let team: PayrollTeam;

  const request = (
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    cookie: string,
    options: { payload?: object; userAgent?: string; remoteAddress?: string } = {},
  ) =>
    team.server.inject({
      method,
      url: `/v1${url}`,
      remoteAddress: options.remoteAddress ?? '192.0.2.20',
      headers: {
        origin: DASHBOARD_ORIGIN,
        'user-agent': options.userAgent ?? PHONE,
        ...(cookie === '' ? {} : { cookie }),
      },
      ...(options.payload === undefined ? {} : { payload: options.payload }),
    });

  /** Adds `key` on the session `cookie` (its password and code just confirmed), as the phone's Safari. */
  const add = async (cookie: string, key: FakePasskey, gesture: { verified?: boolean } = {}) => {
    const options = await request('GET', '/auth/passkey/generate-register-options', cookie);
    expect(options.statusCode, options.body).toBe(200);
    expect(OptionsSchema.parse(options.json())).toMatchObject({
      authenticatorSelection: { userVerification: 'required', residentKey: 'required' },
    });
    return request('POST', '/auth/passkey/verify-registration', withCookies(cookie, options.headers), {
      payload: { response: key.register(options.json(), gesture) },
    });
  };

  /** A sign-in by a gesture of `key`, from a browser without a session. */
  const signInWith = async (
    key: FakePasskey,
    gesture: { verified?: boolean; forge?: boolean; origin?: string } = {},
    remoteAddress = '192.0.2.30',
  ) => {
    const options = await request('GET', '/auth/passkey/generate-authenticate-options', '', {
      remoteAddress,
    });
    expect(options.statusCode, options.body).toBe(200);
    const parsed = OptionsSchema.parse(options.json());
    expect(parsed.userVerification).toBe('required');
    return request('POST', '/auth/passkey/verify-authentication', cookiesOf(options.headers), {
      payload: { response: key.assert(parsed, gesture) },
      remoteAddress,
    });
  };

  const alerts = async (reason: string) =>
    (
      await team.test.admin.db.execute<{ payload: { userId: string } }>(
        sql`select payload from domain_events where type = 'security_alert' and payload->>'reason' = ${reason}`,
      )
    ).rows;
  const keysOf = (userId: string) =>
    team.test.admin.db.select().from(schema.passkey).where(eq(schema.passkey.userId, userId));
  const confirmedAtOf = async (cookie: string) => {
    const token = /better-auth\.session_token=([^.;]+)/u.exec(cookie)?.[1];
    if (token === undefined) throw new Error('no session cookie');
    const [row] = await team.test.admin.db
      .select({ at: schema.session.reauthenticatedAt })
      .from(schema.session)
      .where(eq(schema.session.token, decodeURIComponent(token)));
    return row?.at ?? null;
  };
  /** Moves the session's confirmation by the password and the code `minutes` into the past. */
  const confirmedAgo = (userId: string, minutes: number) =>
    team.test.admin.db
      .update(schema.session)
      .set({
        reauthenticatedAt: sql`now() - make_interval(mins => ${minutes})`,
        codeConfirmedAt: sql`now() - make_interval(mins => ${minutes})`,
      })
      .where(eq(schema.session.userId, userId));

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'));
  });

  afterAll(async () => {
    await team.close();
  });

  it('adds a key only within 5 minutes of the password and code, names it by its device, and tells the group', async () => {
    const key = new FakePasskey();
    await confirmedAgo(team.ownerId, 6);
    const late = await request('GET', '/auth/passkey/generate-register-options', team.owner);
    expect([late.statusCode, codeOf(late)]).toEqual([403, 'reauthentication_forbidden']);

    await confirmedAgo(team.ownerId, 1);
    const added = await add(team.owner, key);
    expect(added.statusCode, added.body).toBe(200);
    const view = PasskeySchema.parse(added.json());
    expect(view).toMatchObject({ device: 'Safari sur iPhone', lastUsedAt: null });
    // Never the key itself nor its credential id.
    expect(added.body).not.toContain(key.credentialId);
    expect(added.body).not.toMatch(/publicKey|credentialID/u);

    expect(await keysOf(team.ownerId)).toHaveLength(1);
    expect((await alerts('passkey_added')).map((row) => row.payload.userId)).toEqual([team.ownerId]);
    expect(await team.audited('auth.passkey_added')).toBe(1);

    const listed = PasskeysSchema.parse((await request('GET', '/auth/passkeys', team.owner)).json());
    expect(listed.passkeys.map((passkey) => passkey.id)).toEqual([view.id]);
  });

  it('refuses a key made without Face ID, a fingerprint or the phone’s code', async () => {
    const { member, cookie } = await team.addMember('lise@example.test', 'Lise');
    const refused = await add(cookie, new FakePasskey(), { verified: false });
    expect([refused.statusCode, codeOf(refused)]).toEqual([401, 'passkey_unauthenticated']);
    expect(await keysOf(member.userId)).toEqual([]);
  });

  it('signs in with one gesture, no password, no code, and tells the owner of a key never used before', async () => {
    const key = new FakePasskey();
    const { member, cookie } = await team.addMember('remi@example.test', 'Rémi');
    expect((await add(cookie, key)).statusCode).toBe(200);
    const ownerKey = new FakePasskey();
    await confirmedAgo(team.ownerId, 0);
    expect((await add(team.owner, ownerKey)).statusCode).toBe(200);

    const signedIn = await signInWith(key);
    expect(signedIn.statusCode, signedIn.body).toBe(200);
    expect(signedIn.body).not.toMatch(/"token"/u);
    const session = cookiesOf(signedIn.headers);
    const me = await request('GET', '/me', session);
    expect([me.statusCode, z.object({ id: z.string() }).parse(me.json()).id]).toEqual([200, member.userId]);
    // The sign-in gesture is not a confirmation: a sensitive action asks for another one.
    expect(await confirmedAtOf(session)).toBeNull();
    const [used] = await keysOf(member.userId);
    expect(used?.lastUsedAt).not.toBeNull();
    // A member's first use is not told; the owner's is, once.
    expect(await alerts('passkey_new_sign_in')).toEqual([]);
    expect((await signInWith(ownerKey)).statusCode).toBe(200);
    expect((await signInWith(ownerKey)).statusCode).toBe(200);
    expect((await alerts('passkey_new_sign_in')).map((row) => row.payload.userId)).toEqual([team.ownerId]);
  });

  it('counts only refusals the server checked, toward the alert of repeated refusals', async () => {
    const key = new FakePasskey();
    const { member, cookie } = await team.addMember('yann@example.test', 'Yann');
    expect((await add(cookie, key)).statusCode).toBe(200);
    const refusals = () =>
      team.test.admin.db
        .select({ id: schema.auditLog.id })
        .from(schema.auditLog)
        .where(
          and(eq(schema.auditLog.userId, member.userId), eq(schema.auditLog.action, 'auth.passkey_refused')),
        );

    const forged = await signInWith(key, { forge: true });
    expect([forged.statusCode, codeOf(forged)]).toEqual([401, 'passkey_unauthenticated']);
    const unverified = await signInWith(key, { verified: false });
    expect([unverified.statusCode, codeOf(unverified)]).toEqual([401, 'passkey_unauthenticated']);
    const elsewhere = await signInWith(key, { origin: 'https://evil.example' });
    expect(codeOf(elsewhere)).toBe('passkey_unauthenticated');
    expect(await refusals()).toHaveLength(3);

    // An unknown key names no account: limited by the address, counted for nobody.
    const unknown = await signInWith(new FakePasskey());
    expect([unknown.statusCode, codeOf(unknown)]).toEqual([401, 'passkey_unauthenticated']);
    expect(await refusals()).toHaveLength(3);

    for (let attempt = 0; attempt < 2; attempt += 1) await signInWith(key, { forge: true });
    expect((await alerts('sign_in_refusals')).map((row) => row.payload.userId)).toContain(member.userId);
  });

  it('confirms a sensitive action with a fresh gesture of this account, used once', async () => {
    const key = new FakePasskey();
    const { member, cookie } = await team.addMember('nina@example.test', 'Nina');
    expect((await add(cookie, key)).statusCode).toBe(200);
    const session = cookiesOf((await signInWith(key)).headers);
    expect(await confirmedAtOf(session)).toBeNull();

    // A key of another account is refused, and counted.
    const options = await request('POST', '/auth/passkey/confirm-options', session);
    expect(options.statusCode, options.body).toBe(200);
    const stranger = new FakePasskey();
    const wrongKey = await request('POST', '/auth/passkey/confirm', session, {
      payload: { response: stranger.assert(options.json()) },
    });
    expect([wrongKey.statusCode, codeOf(wrongKey)]).toEqual([401, 'passkey_unauthenticated']);
    // The challenge was used up by that try.
    const replay = await request('POST', '/auth/passkey/confirm', session, {
      payload: { response: key.assert(options.json()) },
    });
    expect([replay.statusCode, codeOf(replay)]).toEqual([401, 'passkey_challenge_unauthenticated']);

    const fresh = await request('POST', '/auth/passkey/confirm-options', session);
    const confirmed = await request('POST', '/auth/passkey/confirm', session, {
      payload: { response: key.assert(fresh.json()) },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(204);
    expect(await confirmedAtOf(session)).not.toBeNull();
    expect(await team.audited('auth.reauthenticated')).toBeGreaterThan(0);
    // A gesture confirms a sensitive action, never the adding of another key: that asks for the password and the code.
    const another = await request('GET', '/auth/passkey/generate-register-options', session);
    expect([another.statusCode, codeOf(another)]).toEqual([403, 'reauthentication_forbidden']);

    // An account without a key has nothing to confirm with.
    await team.test.admin.db.delete(schema.passkey).where(eq(schema.passkey.userId, member.userId));
    const none = await request('POST', '/auth/passkey/confirm-options', session);
    expect([none.statusCode, codeOf(none)]).toEqual([404, 'passkey_not_found']);
  });

  it('removes a key by its holder after a confirmation, and every key of an account by the owner', async () => {
    const { member, cookie } = await team.addMember('ines@example.test', 'Inès');
    const [first, second] = [new FakePasskey(), new FakePasskey()];
    const one = PasskeySchema.parse((await add(cookie, first)).json());
    expect((await add(cookie, second)).statusCode).toBe(200);

    await confirmedAgo(member.userId, 11);
    const stale = await request('DELETE', `/auth/passkeys/${one.id}`, cookie);
    expect([stale.statusCode, codeOf(stale)]).toEqual([403, 'reauthentication_forbidden']);
    await confirmedAgo(member.userId, 0);
    expect((await request('DELETE', `/auth/passkeys/${one.id}`, cookie)).statusCode).toBe(204);
    const again = await request('DELETE', `/auth/passkeys/${one.id}`, cookie);
    expect([again.statusCode, codeOf(again)]).toEqual([404, 'passkey_not_found']);
    expect(await keysOf(member.userId)).toHaveLength(1);

    const accounts = AccountsSecuritySchema.parse(
      (await request('GET', '/settings/security/accounts', team.owner, { userAgent: LAPTOP })).json(),
    );
    expect(accounts.accounts.find((account) => account.userId === member.userId)?.passkeys).toBe(1);

    await confirmedAgo(team.ownerId, 0);
    const removed = await request(
      'POST',
      `/settings/security/accounts/${member.userId}/remove-passkeys`,
      team.owner,
    );
    expect([removed.statusCode, removed.json()]).toEqual([200, { passkeys: 1 }]);
    expect(await keysOf(member.userId)).toEqual([]);
    // Its sessions stay open: closing them is the gesture beside it.
    expect((await request('GET', '/me', cookie)).statusCode).toBe(200);
  });

  it('removes every key at a reset of the second factor and at a departure, never when sessions close', async () => {
    const { member, cookie } = await team.addMember('paul@example.test', 'Paul');
    expect((await add(cookie, new FakePasskey())).statusCode).toBe(200);
    expect((await request('POST', '/auth/sessions/close-others', cookie)).statusCode).toBe(200);
    expect(await keysOf(member.userId)).toHaveLength(1);

    await resetAccountSecondFactor(team.test.admin.db, 'paul@example.test');
    expect(await keysOf(member.userId)).toEqual([]);

    const { member: leaving, cookie: leavingCookie } = await team.addMember('zoe@example.test', 'Zoé');
    const key = new FakePasskey();
    expect((await add(leavingCookie, key)).statusCode).toBe(200);
    const left = await team.call('PUT', `/team/members/${leaving.id}/status`, team.owner, { status: 'left' });
    expect(left.statusCode, left.body).toBe(200);
    expect(await keysOf(leaving.userId)).toEqual([]);
    const after = await signInWith(key);
    expect([after.statusCode, codeOf(after)]).toEqual([401, 'passkey_unauthenticated']);
  });
});
