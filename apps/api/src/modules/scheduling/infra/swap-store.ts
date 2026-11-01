import {
  CreatorIdSchema,
  ShiftIdSchema,
  ShiftSwapRequestIdSchema,
  ShiftSwapStatusSchema,
  TeamMemberIdSchema,
  TeamMemberStatusSchema,
  type ShiftSwapRequestId,
} from '@nirvana/contracts';
import {
  and,
  enterCreator,
  eq,
  inArray,
  schema,
  sql,
  SNAPSHOT_READ,
  withAdmin,
  withMember,
  withTenantMember,
  type Database,
  type Transaction,
} from '@nirvana/db';
import { z } from 'zod';

import {
  MemberNotFound,
  MemberOnLeave,
  ShiftMemberConflict,
  ShiftNotFound,
  ShiftSwapAnswered,
  ShiftSwapConflict,
  ShiftSwapLapsed,
  ShiftSwapNotFound,
  ShiftSwapOpen,
  ShiftSwapRevert,
} from '../domain/errors';
import type { ColleagueReads, StoredAccount, StoredShift, StoredSwap, SwapStore } from '../domain/ports';
import { assertCanWork, type WorkingMember } from '../domain/shifts';
import {
  assertAnswers,
  assertColleague,
  assertOffered,
  stillAsNoted,
  swapEnding,
  type SwapShiftNow,
} from '../domain/swaps';

import {
  assertMemberWorks,
  assertNotOnLeave,
  agencyZone,
  audit,
  creatorOfUnscoped,
  lockMembers,
  ownMemberId,
  pgErrorOf,
  shiftColumns,
  StoredAccountSchema,
  toShift,
} from './rows';

const { platformAccounts, shiftSwapRequests, shifts, teamMembers, user } = schema;

/**
 * The shift that keeps a member of a swap off the one they would get, read on the admin connection (it may be on
 * another creator); the shifts the swap moves are not in the way, whoever holds them now. With `reader`, only a shift
 * of that member is named (ADR 0031: a colleague's shift never is); `null` when the shift in the way is the other's.
 */
async function inTheWayOfMovesUnscoped(
  adminDb: Database,
  moves: readonly Move[],
  reader: string | null,
): Promise<string | null> {
  const moved = moves.map((move) => move.shiftId);
  for (const move of moves) {
    if (reader !== null && move.to !== reader) continue;
    const [row] = await withAdmin(adminDb, (tx) =>
      tx
        .select({ id: shifts.id })
        .from(shifts)
        .where(
          and(
            eq(shifts.memberId, move.to),
            sql`${shifts.cancelledAt} is null`,
            sql`not ${inArray(shifts.id, moved)}`,
            sql`tstzrange(${shifts.startsAt}, ${shifts.endsAt}, '[)') && tstzrange(${move.startsAt}, ${move.endsAt}, '[)')`,
          ),
        )
        .limit(1),
    );
    if (row !== undefined) return row.id;
  }
  return null;
}

const swapColumns = {
  id: shiftSwapRequests.id,
  creatorId: shiftSwapRequests.creatorId,
  shiftId: shiftSwapRequests.shiftId,
  requesterId: shiftSwapRequests.requesterId,
  shiftStartsAt: shiftSwapRequests.shiftStartsAt,
  shiftEndsAt: shiftSwapRequests.shiftEndsAt,
  targetMemberId: shiftSwapRequests.targetMemberId,
  targetCreatorId: shiftSwapRequests.targetCreatorId,
  targetShiftId: shiftSwapRequests.targetShiftId,
  targetShiftStartsAt: shiftSwapRequests.targetShiftStartsAt,
  targetShiftEndsAt: shiftSwapRequests.targetShiftEndsAt,
  message: shiftSwapRequests.message,
  status: shiftSwapRequests.status,
  resolvedAt: shiftSwapRequests.resolvedAt,
  revertedAt: shiftSwapRequests.revertedAt,
  createdAt: shiftSwapRequests.createdAt,
  // The requester's account wrote the proposal; anyone else who withdrew it planned.
  createdBy: shiftSwapRequests.createdBy,
  resolvedBy: shiftSwapRequests.resolvedBy,
};

