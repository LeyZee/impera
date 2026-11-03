import {
  CreatorIdSchema,
  PayPeriodSchema,
  PlatformAccountIdSchema,
  ReportSignalSchema,
  ShiftFeedbackIdSchema,
  ShiftIdSchema,
  TeamMemberIdSchema,
  type ShiftId,
} from '@impera/contracts';
import { eq, schema, withTenantMember, type Database, type Transaction } from '@impera/db';
import { z } from 'zod';

import {
  ShiftFeedbackConflict,
  ShiftFeedbackExists,
  ShiftFeedbackForbidden,
  ShiftNotFound,
} from '../domain/errors';
import type { ShiftFeedbackInput, ShiftFeedbackStore, StoredShiftFeedback } from '../domain/ports';
import { assertFeedbackDue, shiftPeriod } from '../domain/reports';

import {
  agencyTimeZone,
  audit,
  creatorOfUnscoped,
  ownMemberId,
  pgErrorOf,
  RulesRowSchema,
  shiftColumns,
  toShift,
} from './rows';

const { accountPayRules, shiftFeedbacks, shifts } = schema;

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
});

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

  return {
    read: (actor, shiftId) =>
      inShiftCreator(shiftId, actor, async (tx) => {
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
        const made = await feedbackWhere(tx, shiftFeedbacks.id, sent.id);
        if (made === null) throw new ShiftNotFound();
        return { feedback: made.feedback, created: true };
      }),
  };
}
