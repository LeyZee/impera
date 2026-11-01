import {
  CreatorIdSchema,
  LeaveRequestIdSchema,
  newId,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  ShiftSwapRequestIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
} from '@nirvana/contracts';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { enterCreator, withAdmin, withMember, withTenantMember, type Transaction } from './client';
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

/** Invented people and creators only (ADR 0010). */
describe('leaves and swaps (ADR 0031): the member, the colleague, the agency', () => {
  let test: TestDb;
  const owner = newId(UserIdSchema);
  const manager = newId(UserIdSchema);
  const chatterA = newId(UserIdSchema);
  const chatterB = newId(UserIdSchema);
  const chatterC = newId(UserIdSchema);
  const memberOf = new Map<string, string>();
  const nora = { creatorId: newId(CreatorIdSchema), accountId: newId(PlatformAccountIdSchema) };
  const ines = { creatorId: newId(CreatorIdSchema), accountId: newId(PlatformAccountIdSchema) };

  const member = (userId: string): string => {
    const memberId = memberOf.get(userId);
    if (memberId === undefined) throw new Error('no member');
    return memberId;
  };

  const shiftRow = (creator: typeof nora, userId: string, startsAt: string, endsAt: string) => ({
    id: newId(ShiftIdSchema),
    creatorId: creator.creatorId,
    platformAccountId: creator.accountId,
    memberId: member(userId),
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    createdBy: owner,
    updatedBy: owner,
  });

  const plan = async (
    creator: typeof nora,
    userId: string,
    startsAt: string,
    endsAt: string,
  ): Promise<string> => {
    const row = shiftRow(creator, userId, startsAt, endsAt);
    await withAdmin(test.admin.db, (tx) => tx.insert(s.shifts).values(row));
    return row.id;
  };

  const memberOfShift = (id: string): Promise<string | undefined> =>
    withAdmin(test.admin.db, (tx) =>
      tx
        .select({ memberId: s.shifts.memberId })
        .from(s.shifts)
        .where(eq(s.shifts.id, id))
        .then((rows) => rows[0]?.memberId),
    );

  /** A proposal of chatter A, recorded by A under the creator of their shift. */
  const propose = async (
    shift: { id: string; creator: typeof nora; startsAt: string; endsAt: string },
    target: string,
    back: { id: string; creator: typeof nora; startsAt: string; endsAt: string } | null = null,
  ): Promise<string> => {
    const id = newId(ShiftSwapRequestIdSchema);
    await withTenantMember(test.app.db, shift.creator.creatorId, chatterA, (tx) =>
      tx.insert(s.shiftSwapRequests).values({
        id,
        creatorId: shift.creator.creatorId,
        shiftId: shift.id,
        requesterId: member(chatterA),
        shiftStartsAt: new Date(shift.startsAt),
        shiftEndsAt: new Date(shift.endsAt),
        targetMemberId: member(target),
        targetCreatorId: back?.creator.creatorId ?? null,
        targetShiftId: back?.id ?? null,
        targetShiftStartsAt: back === null ? null : new Date(back.startsAt),
        targetShiftEndsAt: back === null ? null : new Date(back.endsAt),
        status: 'proposed',
        createdBy: chatterA,
      }),
    );
    return id;
  };

  /** The colleague accepts: the swap first, then each shift under its own creator, in one transaction. */
  const accept = (
    userId: string,
    swapId: string,
    moves: readonly { creator: typeof nora; shiftId: string; to: string }[],
  ): Promise<number> =>
    withTenantMember(test.app.db, moves[0]?.creator.creatorId ?? '', userId, async (tx) => {
      await tx
        .update(s.shiftSwapRequests)
        .set({ status: 'accepted', resolvedAt: sql`now()`, resolvedBy: userId })
        .where(eq(s.shiftSwapRequests.id, swapId));
      let moved = 0;
      const named = moves.map((move) => move.creator.creatorId);
      for (const move of moves) {
        await enterCreator(tx, move.creator.creatorId, named);
        const rows = await tx
          .update(s.shifts)
          .set({ memberId: member(move.to), updatedBy: userId })
          .where(eq(s.shifts.id, move.shiftId))
          .returning({ id: s.shifts.id });
        moved += rows.length;
      }
      return moved;
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
        [chatterA, 'operator', 'chatter'],
        [chatterB, 'operator', 'chatter'],
        [chatterC, 'operator', 'chatter'],
      ] as const;
      for (const [userId, role, teamRole] of people) {
        await tx
          .insert(s.user)
          .values({ id: userId, name: `Compte ${role}`, email: `${userId}@example.test`, role });
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
    });
  });

  afterAll(async () => {
    await test.close();
  });

  describe('swaps', () => {
    it('a colleague reads the shift offered to them, and nothing else of the requester', async () => {
      const offered = { creator: nora, startsAt: '2099-12-01T00:00:00Z', endsAt: '2099-12-01T06:00:00Z' };
      const id = await plan(nora, chatterA, offered.startsAt, offered.endsAt);
      const other = await plan(nora, chatterA, '2099-12-01T06:00:00Z', '2099-12-01T12:00:00Z');
      const before = await withTenantMember(test.app.db, nora.creatorId, chatterB, (tx) =>
        tx.select({ id: s.shifts.id }).from(s.shifts),
      );
      expect(before.map((row) => row.id)).not.toContain(id);
      await propose({ ...offered, id }, chatterB);
      const seen = await withTenantMember(test.app.db, nora.creatorId, chatterB, (tx) =>
        tx.select({ id: s.shifts.id }).from(s.shifts),
      );
      expect(seen.map((row) => row.id)).toContain(id);
      expect(seen.map((row) => row.id)).not.toContain(other);
      const byC = await withTenantMember(test.app.db, nora.creatorId, chatterC, (tx) =>
        tx.select({ id: s.shiftSwapRequests.id }).from(s.shiftSwapRequests),
      );
      expect(byC).toEqual([]);
    });

    it('enters no creator outside the list its caller checked', async () => {
      const entered = withTenantMember(test.app.db, nora.creatorId, owner, (tx) =>
        enterCreator(tx, ines.creatorId, [nora.creatorId]),
      );
      await expect(entered).rejects.toThrow(/outside the allowed list/u);
    });

    it('moves nothing without an accepted swap, and nothing but to the other member of it', async () => {
      const offered = { creator: nora, startsAt: '2099-12-02T00:00:00Z', endsAt: '2099-12-02T06:00:00Z' };
      const id = await plan(nora, chatterA, offered.startsAt, offered.endsAt);
      const swap = await propose({ ...offered, id }, chatterB);
      const taken = await withTenantMember(test.app.db, nora.creatorId, chatterB, (tx) =>
        tx
          .update(s.shifts)
          .set({ memberId: member(chatterB), updatedBy: chatterB })
          .where(eq(s.shifts.id, id))
          .returning({ id: s.shifts.id }),
      );
      expect(taken).toEqual([]);
      expect(await failure(accept(chatterB, swap, [{ creator: nora, shiftId: id, to: chatterC }]))).toMatch(
        /row-level security/u,
      );
      expect(await memberOfShift(id)).toBe(member(chatterA));
    });

    it('exchanges two shifts on two creators in the transaction that accepts, and never after', async () => {
      const given = { creator: nora, startsAt: '2099-12-03T00:00:00Z', endsAt: '2099-12-03T06:00:00Z' };
      const back = { creator: ines, startsAt: '2099-12-04T00:00:00Z', endsAt: '2099-12-04T06:00:00Z' };
      const givenId = await plan(nora, chatterA, given.startsAt, given.endsAt);
      const backId = await plan(ines, chatterB, back.startsAt, back.endsAt);
      const swap = await propose({ ...given, id: givenId }, chatterB, { ...back, id: backId });
      expect(
        await accept(chatterB, swap, [
          { creator: nora, shiftId: givenId, to: chatterB },
          { creator: ines, shiftId: backId, to: chatterA },
        ]),
      ).toBe(2);
      expect(await memberOfShift(givenId)).toBe(member(chatterB));
      expect(await memberOfShift(backId)).toBe(member(chatterA));
      // The manager gives it to someone else: the old swap proves nothing any more.
      await withTenantMember(test.app.db, nora.creatorId, manager, (tx) =>
        tx
          .update(s.shifts)
          .set({ memberId: member(chatterC), updatedBy: manager })
          .where(eq(s.shifts.id, givenId)),
      );
      const takenBack = await withTenantMember(test.app.db, nora.creatorId, chatterB, (tx) =>
        tx
          .update(s.shifts)
          .set({ memberId: member(chatterB), updatedBy: chatterB })
          .where(eq(s.shifts.id, givenId))
          .returning({ id: s.shifts.id }),
      );
      expect(takenBack).toEqual([]);
      expect(await memberOfShift(givenId)).toBe(member(chatterC));
    });

    it('exchanges two shifts at the same hours once the member exclusion waits for the end of the moves', async () => {
      const given = { creator: nora, startsAt: '2099-12-09T00:00:00Z', endsAt: '2099-12-09T06:00:00Z' };
      const back = { creator: ines, startsAt: given.startsAt, endsAt: given.endsAt };
      const givenId = await plan(nora, chatterA, given.startsAt, given.endsAt);
      const backId = await plan(ines, chatterB, back.startsAt, back.endsAt);
      const moves = [
        { creator: nora, shiftId: givenId, to: chatterB },
        { creator: ines, shiftId: backId, to: chatterA },
      ];
      const swap = await propose({ ...given, id: givenId }, chatterB, { ...back, id: backId });
      expect(await failure(accept(chatterB, swap, moves))).toMatch(/shifts_member_overlap_excl/u);
      await withTenantMember(test.app.db, nora.creatorId, chatterB, async (tx) => {
        await tx.execute(sql`set constraints shifts_member_overlap_excl deferred`);
        await tx
          .update(s.shiftSwapRequests)
          .set({ status: 'accepted', resolvedAt: sql`now()`, resolvedBy: chatterB })
          .where(eq(s.shiftSwapRequests.id, swap));
        for (const move of moves) {
          await enterCreator(tx, move.creator.creatorId, [nora.creatorId, ines.creatorId]);
          await tx
            .update(s.shifts)
            .set({ memberId: member(move.to), updatedBy: chatterB })
            .where(eq(s.shifts.id, move.shiftId));
        }
        await tx.execute(sql`set constraints shifts_member_overlap_excl immediate`);
      });
      expect([await memberOfShift(givenId), await memberOfShift(backId)]).toEqual([
        member(chatterB),
        member(chatterA),
      ]);
    });

    it('holds the hours the swap noted, and keeps the shift neither cancelled nor stopped', async () => {
      const offered = { creator: nora, startsAt: '2099-12-05T00:00:00Z', endsAt: '2099-12-05T06:00:00Z' };
      const id = await plan(nora, chatterA, offered.startsAt, offered.endsAt);
      const swap = await propose({ ...offered, id }, chatterB);
      const stretched = withTenantMember(test.app.db, nora.creatorId, chatterB, async (tx) => {
        await tx
          .update(s.shiftSwapRequests)
          .set({ status: 'accepted', resolvedAt: sql`now()`, resolvedBy: chatterB })
          .where(eq(s.shiftSwapRequests.id, swap));
        await tx
          .update(s.shifts)
          .set({ memberId: member(chatterB), endsAt: new Date('2099-12-05T08:00:00Z'), updatedBy: chatterB })
          .where(eq(s.shifts.id, id));
      });
      expect(await failure(stretched)).toMatch(/row-level security/u);
    });

    it('lets the requester withdraw and the colleague answer, nobody else, and only forward', async () => {
      const offered = { creator: nora, startsAt: '2099-12-06T00:00:00Z', endsAt: '2099-12-06T06:00:00Z' };
      const id = await plan(nora, chatterA, offered.startsAt, offered.endsAt);
      const swap = await propose({ ...offered, id }, chatterB);
      const answer = (userId: string, status: 'accepted' | 'declined' | 'withdrawn') =>
        withTenantMember(test.app.db, nora.creatorId, userId, (tx) =>
          tx
            .update(s.shiftSwapRequests)
            .set({ status, resolvedAt: sql`now()`, resolvedBy: userId })
            .where(eq(s.shiftSwapRequests.id, swap))
            .returning({ id: s.shiftSwapRequests.id }),
        );
      expect(await answer(chatterC, 'declined')).toEqual([]);
      expect(await failure(answer(chatterA, 'accepted'))).toMatch(/row-level security/u);
      expect(await answer(chatterB, 'declined')).toHaveLength(1);
      expect(
        await failure(
          withAdmin(test.admin.db, (tx) =>
            tx
              .update(s.shiftSwapRequests)
              .set({ status: 'proposed' })
              .where(eq(s.shiftSwapRequests.id, swap)),
          ),
        ),
      ).toMatch(/keeps its past/u);
      expect(
        await failure(
          withAdmin(test.admin.db, (tx) =>
            tx
              .update(s.shiftSwapRequests)
              .set({ shiftEndsAt: new Date('2099-12-06T08:00:00Z') })
              .where(eq(s.shiftSwapRequests.id, swap)),
          ),
        ),
      ).toMatch(/keeps its past/u);
    });

    it('a chatter proposes only their own swaps, one open proposal at a time', async () => {
      const offered = { creator: nora, startsAt: '2099-12-07T00:00:00Z', endsAt: '2099-12-07T06:00:00Z' };
      const id = await plan(nora, chatterA, offered.startsAt, offered.endsAt);
      const forged = withTenantMember(test.app.db, nora.creatorId, chatterC, (tx) =>
        tx.insert(s.shiftSwapRequests).values({
          id: newId(ShiftSwapRequestIdSchema),
          creatorId: nora.creatorId,
          shiftId: id,
          requesterId: member(chatterA),
          shiftStartsAt: new Date(offered.startsAt),
          shiftEndsAt: new Date(offered.endsAt),
          targetMemberId: member(chatterC),
          status: 'proposed',
          createdBy: chatterC,
        }),
      );
      expect(await failure(forged)).toMatch(/row-level security/u);
      await propose({ ...offered, id }, chatterB);
      expect(await failure(propose({ ...offered, id }, chatterB))).toMatch(
        /shift_swap_requests_open_unique/u,
      );
    });

    it('the agency reverts an accepted swap and keeps the instant of its acceptance', async () => {
      const offered = { creator: nora, startsAt: '2099-12-08T00:00:00Z', endsAt: '2099-12-08T06:00:00Z' };
      const id = await plan(nora, chatterA, offered.startsAt, offered.endsAt);
      const swap = await propose({ ...offered, id }, chatterB);
      await accept(chatterB, swap, [{ creator: nora, shiftId: id, to: chatterB }]);
      const revert = (resolvedAt: Date | undefined) =>
        withTenantMember(test.app.db, nora.creatorId, manager, async (tx) => {
          await tx
            .update(s.shiftSwapRequests)
            .set({
              status: 'reverted',
              revertedAt: sql`now()`,
              revertedBy: manager,
              ...(resolvedAt && { resolvedAt }),
            })
            .where(eq(s.shiftSwapRequests.id, swap));
          await tx
            .update(s.shifts)
            .set({ memberId: member(chatterA), updatedBy: manager })
            .where(eq(s.shifts.id, id));
        });
      expect(await failure(revert(new Date('2099-01-01T00:00:00Z')))).toMatch(/keeps its past/u);
      expect(await failure(revert(undefined))).toBe('no error');
      expect(await memberOfShift(id)).toBe(member(chatterA));
    });
  });

  describe('leaves', () => {
    const leave = (userId: string, startsAt: string, endsAt: string) => ({
      id: newId(LeaveRequestIdSchema),
      memberId: member(userId),
      firstDay: startsAt.slice(0, 10),
      lastDay: startsAt.slice(0, 10),
      timeZone: 'UTC',
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      status: 'pending',
      createdBy: userId,
    });
    const ask = (userId: string, row: ReturnType<typeof leave>) =>
      withMember(test.app.db, userId, (tx) => tx.insert(s.leaveRequests).values(row));
    const read = (userId: string) =>
      withMember(test.app.db, userId, (tx: Transaction) =>
        tx.select({ id: s.leaveRequests.id }).from(s.leaveRequests),
      ).then((rows) => rows.map((row) => row.id));
    const decide = (userId: string, id: string, status: 'approved' | 'refused') =>
      withMember(test.app.db, userId, (tx) =>
        tx
          .update(s.leaveRequests)
          .set({ status, decidedAt: sql`now()`, decidedBy: userId })
          .where(eq(s.leaveRequests.id, id))
          .returning({ id: s.leaveRequests.id }),
      );

    it('a member asks for their own leave and reads theirs; the agency reads all; a colleague reads none', async () => {
      const mine = leave(chatterA, '2099-12-20T00:00:00Z', '2099-12-21T00:00:00Z');
      expect(await failure(ask(chatterB, mine))).toMatch(/row-level security/u);
      expect(await failure(ask(chatterA, mine))).toBe('no error');
      expect(await read(chatterA)).toContain(mine.id);
      expect(await read(chatterB)).not.toContain(mine.id);
      expect(await read(manager)).toContain(mine.id);
      expect(await read(owner)).toContain(mine.id);
    });

    it('a manager never decides their own leave; a chatter decides none', async () => {
      const managers = leave(manager, '2099-12-22T00:00:00Z', '2099-12-23T00:00:00Z');
      const chatters = leave(chatterB, '2099-12-22T00:00:00Z', '2099-12-23T00:00:00Z');
      await ask(manager, managers);
      await ask(chatterB, chatters);
      expect(await failure(decide(manager, managers.id, 'approved'))).toMatch(/row-level security/u);
      expect(await decide(chatterA, chatters.id, 'approved')).toEqual([]);
      expect(await decide(owner, managers.id, 'approved')).toHaveLength(1);
      expect(await decide(manager, chatters.id, 'refused')).toHaveLength(1);
    });

    it('keeps two pending or approved leaves of a member apart, and frees a withdrawn one', async () => {
      const first = leave(chatterC, '2099-12-24T00:00:00Z', '2099-12-26T00:00:00Z');
      await ask(chatterC, first);
      const overlap = leave(chatterC, '2099-12-25T00:00:00Z', '2099-12-27T00:00:00Z');
      expect(await failure(ask(chatterC, overlap))).toMatch(/leave_requests_member_overlap_excl/u);
      await withMember(test.app.db, chatterC, (tx) =>
        tx
          .update(s.leaveRequests)
          .set({ status: 'withdrawn', cancelledAt: sql`now()`, cancelledBy: chatterC })
          .where(eq(s.leaveRequests.id, first.id)),
      );
      expect(await failure(ask(chatterC, overlap))).toBe('no error');
    });

    it('a leave keeps its days, its approval once cancelled, and moves only forward', async () => {
      const row = leave(chatterA, '2099-12-28T00:00:00Z', '2099-12-29T00:00:00Z');
      await ask(chatterA, row);
      await decide(manager, row.id, 'approved');
      const change = (patch: Partial<typeof s.leaveRequests.$inferInsert>) =>
        failure(
          withAdmin(test.admin.db, (tx) =>
            tx.update(s.leaveRequests).set(patch).where(eq(s.leaveRequests.id, row.id)),
          ),
        );
      expect(await change({ endsAt: new Date('2099-12-30T00:00:00Z') })).toMatch(/keeps its past/u);
      expect(await change({ status: 'pending', decidedAt: null, decidedBy: null })).toMatch(
        /keeps its past/u,
      );
      expect(
        await change({
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelledBy: manager,
          decidedBy: owner,
        }),
      ).toMatch(/keeps its past/u);
      expect(
        await failure(
          withMember(test.app.db, manager, (tx) =>
            tx
              .update(s.leaveRequests)
              .set({ status: 'cancelled', cancelledAt: sql`now()`, cancelledBy: manager })
              .where(eq(s.leaveRequests.id, row.id)),
          ),
        ),
      ).toBe('no error');
      expect(
        await failure(
          withAdmin(test.admin.db, (tx) => tx.delete(s.leaveRequests).where(eq(s.leaveRequests.id, row.id))),
        ),
      ).toMatch(/keeps its past/u);
    });
  });
});