const StoredSwapSchema = z.object({
  id: ShiftSwapRequestIdSchema,
  creatorId: CreatorIdSchema,
  shiftId: ShiftIdSchema,
  requesterId: TeamMemberIdSchema,
  shiftStartsAt: z.date(),
  shiftEndsAt: z.date(),
  targetMemberId: TeamMemberIdSchema,
  targetCreatorId: CreatorIdSchema.nullable(),
  targetShiftId: ShiftIdSchema.nullable(),
  targetShiftStartsAt: z.date().nullable(),
  targetShiftEndsAt: z.date().nullable(),
  message: z.string().nullable(),
  status: ShiftSwapStatusSchema,
  resolvedAt: z.date().nullable(),
  revertedAt: z.date().nullable(),
  createdAt: z.date(),
  createdBy: z.string(),
  resolvedBy: z.string().nullable(),
});

function toSwap(row: unknown): StoredSwap {
  const { createdBy, resolvedBy, ...swap } = StoredSwapSchema.parse(row);
  return { ...swap, withdrawnByAgency: swap.status === 'withdrawn' && resolvedBy !== createdBy };
}

/** The swap as the policies show it, locked when it is about to change. */
async function readSwap(
  tx: Transaction,
  id: ShiftSwapRequestId,
  lock: 'for update' | null = null,
): Promise<StoredSwap | null> {
  const query = tx.select(swapColumns).from(shiftSwapRequests).where(eq(shiftSwapRequests.id, id));
  const [row] = lock === null ? await query : await query.for('update');
  return row === undefined ? null : toSwap(row);
}

/** The signed-in member's own status and creators, to take a shift by a swap like one set by hand. */
async function ownWork(tx: Transaction, userId: string): Promise<WorkingMember> {
  const [row] = await tx
    .select({
      status: teamMembers.status,
      creatorIds: user.creatorIds,
      joinedOn: teamMembers.joinedOn,
      agencyTimeZone: agencyZone,
    })
    .from(teamMembers)
    .innerJoin(user, eq(user.id, teamMembers.userId))
    .where(eq(teamMembers.userId, userId));
  if (row === undefined) throw new MemberNotFound();
  return { ...row, status: TeamMemberStatusSchema.parse(row.status) };
}

/** A shift as a swap sees it now, in the creator the transaction stands in; `null` when the policies hide it. */
async function shiftNow(tx: Transaction, id: string): Promise<(StoredShift & SwapShiftNow) | null> {
  const [row] = await tx
    .select({ ...shiftColumns, cancelledAt: shifts.cancelledAt })
    .from(shifts)
    .where(eq(shifts.id, id));
  return row === undefined ? null : { ...toShift(row), cancelled: row.cancelledAt !== null };
}

