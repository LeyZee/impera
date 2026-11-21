import {
  CreatorIdSchema,
  JOB_MAX_ATTEMPTS,
  PayPeriodSchema,
  PlatformAccountIdSchema,
  ReportSignalSchema,
  ShiftFeedbackIdSchema,
  ShiftIdSchema,
  TeamMemberIdSchema,
  type CreatorId,
  type ShiftFeedbackId,
  type ShiftId,
} from '@impera/contracts';
import {
  and,
  enterCreator,
  eq,
  inArray,
  schema,
  sql,
  SNAPSHOT_READ,
  withMember,
  withTenantMember,
  type Database,
  type Transaction,
} from '@impera/db';
import { z } from 'zod';

import {
  ShiftFeedbackConflict,
  ShiftFeedbackExists,
  ShiftFeedbackForbidden,
  ShiftFeedbackNotFound,
  ShiftIncidentForbidden,
  ShiftNotFound,
} from '../domain/errors';
import type {
  ShiftFeedbackInput,
  ShiftFeedbackListRead,
  ShiftFeedbackStore,
  StoredAccount,
  StoredShiftFeedback,
} from '../domain/ports';
import { assertFeedbackDue, isAgency, shiftPeriod } from '../domain/reports';

import {
  agencyTimeZone,
  audit,
  creatorOfUnscoped,
  memberColumns,
  ownMemberId,
  pgErrorOf,
  RulesRowSchema,
  shiftColumns,
  StoredAccountSchema,
  toMember,
  toShift,
} from './rows';

const { accountPayRules, platformAccounts, shiftFeedbacks, shiftIncidentSteps, shifts, teamMembers } = schema;

/** When its incident was first looked at: « Vu », or « Réglé » said straight away. */
const seenAt = sql`(select min(s.said_at) from shift_incident_steps s where s.shift_feedback_id = ${shiftFeedbacks.id})`;
const resolvedAt = sql`(select s.said_at from shift_incident_steps s where s.shift_feedback_id = ${shiftFeedbacks.id} and s.step = 'resolved')`;

const feedbackColumns = {
  id: shiftFeedbacks.id,
  shiftId: shiftFeedbacks.shiftId,
  creatorId: shiftFeedbacks.creatorId,
  platformAccountId: shiftFeedbacks.platformAccountId,
  memberId: shiftFeedbacks.memberId,
  period: shiftFeedbacks.period,
  nothingToReport: shiftFeedbacks.nothingToReport,
  comment: shiftFeedbacks.comment,
  incident: shiftFeedbacks.incident,
  signals: shiftFeedbacks.signals,
  createdAt: shiftFeedbacks.createdAt,
  incidentSeenAt: seenAt,
  incidentResolvedAt: resolvedAt,
};

const StoredShiftFeedbackSchema = z.object({
  id: ShiftFeedbackIdSchema,
  shiftId: ShiftIdSchema,
  creatorId: CreatorIdSchema,
  platformAccountId: PlatformAccountIdSchema,
  memberId: TeamMemberIdSchema,
  period: PayPeriodSchema,
  nothingToReport: z.boolean(),
  comment: z.string().nullable(),
  incident: z.string().nullable(),
  signals: z.array(ReportSignalSchema),
  createdAt: z.date(),
  // Read through a subquery: Postgres gives the instant back as text there.
  incidentSeenAt: z.coerce.date().nullable(),
  incidentResolvedAt: z.coerce.date().nullable(),
});

const accountColumns = {
  id: platformAccounts.id,
  creatorId: platformAccounts.creatorId,
  platform: platformAccounts.platform,
  handle: platformAccounts.handle,
};

/** Incidents not « Réglé » first, then the most recent: what the agency still has to look at leads. */
const byUrgency = (a: StoredShiftFeedback, b: StoredShiftFeedback): number => {
  const open = (one: StoredShiftFeedback) =>
    one.incident !== null && one.incidentResolvedAt === null ? 0 : 1;
  return open(a) - open(b) || b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id);
};

async function feedbackWhere(
  tx: Transaction,
  column: typeof shiftFeedbacks.id | typeof shiftFeedbacks.shiftId,
  value: string,
): Promise<{ feedback: StoredShiftFeedback; createdBy: string } | null> {
  const [row] = await tx
    .select({ ...feedbackColumns, createdBy: shiftFeedbacks.createdBy })
    .from(shiftFeedbacks)
    .where(eq(column, value));
  return row === undefined
    ? null
    : { feedback: StoredShiftFeedbackSchema.parse(row), createdBy: row.createdBy };
}

