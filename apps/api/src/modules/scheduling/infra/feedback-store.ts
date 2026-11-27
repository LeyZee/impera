import {
  ConversationIdSchema,
  CreatorIdSchema,
  DraftReasonSchema,
  JOB_MAX_ATTEMPTS,
  JOB_PAYLOADS,
  SHIFT_REPORT_OPENS_BEFORE_END_MINUTES,
  PayPeriodSchema,
  PlatformAccountIdSchema,
  ReportSignalSchema,
  ShiftFeedbackIdSchema,
  ShiftIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
  type CreatorId,
  type PayPeriod,
  type PlatformAccountId,
  type ShiftFeedbackId,
  type ShiftId,
  type TeamMemberId,
  type UserId,
} from '@impera/contracts';
import {
  and,
  enterCreator,
  eq,
  inArray,
  onCreatorList,
  schema,
  sql,
  SNAPSHOT_READ,
  withAdmin,
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
import {
  assertFeedbackFits,
  assertFeedbackNotExpired,
  missingFeedbacks,
  type LastOpenedShift,
} from '../domain/feedback-due';
import type {
  ShiftFeedbackInput,
  ShiftFeedbackListRead,
  ShiftFeedbackStore,
  StoredAccount,
  StoredMissingFeedback,
  StoredShift,
  StoredShiftDigest,
  StoredShiftFeedback,
} from '../domain/ports';
import { assertFeedbackDue, earningsSourceFor, isAgency, shiftPeriod } from '../domain/reports';

import type { ShiftSalesReader } from './report-check';
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
  draftReason: shiftFeedbacks.draftReason,
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
  draftReason: DraftReasonSchema.nullable(),
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
    stored.draftReason === sent.draftReason &&
    JSON.stringify(stored.signals) === JSON.stringify(sent.signals)
  );
}

/**
 * What the conversations say of a shift (ADR 0170 § 1): the `conversations` module's
 * `conversationReadsForShifts.activity`, given by the composition root and read in the caller's transaction, under
 * the shift's creator entered. The planning never opens the conversations itself.
 */
export type ShiftActivityReader = (
  tx: Transaction,
  query: {
    readonly platformAccountId: PlatformAccountId;
    readonly userId: UserId;
    readonly from: Date;
    readonly to: Date;
  },
) => Promise<Omit<StoredShiftDigest, 'sales' | 'currency'>>;

const instant = z.union([z.date(), z.string()]).transform((value) => new Date(value));
const LastRowSchema = z.object({
  id: ShiftIdSchema,
  creator_id: CreatorIdSchema,
  platform_account_id: PlatformAccountIdSchema,
  member_id: TeamMemberIdSchema,
  starts_at: instant,
  ends_at: instant,
  has_feedback: z.boolean(),
});

/**
 * Each member's last shift whose feedback has opened at `now` (retour léger, 26/11), on every creator: read as the
 * admin role, bounded to the members named, whom the caller takes from his own row or from the shifts his policies
 * show. A cancelled shift is not theirs to report; a shift swapped away belongs to the colleague who took it.
 */
async function lastOpenedUnscoped(
  adminDb: Database,
  memberIds: readonly TeamMemberId[],
  now: Date,
): Promise<Map<TeamMemberId, LastOpenedShift>> {
  if (memberIds.length === 0) return new Map();
  return withAdmin(adminDb, async (tx) => {
    const result = await tx.execute(sql`
      select distinct on (s.member_id)
             s.id, s.creator_id, s.platform_account_id, s.member_id, s.starts_at, s.ends_at,
             exists (select 1 from shift_feedbacks f where f.shift_id = s.id) as has_feedback
        from shifts s
       where s.member_id in (${sql.join(
         memberIds.map((one) => sql`${one}::uuid`),
         sql`, `,
       )}) and s.cancelled_at is null
         and greatest(s.ends_at - make_interval(mins => ${SHIFT_REPORT_OPENS_BEFORE_END_MINUTES}), s.starts_at)
             <= ${now.toISOString()}::timestamptz
       order by s.member_id, s.ends_at desc, s.id desc`);
    const rows = result.rows.map((raw) => LastRowSchema.parse(raw));
    const timeZone = await agencyTimeZone(tx);
    const accounts = [...new Set(rows.map((row) => row.platform_account_id))];
    const rules =
      accounts.length === 0
        ? []
        : await tx
            .select({
              platformAccountId: accountPayRules.platformAccountId,
              fromPeriod: accountPayRules.fromPeriod,
              currency: accountPayRules.currency,
              earningsSource: accountPayRules.earningsSource,
            })
            .from(accountPayRules)
            .where(inArray(accountPayRules.platformAccountId, accounts));
    return new Map(
      rows.map((row) => {
        const source = earningsSourceFor(
          rules
            .filter((one) => one.platformAccountId === row.platform_account_id)
            .map((one) => RulesRowSchema.parse(one)),
          shiftPeriod(row.starts_at, timeZone),
        );
        return [
          row.member_id,
          {
            id: row.id,
            creatorId: row.creator_id,
            platformAccountId: row.platform_account_id,
            memberId: row.member_id,
            startsAt: row.starts_at,
            endsAt: row.ends_at,
            takesFeedback: source === 'detected',
            hasFeedback: row.has_feedback,
          },
        ];
      }),
    );
  });
}