interface Move {
  readonly shiftId: string;
  readonly creatorId: string;
  readonly from: string;
  readonly to: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** The move of an exchange's target shift, back to the requester; `null` for a shift given. */
function backOf(swap: StoredSwap): Move | null {
  if (
    swap.targetShiftId === null ||
    swap.targetCreatorId === null ||
    swap.targetShiftStartsAt === null ||
    swap.targetShiftEndsAt === null
  ) {
    return null;
  }
  return {
    shiftId: swap.targetShiftId,
    creatorId: swap.targetCreatorId,
    from: swap.targetMemberId,
    to: swap.requesterId,
    startsAt: swap.targetShiftStartsAt,
    endsAt: swap.targetShiftEndsAt,
  };
}

/** Thrown inside the moves' savepoint when a shift is no longer as the swap noted it. */
class NotAsNoted extends Error {}

/**
 * The shifts change hands in a savepoint, each in its creator, only if each is still as the swap noted it: with its
 * member, its hours, neither cancelled nor started (checked again by the update itself, after any lock it waited
 * on). The member exclusion waits for the end of the moves, so that two shifts at the same hours can be exchanged.
 * An exclusion still violated then answers the module's conflict, with the shift in the way when `write.reader` may
 * read it: the colleague who accepts names only their own (`null` names any, for the owner and an active manager).
 */
async function moveShifts(
  tx: Transaction,
  adminDb: Database,
  moves: readonly Move[],
  write: {
    readonly by: string;
    readonly now: Date;
    readonly allowed: readonly string[];
    readonly reader: string | null;
  },
  first: (savepoint: Transaction) => Promise<void>,
): Promise<void> {
  try {
    await tx.transaction(async (savepoint) => {
      await savepoint.execute(sql`set constraints shifts_member_overlap_excl deferred`);
      await first(savepoint);
      for (const move of moves) {
        await enterCreator(savepoint, move.creatorId, write.allowed);
        const moved = await savepoint
          .update(shifts)
          .set({ memberId: move.to, updatedBy: write.by, updatedAt: write.now })
          .where(
            and(
              eq(shifts.id, move.shiftId),
              eq(shifts.memberId, move.from),
              eq(shifts.startsAt, move.startsAt),
              eq(shifts.endsAt, move.endsAt),
              sql`${shifts.cancelledAt} is null`,
              sql`${shifts.startsAt} > ${write.now}`,
            ),
          )
          .returning({ id: shifts.id });
        if (moved.length === 0) throw new NotAsNoted();
      }
      await savepoint.execute(sql`set constraints shifts_member_overlap_excl immediate`);
    });
  } catch (error) {
    // A swap changes members only, never accounts: the member exclusion is the one a move can break.
    const failure = pgErrorOf(error);
    if (failure?.code !== '23P01' || failure.constraint !== 'shifts_member_overlap_excl') throw error;
    throw new ShiftMemberConflict(await inTheWayOfMovesUnscoped(adminDb, moves, write.reader));
  }
}

/** The proposals left behind by an acceptance or a revert lapse just after, by `scheduling.lapse_swaps` (ADR 0031). */
async function enqueueLapse(tx: Transaction): Promise<void> {
  await tx.execute(
    sql`select public.enqueue_job(
      task => 'scheduling.lapse_swaps',
      payload => '{}'::jsonb,
      max_attempts => 1,
      job_key => 'scheduling.lapse_swaps',
      job_key_mode => 'replace'
    )`,
  );
}

/**
 * The swaps through `withTenantMember` (ADR 0031): every write stays under the policies, the colleague's acceptance
 * through the dedicated ones on `shifts` (the swap accepted in this transaction is its proof). What a chatter's
 * policies hide of the other side, a colleague's status or shift, is read through `ColleagueReads`, bounded.
 */
export function createDrizzleSwapStore(
  db: Database,
  adminDb: Database,
  colleagues: ColleagueReads,
): SwapStore {
  const creatorOfSwap = async (id: ShiftSwapRequestId): Promise<string> => {
    const creatorId = await creatorOfUnscoped(adminDb, shiftSwapRequests, id);
    if (creatorId === null) throw new ShiftSwapNotFound();
    return creatorId;
  };

  const lapse = async (tx: Transaction, id: ShiftSwapRequestId, by: string, now: Date): Promise<void> => {
    await tx
      .update(shiftSwapRequests)
      .set({ status: 'lapsed', resolvedAt: sql`now()`, resolvedBy: by, updatedAt: now })
      .where(eq(shiftSwapRequests.id, id));
  };

  return {
    propose: async (actor, swap, now) => {
      const creatorId = await creatorOfUnscoped(adminDb, shifts, swap.shiftId);
      if (creatorId === null) throw new ShiftNotFound();
      return withTenantMember(db, creatorId, actor.userId, async (tx) => {
        const me = await ownMemberId(tx, actor.userId);
        if (me === null) throw new ShiftNotFound();
        const existing = await readSwap(tx, swap.id);
        if (existing !== null) {
          const same =
            existing.requesterId === me &&
            existing.shiftId === swap.shiftId &&
            existing.targetMemberId === swap.targetMemberId &&
            existing.targetShiftId === swap.targetShiftId &&
            existing.message === swap.message;
          if (!same) throw new ShiftSwapConflict();
          return { swap: existing, created: false };
        }
        const offered = await shiftNow(tx, swap.shiftId);
        assertOffered(offered, me, now);
        assertColleague(me, swap.targetMemberId);
        const colleague = await colleagues.memberWorkUnscoped(swap.targetMemberId);
        if (colleague === null) throw new MemberNotFound();
        assertCanWork(colleague, offered.creatorId, offered.startsAt);
        const back = swap.targetShiftId === null ? null : await colleagues.shiftUnscoped(swap.targetShiftId);
        if (swap.targetShiftId !== null) {
          assertOffered(back, swap.targetMemberId, now);
          assertCanWork(await ownWork(tx, actor.userId), back.creatorId, back.startsAt);
          // The requester reads their own leaves: no shift comes back to them during one.
          await assertNotOnLeave(tx, me, back.startsAt, back.endsAt);
        }
        // Nobody on two shifts at once, whatever the creator: an acceptance would always fail. The colleague's shift in
        // the way is not the requester's, so it is never named; the requester's own is.
        const busy = await colleagues.overlappingShiftUnscoped(
          swap.targetMemberId,
          offered,
          back === null ? [] : [back.id],
        );
        if (busy !== null) throw new ShiftMemberConflict(null);
        if (back !== null) {
          const mine = await colleagues.overlappingShiftUnscoped(me, back, [offered.id]);
          if (mine !== null) throw new ShiftMemberConflict(mine);
        }
        try {
          await tx.transaction((savepoint) =>
            savepoint.insert(shiftSwapRequests).values({
              id: swap.id,
              creatorId: offered.creatorId,
              shiftId: offered.id,
              requesterId: me,
              shiftStartsAt: offered.startsAt,
              shiftEndsAt: offered.endsAt,
              targetMemberId: swap.targetMemberId,
              targetCreatorId: back?.creatorId ?? null,
              targetShiftId: back?.id ?? null,
              targetShiftStartsAt: back?.startsAt ?? null,
              targetShiftEndsAt: back?.endsAt ?? null,
              message: swap.message,
              status: 'proposed',
              createdBy: actor.userId,
            }),
          );
        } catch (error) {
          const failure = pgErrorOf(error);
          if (failure?.code !== '23505') throw error;
          if (failure.constraint !== 'shift_swap_requests_open_unique') throw new ShiftSwapConflict();
          const [open] = await tx
            .select({ id: shiftSwapRequests.id })
            .from(shiftSwapRequests)
            .where(
              and(
                eq(shiftSwapRequests.shiftId, offered.id),
                eq(shiftSwapRequests.targetMemberId, swap.targetMemberId),
                eq(shiftSwapRequests.status, 'proposed'),
                swap.targetShiftId === null
                  ? sql`${shiftSwapRequests.targetShiftId} is null`
                  : eq(shiftSwapRequests.targetShiftId, swap.targetShiftId),
              ),
            );
          throw new ShiftSwapOpen(open?.id ?? null);
        }
        await audit(tx, actor, 'shift_swap.propose', { kind: 'shift_swap', id: swap.id });
        const stored = await readSwap(tx, swap.id);
        if (stored === null) throw new ShiftSwapNotFound();
        return { swap: stored, created: true };
      });
    },

    answer: async (actor, id, answer, now) => {
      const creatorId = await creatorOfSwap(id);
      const outcome = await withTenantMember(db, creatorId, actor.userId, async (tx) => {
        const seen = await readSwap(tx, id);
        if (seen === null) throw new ShiftSwapNotFound();
        const me = await ownMemberId(tx, actor.userId);
        assertAnswers({ status: seen.status, asked: seen.targetMemberId === me });
        // Both members' locks before any row, as every write that puts a shift on a member takes them.
        if (answer === 'accept') await lockMembers(tx, [seen.requesterId, seen.targetMemberId]);
        const swap = await readSwap(tx, id, 'for update');
        if (swap?.status !== 'proposed') throw new ShiftSwapAnswered();
        if (answer === 'decline') {
          await tx
            .update(shiftSwapRequests)
            .set({ status: 'declined', resolvedAt: sql`now()`, resolvedBy: actor.userId, updatedAt: now })
            .where(eq(shiftSwapRequests.id, id));
          await audit(tx, actor, 'shift_swap.decline', { kind: 'shift_swap', id });
          return { lapsed: false };
        }
        const allowed = [swap.creatorId, ...(swap.targetCreatorId === null ? [] : [swap.targetCreatorId])];
        const moves: Move[] = [
          {
            shiftId: swap.shiftId,
            creatorId: swap.creatorId,
            from: swap.requesterId,
            to: swap.targetMemberId,
            startsAt: swap.shiftStartsAt,
            endsAt: swap.shiftEndsAt,
          },
        ];
        const noted = { memberId: swap.requesterId, startsAt: swap.shiftStartsAt, endsAt: swap.shiftEndsAt };
        let holds = stillAsNoted(await shiftNow(tx, swap.shiftId), noted, now);
        const back = backOf(swap);
        if (back !== null) {
          moves.push(back);
          await enterCreator(tx, back.creatorId, allowed);
          holds &&= stillAsNoted(await shiftNow(tx, back.shiftId), { ...back, memberId: back.from }, now);
          await enterCreator(tx, swap.creatorId, allowed);
        }
        if (!holds) {
          await lapse(tx, id, actor.userId, now);
          return { lapsed: true };
        }
        // The rules of a shift set by hand: the colleague can take it and is not on leave then.
        assertCanWork(await ownWork(tx, actor.userId), swap.creatorId, swap.shiftStartsAt);
        await assertNotOnLeave(tx, swap.targetMemberId, swap.shiftStartsAt, swap.shiftEndsAt);
        if (back !== null) {
          const requester = await colleagues.memberWorkUnscoped(swap.requesterId);
          if (requester === null) throw new MemberNotFound();
          assertCanWork(requester, back.creatorId, back.startsAt);
          // The approval of the requester's leave lapses such a proposal under the same lock; read again here, past
          // the colleague's policies, so that no path gives them a shift during a leave. The leave itself is not said.
          if (await colleagues.onLeaveUnscoped(swap.requesterId, back)) throw new MemberOnLeave(null);
        }
        try {
          const write = { by: actor.userId, now, allowed, reader: swap.targetMemberId };
          await moveShifts(tx, adminDb, moves, write, async (savepoint) => {
            await savepoint
              .update(shiftSwapRequests)
              .set({ status: 'accepted', resolvedAt: sql`now()`, resolvedBy: actor.userId, updatedAt: now })
              .where(eq(shiftSwapRequests.id, id));
          });
        } catch (error) {
          if (!(error instanceof NotAsNoted)) throw error;
          await lapse(tx, id, actor.userId, now);
          return { lapsed: true };
        }
        await enqueueLapse(tx);
        await audit(tx, actor, 'shift_swap.accept', { kind: 'shift_swap', id });
        return { lapsed: false };
      });
      // Recorded `lapsed` first, then said: what the colleague was asked is no longer what would happen.
      if (outcome.lapsed) throw new ShiftSwapLapsed();
      return withTenantMember(db, creatorId, actor.userId, async (tx) => {
        const swap = await readSwap(tx, id);
        if (swap === null) throw new ShiftSwapNotFound();
        return swap;
      });
    },

    end: async (actor, id, now) => {
      const creatorId = await creatorOfSwap(id);
      await withTenantMember(db, creatorId, actor.userId, async (tx, scope) => {
        const seen = await readSwap(tx, id);
        if (seen === null) throw new ShiftSwapNotFound();
        const me = await ownMemberId(tx, actor.userId);
        const ending = swapEnding(scope, { status: seen.status, requested: seen.requesterId === me });
        if (ending === 'withdraw') {
          const swap = await readSwap(tx, id, 'for update');
          if (swap?.status !== 'proposed') throw new ShiftSwapAnswered();
          await tx
            .update(shiftSwapRequests)
            .set({ status: 'withdrawn', resolvedAt: sql`now()`, resolvedBy: actor.userId, updatedAt: now })
            .where(eq(shiftSwapRequests.id, id));
          await audit(tx, actor, 'shift_swap.withdraw', { kind: 'shift_swap', id });
          return;
        }
        await lockMembers(tx, [seen.requesterId, seen.targetMemberId]);
        const swap = await readSwap(tx, id, 'for update');
        if (swap?.status !== 'accepted') throw new ShiftSwapAnswered();
        const allowed = [swap.creatorId, ...(swap.targetCreatorId === null ? [] : [swap.targetCreatorId])];
        // Each shift goes back under the rules of a shift set by hand; the owner and an active manager read both.
        const given = backOf(swap);
        const moves: Move[] = [
          {
            shiftId: swap.shiftId,
            creatorId: swap.creatorId,
            from: swap.targetMemberId,
            to: swap.requesterId,
            startsAt: swap.shiftStartsAt,
            endsAt: swap.shiftEndsAt,
          },
          ...(given === null ? [] : [{ ...given, from: given.to, to: given.from }]),
        ];
        for (const move of moves) {
          await enterCreator(tx, move.creatorId, allowed);
          await assertMemberWorks(
            tx,
            TeamMemberIdSchema.parse(move.to),
            CreatorIdSchema.parse(move.creatorId),
            move.startsAt,
          );
          await assertNotOnLeave(tx, move.to, move.startsAt, move.endsAt);
        }
        await enterCreator(tx, swap.creatorId, allowed);
        try {
          const write = { by: actor.userId, now, allowed, reader: null };
          await moveShifts(tx, adminDb, moves, write, async (savepoint) => {
            await savepoint
              .update(shiftSwapRequests)
              .set({ status: 'reverted', revertedAt: sql`now()`, revertedBy: actor.userId, updatedAt: now })
              .where(eq(shiftSwapRequests.id, id));
          });
        } catch (error) {
          if (error instanceof NotAsNoted) throw new ShiftSwapRevert();
          throw error;
        }
        await enqueueLapse(tx);
        await audit(tx, actor, 'shift_swap.revert', { kind: 'shift_swap', id });
      });
    },

    list: (actor, creatorIds, since) =>
      withMember(
        db,
        actor,
        async (tx) => {
          const swaps = new Map<string, StoredSwap>();
          for (const creatorId of creatorIds) {
            await enterCreator(tx, creatorId, creatorIds);
            const rows = await tx
              .select(swapColumns)
              .from(shiftSwapRequests)
              .where(
                sql`${shiftSwapRequests.status} = 'proposed' or coalesce(${shiftSwapRequests.revertedAt}, ${shiftSwapRequests.resolvedAt}) >= ${since}`,
              );
            for (const row of rows) swaps.set(row.id, toSwap(row));
          }
          const found: { shifts: StoredShift[]; accounts: StoredAccount[] } = { shifts: [], accounts: [] };
          for (const creatorId of creatorIds) {
            const named = [...swaps.values()].flatMap((swap) => [
              ...(swap.creatorId === creatorId ? [swap.shiftId] : []),
              ...(swap.targetCreatorId === creatorId && swap.targetShiftId !== null
                ? [swap.targetShiftId]
                : []),
            ]);
            if (named.length === 0) continue;
            await enterCreator(tx, creatorId, creatorIds);
            const rows = await tx
              .select(shiftColumns)
              .from(shifts)
              .where(and(inArray(shifts.id, named), sql`${shifts.cancelledAt} is null`));
            found.shifts.push(...rows.map(toShift));
            const accounts = await tx
              .select({
                id: platformAccounts.id,
                creatorId: platformAccounts.creatorId,
                platform: platformAccounts.platform,
                handle: platformAccounts.handle,
              })
              .from(platformAccounts);
            found.accounts.push(...accounts.map((row) => StoredAccountSchema.parse(row)));
          }
          const listed = [...swaps.values()].toSorted(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id),
          );
          return { swaps: listed, ...found };
        },
        SNAPSHOT_READ,
      ),

    offeredShift: async (actor, id, now) => {
      const creatorId = await creatorOfUnscoped(adminDb, shifts, id);
      if (creatorId === null) throw new ShiftNotFound();
      return withTenantMember(db, creatorId, actor, async (tx) => {
        const me = await ownMemberId(tx, actor);
        if (me === null) throw new ShiftNotFound();
        const shift = await shiftNow(tx, id);
        assertOffered(shift, me, now);
        const work = await ownWork(tx, actor);
        return { shift, creatorIds: work.creatorIds.map((one) => CreatorIdSchema.parse(one)) };
      });
    },
  };
}
