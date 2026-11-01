import {
  calendarDayAt,
  DEFAULT_MINIMUM_PAYOUT_MINOR,
  payPeriodOfDay,
  PayPeriodSchema,
  type PayPeriod,
} from '@nirvana/contracts';
import { eq, lockPayrollClose, schema, withMember, type Database, type Transaction } from '@nirvana/db';

import { PayEntryConflict, PayPeriodClosed } from '../domain/errors';
import type { PayrollRuleStore } from '../domain/ports';
import {
  assertGoalOpen,
  assertRuleStarts,
  assertSetsTeamRules,
  draftPeriodsFrom,
  goalPeriods,
  rulesOpenFor,
  sameTiers,
} from '../domain/rules';

import { enqueuePayRecalculation } from './recalculation-queue';
import {
  bonusTierSetOfRow,
  closingsSpan,
  collectiveGoalOfRow,
  payoutMinimumOfRow,
  settingsFor,
  type PayInputReads,
} from './snapshot';
import { audit } from './writes';

const { bonusTierSets, collectiveGoals, commissionStatements, payoutMinimums, payrollSettings } = schema;

/**
 * Under `payroll.close` (ADR 0032): no validation closes a period meanwhile, so the last closing read here stays the
 * last one until the write commits, and the job never computes a period with half the rules.
 */
async function lockOpenForRules(tx: Transaction, period: PayPeriod): Promise<void> {
  await lockPayrollClose(tx);
  if (!rulesOpenFor((await closingsSpan(tx)).last, period))
    throw new PayPeriodClosed(period, { forTeam: true });
}

/** The periods holding a draft from `from` on, which the owner reads all of. */
async function draftPeriods(tx: Transaction, from: PayPeriod | null): Promise<PayPeriod[]> {
  const rows = await tx
    .selectDistinct({ period: commissionStatements.period })
    .from(commissionStatements)
    .where(eq(commissionStatements.status, 'draft'));
  return draftPeriodsFrom(
    rows.map((row) => PayPeriodSchema.parse(row.period)),
    from,
  );
}

async function enqueueAll(tx: Transaction, periods: readonly PayPeriod[]): Promise<void> {
  for (const period of periods) await enqueuePayRecalculation(tx, period);
}

/**
 * The team's rules (EQ-04, ADR 0032), as the owner (`withMember`): the policies keep them to the owner, the triggers
 * keep them off a period some statement is validated for. A create sent again with the same `id` and values gives back
 * what was recorded.
 */
