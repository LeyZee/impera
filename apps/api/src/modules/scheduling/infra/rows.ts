import {
  AuditEntryIdSchema,
  CreatorIdSchema,
  LeaveRequestIdSchema,
  LeaveRequestStatusSchema,
  newId,
  PlatformAccountIdSchema,
  PlatformSchema,
  ShiftIdSchema,
  ShiftTemplateIdSchema,
  TeamMemberIdSchema,
  TeamMemberStatusSchema,
  type CreatorId,
  type TeamMemberId,
} from '@nirvana/contracts';
import { and, eq, inArray, schema, sql, withAdmin, type Database, type Transaction } from '@nirvana/db';
import { z } from 'zod';

import {
  MemberNotFound,
  MemberOnLeave,
  PlatformAccountNotFound,
  ShiftAccountConflict,
  ShiftMemberConflict,
  ShiftReportExists,
} from '../domain/errors';
import { leaveCover } from '../domain/leaves';
import type { Actor, StoredLeave, StoredMember, StoredShift, StoredTemplate } from '../domain/ports';
import {
  assertCanWork,
  assertJoined,
  DEFAULT_SCHEDULING_SETTINGS,
  type WorkingMember,
} from '../domain/shifts';

/** What the planning's stores share: the columns read, their parsing, the audit line, the member lock, the leaves. */

const {
  auditLog,
  leaveRequests,
  platformAccounts,
  schedulingSettings,
  shiftReports,
  shiftTemplates,
  shifts,
  teamMembers,
  user,
} = schema;

export const shiftColumns = {
  id: shifts.id,
  creatorId: shifts.creatorId,
  platformAccountId: shifts.platformAccountId,
  memberId: shifts.memberId,
  startsAt: shifts.startsAt,
  endsAt: shifts.endsAt,
  templateId: shifts.templateId,
  stoppedAt: shifts.stoppedAt,
};

const StoredShiftSchema = z.object({
  id: ShiftIdSchema,
  creatorId: CreatorIdSchema,
  platformAccountId: PlatformAccountIdSchema,
  memberId: TeamMemberIdSchema,
  startsAt: z.date(),
  endsAt: z.date(),
  templateId: ShiftTemplateIdSchema.nullable(),
  stoppedAt: z.date().nullable(),
});

export const templateColumns = {
  id: shiftTemplates.id,
  creatorId: shiftTemplates.creatorId,
  platformAccountId: shiftTemplates.platformAccountId,
  memberId: shiftTemplates.memberId,
  weekday: shiftTemplates.weekday,
  startMinute: shiftTemplates.startMinute,
  endMinute: shiftTemplates.endMinute,
  validFrom: shiftTemplates.validFrom,
  validUntil: shiftTemplates.validUntil,
};

const StoredTemplateSchema = z.object({
  id: ShiftTemplateIdSchema,
  creatorId: CreatorIdSchema,
  platformAccountId: PlatformAccountIdSchema,
  memberId: TeamMemberIdSchema,
  weekday: z.number(),
  startMinute: z.number(),
  endMinute: z.number(),
  validFrom: z.string(),
  validUntil: z.string().nullable(),
});

export const StoredAccountSchema = z.object({
  id: PlatformAccountIdSchema,
  creatorId: CreatorIdSchema,
  platform: PlatformSchema,
  handle: z.string(),
});

export const memberColumns = {
  id: teamMembers.id,
  displayName: teamMembers.displayName,
  color: teamMembers.color,
  status: teamMembers.status,
};

const StoredMemberSchema = z.object({
  id: TeamMemberIdSchema,
  displayName: z.string(),
  color: z.string().nullable(),
  status: TeamMemberStatusSchema,
});

export const toShift = (row: unknown): StoredShift => StoredShiftSchema.parse(row);
export const toTemplate = (row: unknown): StoredTemplate => StoredTemplateSchema.parse(row);
export const toMember = (row: unknown): StoredMember => StoredMemberSchema.parse(row);

/** The signed-in account's member id, which every scope reads; `null` outside the team. */
export async function ownMemberId(tx: Transaction, userId: string): Promise<TeamMemberId | null> {
  const [row] = await tx
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  return row === undefined ? null : TeamMemberIdSchema.parse(row.id);
}

/** The Postgres code and constraint behind a failed query (Drizzle wraps the driver's error as `cause`). */
export function pgErrorOf(error: unknown): { code: string; constraint: string | null } | null {
  for (let current = error; typeof current === 'object' && current !== null;) {
    if ('code' in current && typeof current.code === 'string') {
      const constraint =
        'constraint' in current && typeof current.constraint === 'string' ? current.constraint : null;
      return { code: current.code, constraint };
    }
    current = 'cause' in current ? current.cause : null;
  }
  return null;
}

