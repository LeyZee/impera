import {
  TeamMemberIdSchema,
  TeamMemberStatusSchema,
  type CreatorId,
  type LeaveRequestId,
  type TeamMemberStatus,
} from '@nirvana/contracts';
import {
  and,
  enterCreator,
  eq,
  inArray,
  schema,
  sql,
  SNAPSHOT_READ,
  withMember,
  type Database,
  type Transaction,
} from '@nirvana/db';
import { z } from 'zod';

import {
  LeaveDecided,
  LeaveOverlap,
  LeaveRequestConflict,
  LeaveRequestNotFound,
  LeaveShifts,
  MemberNotActive,
  MemberNotFound,
} from '../domain/errors';
import { assertDecides, assertLeaveStart, leaveEnding, leaveInstants } from '../domain/leaves';
import type { LeaveStore, StoredLeaveRequest } from '../domain/ports';
import { calendarDayIn } from '../domain/time';

import {
  audit,
  leaveColumns,
  lockMembers,
  memberColumns,
  pgErrorOf,
  StoredLeaveSchema,
  toMember,
} from './rows';

const { leaveRequests, shiftSwapRequests, shifts, teamMembers } = schema;

const leaveRequestColumns = {
  ...leaveColumns,
  firstDay: leaveRequests.firstDay,
  lastDay: leaveRequests.lastDay,
  timeZone: leaveRequests.timeZone,
  note: leaveRequests.note,
  decidedAt: leaveRequests.decidedAt,
  decisionNote: leaveRequests.decisionNote,
  createdAt: leaveRequests.createdAt,
};

const StoredLeaveRequestSchema = StoredLeaveSchema.extend({
  firstDay: z.string(),
  lastDay: z.string(),
  timeZone: z.string(),
  note: z.string().nullable(),
  decidedAt: z.date().nullable(),
  decisionNote: z.string().nullable(),
  createdAt: z.date(),
});

const toLeave = (row: unknown): StoredLeaveRequest => StoredLeaveRequestSchema.parse(row);

/** The signed-in account's own member row, which every scope reads; `null` for an account outside the team. */
async function ownMember(
  tx: Transaction,
  userId: string,
): Promise<{ id: string; status: TeamMemberStatus; timeZone: string } | null> {
  const [row] = await tx
    .select({ id: teamMembers.id, status: teamMembers.status, timeZone: teamMembers.timeZone })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  return row === undefined
    ? null
    : {
        id: TeamMemberIdSchema.parse(row.id),
        status: TeamMemberStatusSchema.parse(row.status),
        timeZone: row.timeZone,
      };
}

/** The request as the policies show it, locked when it is about to change. */
async function readLeave(
  tx: Transaction,
  id: LeaveRequestId,
  lock: 'for update' | null = null,
): Promise<StoredLeaveRequest | null> {
  const query = tx.select(leaveRequestColumns).from(leaveRequests).where(eq(leaveRequests.id, id));
  const [row] = lock === null ? await query : await query.for('update');
  return row === undefined ? null : toLeave(row);
}

/**
 * The member's leaves through `withMember` (ADR 0031): a member reads and asks their own, the owner and an active
 * manager read every one and decide. The approval locks the member, then reads their shifts and lapses their swap
 * proposals creator by creator, under the team's policies.
 */