export function createDrizzlePayrollRuleStore(
  db: Database,
  reads: PayInputReads,
  now: () => Date,
): PayrollRuleStore {
  /** Today in the agency's zone (PAIE-22): the server's day, never the client's. */
  const today = async (tx: Transaction): Promise<string> =>
    calendarDayAt(now(), await reads.agencyTimeZone(tx));
  return {
    createBonusTierSet: (actor, body) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertSetsTeamRules({ scope });
        const replay = async () => {
          const [row] = await tx.select().from(bonusTierSets).where(eq(bonusTierSets.id, body.id));
          if (row === undefined) return null;
          const value = bonusTierSetOfRow(row);
          if (value.fromPeriod !== body.fromPeriod || !sameTiers(value.tiers, body.tiers))
            throw new PayEntryConflict('bonus_tier_set_conflict');
          return { value, created: false };
        };
        const sent = await replay();
        if (sent !== null) return sent;

        assertRuleStarts(body.fromPeriod, await today(tx));
        await lockOpenForRules(tx, body.fromPeriod);
        const [row] = await tx
          .insert(bonusTierSets)
          .values({ ...body, createdBy: actor.userId })
          .onConflictDoNothing({ target: bonusTierSets.id })
          .returning();
        if (row === undefined) {
          const raced = await replay();
          if (raced === null) throw new PayEntryConflict('bonus_tier_set_conflict');
          return raced;
        }
        await audit(
          tx,
          actor,
          'bonus_tier_set.create',
          { kind: 'bonus_tier_set', id: row.id },
          { fromPeriod: body.fromPeriod },
        );
        await enqueueAll(tx, await draftPeriods(tx, body.fromPeriod));
        return { value: bonusTierSetOfRow(row), created: true };
      }),

    createCollectiveGoal: (actor, body) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertSetsTeamRules({ scope });
        const replay = async () => {
          const [row] = await tx.select().from(collectiveGoals).where(eq(collectiveGoals.id, body.id));
          if (row === undefined) return null;
          const value = collectiveGoalOfRow(row);
          if (
            value.period !== body.period ||
            value.targetMinor !== body.targetMinor ||
            !sameTiers(value.tiers, body.tiers)
          )
            throw new PayEntryConflict('collective_goal_conflict');
          return { value, created: false };
        };
        const sent = await replay();
        if (sent !== null) return sent;

        const day = await today(tx);
        assertGoalOpen(body.period, day);
        await lockOpenForRules(tx, body.period);
        const [row] = await tx
          .insert(collectiveGoals)
          .values({ ...body, createdBy: actor.userId })
          .onConflictDoNothing({ target: collectiveGoals.id })
          .returning();
        if (row === undefined) {
          const raced = await replay();
          if (raced === null) throw new PayEntryConflict('collective_goal_conflict');
          return raced;
        }
        await audit(
          tx,
          actor,
          'collective_goal.create',
          { kind: 'collective_goal', id: row.id },
          { period: body.period },
        );
        await enqueueAll(tx, goalPeriods(body.period, payPeriodOfDay(day)));
        return { value: collectiveGoalOfRow(row), created: true };
      }),

    createPayoutMinimum: (actor, body) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertSetsTeamRules({ scope });
        const replay = async () => {
          const [row] = await tx.select().from(payoutMinimums).where(eq(payoutMinimums.id, body.id));
          if (row === undefined) return null;
          const value = payoutMinimumOfRow(row);
          if (value.fromPeriod !== body.fromPeriod || value.minimumPayoutMinor !== body.minimumPayoutMinor)
            throw new PayEntryConflict('payout_minimum_conflict');
          return { value, created: false };
        };
        const sent = await replay();
        if (sent !== null) return sent;

        assertRuleStarts(body.fromPeriod, await today(tx));
        await lockOpenForRules(tx, body.fromPeriod);
        const [row] = await tx
          .insert(payoutMinimums)
          .values({ ...body, createdBy: actor.userId })
          .onConflictDoNothing({ target: payoutMinimums.id })
          .returning();
        if (row === undefined) {
          const raced = await replay();
          if (raced === null) throw new PayEntryConflict('payout_minimum_conflict');
          return raced;
        }
        await audit(
          tx,
          actor,
          'payout_minimum.create',
          { kind: 'payout_minimum', id: row.id },
          { fromPeriod: body.fromPeriod, minimumPayoutMinor: body.minimumPayoutMinor },
        );
        // A period that has not begun rarely has a draft; one that has, from a report dated ahead, counts it.
        await enqueueAll(tx, await draftPeriods(tx, body.fromPeriod));
        return { value: payoutMinimumOfRow(row), created: true };
      }),

    setSettings: (actor, body) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertSetsTeamRules({ scope });
        const current = payPeriodOfDay(await today(tx));
        const [row] = await tx.select().from(payrollSettings).where(eq(payrollSettings.id, 1));
        const before = row?.payoutDelayBusinessDays ?? null;
        if (before === body.payoutDelayBusinessDays) return settingsFor(tx, current);

        // The delay is announced, never computed: it changes no statement and enqueues nothing.
        const values = {
          payoutDelayBusinessDays: body.payoutDelayBusinessDays,
          updatedBy: actor.userId,
          updatedAt: now(),
        };
        if (row === undefined)
          await tx
            .insert(payrollSettings)
            .values({ id: 1, minimumPayoutMinor: DEFAULT_MINIMUM_PAYOUT_MINOR, ...values });
        else await tx.update(payrollSettings).set(values).where(eq(payrollSettings.id, 1));
        await audit(
          tx,
          actor,
          'payroll_settings.update',
          { kind: 'payroll_settings', id: '1' },
          { payoutDelayBusinessDays: { from: before, to: body.payoutDelayBusinessDays } },
        );
        return settingsFor(tx, current);
      }),
  };
}
