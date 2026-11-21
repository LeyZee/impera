import {
  CreatorIdSchema,
  newId,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
  type UserId,
} from '@impera/contracts';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { withAdmin, withMember, withTenantMember } from './client';
import * as s from './schema';
import { createTestDb, type TestDb } from './test/test-db';

/** The Postgres message behind a failed query (Drizzle wraps it as `cause`). */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    return cause instanceof Error ? cause.message : String(cause);
  }
  return 'no error';
}

const AnswerSchema = z.object({ outcome: z.string(), taken_at: z.coerce.date().nullable() });
const CHECK_IN = 'shift.check_in';
const MINUTE = 60_000;

/** A whole minute `minutes` from now: the shifts' instants fall on a minute. */
const inMinutes = (minutes: number): Date =>
  new Date(Math.floor(Date.now() / MINUTE) * MINUTE + minutes * MINUTE);

/**
 * `check_in_own_shift` (0247, EQ-12): « Je prends mon poste ». SECURITY DEFINER, so it holds its own boundary; called
 * here the way the API calls it, on the application role. Each case has its own shifts, the planning keeping its past.
 * Invented people only (ADR 0010).
 */
describe('a member takes his own shift, in its window (0247)', () => {
  let test: TestDb;
  const owner = newId(UserIdSchema);
  const nora = { creatorId: newId(CreatorIdSchema) };
  let made = 0;

  /** A new member of the team on Nora: a member is never on two shifts at once, so each case has its own. */
  async function hire(status: 'active' | 'left' = 'active'): Promise<{ userId: UserId; memberId: string }> {
    made += 1;
    const userId = newId(UserIdSchema);
    const memberId = newId(TeamMemberIdSchema);
    await withAdmin(test.admin.db, async (tx) => {
      await tx.insert(s.user).values({
        id: userId,
        name: 'Compte operator',
        email: `${userId}@example.test`,
        role: 'operator',
        creatorIds: [nora.creatorId],
      });
      await tx.insert(s.teamMembers).values({
        id: memberId,
        userId,
        teamRole: 'chatter',
        firstName: 'Prénom',
        lastName: 'Inventé',
        displayName: `Membre ${String(made)}`,
        country: 'BJ',
        timeZone: 'Africa/Porto-Novo',
        status,
        joinedOn: '2026-10-01',
        leftOn: status === 'left' ? '2026-11-01' : null,
      });
    });
    return { userId, memberId };
  }

  /**
   * A shift starting `startIn` minutes from now, an hour long unless said, on its own account, of a new member unless
   * one is given; with that member's account.
   */
  async function plan(
    startIn: number,
    patch: {
      readonly endIn?: number;
      readonly cancelled?: boolean;
      readonly stopped?: boolean;
      readonly status?: 'active' | 'left';
    } = {},
  ): Promise<{ shift: string; userId: UserId }> {
    const { userId, memberId } = await hire(patch.status);
    const id = newId(ShiftIdSchema);
    const accountId = newId(PlatformAccountIdSchema);
    const startsAt = inMinutes(startIn);
    const endsAt = inMinutes(patch.endIn ?? startIn + 60);
    await withAdmin(test.admin.db, async (tx) => {
      await tx.insert(s.platformAccounts).values({
        id: accountId,
        creatorId: nora.creatorId,
        platform: 'reveal',
        handle: `handle-${String(made)}`,
      });
      await tx.insert(s.shifts).values({
        id,
        creatorId: nora.creatorId,
        platformAccountId: accountId,
        memberId,
        startsAt,
        endsAt,
        cancelledAt: patch.cancelled === true ? new Date() : null,
        stoppedAt: patch.stopped === true ? endsAt : null,
        createdBy: owner,
        updatedBy: owner,
      });
    });
    return { shift: id, userId };
  }

  const checkIn = (userId: UserId, shiftId: string) =>
    withMember(test.app.db, userId, async (tx) => {
      const { rows } = await tx.execute(
        sql`select outcome, taken_at from public.check_in_own_shift(${shiftId}::uuid)`,
      );
      return AnswerSchema.parse(rows[0]);
    });

  const shiftOf = (id: string) =>
    withAdmin(test.admin.db, async (tx) => {
      const [row] = await tx
        .select({
          checkedInAt: s.shifts.checkedInAt,
          updatedAt: s.shifts.updatedAt,
          updatedBy: s.shifts.updatedBy,
          memberId: s.shifts.memberId,
        })
        .from(s.shifts)
        .where(eq(s.shifts.id, id));
      if (row === undefined) throw new Error('no shift');
      return row;
    });

  const traces = (shiftId: string) =>
    withAdmin(test.admin.db, (tx) =>
      tx
        .select({ userId: s.auditLog.userId, ip: s.auditLog.ip })
        .from(s.auditLog)
        .where(and(eq(s.auditLog.action, CHECK_IN), eq(s.auditLog.entityId, shiftId))),
    );

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    await withAdmin(test.admin.db, async (tx) => {
      await tx.insert(s.creators).values({
        id: nora.creatorId,
        nameKey: nora.creatorId,
        displayName: 'Créatrice Nora',
        timezone: 'Europe/Paris',
      });
      await tx.insert(s.user).values({
        id: owner,
        name: 'Compte owner',
        email: `${owner}@example.test`,
        role: 'owner',
      });
    });
  });

  afterAll(async () => {
    await test.close();
  });

  it('dates his own shift once, from its start margin, and traces it without an IP', async () => {
    const { shift, userId } = await plan(10);
    const before = await shiftOf(shift);
    const first = await checkIn(userId, shift);
    expect(first.outcome).toBe('checked_in');
    expect(first.taken_at).not.toBeNull();
    const after = await shiftOf(shift);
    expect(after.checkedInAt).toEqual(first.taken_at);
    // A check-in is not a change of the planning.
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.updatedBy).toBe(owner);
    expect(await traces(shift)).toEqual([{ userId, ip: null }]);
    const again = await checkIn(userId, shift);
    expect(again).toEqual({ outcome: 'already', taken_at: first.taken_at });
    expect(await traces(shift)).toHaveLength(1);
  });

  it('takes a shift under way', async () => {
    const { shift, userId } = await plan(-30, { endIn: 30 });
    expect((await checkIn(userId, shift)).outcome).toBe('checked_in');
  });

  it('refuses before the window opens, and after the end or a stop, writing nothing', async () => {
    const early = await plan(120);
    const ended = await plan(-120, { endIn: -60 });
    const stopped = await plan(-20, { endIn: 0, stopped: true });
    expect(await checkIn(early.userId, early.shift)).toEqual({ outcome: 'early', taken_at: null });
    expect(await checkIn(ended.userId, ended.shift)).toEqual({ outcome: 'ended', taken_at: null });
    expect(await checkIn(stopped.userId, stopped.shift)).toEqual({ outcome: 'ended', taken_at: null });
    for (const { shift } of [early, ended, stopped]) {
      expect((await shiftOf(shift)).checkedInAt).toBeNull();
      expect(await traces(shift)).toEqual([]);
    }
  });

  it('reads the margin the owner set', async () => {
    const { shift, userId } = await plan(40);
    expect((await checkIn(userId, shift)).outcome).toBe('early');
    await withAdmin(test.admin.db, (tx) =>
      tx.insert(s.schedulingSettings).values({
        id: 1,
        timeZone: 'Europe/Paris',
        slotStartMinute: 0,
        slotLengthMinutes: 360,
        accessMarginMinutes: 60,
        updatedBy: owner,
      }),
    );
    expect((await checkIn(userId, shift)).outcome).toBe('checked_in');
  });

  it('answers one same « not found » for someone else’s shift, a cancelled one, a member who left, an unknown id', async () => {
    const { userId: reader } = await plan(200);
    const others = await plan(5);
    const cancelled = await plan(5, { cancelled: true });
    const left = await plan(5, { status: 'left' });
    const none = { outcome: 'not_found', taken_at: null };
    expect(await checkIn(reader, others.shift)).toEqual(none);
    expect(await checkIn(cancelled.userId, cancelled.shift)).toEqual(none);
    expect(await checkIn(left.userId, left.shift)).toEqual(none);
    expect(await checkIn(owner, others.shift)).toEqual(none);
    expect(await checkIn(reader, newId(ShiftIdSchema))).toEqual(none);
    for (const { shift } of [others, cancelled, left]) expect((await shiftOf(shift)).checkedInAt).toBeNull();
  });

  it('refuses a transaction that names no account', async () => {
    const { shift } = await plan(5);
    const bare = test.app.db.transaction((tx) =>
      tx.execute(sql`select * from public.check_in_own_shift(${shift}::uuid)`),
    );
    expect(await failure(bare)).toMatch(/no reader for the check-in/);
  });

  it('clears the check-in when the shift changes member or start, never on a later end', async () => {
    const write = (shift: string, change: { endsAt?: Date; startsAt?: Date; memberId?: string }) =>
      withTenantMember(test.app.db, nora.creatorId, owner, (tx) =>
        tx
          .update(s.shifts)
          .set({ ...change, updatedBy: owner })
          .where(eq(s.shifts.id, shift)),
      );
    const lengthened = await plan(5);
    await checkIn(lengthened.userId, lengthened.shift);
    await write(lengthened.shift, { endsAt: inMinutes(125) });
    expect((await shiftOf(lengthened.shift)).checkedInAt).not.toBeNull();
    const moved = await plan(5);
    await checkIn(moved.userId, moved.shift);
    await write(moved.shift, { memberId: (await hire()).memberId });
    expect((await shiftOf(moved.shift)).checkedInAt).toBeNull();
    const later = await plan(5);
    await checkIn(later.userId, later.shift);
    await write(later.shift, { startsAt: inMinutes(6) });
    expect((await shiftOf(later.shift)).checkedInAt).toBeNull();
  });

  it('is never written by a column grant: neither the owner nor the member dates a check-in by hand', async () => {
    const { shift, userId } = await plan(5);
    for (const writer of [owner, userId]) {
      expect(
        await failure(
          withTenantMember(test.app.db, nora.creatorId, writer, (tx) =>
            tx.update(s.shifts).set({ checkedInAt: new Date() }).where(eq(s.shifts.id, shift)),
          ),
        ),
      ).toMatch(/permission denied/);
    }
    expect((await shiftOf(shift)).checkedInAt).toBeNull();
    // Nor by planning a shift already taken: the insert grant covers the column, the database clears it.
    const { memberId } = await hire();
    const planned = newId(ShiftIdSchema);
    const accountId = newId(PlatformAccountIdSchema);
    await withAdmin(test.admin.db, (tx) =>
      tx
        .insert(s.platformAccounts)
        .values({ id: accountId, creatorId: nora.creatorId, platform: 'reveal', handle: 'handle-taken' }),
    );
    await withTenantMember(test.app.db, nora.creatorId, owner, (tx) =>
      tx.insert(s.shifts).values({
        id: planned,
        creatorId: nora.creatorId,
        platformAccountId: accountId,
        memberId,
        startsAt: inMinutes(5),
        endsAt: inMinutes(65),
        checkedInAt: new Date(),
        createdBy: owner,
        updatedBy: owner,
      }),
    );
    expect((await shiftOf(planned)).checkedInAt).toBeNull();
  });

  it('is a door of the application role alone: neither PUBLIC nor the service role may call it', async () => {
    const { rows } = await test.admin.db.execute(sql`
      select has_function_privilege('nirvana_app', 'public.check_in_own_shift(uuid)', 'EXECUTE') as app,
             has_function_privilege('impera_service', 'public.check_in_own_shift(uuid)', 'EXECUTE') as service,
             exists (select from pg_proc p, aclexplode(p.proacl) a
                      where p.oid = 'public.check_in_own_shift(uuid)'::regprocedure and a.grantee = 0) as public,
             p.prosecdef as definer, p.pronargs as arguments, p.proconfig as config
        from pg_proc p where p.oid = 'public.check_in_own_shift(uuid)'::regprocedure`);
    expect(rows[0]).toEqual({
      app: true,
      service: false,
      public: false,
      definer: true,
      arguments: 1,
      config: ['search_path=pg_catalog, pg_temp'],
    });
    expect(
      await failure(
        test.service.db.execute(sql`select * from public.check_in_own_shift(${newId(ShiftIdSchema)}::uuid)`),
      ),
    ).toMatch(/permission denied for function check_in_own_shift/);
  });
});