/** Who did what (append-only, `audit_log`): never a name. */
export async function audit(
  tx: Transaction,
  actor: Actor,
  action: string,
  entity: {
    readonly kind:
      | 'shift'
      | 'shift_template'
      | 'scheduling_settings'
      | 'leave_request'
      | 'shift_swap'
      | 'shift_report'
      | 'account_pay_rules';
    readonly id: string;
  },
  details: Record<string, unknown> = {},
): Promise<void> {
  await tx.insert(auditLog).values({
    id: newId(AuditEntryIdSchema),
    userId: actor.userId,
    action,
    entity: entity.kind,
    entityId: entity.id,
    details,
    ip: actor.ip,
  });
}

/**
 * One lock per member (ADR 0031), taken by every write that puts a shift on a member and by a leave's approval, so
 * that an approval and a new shift at the same moment cannot both win. A transaction-scoped advisory lock, which the
 * policies do not hide; several members in the order of their ids. Every path takes it before locking any row.
 */
export async function lockMembers(tx: Transaction, memberIds: readonly string[]): Promise<void> {
  for (const memberId of [...new Set(memberIds)].toSorted()) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`scheduling.member:${memberId}`}, 0))`,
    );
  }
}

export const leaveColumns = {
  id: leaveRequests.id,
  memberId: leaveRequests.memberId,
  status: leaveRequests.status,
  startsAt: leaveRequests.startsAt,
  endsAt: leaveRequests.endsAt,
  cancelledAt: leaveRequests.cancelledAt,
};

export const StoredLeaveSchema = z.object({
  id: LeaveRequestIdSchema,
  memberId: TeamMemberIdSchema,
  status: LeaveRequestStatusSchema,
  startsAt: z.date(),
  endsAt: z.date(),
  cancelledAt: z.date().nullable(),
});

/**
 * The member's leaves that may cover something in [`from`, `to`): approved or cancelled ones overlapping it (a
 * cancelled one covers up to its cancellation, `leaveCover`). Read by the owner, an active manager or the job; a
 * creator's transaction reads them too, since a leave has no creator.
 */
export async function leavesOf(
  tx: Transaction,
  memberIds: readonly string[],
  from: Date,
  to: Date,
): Promise<StoredLeave[]> {
  if (memberIds.length === 0) return [];
  const rows = await tx
    .select(leaveColumns)
    .from(leaveRequests)
    .where(
      and(
        inArray(leaveRequests.memberId, [...memberIds]),
        inArray(leaveRequests.status, ['approved', 'cancelled']),
        sql`${leaveRequests.startsAt} < ${to}`,
        sql`${leaveRequests.endsAt} > ${from}`,
      ),
    );
  return rows.map((row) => StoredLeaveSchema.parse(row));
}

/** The leave that covers part of [`startsAt`, `endsAt`) for the member, if any. */
export function leaveCovering(
  leaves: readonly StoredLeave[],
  memberId: string,
  startsAt: Date,
  endsAt: Date,
): StoredLeave | undefined {
  return leaves.find((leave) => {
    const cover = leave.memberId === memberId ? leaveCover(leave) : null;
    return (
      cover !== null &&
      cover.startsAt.getTime() < endsAt.getTime() &&
      startsAt.getTime() < cover.endsAt.getTime()
    );
  });
}

/** No shift on a member during their leave: called under the member's lock (`lockMembers`). */
export async function assertNotOnLeave(
  tx: Transaction,
  memberId: string,
  startsAt: Date,
  endsAt: Date,
): Promise<void> {
  const away = leaveCovering(await leavesOf(tx, [memberId], startsAt, endsAt), memberId, startsAt, endsAt);
  if (away !== undefined) throw new MemberOnLeave(away.id);
}

/** What a shift's member must be (`assertCanWork`); `member_not_found` when the member does not exist. */
async function workingMember(tx: Transaction, memberId: TeamMemberId): Promise<WorkingMember> {
  const [member] = await tx
    .select({
      status: teamMembers.status,
      creatorIds: user.creatorIds,
      joinedOn: teamMembers.joinedOn,
      agencyTimeZone: agencyZone,
    })
    .from(teamMembers)
    .innerJoin(user, eq(user.id, teamMembers.userId))
    .where(eq(teamMembers.id, memberId));
  if (member === undefined) throw new MemberNotFound();
  return { ...member, status: TeamMemberStatusSchema.parse(member.status) };
}

/**
 * A shift starting at `startsAt` goes to an `active` member working on its creator, who has joined by then;
 * `member_not_found` when the member does not exist.
 */
export async function assertMemberWorks(
  tx: Transaction,
  memberId: TeamMemberId,
  creatorId: CreatorId,
  startsAt: Date,
): Promise<void> {
  assertCanWork(await workingMember(tx, memberId), creatorId, startsAt);
}

/** A shift of the same member moved to another start: still on or after the day they join. */
export async function assertMemberJoined(
  tx: Transaction,
  memberId: TeamMemberId,
  startsAt: Date,
): Promise<void> {
  assertJoined(await workingMember(tx, memberId), startsAt);
}

/** The account is the creator's: the tenant policy hides any other. */
export async function assertAccountOf(tx: Transaction, platformAccountId: string): Promise<void> {
  const [account] = await tx
    .select({ id: platformAccounts.id })
    .from(platformAccounts)
    .where(eq(platformAccounts.id, platformAccountId));
  if (account === undefined) throw new PlatformAccountNotFound();
}

export interface Placed {
  readonly id: string;
  readonly memberId: string;
  readonly platformAccountId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/**
 * The write, with an exclusion violation (23P01) turned into the module's conflict and the shift in the way, read on
 * the admin connection: it may be on another creator, which this transaction does not see.
 */
export async function placed<T>(adminDb: Database, write: Promise<T>, shift: Placed): Promise<T> {
  try {
    return await write;
  } catch (error) {
    const failure = pgErrorOf(error);
    if (failure?.code !== '23P01') throw error;
    const byMember = failure.constraint === 'shifts_member_overlap_excl';
    const inTheWay = await shiftInTheWayUnscoped(adminDb, shift, byMember ? 'member' : 'account');
    throw byMember ? new ShiftMemberConflict(inTheWay) : new ShiftAccountConflict(inTheWay);
  }
}

async function shiftInTheWayUnscoped(
  adminDb: Database,
  shift: Placed,
  by: 'member' | 'account',
): Promise<string | null> {
  const [row] = await withAdmin(adminDb, (tx) =>
    tx
      .select({ id: shifts.id })
      .from(shifts)
      .where(
        and(
          by === 'member'
            ? eq(shifts.memberId, shift.memberId)
            : eq(shifts.platformAccountId, shift.platformAccountId),
          sql`${shifts.cancelledAt} is null`,
          sql`${shifts.id} <> ${shift.id}`,
          sql`tstzrange(${shifts.startsAt}, ${shifts.endsAt}, '[)') && tstzrange(${shift.startsAt}, ${shift.endsAt}, '[)')`,
        ),
      )
      .limit(1),
  );
  return row?.id ?? null;
}

/**
 * The creator of a shift, a template, a swap, a report or an account, to enter her with `withTenantMember`; the
 * policies then decide.
 */
export async function creatorOfUnscoped(
  adminDb: Database,
  table:
    | typeof shifts
    | typeof shiftTemplates
    | typeof schema.shiftSwapRequests
    | typeof schema.shiftReports
    | typeof platformAccounts,
  id: string,
): Promise<string | null> {
  const [row] = await withAdmin(adminDb, (tx) =>
    tx.select({ creatorId: table.creatorId }).from(table).where(eq(table.id, id)),
  );
  return row?.creatorId ?? null;
}

/**
 * A shift that has its report is no longer cancelled (EQ-03): read by the owner or an active manager, who read every
 * report of the creator, after the shift's row is locked `for update`. A report made at the same moment waits on that
 * lock (its foreign key takes `for key share`) and reads the shift again once it is written; the trigger of migration
 * 0026 holds the rest.
 */
export async function assertNotReported(tx: Transaction, shiftId: string): Promise<void> {
  const [report] = await tx
    .select({ id: shiftReports.id })
    .from(shiftReports)
    .where(and(eq(shiftReports.shiftId, shiftId), sql`${shiftReports.correctsId} is null`));
  if (report !== undefined) throw new ShiftReportExists(report.id);
}

/** The agency's zone as a column, for a read that also takes a member's row (`WorkingMember`). */
export const agencyZone = sql<string>`coalesce((select ${schedulingSettings.timeZone} from ${schedulingSettings} limit 1), ${DEFAULT_SCHEDULING_SETTINGS.timeZone})`;

/**
 * The agency's zone, which the pay periods follow (ADR 0023): the planning's, or its default until the owner sets it.
 * Every team scope reads the settings.
 */
export async function agencyTimeZone(tx: Transaction): Promise<string> {
  const result = await tx.execute<{ zone: string }>(sql`select ${agencyZone} as zone`);
  return result.rows[0]?.zone ?? DEFAULT_SCHEDULING_SETTINGS.timeZone;
}
