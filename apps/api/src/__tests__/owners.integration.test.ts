import {
  EVENT_PAYLOADS,
  newId,
  OwnersSchema,
  TeamMemberIdSchema,
  type NotificationRequest,
} from '@impera/contracts';
import { and, eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { applyOwnerRemovalsUnscoped, relayOwnerAlertsUnscoped } from '../owners';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

/** Invented accounts. */
const account = (name: string) => ({
  email: `${name}@example.test`,
  name,
  password: `${name} correct horse battery`,
});

type Json = Record<string, unknown>;
const ErrorBodySchema = z.object({
  error: z.object({ code: z.string(), details: z.record(z.string(), z.unknown()).optional() }),
});
const HOUR_MS = 3_600_000;

describe('the owners (ADR 0096)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;

  const request = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, cookie: string, payload?: Json) =>
    server.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload }),
      headers: { origin: DASHBOARD_ORIGIN, ...(cookie === '' ? {} : { cookie }) },
    });
  const refusal = (response: { statusCode: number; body: string }) => {
    const { error } = ErrorBodySchema.parse(JSON.parse(response.body));
    return [response.statusCode, error.code, error.details?.['refusal']].filter((part) => part !== undefined);
  };
  const ownersOf = async (cookie: string) => {
    const response = await request('GET', '/v1/settings/security/owners', cookie);
    expect(response.statusCode, response.body).toBe(200);
    return OwnersSchema.parse(response.json());
  };
  const roleOf = async (userId: string) =>
    (
      await test.admin.db
        .select({ role: schema.user.role })
        .from(schema.user)
        .where(eq(schema.user.id, userId))
    )[0]?.role;
  const alerts = async (reason: string) =>
    (
      await test.admin.db
        .select({ id: schema.domainEvents.id, payload: schema.domainEvents.payload })
        .from(schema.domainEvents)
        .where(
          and(
            eq(schema.domainEvents.type, 'security_alert'),
            sql`${schema.domainEvents.payload} ->> 'reason' = ${reason}`,
          ),
        )
    ).map((row) => ({ id: row.id, alert: EVENT_PAYLOADS.security_alert.parse(row.payload) }));
  const audited = async (action: string, entityId: string) =>
    test.admin.db
      .select({ userId: schema.auditLog.userId, details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, action), eq(schema.auditLog.entityId, entityId)));

  /** An owner, signed in with his code: his password and his code were just given. */
  const owner = async (name: string) => {
    const who = account(name);
    const { userId } = await createOwner(app.auth, app.db.db, who);
    return { ...who, userId, cookie: await signIn(server, who.email, who.password) };
  };
  /** A member of the team with a password; his second factor is active once he has signed in. */
  const member = async (name: string, status: 'active' | 'suspended' = 'active') => {
    const who = account(name);
    const { userId } = await createOwner(app.auth, app.db.db, who);
    await test.admin.db.update(schema.user).set({ role: 'operator' }).where(eq(schema.user.id, userId));
    const memberId = newId(TeamMemberIdSchema);
    await test.admin.db.insert(schema.teamMembers).values({
      id: memberId,
      userId,
      teamRole: 'manager',
      status,
      firstName: name,
      lastName: 'Inventé',
      displayName: name,
      country: 'FR',
      timeZone: 'Europe/Paris',
      joinedOn: '2026-10-01',
    });
    return { ...who, userId, memberId };
  };
  /** Two owners: the first, and a member he made the second, signed in again as an owner. */
  const twoOwners = async (first: string, second: string) => {
    const a = await owner(first);
    const b = await member(second);
    await signIn(server, b.email, b.password);
    const added = await request('POST', '/v1/settings/security/owners', a.cookie, { userId: b.userId });
    expect(added.statusCode, added.body).toBe(200);
    return { a, b: { ...b, cookie: await signIn(server, b.email, b.password) } };
  };

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
    app = await createApp(config, createLogger(config), { passwordBreaches: () => Promise.resolve(false) });
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  // One database for the file: each test starts with no owner and no removal waiting.
  beforeEach(async () => {
    await test.admin.db.update(schema.user).set({ role: 'operator' }).where(eq(schema.user.role, 'owner'));
    await test.admin.db
      .update(schema.ownerRemovals)
      .set({ cancelledAt: sql`now()` })
      .where(sql`cancelled_at is null and applied_at is null`);
  });

  it('makes an active member with his code the second owner, and never a third', async () => {
    const a = await owner('ada');
    const b = await member('bo');
    const away = await member('cy', 'suspended');

    // Not before his second factor is active (§ 3), and never an account that is not an active member.
    const early = await request('POST', '/v1/settings/security/owners', a.cookie, { userId: b.userId });
    expect(refusal(early)).toEqual([422, 'owner_unprocessable', 'second_factor_missing']);
    await signIn(server, away.email, away.password).catch(() => undefined);
    const suspended = await request('POST', '/v1/settings/security/owners', a.cookie, {
      userId: away.userId,
    });
    expect(refusal(suspended)).toEqual([422, 'owner_unprocessable', 'not_a_member']);
    const unknown = await request('POST', '/v1/settings/security/owners', a.cookie, { userId: 'nobody' });
    expect(refusal(unknown)).toEqual([422, 'owner_unprocessable', 'not_a_member']);

    const before = await signIn(server, b.email, b.password);
    // A member reads nothing of the owners.
    expect((await request('GET', '/v1/settings/security/owners', before)).statusCode).toBe(403);
    expect((await ownersOf(a.cookie)).candidates).toEqual([
      { userId: b.userId, name: 'bo', refusal: null },
      { userId: away.userId, name: 'cy', refusal: 'not_a_member' },
    ]);

    // A sensitive action: a confirmation older than 10 minutes is asked again.
    await test.admin.db.update(schema.session).set({ reauthenticatedAt: sql`now() - interval '11 minutes'` });
    const stale = await request('POST', '/v1/settings/security/owners', a.cookie, { userId: b.userId });
    expect(refusal(stale)).toEqual([403, 'reauthentication_forbidden']);
    expect(await roleOf(b.userId)).toBe('operator');
    await test.admin.db.update(schema.session).set({ reauthenticatedAt: sql`now()` });

    const added = await request('POST', '/v1/settings/security/owners', a.cookie, { userId: b.userId });
    expect(added.statusCode, added.body).toBe(200);
    const state = OwnersSchema.parse(added.json());
    expect(state.owners.map((one) => [one.name, one.you, one.secondFactor])).toEqual([
      ['ada', true, true],
      ['bo', false, true],
    ]);
    expect(state.candidates).toEqual([]);
    expect(state.noticeHours).toBe(72);

    // Nothing he opened before carries the role: he signs in again, with his code.
    expect((await request('GET', '/v1/me', before)).statusCode).toBe(401);
    const after = await signIn(server, b.email, b.password);
    expect((await ownersOf(after)).owners.map((one) => one.you)).toEqual([false, true]);

    expect(
      (await audited('user.role_changed', b.userId)).filter((line) => line.userId === a.userId),
    ).toMatchObject([{ details: { role: 'owner', via: 'owner:add' } }]);
    expect((await alerts('owner_added')).map((row) => row.alert)).toEqual([
      expect.objectContaining({ userId: b.userId, by: a.userId, role: 'owner' }),
    ]);

    // Never a third (§ 1), whoever asks.
    const c = await member('dee');
    await signIn(server, c.email, c.password);
    for (const cookie of [a.cookie, after]) {
      const third = await request('POST', '/v1/settings/security/owners', cookie, { userId: c.userId });
      expect(refusal(third)).toEqual([409, 'owner_conflict']);
    }
    expect(await roleOf(c.userId)).toBe('operator');
  });

  it('removes an owner only after 72 hours, and lets the one it is about cancel', async () => {
    const { a, b } = await twoOwners('eli', 'fay');

    // Oneself, or an account that is not an owner, is not « the other owner ».
    for (const target of [a.userId, 'nobody']) {
      const none = await request('POST', `/v1/settings/security/owners/${target}/removal`, a.cookie);
      expect(refusal(none)).toEqual([404, 'owner_not_found']);
    }

    const start = Date.now();
    const asked = await request('POST', `/v1/settings/security/owners/${b.userId}/removal`, a.cookie);
    expect(asked.statusCode, asked.body).toBe(200);
    const { removal } = OwnersSchema.parse(asked.json());
    if (removal === null) throw new Error('a removal expected');
    expect(removal).toMatchObject({ targetUserId: b.userId, requestedBy: a.userId });
    const notice = Date.parse(removal.effectiveAt) - Date.parse(removal.requestedAt);
    expect(notice).toBe(72 * HOUR_MS);
    expect(Date.parse(removal.requestedAt)).toBeGreaterThanOrEqual(start - 1000);

    // One at a time, and nothing else changes among the owners meanwhile.
    const twice = await request('POST', `/v1/settings/security/owners/${b.userId}/removal`, a.cookie);
    expect(refusal(twice)).toEqual([409, 'owner_removal_conflict']);
    const counter = await request('POST', `/v1/settings/security/owners/${a.userId}/removal`, b.cookie);
    expect(refusal(counter)).toEqual([409, 'owner_removal_conflict']);

    // Both read it; only the owner it is about cancels it.
    expect((await ownersOf(b.cookie)).removal?.id).toBe(removal.id);
    const notHis = await request('DELETE', '/v1/settings/security/owners/removal', a.cookie);
    expect(refusal(notHis)).toEqual([403, 'owner_removal_forbidden']);
    expect((await ownersOf(a.cookie)).removal?.id).toBe(removal.id);

    // Before its notice ends, the job changes nothing, however often it runs.
    expect(await applyOwnerRemovalsUnscoped(app.adminDb.db, new Date(start + 71 * HOUR_MS))).toEqual({
      applied: 0,
      lapsed: 0,
    });
    expect(await roleOf(b.userId)).toBe('owner');

    const cancelled = await request('DELETE', '/v1/settings/security/owners/removal', b.cookie);
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(OwnersSchema.parse(cancelled.json()).removal).toBeNull();
    const nothing = await request('DELETE', '/v1/settings/security/owners/removal', b.cookie);
    expect(refusal(nothing)).toEqual([404, 'owner_removal_not_found']);
    // Cancelled, it is never applied, even long after.
    expect(await applyOwnerRemovalsUnscoped(app.adminDb.db, new Date(start + 100 * HOUR_MS))).toEqual({
      applied: 0,
      lapsed: 0,
    });
    expect(await roleOf(b.userId)).toBe('owner');

    // Asked again and left alone, it is applied once its 72 hours are over, once.
    const again = await request('POST', `/v1/settings/security/owners/${b.userId}/removal`, a.cookie);
    expect(again.statusCode, again.body).toBe(200);
    const due = new Date(Date.now() + 72 * HOUR_MS + 1000);
    expect(await applyOwnerRemovalsUnscoped(app.adminDb.db, due)).toEqual({ applied: 1, lapsed: 0 });
    expect(await applyOwnerRemovalsUnscoped(app.adminDb.db, due)).toEqual({ applied: 0, lapsed: 0 });
    expect(await roleOf(b.userId)).toBe('operator');
    expect(await roleOf(a.userId)).toBe('owner');
    // His sessions are closed; signed in again, he is a member of the team as before.
    expect((await request('GET', '/v1/me', b.cookie)).statusCode).toBe(401);
    const back = await signIn(server, b.email, b.password);
    expect((await request('GET', '/v1/settings/security/owners', back)).statusCode).toBe(403);
    const state = await ownersOf(a.cookie);
    expect(state.owners.map((one) => one.name)).toEqual(['eli']);
    expect(state.removal).toBeNull();

    expect(await audited('owner.removal_requested', b.userId)).toHaveLength(2);
    expect(await audited('owner.removal_cancelled', b.userId)).toHaveLength(1);
    expect(
      (await audited('user.role_changed', b.userId)).filter((line) => line.userId === a.userId),
    ).toMatchObject([
      { details: { via: 'owner:add' } },
      { details: { role: 'operator', via: 'owner:removal' } },
    ]);
    expect((await alerts('owner_removal_requested')).map((row) => row.alert)).toHaveLength(2);
    expect((await alerts('owner_removal_cancelled')).map((row) => row.alert)).toEqual([
      expect.objectContaining({ userId: b.userId }),
    ]);
    expect((await alerts('owner_removed')).map((row) => row.alert)).toEqual([
      expect.objectContaining({ userId: b.userId, by: a.userId }),
    ]);
  });

  it('asks for the password and the code before a removal or its cancelling', async () => {
    const { a, b } = await twoOwners('gus', 'hal');
    await test.admin.db.update(schema.session).set({ reauthenticatedAt: sql`now() - interval '11 minutes'` });
    const asked = await request('POST', `/v1/settings/security/owners/${b.userId}/removal`, a.cookie);
    expect(refusal(asked)).toEqual([403, 'reauthentication_forbidden']);
    await test.admin.db.update(schema.session).set({ reauthenticatedAt: sql`now()` });
    expect(
      (await request('POST', `/v1/settings/security/owners/${b.userId}/removal`, a.cookie)).statusCode,
    ).toBe(200);
    await test.admin.db.update(schema.session).set({ reauthenticatedAt: sql`now() - interval '11 minutes'` });
    const cancelled = await request('DELETE', '/v1/settings/security/owners/removal', b.cookie);
    expect(refusal(cancelled)).toEqual([403, 'reauthentication_forbidden']);
    expect((await ownersOf(a.cookie)).removal).not.toBeNull();
  });

  it('never leaves the agency without an owner, and holds the notice in the table itself', async () => {
    const { a, b } = await twoOwners('ida', 'jon');
    expect(
      (await request('POST', `/v1/settings/security/owners/${b.userId}/removal`, a.cookie)).statusCode,
    ).toBe(200);
    // Whoever asked is no longer an owner when the notice ends (the server's command): the other stays.
    await test.admin.db.update(schema.user).set({ role: 'operator' }).where(eq(schema.user.id, a.userId));
    const due = new Date(Date.now() + 73 * HOUR_MS);
    expect(await applyOwnerRemovalsUnscoped(app.adminDb.db, due)).toEqual({ applied: 0, lapsed: 1 });
    expect(await roleOf(b.userId)).toBe('owner');
    // It is closed, not left waiting: nothing blocks a later removal, and the job has nothing more to read.
    expect((await ownersOf(b.cookie)).removal).toBeNull();
    expect(await applyOwnerRemovalsUnscoped(app.adminDb.db, due)).toEqual({ applied: 0, lapsed: 0 });
    // An owner again, a removal can be asked anew: the rest reads a row that waits.
    await test.admin.db.update(schema.user).set({ role: 'owner' }).where(eq(schema.user.id, a.userId));
    expect(
      (await request('POST', `/v1/settings/security/owners/${a.userId}/removal`, b.cookie)).statusCode,
    ).toBe(200);

    // A row that would take effect sooner cannot be written, whatever the code; nor one applied before its notice.
    const shorter = app.adminDb.db.insert(schema.ownerRemovals).values({
      id: newId(z.uuid()),
      targetUserId: a.userId,
      requestedBy: b.userId,
      requestedAt: new Date(),
      effectiveAt: new Date(Date.now() + 71 * HOUR_MS),
    });
    await expect(shorter).rejects.toThrow();
    const early = app.adminDb.db
      .update(schema.ownerRemovals)
      .set({ appliedAt: sql`now()` })
      .where(sql`cancelled_at is null and applied_at is null`);
    await expect(early).rejects.toThrow();
    // The service role ends a removal, and changes nothing else of it; the app role never reaches the table.
    const moved = app.adminDb.db.update(schema.ownerRemovals).set({ effectiveAt: sql`now()` });
    await expect(moved).rejects.toThrow();
    await expect(app.adminDb.db.delete(schema.ownerRemovals)).rejects.toThrow();
    await expect(app.db.db.select().from(schema.ownerRemovals)).rejects.toThrow();
  });

  it('lets no other gesture shut an owner out', async () => {
    const { a, b } = await twoOwners('kim', 'lou');

    // His record of the team stays, but no status takes his access.
    for (const status of ['suspended', 'left']) {
      const changed = await request('PUT', `/v1/team/members/${b.memberId}/status`, a.cookie, { status });
      expect(refusal(changed)).toEqual([409, 'owner_protected_conflict']);
    }
    // No link chooses his password in his place.
    for (const purpose of ['reset', 'invitation']) {
      const link = await request('POST', `/v1/team/members/${b.memberId}/invitation-link`, a.cookie, {
        purpose,
      });
      expect(refusal(link)).toEqual([409, 'owner_protected_conflict']);
    }
    // His passkeys are his own; one's own are still removed from here.
    const keys = await request(
      'POST',
      `/v1/settings/security/accounts/${b.userId}/remove-passkeys`,
      a.cookie,
    );
    expect(refusal(keys)).toEqual([409, 'owner_protected_conflict']);
    const own = await request('POST', `/v1/settings/security/accounts/${a.userId}/remove-passkeys`, a.cookie);
    expect(own.statusCode, own.body).toBe(200);
    expect((await request('GET', '/v1/me', b.cookie)).statusCode).toBe(200);
  });

  it('revokes the live invitation link of the member made an owner', async () => {
    const a = await owner('max');
    const b = await member('nia');
    await signIn(server, b.email, b.password);
    const link = await request('POST', `/v1/team/members/${b.memberId}/invitation-link`, a.cookie, {
      purpose: 'reset',
    });
    expect(link.statusCode, link.body).toBe(200);
    expect(
      (await request('POST', '/v1/settings/security/owners', a.cookie, { userId: b.userId })).statusCode,
    ).toBe(200);
    const live = await test.admin.db
      .select({ id: schema.invitationLinks.id })
      .from(schema.invitationLinks)
      .where(
        and(
          eq(schema.invitationLinks.memberId, b.memberId),
          sql`${schema.invitationLinks.usedAt} is null and ${schema.invitationLinks.revokedAt} is null`,
        ),
      );
    expect(live).toEqual([]);
  });

  it('tells the owners in the app of each change among them, once', async () => {
    const { a, b } = await twoOwners('oda', 'pia');
    expect(
      (await request('POST', `/v1/settings/security/owners/${b.userId}/removal`, a.cookie)).statusCode,
    ).toBe(200);
    const asked: NotificationRequest[] = [];
    const deps = {
      notify: (one: NotificationRequest) => {
        asked.push(one);
        return Promise.resolve('rang' as const);
      },
      agencyTimeZone: () => Promise.resolve('Europe/Paris'),
    };
    await relayOwnerAlertsUnscoped(app.adminDb.db, deps);

    const about = async (reason: string) =>
      (await alerts(reason)).find((row) => 'userId' in row.alert && row.alert.userId === b.userId);
    const added = await about('owner_added');
    const removal = await about('owner_removal_requested');
    if (added === undefined || removal === undefined) throw new Error('both alerts expected');
    const told = (key: string) =>
      asked
        .filter((one) => one.objectKey === key)
        .map((one) => one.userId)
        .sort();
    const both = [a.userId, b.userId].sort();
    expect(told(added.id)).toEqual(both);
    expect(told(removal.id)).toEqual(both);
    expect(new Set(asked.map((one) => one.reason))).toEqual(new Set(['owner_change']));
    // Never a name, and it opens the screen where the removal is cancelled.
    for (const one of asked) {
      expect(JSON.stringify(one.message)).not.toMatch(/oda|pia/u);
      expect(one.message.url).toBe('/reglages/securite');
    }
    // A sign-in of an owner on a device that was not trusted is told to the other one only (§ 5).
    const signIns = (await alerts('new_device_sign_in')).filter((row) => row.alert.userId === b.userId);
    expect(signIns.length).toBeGreaterThan(0);
    for (const row of signIns) expect(told(row.id)).toEqual([a.userId]);

    // The owner removed hears of it too, though no longer an owner.
    asked.length = 0;
    const due = new Date(Date.now() + 72 * HOUR_MS + 1000);
    await applyOwnerRemovalsUnscoped(app.adminDb.db, due);
    await relayOwnerAlertsUnscoped(app.adminDb.db, deps, due);
    const removed = await about('owner_removed');
    if (removed === undefined) throw new Error('the removal’s alert expected');
    expect(told(removed.id)).toEqual(both);
  });
});