/** The same feedback, sent again by the same person: what a retry of the panel sends. */
function sameAs(
  { feedback: stored, createdBy }: { feedback: StoredShiftFeedback; createdBy: string },
  by: string,
  shiftId: ShiftId,
  sent: ShiftFeedbackInput,
) {
  return (
    createdBy === by &&
    stored.shiftId === shiftId &&
    stored.nothingToReport === sent.nothingToReport &&
    stored.comment === sent.comment &&
    stored.incident === sent.incident &&
    JSON.stringify(stored.signals) === JSON.stringify(sent.signals)
  );
}

/**
 * The mini feedback through `withTenantMember` in the shift's creator (ADR 0050 § 10): the policies decide who reads
 * (the member, the owner, an active manager) and who writes (the member alone). No amount: no lock of pay.
 */
export function createDrizzleShiftFeedbackStore(db: Database, adminDb: Database): ShiftFeedbackStore {
  async function inShiftCreator<T>(shiftId: ShiftId, userId: string, fn: (tx: Transaction) => Promise<T>) {
    const creatorId = await creatorOfUnscoped(adminDb, shifts, shiftId);
    if (creatorId === null) throw new ShiftNotFound();
    return withTenantMember(db, creatorId, userId, (tx) => fn(tx));
  }

  async function inFeedbackCreator<T>(
    feedbackId: ShiftFeedbackId,
    userId: string,
    fn: (tx: Transaction, creatorId: CreatorId) => Promise<T>,
  ) {
    const found = await creatorOfUnscoped(adminDb, shiftFeedbacks, feedbackId);
    if (found === null) throw new ShiftFeedbackNotFound();
    const creatorId = CreatorIdSchema.parse(found);
    return withTenantMember(db, creatorId, userId, (tx) => fn(tx, creatorId));
  }

  return {
    read: (actor, shiftId) =>
      inShiftCreator(shiftId, actor, async (tx) => {
        // The shift as his policies show it: one he does not see answers as an unknown id, never `null`, which would
        // tell him it exists (isolation sweep of the 06/11).
        const [seen] = await tx.select({ id: shifts.id }).from(shifts).where(eq(shifts.id, shiftId));
        if (seen === undefined) throw new ShiftNotFound();
        const found = await feedbackWhere(tx, shiftFeedbacks.shiftId, shiftId);
        return found?.feedback ?? null;
      }),

    create: (actor, shiftId, sent, now) =>
      inShiftCreator(shiftId, actor.userId, async (tx) => {
        const replay = async () => {
          const existing = await feedbackWhere(tx, shiftFeedbacks.id, sent.id);
          if (existing === null) return null;
          if (!sameAs(existing, actor.userId, shiftId, sent)) throw new ShiftFeedbackConflict();
          return { feedback: existing.feedback, created: false };
        };
        const sentBefore = await replay();
        if (sentBefore !== null) return sentBefore;

        const [row] = await tx
          .select({ ...shiftColumns, cancelledAt: shifts.cancelledAt })
          .from(shifts)
          .where(eq(shifts.id, shiftId));
        if (row?.cancelledAt !== null) throw new ShiftNotFound();
        const shift = toShift(row);
        if (shift.memberId !== (await ownMemberId(tx, actor.userId))) throw new ShiftFeedbackForbidden();
        const period = shiftPeriod(shift.startsAt, await agencyTimeZone(tx));
        const rules = await tx
          .select({
            fromPeriod: accountPayRules.fromPeriod,
            currency: accountPayRules.currency,
            earningsSource: accountPayRules.earningsSource,
          })
          .from(accountPayRules)
          .where(eq(accountPayRules.platformAccountId, shift.platformAccountId));
        assertFeedbackDue(
          rules.map((one) => RulesRowSchema.parse(one)),
          period,
          shift,
          now,
        );
        if ((await feedbackWhere(tx, shiftFeedbacks.shiftId, shiftId)) !== null)
          throw new ShiftFeedbackExists();

        try {
          await tx.transaction((savepoint) =>
            savepoint.insert(shiftFeedbacks).values({
              ...sent,
              signals: [...sent.signals],
              shiftId,
              creatorId: shift.creatorId,
              platformAccountId: shift.platformAccountId,
              memberId: shift.memberId,
              period,
              createdBy: actor.userId,
            }),
          );
        } catch (error) {
          const failure = pgErrorOf(error);
          if (failure?.code !== '23505') throw error;
          // The same panel sent twice at once: the twin is a replay; another feedback of the shift is refused.
          const twin = await replay();
          if (twin !== null) return twin;
          if (failure.constraint === 'shift_feedbacks_shift_unique') throw new ShiftFeedbackExists();
          throw new ShiftFeedbackConflict();
        }
        await audit(tx, actor, 'shift_feedback.create', { kind: 'shift_feedback', id: sent.id }, { period });
        // An incident tells the owner and the managers at once, once it commits (trous béants n° 1): one job per feedback.
        if (sent.incident !== null) await enqueueIncidentNotice(tx, sent.id);
        const made = await feedbackWhere(tx, shiftFeedbacks.id, sent.id);
        if (made === null) throw new ShiftNotFound();
        return { feedback: made.feedback, created: true };
      }),

    list: (actor, creatorIds, period) =>
      withMember(
        db,
        actor,
        async (tx, scope): Promise<ShiftFeedbackListRead> => {
          const reader = { userId: actor, scope, memberId: await ownMemberId(tx, actor) };
          // Anyone else than the agency reads their own, as the reports.
          const own = isAgency(reader) ? null : reader.memberId;
          if (!isAgency(reader) && own === null) return { feedbacks: [], accounts: [], members: [] };
          const feedbacks: (StoredShiftFeedback & { shiftStartsAt: Date; shiftEndsAt: Date })[] = [];
          const accounts: StoredAccount[] = [];
          for (const creatorId of creatorIds) {
            await enterCreator(tx, creatorId, creatorIds);
            const rows = await tx
              .select({ ...feedbackColumns, shiftStartsAt: shifts.startsAt, shiftEndsAt: shifts.endsAt })
              .from(shiftFeedbacks)
              .innerJoin(shifts, eq(shifts.id, shiftFeedbacks.shiftId))
              .where(
                and(
                  period === null
                    ? sql`${shiftFeedbacks.incident} is not null and ${resolvedAt} is null`
                    : eq(shiftFeedbacks.period, period),
                  own === null ? undefined : eq(shiftFeedbacks.memberId, own),
                ),
              );
            const read = rows.map((row) => ({
              ...StoredShiftFeedbackSchema.parse(row),
              shiftStartsAt: row.shiftStartsAt,
              shiftEndsAt: row.shiftEndsAt,
            }));
            feedbacks.push(...read);
            const accountIds = [...new Set(read.map((one) => one.platformAccountId))];
            if (accountIds.length > 0) {
              const found = await tx
                .select(accountColumns)
                .from(platformAccounts)
                .where(inArray(platformAccounts.id, accountIds));
              accounts.push(...found.map((row) => StoredAccountSchema.parse(row)));
            }
          }
          const memberIds = [...new Set(feedbacks.map((one) => one.memberId))];
          const members =
            memberIds.length === 0
              ? []
              : await tx.select(memberColumns).from(teamMembers).where(inArray(teamMembers.id, memberIds));
          return { feedbacks: feedbacks.toSorted(byUrgency), accounts, members: members.map(toMember) };
        },
        SNAPSHOT_READ,
      ),

    step: (actor, feedbackId, step) =>
      inFeedbackCreator(feedbackId, actor.userId, async (tx, creatorId) => {
        const found = await feedbackWhere(tx, shiftFeedbacks.id, feedbackId);
        if (found?.feedback.incident == null) throw new ShiftFeedbackNotFound();
        const { feedback } = found;
        const mine = feedback.memberId === (await ownMemberId(tx, actor.userId));
        const [scopeRow] = (
          await tx.execute(sql`select nullif(current_setting('app.team_scope', true), '') as scope`)
        ).rows;
        const scope = z.object({ scope: z.string().nullable() }).parse(scopeRow).scope;
        if (mine || (scope !== 'owner' && scope !== 'agency')) throw new ShiftIncidentForbidden();
        const already = step === 'resolved' ? feedback.incidentResolvedAt : feedback.incidentSeenAt;
        if (already !== null) return feedback;
        await tx
          .insert(shiftIncidentSteps)
          .values({ shiftFeedbackId: feedbackId, creatorId, step, saidBy: actor.userId })
          .onConflictDoNothing();
        await audit(
          tx,
          actor,
          step === 'resolved' ? 'shift_incident.resolved' : 'shift_incident.seen',
          { kind: 'shift_feedback', id: feedbackId },
          { period: feedback.period },
        );
        const after = await feedbackWhere(tx, shiftFeedbacks.id, feedbackId);
        if (after === null) throw new ShiftFeedbackNotFound();
        return after.feedback;
      }),
  };
}

/** `scheduling.notify_incident` for a feedback with an incident, once its transaction commits; one per feedback. */
async function enqueueIncidentNotice(tx: Transaction, shiftFeedbackId: ShiftFeedbackId): Promise<void> {
  await tx.execute(
    sql`select public.enqueue_job(
      task => 'scheduling.notify_incident',
      payload => ${JSON.stringify({ shiftFeedbackId })}::jsonb,
      max_attempts => ${JOB_MAX_ATTEMPTS['scheduling.notify_incident']}::int,
      job_key => ${`scheduling.notify_incident:${shiftFeedbackId}`},
      job_key_mode => 'preserve_run_at'
    )`,
  );
}