export function createDrizzleLeaveStore(db: Database): LeaveStore {
  return {
    create: (actor, request, now) =>
      withMember(db, actor.userId, async (tx) => {
        const me = await ownMember(tx, actor.userId);
        if (me === null) throw new MemberNotFound();
        if (me.status === 'left') throw new MemberNotActive();
        const existing = await readLeave(tx, request.id);
        if (existing !== null) {
          const same =
            existing.memberId === me.id &&
            existing.firstDay === request.firstDay &&
            existing.lastDay === request.lastDay &&
            existing.note === request.note;
          if (!same) throw new LeaveRequestConflict();
          return { leave: existing, created: false };
        }
        assertLeaveStart(request.firstDay, calendarDayIn(now, me.timeZone));
        const { startsAt, endsAt } = leaveInstants(request.firstDay, request.lastDay, me.timeZone);
        try {
          await tx.transaction((savepoint) =>
            savepoint.insert(leaveRequests).values({
              ...request,
              memberId: me.id,
              timeZone: me.timeZone,
              startsAt,
              endsAt,
              status: 'pending',
              createdBy: actor.userId,
            }),
          );
        } catch (error) {
          const failure = pgErrorOf(error);
          // The same id is someone else's request, which this member does not see.
          if (failure?.code === '23505') throw new LeaveRequestConflict();
          if (failure?.code !== '23P01') throw error;
          const [overlapping] = await tx
            .select({ id: leaveRequests.id })
            .from(leaveRequests)
            .where(
              and(
                eq(leaveRequests.memberId, me.id),
                inArray(leaveRequests.status, ['pending', 'approved']),
                sql`${leaveRequests.startsAt} < ${endsAt}`,
                sql`${leaveRequests.endsAt} > ${startsAt}`,
              ),
            )
            .limit(1);
          throw new LeaveOverlap(overlapping?.id ?? null);
        }
        await audit(tx, actor, 'leave_request.create', { kind: 'leave_request', id: request.id });
        const leave = await readLeave(tx, request.id);
        if (leave === null) throw new LeaveRequestNotFound();
        return { leave, created: true };
      }),

    decide: (actor, id, decision, creatorIds, now) =>
      withMember(db, actor.userId, async (tx, scope) => {
        const seen = await readLeave(tx, id);
        if (seen === null) throw new LeaveRequestNotFound();
        const own = seen.memberId === (await ownMember(tx, actor.userId))?.id;
        assertDecides(scope, { status: seen.status, own });
        const approving = decision.decision === 'approve';
        // The member's lock first, as every write that puts a shift on them takes it: neither wins unseen.
        if (approving) await lockMembers(tx, [seen.memberId]);
        const leave = await readLeave(tx, id, 'for update');
        if (leave === null) throw new LeaveRequestNotFound();
        assertDecides(scope, { status: leave.status, own });
        let lapsedSwaps = 0;
        if (approving) {
          lapsedSwaps = await clearLeave(tx, leave, creatorIds, actor.userId, now);
        }
        await tx
          .update(leaveRequests)
          .set({
            status: approving ? 'approved' : 'refused',
            decidedAt: now,
            decidedBy: actor.userId,
            decisionNote: decision.note,
            updatedAt: now,
          })
          .where(eq(leaveRequests.id, id));
        await audit(
          tx,
          actor,
          approving ? 'leave_request.approve' : 'leave_request.refuse',
          { kind: 'leave_request', id },
          approving ? { lapsedSwaps } : {},
        );
        const decided = await readLeave(tx, id);
        if (decided === null) throw new LeaveRequestNotFound();
        return decided;
      }),

    end: (actor, id, now) =>
      withMember(db, actor.userId, async (tx, scope) => {
        const seen = await readLeave(tx, id);
        if (seen === null) throw new LeaveRequestNotFound();
        const own = seen.memberId === (await ownMember(tx, actor.userId))?.id;
        const ending = leaveEnding(scope, { status: seen.status, own, endsAt: seen.endsAt }, now);
        const leave = await readLeave(tx, id, 'for update');
        if (leave?.status !== seen.status) throw new LeaveDecided();
        await tx
          .update(leaveRequests)
          .set({
            status: ending === 'withdraw' ? 'withdrawn' : 'cancelled',
            cancelledAt: now,
            cancelledBy: actor.userId,
            updatedAt: now,
          })
          .where(eq(leaveRequests.id, id));
        await audit(tx, actor, ending === 'withdraw' ? 'leave_request.withdraw' : 'leave_request.cancel', {
          kind: 'leave_request',
          id,
        });
      }),

    list: (actor, range) =>
      withMember(
        db,
        actor,
        async (tx) => {
          const rows = await tx
            .select(leaveRequestColumns)
            .from(leaveRequests)
            .where(
              and(
                sql`${leaveRequests.status} <> 'withdrawn'`,
                sql`${leaveRequests.startsAt} < ${range.to}`,
                sql`${leaveRequests.endsAt} > ${range.from}`,
              ),
            );
          const leaves = rows
            .map(toLeave)
            .toSorted((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id));
          const named = [...new Set(leaves.map((leave) => leave.memberId))];
          const members =
            named.length === 0
              ? []
              : await tx.select(memberColumns).from(teamMembers).where(inArray(teamMembers.id, named));
          return { leaves, members: members.map(toMember) };
        },
        SNAPSHOT_READ,
      ),
  };
}

/**
 * Before an approval, under the member's lock: no shift of theirs that has not ended may still cover the leave
 * (`leave_shifts_conflict`, to give them to someone else first), and the swap proposals that would give them a shift
 * during it lapse. Creator by creator, under the team's policies; how many proposals lapsed.
 */
async function clearLeave(
  tx: Transaction,
  leave: StoredLeaveRequest,
  creatorIds: readonly CreatorId[],
  userId: string,
  now: Date,
): Promise<number> {
  const during = (startsAt: unknown, endsAt: unknown) =>
    sql`tstzrange(${startsAt}, ${endsAt}, '[)') && tstzrange(${leave.startsAt}, ${leave.endsAt}, '[)')`;
  const inTheWay: string[] = [];
  for (const creatorId of creatorIds) {
    await enterCreator(tx, creatorId, creatorIds);
    const rows = await tx
      .select({ id: shifts.id })
      .from(shifts)
      .where(
        and(
          eq(shifts.memberId, leave.memberId),
          sql`${shifts.cancelledAt} is null`,
          sql`${shifts.endsAt} > ${now}`,
          during(shifts.startsAt, shifts.endsAt),
        ),
      );
    inTheWay.push(...rows.map((row) => row.id));
  }
  if (inTheWay.length > 0) throw new LeaveShifts(inTheWay.toSorted());
  const lapsed = new Set<string>();
  for (const creatorId of creatorIds) {
    await enterCreator(tx, creatorId, creatorIds);
    const rows = await tx
      .update(shiftSwapRequests)
      .set({ status: 'lapsed', resolvedAt: sql`now()`, resolvedBy: userId, updatedAt: now })
      .where(
        and(
          eq(shiftSwapRequests.status, 'proposed'),
          sql`((${shiftSwapRequests.targetMemberId} = ${leave.memberId} and ${during(shiftSwapRequests.shiftStartsAt, shiftSwapRequests.shiftEndsAt)}) or (${shiftSwapRequests.requesterId} = ${leave.memberId} and ${shiftSwapRequests.targetShiftId} is not null and ${during(shiftSwapRequests.targetShiftStartsAt, shiftSwapRequests.targetShiftEndsAt)}))`,
        ),
      )
      .returning({ id: shiftSwapRequests.id });
    for (const row of rows) lapsed.add(row.id);
  }
  return lapsed.size;
}
