import { randomUUID } from 'node:crypto';

import {
  CreatorIdSchema,
  FanIdSchema,
  newId,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
} from '@nirvana/contracts';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { withAdmin, withMember, withTenantMember, type Transaction } from './client';
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

const HOUR = 3_600_000;
const SLOTS = [
  { startMinute: 0, endMinute: 720, name: null },
  { startMinute: 720, endMinute: 0, name: 'Soir' },
];

/** ADR 0049: dated créneaux, seats, three chatters at most on an account, the fans they hold. Invented people only. */
describe('créneaux, seats and fans held (CR-14)', () => {
  let test: TestDb;
  const owner = newId(UserIdSchema);
  const manager = newId(UserIdSchema);
  const chatters = [
    newId(UserIdSchema),
    newId(UserIdSchema),
    newId(UserIdSchema),
    newId(UserIdSchema),
  ] as const;
  const [chatterA, chatterB, chatterC, chatterD] = chatters;
  const creatorUser = newId(UserIdSchema);
  const memberOf = new Map<string, string>();
  const nora = { creatorId: newId(CreatorIdSchema), accountId: newId(PlatformAccountIdSchema) };
  const ines = { creatorId: newId(CreatorIdSchema), accountId: newId(PlatformAccountIdSchema) };
  const fanOfNora = newId(FanIdSchema);
  const shiftOfA = newId(ShiftIdSchema);
  const shiftOfB = newId(ShiftIdSchema);

  const member = (userId: string): string => {
    const memberId = memberOf.get(userId);
    if (memberId === undefined) throw new Error('no member');
    return memberId;
  };

  const shiftRow = (
    creator: { creatorId: string; accountId: string },
    userId: string,
    startsAt: string,
    endsAt: string,
  ) => ({
    id: newId(ShiftIdSchema),
    creatorId: creator.creatorId,
    platformAccountId: creator.accountId,
    memberId: member(userId),
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    createdBy: owner,
    updatedBy: owner,
  });

  const versionRow = (effectiveAt: Date, by = owner) => ({
    id: randomUUID(),
    effectiveAt,
    timeZone: 'Europe/Paris',
    slots: SLOTS,
    createdBy: by,
  });

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    await withAdmin(test.admin.db, async (tx) => {
      for (const [label, creator] of [
        ['Nora', nora],
        ['Inès', ines],
      ] as const) {
        await tx.insert(s.creators).values({
          id: creator.creatorId,
          nameKey: creator.creatorId,
          displayName: `Créatrice ${label}`,
          timezone: 'Europe/Paris',
        });
        await tx.insert(s.platformAccounts).values({
          id: creator.accountId,
          creatorId: creator.creatorId,
          platform: 'reveal',
          handle: `handle-${label}`,
        });
      }
      const people = [
        [owner, 'owner', null],
        [manager, 'operator', 'manager'],
        ...chatters.map((userId) => [userId, 'operator', 'chatter'] as const),
        [creatorUser, 'creator', null],
      ] as const;
      for (const [userId, role, teamRole] of people) {
        await tx.insert(s.user).values({
          id: userId,
          name: `Compte ${role}`,
          email: `${userId}@example.test`,
          role,
          // A creator's account opens exactly one creator (CR-02).
          creatorIds: role === 'creator' ? [nora.creatorId] : [],
        });
        if (teamRole === null) continue;
        const memberId = newId(TeamMemberIdSchema);
        memberOf.set(userId, memberId);
        await tx.insert(s.teamMembers).values({
          id: memberId,
          userId,
          teamRole,
          firstName: 'Prénom',
          lastName: 'Inventé',
          displayName: `Membre ${teamRole}`,
          country: 'BJ',
          timeZone: 'Africa/Porto-Novo',
          joinedOn: '2026-10-01',
        });
      }
      await tx.insert(s.fans).values({
        id: fanOfNora,
        creatorId: nora.creatorId,
        platformAccountId: nora.accountId,
        platformFanId: 'fan-invente-1',
        displayName: 'Fan inventé',
      });
      await tx.insert(s.shifts).values([
        { ...shiftRow(nora, chatterA, '2099-12-01T00:00:00Z', '2099-12-01T06:00:00Z'), id: shiftOfA },
        { ...shiftRow(nora, chatterB, '2099-12-01T00:00:00Z', '2099-12-01T06:00:00Z'), id: shiftOfB },
      ]);
    });
  });

  afterAll(async () => {
    await test.close();
  });

  describe('three shifts at once on an account at most (ADR 0049 § 2)', () => {
    const plan = (row: ReturnType<typeof shiftRow>) =>
      failure(withTenantMember(test.app.db, nora.creatorId, owner, (tx) => tx.insert(s.shifts).values(row)));

    it('takes a third, refuses a fourth whoever writes, and counts only where they overlap', async () => {
      expect(await plan(shiftRow(nora, chatterC, '2099-12-02T00:00:00Z', '2099-12-02T12:00:00Z'))).toBe(
        'no error',
      );
      expect(await plan(shiftRow(nora, chatterD, '2099-12-02T00:00:00Z', '2099-12-02T12:00:00Z'))).toBe(
        'no error',
      );
      expect(await plan(shiftRow(nora, chatterA, '2099-12-02T00:00:00Z', '2099-12-02T06:00:00Z'))).toBe(
        'no error',
      );
      // Three from 00:00 to 06:00; from 06:00 two are left, so a fourth fits there and not an hour sooner.
      expect(await plan(shiftRow(nora, chatterB, '2099-12-02T05:00:00Z', '2099-12-02T09:00:00Z'))).toMatch(
        /three shifts at once/u,
      );
      expect(await plan(shiftRow(nora, chatterB, '2099-12-02T06:00:00Z', '2099-12-02T09:00:00Z'))).toBe(
        'no error',
      );
      // The admin role of the jobs is held too.
      const byAdmin = shiftRow(nora, manager, '2099-12-02T07:00:00Z', '2099-12-02T08:00:00Z');
      expect(await failure(withAdmin(test.admin.db, (tx) => tx.insert(s.shifts).values(byAdmin)))).toMatch(
        /three shifts at once/u,
      );
    });

    it('judges a move at the commit, and frees the time of a cancelled shift', async () => {
      const third = shiftRow(nora, chatterC, '2099-12-01T00:00:00Z', '2099-12-01T06:00:00Z');
      expect(await plan(third)).toBe('no error');
      const fourth = shiftRow(nora, chatterD, '2099-12-01T06:00:00Z', '2099-12-01T08:00:00Z');
      expect(await plan(fourth)).toBe('no error');
      // Moved onto the three, then away in the same transaction: only where it ends counts.
      expect(
        await failure(
          withAdmin(test.admin.db, async (tx) => {
            await tx
              .update(s.shifts)
              .set({ startsAt: new Date('2099-12-01T05:00:00Z') })
              .where(eq(s.shifts.id, fourth.id));
            await tx
              .update(s.shifts)
              .set({ startsAt: new Date('2099-12-01T06:00:00Z') })
              .where(eq(s.shifts.id, fourth.id));
          }),
        ),
      ).toBe('no error');
      expect(
        await failure(
          withAdmin(test.admin.db, (tx) =>
            tx
              .update(s.shifts)
              .set({ startsAt: new Date('2099-12-01T05:00:00Z') })
              .where(eq(s.shifts.id, fourth.id)),
          ),
        ),
      ).toMatch(/three shifts at once/u);
      await withAdmin(test.admin.db, (tx) =>
        tx.update(s.shifts).set({ cancelledAt: new Date() }).where(eq(s.shifts.id, third.id)),
      );
      expect(
        await failure(
          withAdmin(test.admin.db, (tx) =>
            tx
              .update(s.shifts)
              .set({ startsAt: new Date('2099-12-01T05:00:00Z') })
              .where(eq(s.shifts.id, fourth.id)),
          ),
        ),
      ).toBe('no error');
    });

    it('lets one of two writers at the same moment add the shift that makes four', async () => {
      await withAdmin(test.admin.db, (tx) =>
        tx
          .insert(s.shifts)
          .values([
            shiftRow(nora, chatterA, '2099-12-03T00:00:00Z', '2099-12-03T06:00:00Z'),
            shiftRow(nora, chatterB, '2099-12-03T00:00:00Z', '2099-12-03T06:00:00Z'),
          ]),
      );
      // Each inserts, then waits for the other to have inserted too before either commits.
      let arrived = 0;
      let release: () => void = () => undefined;
      const both = new Promise<void>((resolve) => {
        release = resolve;
      });
      const write = (userId: string) =>
        withAdmin(test.admin.db, async (tx: Transaction) => {
          await tx
            .insert(s.shifts)
            .values(shiftRow(nora, userId, '2099-12-03T01:00:00Z', '2099-12-03T02:00:00Z'));
          arrived += 1;
          if (arrived === 2) release();
          await both;
        });
      const outcomes = await Promise.allSettled([write(chatterC), write(chatterD)]);
      expect(outcomes.map((outcome) => outcome.status).toSorted()).toEqual(['fulfilled', 'rejected']);
    });
  });

  describe('dated créneaux and their seats (ADR 0049 § 1)', () => {
    it('lets the owner alone write a version ahead with its seats, and every member read them', async () => {
      const ahead = versionRow(new Date(Date.now() + 48 * HOUR));
      expect(
        await failure(
          withMember(test.app.db, manager, (tx) =>
            tx.insert(s.schedulingSlotVersions).values({ ...ahead, createdBy: manager }),
          ),
        ),
      ).toMatch(/row-level security/u);
      expect(
        await failure(
          withMember(test.app.db, owner, (tx) => tx.insert(s.schedulingSlotVersions).values(ahead)),
        ),
      ).toBe('no error');
      const seat = { versionId: ahead.id, slotRank: 1, platformAccountId: nora.accountId, seats: 2 };
      expect(
        await failure(
          withMember(test.app.db, manager, (tx) => tx.insert(s.schedulingSlotSeats).values(seat)),
        ),
      ).toMatch(/row-level security/u);
      expect(
        await failure(withMember(test.app.db, owner, (tx) => tx.insert(s.schedulingSlotSeats).values(seat))),
      ).toBe('no error');
      expect(
        await failure(
          withMember(test.app.db, owner, (tx) =>
            tx.insert(s.schedulingSlotSeats).values({ ...seat, slotRank: 0, seats: 3 }),
          ),
        ),
      ).toMatch(/scheduling_slot_seats_seats_check/u);
      const read = await withMember(test.app.db, chatterA, (tx) =>
        tx
          .select({ seats: s.schedulingSlotSeats.seats })
          .from(s.schedulingSlotSeats)
          .where(eq(s.schedulingSlotSeats.versionId, ahead.id)),
      );
      expect(read).toEqual([{ seats: 2 }]);
      // A version ahead is never edited: withdrawn whole, with its seats, and written again.
      expect(
        await failure(
          withAdmin(test.admin.db, (tx) =>
            tx
              .update(s.schedulingSlotSeats)
              .set({ seats: 1 })
              .where(eq(s.schedulingSlotSeats.versionId, ahead.id)),
          ),
        ),
      ).toMatch(/keeps its past/u);
      expect(
        await failure(
          withMember(test.app.db, owner, (tx) =>
            tx.delete(s.schedulingSlotVersions).where(eq(s.schedulingSlotVersions.id, ahead.id)),
          ),
        ),
      ).toBe('no error');
      const left = await withAdmin(test.admin.db, (tx) =>
        tx.select().from(s.schedulingSlotSeats).where(eq(s.schedulingSlotSeats.versionId, ahead.id)),
      );
      expect(left).toEqual([]);
    });

    it('keeps a version that took effect and its seats, even for the admin role', async () => {
      const past = versionRow(new Date(Date.now() - HOUR));
      expect(
        await failure(
          withMember(test.app.db, owner, (tx) => tx.insert(s.schedulingSlotVersions).values(past)),
        ),
      ).toMatch(/row-level security/u);
      await withAdmin(test.admin.db, (tx) => tx.insert(s.schedulingSlotVersions).values(past));
      const seat = { versionId: past.id, slotRank: 0, platformAccountId: nora.accountId, seats: 2 };
      expect(
        await failure(withAdmin(test.admin.db, (tx) => tx.insert(s.schedulingSlotSeats).values(seat))),
      ).toMatch(/keeps its past/u);
      expect(
        await failure(
          withAdmin(test.admin.db, (tx) =>
            tx
              .update(s.schedulingSlotVersions)
              .set({ timeZone: 'UTC' })
              .where(eq(s.schedulingSlotVersions.id, past.id)),
          ),
        ),
      ).toMatch(/keeps its past/u);
      expect(
        await failure(
          withAdmin(test.admin.db, (tx) =>
            tx.delete(s.schedulingSlotVersions).where(eq(s.schedulingSlotVersions.id, past.id)),
          ),
        ),
      ).toMatch(/keeps its past/u);
      // A truncate would pass the RLS and the triggers: the application's role has no right to it.
      expect(
        await failure(
          withMember(test.app.db, owner, (tx) => tx.execute(sql`truncate scheduling_slot_seats`)),
        ),
      ).toMatch(/permission denied/u);
    });
  });

  describe('the fans held while several are on shift (ADR 0049 § 3)', () => {
    const held = (userId: string, shiftId: string, startsAt: string, endsAt: string | null = null) => ({
      id: newId(ShiftIdSchema),
      creatorId: nora.creatorId,
      platformAccountId: nora.accountId,
      fanId: fanOfNora,
      memberId: member(userId),
      shiftId,
      startsAt: new Date(startsAt),
      endsAt: endsAt === null ? null : new Date(endsAt),
    });

    it('gives a fan one member at a time, and a row changes only by closing once', async () => {
      const first = held(chatterA, shiftOfA, '2099-12-01T00:00:00Z');
      await withAdmin(test.admin.db, (tx) => tx.insert(s.shiftFanAssignments).values(first));
      expect(
        await failure(
          withAdmin(test.admin.db, (tx) =>
            tx.insert(s.shiftFanAssignments).values(held(chatterB, shiftOfB, '2099-12-01T02:00:00Z')),
          ),
        ),
      ).toMatch(/shift_fan_assignments_fan_excl/u);
      const close = (at: string) =>
        failure(
          withAdmin(test.admin.db, (tx) =>
            tx
              .update(s.shiftFanAssignments)
              .set({ endsAt: new Date(at) })
              .where(eq(s.shiftFanAssignments.id, first.id)),
          ),
        );
      expect(
        await failure(
          withAdmin(test.admin.db, (tx) =>
            tx
              .update(s.shiftFanAssignments)
              .set({ memberId: member(chatterB), shiftId: shiftOfB })
              .where(eq(s.shiftFanAssignments.id, first.id)),
          ),
        ),
      ).toMatch(/keeps its past/u);
      expect(await close('2099-12-01T02:00:00Z')).toBe('no error');
      expect(await close('2099-12-01T03:00:00Z')).toMatch(/keeps its past/u);
      expect(
        await failure(
          withAdmin(test.admin.db, (tx) =>
            tx.insert(s.shiftFanAssignments).values(held(chatterB, shiftOfB, '2099-12-01T02:00:00Z')),
          ),
        ),
      ).toBe('no error');
      expect(
        await failure(
          withAdmin(test.admin.db, (tx) =>
            tx.delete(s.shiftFanAssignments).where(eq(s.shiftFanAssignments.id, first.id)),
          ),
        ),
      ).toMatch(/keeps its past/u);
    });

    it('lets a member read theirs, the owner and the agency all of them, and the creator nothing', async () => {
      const read = (userId: string, creatorId = nora.creatorId) =>
        withTenantMember(test.app.db, creatorId, userId, (tx) =>
          tx.select({ memberId: s.shiftFanAssignments.memberId }).from(s.shiftFanAssignments),
        );
      expect((await read(chatterA)).map((row) => row.memberId)).toEqual([member(chatterA)]);
      expect(await read(chatterC)).toEqual([]);
      expect(await read(owner)).toHaveLength(2);
      expect(await read(manager)).toHaveLength(2);
      expect(await read(creatorUser)).toEqual([]);
      expect(await read(owner, ines.creatorId)).toEqual([]);
      // Nobody writes them yet through the application (EQ-08).
      expect(
        await failure(
          withTenantMember(test.app.db, nora.creatorId, owner, (tx) =>
            tx.insert(s.shiftFanAssignments).values(held(chatterC, shiftOfA, '2099-12-01T05:00:00Z')),
          ),
        ),
      ).toMatch(/permission denied/u);
    });
  });
});