/** One member's last opened shift at `now`, or null. */
async function lastOpenedOf(
  adminDb: Database,
  memberId: TeamMemberId,
  now: Date,
): Promise<LastOpenedShift | null> {
  return (await lastOpenedUnscoped(adminDb, [memberId], now)).get(memberId) ?? null;
}

/**
 * The mini feedback through `withTenantMember` in the shift's creator (ADR 0050 § 10): the policies decide who reads
 * (the member, the owner, an active manager) and who writes (the member alone). No amount: no lock of pay.
 */
export function createDrizzleShiftFeedbackStore(
  db: Database,
  adminDb: Database,
  reads: { readonly shiftSalesOf: ShiftSalesReader; readonly activityOf: ShiftActivityReader },
): ShiftFeedbackStore {
  /** The shift's figures (ADR 0170 § 1), in the shift's creator entered: its hours, its member, its account. */
  async function digestIn(tx: Transaction, shift: StoredShift, now: Date): Promise<StoredShiftDigest> {
    const [member] = await tx
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(eq(teamMembers.id, shift.memberId));
    const window = { from: shift.startsAt, to: shift.endsAt };
    const activity =
      member === undefined
        ? { drafts: { asIs: 0, edited: 0, rejected: 0 }, handoffs: 0, fans: [] }
        : await reads.activityOf(tx, {
            platformAccountId: shift.platformAccountId,
            userId: UserIdSchema.parse(member.userId),
            ...window,
          });
    const rules = await tx
      .select({
        fromPeriod: accountPayRules.fromPeriod,
        currency: accountPayRules.currency,
        earningsSource: accountPayRules.earningsSource,
      })
      .from(accountPayRules)
      .where(eq(accountPayRules.platformAccountId, shift.platformAccountId));
    const period = shiftPeriod(shift.startsAt, await agencyTimeZone(tx));
    const inForce = rules
      .map((one) => RulesRowSchema.parse(one))
      .filter((one) => one.fromPeriod <= period)
      .toSorted((a, b) => b.fromPeriod.localeCompare(a.fromPeriod))[0];
    const sales =
      inForce === undefined
        ? ({ feed: 'none' } as const)
        : await reads.shiftSalesOf(tx, {
            platformAccountId: shift.platformAccountId,
            memberId: shift.memberId,
            currency: inForce.currency,
            ...window,
            now,
          });
    return { ...activity, sales, currency: inForce?.currency ?? null };
  }

  async function shiftIn(tx: Transaction, shiftId: ShiftId): Promise<StoredShift & { cancelled: boolean }> {
    const [row] = await tx
      .select({ ...shiftColumns, cancelledAt: shifts.cancelledAt })
      .from(shifts)
      .where(eq(shifts.id, shiftId));
    if (row === undefined) throw new ShiftNotFound();
    return { ...toShift(row), cancelled: row.cancelledAt !== null };
  }

  /**
   * The shifts of `period` on the creators the agency reader sees that were left « sans retour » (retour léger, 26/11):
   * ended, on an account whose pay reads the sales for the period, without feedback, and not their member's last.
   */
  async function missingIn(
    tx: Transaction,
    actor: UserId,
    creatorIds: readonly CreatorId[],
    period: PayPeriod,
    now: Date,
  ): Promise<StoredMissingFeedback[]> {
    const timeZone = await agencyTimeZone(tx);
    const candidates: StoredMissingFeedback[] = [];
    for (const creatorId of creatorIds) {
      const [scopeRow] = (
        await tx.execute(sql`select nullif(current_setting('app.team_scope', true), '') as scope`)
      ).rows;
      const scope = z.object({ scope: z.string().nullable() }).parse(scopeRow).scope;
      if (scope === 'agency' && !(await onCreatorList(tx, actor, creatorId))) continue;
      await enterCreator(tx, creatorId, creatorIds);
      const rows = await tx
        .select(shiftColumns)
        .from(shifts)
        .where(
          and(
            sql`${shifts.cancelledAt} is null`,
            sql`${shifts.endsAt} <= ${now.toISOString()}::timestamptz`,
            sql`not exists (select 1 from shift_feedbacks f where f.shift_id = ${shifts.id})`,
          ),
        );
      const ruleRows = await tx
        .select({
          platformAccountId: accountPayRules.platformAccountId,
          fromPeriod: accountPayRules.fromPeriod,
          currency: accountPayRules.currency,
          earningsSource: accountPayRules.earningsSource,
        })
        .from(accountPayRules);
      for (const shift of rows.map(toShift)) {
        if (shiftPeriod(shift.startsAt, timeZone) !== period) continue;
        const rules = ruleRows
          .filter((one) => one.platformAccountId === shift.platformAccountId)
          .map((one) => RulesRowSchema.parse(one));
        if (earningsSourceFor(rules, period) !== 'detected') continue;
        candidates.push({
          shiftId: shift.id,
          creatorId: shift.creatorId,
          platformAccountId: shift.platformAccountId,
          memberId: shift.memberId,
          startsAt: shift.startsAt,
          endsAt: shift.endsAt,
        });
      }
    }
    const last = await lastOpenedUnscoped(adminDb, [...new Set(candidates.map((one) => one.memberId))], now);
    const lastIds = new Map([...last].map(([member, shift]) => [member, shift.id]));
    return missingFeedbacks(candidates, lastIds).toSorted(
      (a, b) => b.startsAt.getTime() - a.startsAt.getTime(),
    );
  }

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
    read: (actor, shiftId, now) =>
      inShiftCreator(shiftId, actor, async (tx) => {
        // The shift as his policies show it: one he does not see answers as an unknown id, never `null`, which would
        // tell him it exists (isolation sweep of the 06/11).
        const shift = await shiftIn(tx, shiftId);
        const found = await feedbackWhere(tx, shiftFeedbacks.shiftId, shiftId);
        return { feedback: found?.feedback ?? null, digest: await digestIn(tx, shift, now) };
      }),

    owed: (actor, now) =>
      withMember(db, actor, async (tx) => {
        const memberId = await ownMemberId(tx, actor);
        if (memberId === null) return null;
        const last = await lastOpenedOf(adminDb, memberId, now);
        return last !== null && last.takesFeedback && !last.hasFeedback ? last : null;
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

        const shift = await shiftIn(tx, shiftId);
        if (shift.cancelled) throw new ShiftNotFound();
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
        // Only his last opened shift takes one (retour léger, 26/11); a linked fan and the closed answer fit its figures.
        assertFeedbackNotExpired(shiftId, await lastOpenedOf(adminDb, shift.memberId, now));
        assertFeedbackFits(sent, await digestIn(tx, shift, now));

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
        if (sent.incident !== null) await enqueueIncidentNotice(tx, sent.id, shift.creatorId);
        // A signal linked to a fan goes into his card, « par un chatteur » (ADR 0170 § 4): the note « Rendre la main »
        // writes, through the conversations' own job, once it commits.
        for (const [index, signal] of sent.signals.entries()) {
          if (signal.conversationId === null) continue;
          await enqueueFanNote(tx, {
            feedbackId: sent.id,
            index,
            creatorId: shift.creatorId,
            conversationId: signal.conversationId,
            note: signal.text,
            at: now,
            userId: actor.userId,
          });
        }
        const made = await feedbackWhere(tx, shiftFeedbacks.id, sent.id);
        if (made === null) throw new ShiftNotFound();
        return { feedback: made.feedback, created: true };
      }),

    list: (actor, creatorIds, period, now) =>
      withMember(
        db,
        actor,
        async (tx, scope): Promise<ShiftFeedbackListRead> => {
          const reader = { userId: actor, scope, memberId: await ownMemberId(tx, actor) };
          // Anyone else than the agency reads their own, as the reports.
          const own = isAgency(reader) ? null : reader.memberId;
          if (!isAgency(reader) && own === null)
            return { feedbacks: [], accounts: [], members: [], missing: [] };
          const feedbacks: (StoredShiftFeedback & { shiftStartsAt: Date; shiftEndsAt: Date })[] = [];
          const accounts: StoredAccount[] = [];
          for (const creatorId of creatorIds) {
            // A manager reads the creators of his list only, as the reports (Sécurité, #992); the owner reads all.
            if (scope === 'agency' && !(await onCreatorList(tx, actor, creatorId))) continue;
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
          const missing =
            period === null || !isAgency(reader) ? [] : await missingIn(tx, actor, creatorIds, period, now);
          const missingAccounts = [...new Set(missing.map((one) => one.platformAccountId))].filter(
            (id) => !accounts.some((account) => account.id === id),
          );
          for (const creatorId of [...new Set(missing.map((one) => one.creatorId))]) {
            const ids = missingAccounts.filter((id) =>
              missing.some((one) => one.platformAccountId === id && one.creatorId === creatorId),
            );
            if (ids.length === 0) continue;
            await enterCreator(tx, creatorId, creatorIds);
            const found = await tx
              .select(accountColumns)
              .from(platformAccounts)
              .where(inArray(platformAccounts.id, ids));
            accounts.push(...found.map((row) => StoredAccountSchema.parse(row)));
          }
          const memberIds = [
            ...new Set([...feedbacks.map((one) => one.memberId), ...missing.map((one) => one.memberId)]),
          ];
          const members =
            memberIds.length === 0
              ? []
              : await tx.select(memberColumns).from(teamMembers).where(inArray(teamMembers.id, memberIds));
          return {
            feedbacks: feedbacks.toSorted(byUrgency),
            accounts,
            members: members.map(toMember),
            missing,
          };
        },
        SNAPSHOT_READ,
      ),

    step: (actor, feedbackId, step) =>
      inFeedbackCreator(feedbackId, actor.userId, async (tx, creatorId) => {
        const [scopeRow] = (
          await tx.execute(sql`select nullif(current_setting('app.team_scope', true), '') as scope`)
        ).rows;
        const scope = z.object({ scope: z.string().nullable() }).parse(scopeRow).scope;
        // A manager off the creator's list is told nothing exists (Sécurité, #992), as for an unknown feedback.
        if (scope === 'agency' && !(await onCreatorList(tx, actor.userId, creatorId))) {
          throw new ShiftFeedbackNotFound();
        }
        const found = await feedbackWhere(tx, shiftFeedbacks.id, feedbackId);
        if (found?.feedback.incident == null) throw new ShiftFeedbackNotFound();
        const { feedback } = found;
        const mine = feedback.memberId === (await ownMemberId(tx, actor.userId));
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
async function enqueueIncidentNotice(
  tx: Transaction,
  shiftFeedbackId: ShiftFeedbackId,
  creatorId: CreatorId,
): Promise<void> {
  await tx.execute(
    sql`select public.enqueue_job(
      task => 'scheduling.notify_incident',
      payload => ${JSON.stringify({ shiftFeedbackId, creatorId })}::jsonb,
      max_attempts => ${JOB_MAX_ATTEMPTS['scheduling.notify_incident']}::int,
      job_key => ${`scheduling.notify_incident:${shiftFeedbackId}`},
      job_key_mode => 'preserve_run_at'
    )`,
  );
}

/**
 * `conversation.record_facts` for a signal linked to a fan (ADR 0170 § 4): the conversations' own job writes it as an
 * `operator_note` fact, the note « Rendre la main » writes, with its author; once per feedback and signal.
 */
async function enqueueFanNote(
  tx: Transaction,
  input: {
    readonly feedbackId: ShiftFeedbackId;
    readonly index: number;
    readonly creatorId: CreatorId;
    readonly conversationId: string;
    readonly note: string;
    readonly at: Date;
    readonly userId: UserId;
  },
): Promise<void> {
  const payload = JOB_PAYLOADS['conversation.record_facts'].parse({
    creatorId: input.creatorId,
    conversationId: ConversationIdSchema.parse(input.conversationId),
    correlationId: `shift-feedback:${input.feedbackId}:${String(input.index)}`,
    source: { kind: 'operator_note', note: input.note, at: input.at.toISOString(), userId: input.userId },
  });
  await tx.execute(
    sql`select public.enqueue_job(
      task => 'conversation.record_facts',
      payload => ${JSON.stringify(payload)}::jsonb,
      max_attempts => ${JOB_MAX_ATTEMPTS['conversation.record_facts']}::int,
      job_key => ${`conversation.record_facts:shift-feedback:${input.feedbackId}:${String(input.index)}`},
      job_key_mode => 'preserve_run_at'
    )`,
  );
}
