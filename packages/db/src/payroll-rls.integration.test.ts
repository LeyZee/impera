import {
  BonusIdSchema,
  BonusTierSetIdSchema,
  CarryOverIdSchema,
  CollectiveGoalIdSchema,
  PayoutMinimumIdSchema,
  CommissionStatementIdSchema,
  CreatorIdSchema,
  newId,
  nextPayPeriod,
  PayAdjustmentIdSchema,
  PayPeriodSchema,
  PenaltyIdSchema,
  PlatformAccountIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
} from '@nirvana/contracts';
import { desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { withAdmin, withMember } from './client';
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

const KEPT =
  /pay keeps its past|changes nothing else|takes its next revision|periods close in order|current revision|carry-over is what|made a draft/u;
const RLS = /row-level security/u;
const HASH = 'a'.repeat(64);

/** Invented people and creators only (ADR 0010). */
describe('commission statements (EQ-04): who reads and writes, and a past that never changes', () => {
  let test: TestDb;
  const owner = newId(UserIdSchema);
  const manager = newId(UserIdSchema);
  const theo = newId(UserIdSchema);
  const lea = newId(UserIdSchema);
  const basile = newId(UserIdSchema);
  const iris = newId(UserIdSchema);
  const lou = newId(UserIdSchema);
  const memberOf = new Map<string, string>();
  const nora = { creatorId: newId(CreatorIdSchema), accountId: newId(PlatformAccountIdSchema) };

  const member = (userId: string): string => {
    const memberId = memberOf.get(userId);
    if (memberId === undefined) throw new Error('no member');
    return memberId;
  };

  const admin = <T>(fn: Parameters<typeof withAdmin<T>>[1]): Promise<T> => withAdmin(test.admin.db, fn);
  const as = <T>(userId: string, fn: Parameters<typeof withMember<T>>[2]): Promise<T> =>
    withMember(test.app.db, userId, fn);

  const periods = [
    '2025-08-16',
    '2025-09-01',
    '2025-09-16',
    '2025-10-01',
    '2025-10-16',
    '2025-11-01',
    '2025-11-16',
  ];

  /** A statement of `userId` for `period`, as the job writes it. */
  const statementRow = (
    userId: string,
    period: string,
    values: Partial<typeof s.commissionStatements.$inferInsert> = {},
  ) => ({
    id: newId(CommissionStatementIdSchema),
    memberId: member(userId),
    period,
    status: 'draft',
    revision: 1,
    engineVersion: 'nirvana-1',
    inputsHash: HASH,
    netMinor: 66_666,
    commissionMinor: 13_333,
    collectiveBonusMinor: 0,
    bonusesMinor: 0,
    penaltiesRequestedMinor: 0,
    penaltiesMinor: 0,
    carryOversInMinor: 0,
    adjustmentsMinor: 0,
    totalMinor: 13_333,
    carryOverOutMinor: 0,
    payableMinor: 13_333,
    teamNetMinor: 66_666,
    rules: { exchangeRates: [] },
    counted: {},
    computedAt: new Date(),
    ...values,
  });

  const draft = async (
    userId: string,
    period: string,
    values: Partial<typeof s.commissionStatements.$inferInsert> = {},
  ) => {
    const row = statementRow(userId, period, values);
    await admin((tx) => tx.insert(s.commissionStatements).values(row));
    return row.id;
  };

  /**
   * Closes the team's periods up to `period`, one by one, as the first validation of each does (ADR 0032): nothing
   * counted, the team net every statement here carries. `payroll-closing.integration.test.ts` tests the closing.
   */
  const closeUpTo = (period: string) =>
    admin(async (tx) => {
      const [last] = await tx
        .select({ period: s.payPeriodClosings.period })
        .from(s.payPeriodClosings)
        .orderBy(desc(s.payPeriodClosings.period))
        .limit(1);
      let next = last === undefined ? period : nextPayPeriod(PayPeriodSchema.parse(last.period));
      for (; next <= period; next = nextPayPeriod(PayPeriodSchema.parse(next))) {
        await tx.insert(s.payPeriodClosings).values({
          period: next,
          teamNetMinor: 66_666,
          exchangeRates: [],
          closedBy: owner,
        });
      }
    });

  /** Validates statement `id` as `by`, its period closed first. */
  const validate = async (
    by: string,
    id: string,
    values: Partial<typeof s.commissionStatements.$inferInsert> = {},
  ) => {
    const [statement] = await admin((tx) =>
      tx
        .select({ period: s.commissionStatements.period })
        .from(s.commissionStatements)
        .where(eq(s.commissionStatements.id, id)),
    );
    if (statement === undefined) throw new Error('no statement');
    await closeUpTo(statement.period);
    return as(by, (tx) =>
      tx
        .update(s.commissionStatements)
        .set({ status: 'validated', validatedAt: new Date(), validatedBy: by, ...values })
        .where(eq(s.commissionStatements.id, id))
        .returning({ id: s.commissionStatements.id }),
    );
  };

  /** How the owner paid, as the application writes it (ADR 0023 § Factures). */
  const payment = {
    paidOn: '2025-10-02',
    paymentMethod: 'worldremit',
    paymentReference: 'WR-0412',
    sentMinor: 13_333,
  };

  const pay = (
    by: string,
    id: string,
    values: Partial<typeof s.commissionStatements.$inferInsert> = payment,
  ) =>
    as(by, (tx) =>
      tx
        .update(s.commissionStatements)
        .set({ status: 'paid', paidAt: new Date(), paidBy: by, ...values })
        .where(eq(s.commissionStatements.id, id))
        .returning({ id: s.commissionStatements.id }),
    );

  const readStatements = (by: string) =>
    as(by, (tx) => tx.select({ id: s.commissionStatements.id }).from(s.commissionStatements)).then((rows) =>
      rows.map((row) => row.id),
    );

  const bonusRow = (by: string, userId: string, period: string) => ({
    id: newId(BonusIdSchema),
    memberId: member(userId),
    period,
    amountMinor: 5_000,
    reason: 'Week-end tenu seul',
    createdBy: by,
  });

  const penaltyRow = (by: string, userId: string, fromPeriod: string, toPeriod: string) => ({
    id: newId(PenaltyIdSchema),
    memberId: member(userId),
    fromPeriod,
    toPeriod,
    kind: 'fixed',
    amountMinor: 2_000,
    reason: 'Shift manqué sans prévenir',
    createdBy: by,
  });

  const lineRow = (statementId: string, revision: number) => ({
    id: newId(CommissionStatementIdSchema),
    statementId,
    revision,
    platformAccountId: nora.accountId,
    currency: 'EUR',
    vatBps: 2_000,
    platformFeeBps: 2_000,
    rateMicros: 1_000_000,
    grossMinor: 100_000,
    grossEurMinor: 100_000,
    exclVatMinor: 83_333,
    netMinor: 66_666,
    commissionMinor: 13_333,
    shiftReportIds: [],
    lateReports: [],
  });

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    await admin(async (tx) => {
      await tx.insert(s.creators).values({
        id: nora.creatorId,
        nameKey: nora.creatorId,
        displayName: 'Créatrice Nora',
        timezone: 'Europe/Paris',
      });
      await tx
        .insert(s.platformAccounts)
        .values({ id: nora.accountId, creatorId: nora.creatorId, platform: 'reveal', handle: 'handle-nora' });
      const people = [
        [owner, 'owner', null],
        [manager, 'operator', 'manager'],
        [theo, 'operator', 'chatter'],
        [lea, 'operator', 'chatter'],
        [basile, 'operator', 'chatter'],
        [iris, 'operator', 'chatter'],
        [lou, 'operator', 'chatter'],
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
          joinedOn: '2025-08-01',
        });
      }
      for (const period of periods) {
        const startsAt = new Date(`${period}T00:00:00+02:00`);
        await tx.insert(s.payPeriods).values({
          period,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 15 * 86_400_000),
          timeZone: 'Europe/Paris',
        });
      }
    });
  });

  afterAll(async () => {
    await test.close();
  });

  describe('statements', () => {
    it('a member reads their own; a colleague none; the agency all', async () => {
      const id = await draft(basile, '2025-09-01');
      expect(await readStatements(basile)).toContain(id);
      expect(await readStatements(lea)).not.toContain(id);
      expect(await readStatements(manager)).toContain(id);
      expect(await readStatements(owner)).toContain(id);
      // The application never writes one: the job does.
      expect(
        await failure(
          as(owner, (tx) => tx.insert(s.commissionStatements).values(statementRow(lou, '2025-09-01'))),
        ),
      ).toMatch(/permission denied/u);
    });

    it('a recalculation takes the next revision and keeps the member and the period', async () => {
      const id = await draft(lou, '2025-09-01');
      const recalc = (values: Partial<typeof s.commissionStatements.$inferInsert>) =>
        admin((tx) => tx.update(s.commissionStatements).set(values).where(eq(s.commissionStatements.id, id)));
      await recalc({ revision: 2, totalMinor: 14_000, payableMinor: 14_000 });
      expect(await failure(recalc({ revision: 2, totalMinor: 15_000, payableMinor: 15_000 }))).toMatch(KEPT);
      expect(await failure(recalc({ revision: 3, period: '2025-09-16' }))).toMatch(KEPT);
      // The job makes drafts: only a validation validates.
      const validated = { status: 'validated', validatedAt: new Date(), validatedBy: owner };
      expect(await failure(draft(lou, '2025-09-16', validated))).toMatch(KEPT);
    });

    it('the agency validates a draft, never its own, and changes nothing else then', async () => {
      const own = await draft(manager, '2025-09-01');
      expect(await validate(manager, own)).toEqual([]);
      const [theirs] = await admin((tx) =>
        tx
          .select({ id: s.commissionStatements.id })
          .from(s.commissionStatements)
          .where(sql`${s.commissionStatements.memberId} = ${member(basile)}`),
      );
      if (theirs === undefined) throw new Error('no statement');
      // The application changes no amount: the grants leave it the status and who validated or paid.
      expect(await failure(validate(manager, theirs.id, { totalMinor: 1, payableMinor: 1 }))).toMatch(
        /permission denied/u,
      );
      // And nobody does in validating, the job included.
      expect(
        await failure(
          admin((tx) =>
            tx
              .update(s.commissionStatements)
              .set({
                status: 'validated',
                validatedAt: new Date(),
                validatedBy: manager,
                totalMinor: 1,
                payableMinor: 1,
              })
              .where(eq(s.commissionStatements.id, theirs.id)),
          ),
        ),
      ).toMatch(KEPT);
      // A chatter validates nothing, not even a colleague's.
      expect(await validate(lea, theirs.id)).toEqual([]);
      expect(await validate(manager, theirs.id)).toEqual([{ id: theirs.id }]);
    });

    it('closes periods in order: an earlier draft of the member blocks a later validation', async () => {
      const first = await draft(iris, '2025-09-01');
      const later = await draft(iris, '2025-09-16');
      expect(await failure(validate(manager, later))).toMatch(KEPT);
      await validate(manager, first);
      expect(await validate(manager, later)).toEqual([{ id: later }]);
    });

    it('a validated statement changes only to paid, by the owner alone; then never, for nobody', async () => {
      const [statement] = await admin((tx) =>
        tx
          .select({ id: s.commissionStatements.id })
          .from(s.commissionStatements)
          .where(sql`${s.commissionStatements.memberId} = ${member(basile)}`),
      );
      if (statement === undefined) throw new Error('no statement');
      const id = statement.id;
      const change = (values: Partial<typeof s.commissionStatements.$inferInsert>) =>
        admin((tx) => tx.update(s.commissionStatements).set(values).where(eq(s.commissionStatements.id, id)));
      expect(await pay(manager, id)).toEqual([]);
      expect(await failure(change({ totalMinor: 1, payableMinor: 1 }))).toMatch(KEPT);
      expect(
        await failure(change({ status: 'draft', validatedAt: null, validatedBy: null, revision: 2 })),
      ).toMatch(KEPT);
      // Paid says how: the day, the method of the list and what was sent; the reference when there is one.
      const PAYMENT = /commission_statements_payment_check/u;
      expect(await failure(pay(owner, id, {}))).toMatch(PAYMENT);
      // WorldRemit only (0033): the methods of 0031's default list are refused like any other.
      for (const paymentMethod of ['cash', 'bank_transfer', 'wise', 'paypal', 'other']) {
        expect(await failure(pay(owner, id, { ...payment, paymentMethod }))).toMatch(
          /commission_statements_payment_method_check/u,
        );
      }
      expect(await failure(pay(owner, id, { ...payment, paymentReference: 'V'.repeat(101) }))).toMatch(
        PAYMENT,
      );
      expect(await failure(pay(owner, id, { ...payment, sentMinor: 0 }))).toMatch(PAYMENT);
      // And nothing else with it: the grants, then the guard for the job too.
      expect(await failure(pay(owner, id, { ...payment, totalMinor: 1, payableMinor: 1 }))).toMatch(
        /permission denied/u,
      );
      expect(
        await failure(
          change({
            status: 'paid',
            paidAt: new Date(),
            paidBy: owner,
            ...payment,
            totalMinor: 1,
            payableMinor: 1,
          }),
        ),
      ).toMatch(KEPT);
      expect(await pay(owner, id, { ...payment, paymentReference: null })).toEqual([{ id }]);
      expect(await failure(change({ paidAt: new Date() }))).toMatch(KEPT);
      expect(await failure(change({ paymentReference: 'VIR-0413' }))).toMatch(KEPT);
      expect(
        await failure(
          admin((tx) => tx.delete(s.commissionStatements).where(eq(s.commissionStatements.id, id))),
        ),
      ).toMatch(KEPT);
      // No draft comes back for an earlier period of the member: it is closed too.
      expect(await failure(draft(basile, '2025-08-16'))).toMatch(KEPT);
    });

    it('only a paid statement says how it was paid', async () => {
      expect(await failure(draft(theo, '2025-11-16', payment))).toMatch(
        /commission_statements_payment_check/u,
      );
      const id = await draft(theo, '2025-11-16');
      expect(
        await failure(
          admin((tx) =>
            tx
              .update(s.commissionStatements)
              .set({ ...payment, revision: 2 })
              .where(eq(s.commissionStatements.id, id)),
          ),
        ),
      ).toMatch(/commission_statements_payment_check/u);
    });

    it('lines belong to the current revision of a draft, and are added only', async () => {
      const id = await draft(lou, '2025-11-01');
      await admin((tx) => tx.insert(s.commissionStatementLines).values(lineRow(id, 1)));
      expect(
        await failure(admin((tx) => tx.insert(s.commissionStatementLines).values(lineRow(id, 2)))),
      ).toMatch(KEPT);
      expect(
        await failure(
          admin((tx) =>
            tx
              .update(s.commissionStatementLines)
              .set({ netMinor: 1 })
              .where(eq(s.commissionStatementLines.statementId, id)),
          ),
        ),
      ).toMatch(KEPT);
      const lines = (by: string) =>
        as(by, (tx) =>
          tx
            .select({ id: s.commissionStatementLines.id })
            .from(s.commissionStatementLines)
            .where(eq(s.commissionStatementLines.statementId, id)),
        );
      expect(await lines(lou)).toHaveLength(1);
      expect(await lines(theo)).toHaveLength(0);
      expect(await lines(manager)).toHaveLength(1);
    });
  });

  describe('bonuses, penalties and adjustments', () => {
    it('the agency writes them for others, never for itself; a chatter writes none', async () => {
      await as(manager, (tx) => tx.insert(s.bonuses).values(bonusRow(manager, lea, '2025-11-01')));
      expect(
        await failure(
          as(manager, (tx) => tx.insert(s.bonuses).values(bonusRow(manager, manager, '2025-11-01'))),
        ),
      ).toMatch(RLS);
      expect(
        await failure(as(theo, (tx) => tx.insert(s.bonuses).values(bonusRow(theo, lea, '2025-11-01')))),
      ).toMatch(RLS);
      expect(
        await failure(
          as(theo, (tx) => tx.insert(s.penalties).values(penaltyRow(theo, lea, '2025-11-01', '2025-11-01'))),
        ),
      ).toMatch(RLS);
    });

    it('nothing lands on a period the member closed', async () => {
      // Theo's period of October 1st is validated.
      await validate(manager, await draft(theo, '2025-10-01'));
      expect(
        await failure(
          as(manager, (tx) => tx.insert(s.bonuses).values(bonusRow(manager, theo, '2025-10-01'))),
        ),
      ).toMatch(KEPT);
      expect(
        await failure(
          as(manager, (tx) =>
            tx.insert(s.penalties).values(penaltyRow(manager, theo, '2025-10-01', '2025-11-01')),
          ),
        ),
      ).toMatch(KEPT);
      const adjustment = (period: string) => ({
        id: newId(PayAdjustmentIdSchema),
        memberId: member(theo),
        period,
        amountMinor: -4_000,
        reason: 'Remboursement après paiement',
        createdBy: manager,
      });
      expect(
        await failure(as(manager, (tx) => tx.insert(s.payAdjustments).values(adjustment('2025-10-01')))),
      ).toMatch(KEPT);
      await as(manager, (tx) => tx.insert(s.payAdjustments).values(adjustment('2025-10-16')));
      expect(await failure(admin((tx) => tx.update(s.payAdjustments).set({ amountMinor: 1 })))).toMatch(KEPT);
    });

    it('a bonus is cancelled once, while its period is open; never deleted', async () => {
      const row = bonusRow(manager, theo, '2025-10-16');
      await as(manager, (tx) => tx.insert(s.bonuses).values(row));
      const cancel = (by: string) =>
        as(by, (tx) =>
          tx
            .update(s.bonuses)
            .set({ cancelledAt: new Date(), cancelledBy: by })
            .where(eq(s.bonuses.id, row.id))
            .returning({ id: s.bonuses.id }),
        );
      expect(
        await failure(
          admin((tx) => tx.update(s.bonuses).set({ amountMinor: 1 }).where(eq(s.bonuses.id, row.id))),
        ),
      ).toMatch(KEPT);
      expect(await cancel(theo)).toEqual([]);
      expect(await cancel(owner)).toEqual([{ id: row.id }]);
      expect(await cancel(owner)).toEqual([]);
      expect(await failure(admin((tx) => tx.delete(s.bonuses).where(eq(s.bonuses.id, row.id))))).toMatch(
        KEPT,
      );
    });

    it('a penalty is cancelled from an open period on; the closed ones keep it', async () => {
      const row = penaltyRow(manager, lea, '2025-11-01', '2025-11-16');
      await as(manager, (tx) => tx.insert(s.penalties).values(row));
      const cancelFrom = (from: string) =>
        as(owner, (tx) =>
          tx
            .update(s.penalties)
            .set({ cancelledAt: new Date(), cancelledBy: owner, cancelledFrom: from })
            .where(eq(s.penalties.id, row.id))
            .returning({ id: s.penalties.id }),
        );
      // Out of its periods.
      expect(await failure(cancelFrom('2025-12-01'))).toMatch(/penalties_cancellation_check/u);
      // Lea's period of November 1st is validated: it keeps the penalty.
      await validate(manager, await draft(lea, '2025-11-01'));
      expect(await failure(cancelFrom('2025-11-01'))).toMatch(KEPT);
      expect(await cancelFrom('2025-11-16')).toEqual([{ id: row.id }]);
      // Once: a cancelled penalty is no longer the policy's to change.
      expect(await cancelFrom('2025-11-16')).toEqual([]);
    });
  });

  describe('carry-overs, tiers, goals, rates', () => {
    it('a carry-over is what the member’s validated statement carried, to the next period, once', async () => {
      // Iris's total of October 1st is under the minimum: carried over, nothing paid.
      const under = { totalMinor: 900, carryOverOutMinor: 900, payableMinor: 0 };
      const statementId = await draft(iris, '2025-10-01', under);
      await validate(manager, statementId);
      const carry = (values: Partial<typeof s.carryOvers.$inferInsert> = {}) => ({
        id: newId(CarryOverIdSchema),
        memberId: member(iris),
        fromPeriod: '2025-10-01',
        toPeriod: '2025-10-16',
        amountMinor: 900,
        statementId,
        ...values,
      });
      const insert = (by: string, row: ReturnType<typeof carry>) =>
        as(by, (tx) => tx.insert(s.carryOvers).values(row));
      expect(await failure(insert(owner, carry({ toPeriod: '2025-11-01' })))).toMatch(KEPT);
      // Exactly what the statement carried, never another amount.
      expect(await failure(insert(owner, carry({ amountMinor: 1_000 })))).toMatch(KEPT);
      await insert(manager, carry());
      expect(await failure(insert(owner, carry()))).toMatch(/unique/u);
      expect(await failure(admin((tx) => tx.update(s.carryOvers).set({ amountMinor: 2 })))).toMatch(KEPT);
      // A manager never writes his own, even what his statement carried. His September 1st is validated first.
      const [first] = await admin((tx) =>
        tx
          .select({ id: s.commissionStatements.id })
          .from(s.commissionStatements)
          .where(
            sql`${s.commissionStatements.memberId} = ${member(manager)} and ${s.commissionStatements.period} = '2025-09-01'`,
          ),
      );
      if (first === undefined) throw new Error('no statement');
      await validate(owner, first.id);
      const own = await draft(manager, '2025-09-16', under);
      await validate(owner, own);
      const mine = carry({
        memberId: member(manager),
        fromPeriod: '2025-09-16',
        toPeriod: '2025-10-01',
        statementId: own,
      });
      expect(await failure(insert(manager, mine))).toMatch(RLS);
      await insert(owner, mine);
    });

    it('a positive amount is carried twice in a row at most; a negative one starts the count again (ADR 0038)', async () => {
      const RANK = /carry_overs_rank_check/u;
      /** Validates the draft of `userId` for `period`, then tries to write its carry-over at each rank given. */
      const carried = async (userId: string, period: string, totalMinor: number) => {
        const statementId = await draft(userId, period, {
          totalMinor,
          carryOverOutMinor: totalMinor,
          payableMinor: 0,
        });
        await validate(manager, statementId);
        return (rank: number) =>
          as(owner, (tx) =>
            tx.insert(s.carryOvers).values({
              id: newId(CarryOverIdSchema),
              memberId: member(userId),
              fromPeriod: period,
              toPeriod: nextPayPeriod(PayPeriodSchema.parse(period)),
              amountMinor: totalMinor,
              rank,
              statementId,
            }),
          );
      };

      // Iris: 9 €, then 4 € (13 €), then 1 € (14 €). Her 9 € of October 1st went at rank 1 (test above).
      const second = await carried(iris, '2025-10-16', 1_300);
      expect(await failure(second(1))).toMatch(KEPT);
      await second(2);
      // A third carry-over is written at no rank: the engine pays it (the 14 € here).
      const third = await carried(iris, '2025-11-01', 1_400);
      expect(await failure(third(3))).toMatch(RANK);
      expect(await failure(third(2))).toMatch(KEPT);
      expect(await failure(third(1))).toMatch(KEPT);

      // Basile: −5 €, always at rank 1 (the trigger answers before the CHECK, which refuses it too); then 9 €, a
      // first carry-over; then −5 € in the period, 4 € still owed.
      const negative = await carried(basile, '2025-09-16', -500);
      expect(await failure(negative(2))).toMatch(KEPT);
      await negative(1);
      const first = await carried(basile, '2025-10-01', 900);
      expect(await failure(first(2))).toMatch(KEPT);
      await first(1);
      const owed = await carried(basile, '2025-10-16', 400);
      expect(await failure(owed(1))).toMatch(KEPT);
      await owed(2);
    });

    it('the owner alone sets tiers and goals, never for a period already validated', async () => {
      const tiers = (fromPeriod: string) => ({
        id: newId(BonusTierSetIdSchema),
        fromPeriod,
        tiers: [{ thresholdMinor: 100_000, bonusMinor: 5_000, label: 'Bronze' }],
        createdBy: owner,
      });
      const goal = (period: string, by = owner) => ({
        id: newId(CollectiveGoalIdSchema),
        period,
        targetMinor: 1_000_000,
        tiers: [{ reachedBps: 10_000, bonusMinor: 3_000 }],
        createdBy: by,
      });
      expect(
        await failure(as(manager, (tx) => tx.insert(s.collectiveGoals).values(goal('2025-12-01', manager)))),
      ).toMatch(RLS);
      expect(
        await failure(as(owner, (tx) => tx.insert(s.bonusTierSets).values(tiers('2025-11-01')))),
      ).toMatch(KEPT);
      expect(
        await failure(as(owner, (tx) => tx.insert(s.collectiveGoals).values(goal('2025-11-01')))),
      ).toMatch(KEPT);
      await as(owner, (tx) => tx.insert(s.bonusTierSets).values(tiers('2025-11-16')));
      await as(owner, (tx) => tx.insert(s.collectiveGoals).values(goal('2025-11-16')));
      expect(await failure(admin((tx) => tx.update(s.collectiveGoals).set({ targetMinor: 1 })))).toMatch(
        KEPT,
      );
      expect(await as(theo, (tx) => tx.select().from(s.bonusTierSets))).toHaveLength(1);
    });

    it('the owner alone dates a payout minimum, never on a period validated, and it never changes (PAIE-22)', async () => {
      const minimum = (fromPeriod: string, by = owner) => ({
        id: newId(PayoutMinimumIdSchema),
        fromPeriod,
        minimumPayoutMinor: 2_000,
        createdBy: by,
      });
      expect(
        await failure(
          as(manager, (tx) => tx.insert(s.payoutMinimums).values(minimum('2025-12-01', manager))),
        ),
      ).toMatch(RLS);
      expect(
        await failure(as(owner, (tx) => tx.insert(s.payoutMinimums).values(minimum('2025-11-01')))),
      ).toMatch(KEPT);
      await as(owner, (tx) => tx.insert(s.payoutMinimums).values(minimum('2025-12-16')));
      expect(
        await failure(as(owner, (tx) => tx.update(s.payoutMinimums).set({ minimumPayoutMinor: 0 }))),
      ).toMatch(/permission denied/u);
      expect(
        await failure(admin((tx) => tx.update(s.payoutMinimums).set({ minimumPayoutMinor: 0 }))),
      ).toMatch(KEPT);
      // The single minimum no longer changes from the application; the delay does.
      await admin((tx) =>
        tx
          .insert(s.payrollSettings)
          .values({ id: 1, minimumPayoutMinor: 1_500, updatedBy: owner })
          .onConflictDoNothing(),
      );
      expect(
        await failure(
          as(owner, (tx) => tx.update(s.payrollSettings).set({ minimumPayoutMinor: 0, updatedBy: owner })),
        ),
      ).toMatch(/permission denied/u);
      await as(owner, (tx) =>
        tx
          .update(s.payrollSettings)
          .set({ payoutDelayBusinessDays: 3, updatedBy: owner, updatedAt: new Date() }),
      );
      expect(await as(theo, (tx) => tx.select().from(s.payoutMinimums))).toHaveLength(1);
    });

    it('rates are read by every member, written by the job alone, and never change', async () => {
      const rate = {
        currency: 'USD',
        day: '2025-10-31',
        rateMicros: 920_000,
        source: 'test',
        fetchedAt: new Date(),
      };
      expect(await failure(as(owner, (tx) => tx.insert(s.exchangeRates).values(rate)))).toMatch(
        /permission denied/u,
      );
      await admin((tx) => tx.insert(s.exchangeRates).values(rate));
      expect(await as(theo, (tx) => tx.select().from(s.exchangeRates))).toHaveLength(1);
      expect(await failure(admin((tx) => tx.update(s.exchangeRates).set({ rateMicros: 930_000 })))).toMatch(
        KEPT,
      );
      expect(
        await failure(
          admin((tx) => tx.insert(s.exchangeRates).values({ ...rate, currency: 'EUR', day: '2025-11-01' })),
        ),
      ).toMatch(/exchange_rates_currency_check/u);
    });

    it('a blocked period is read by every member, written and lifted by the job alone, with its reason', async () => {
      const block = {
        period: '2025-11-16',
        code: 'commission_rate_missing_conflict',
        memberIds: [member(theo)],
        since: new Date(),
      };
      expect(await failure(as(owner, (tx) => tx.insert(s.payPeriodBlocks).values(block)))).toMatch(
        /permission denied/u,
      );
      await admin((tx) => tx.insert(s.payPeriodBlocks).values(block));
      expect(await as(lea, (tx) => tx.select().from(s.payPeriodBlocks))).toHaveLength(1);
      expect(await as(owner, (tx) => tx.select().from(s.payPeriodBlocks))).toHaveLength(1);
      // Outside a member's context, nothing.
      expect(await test.app.db.select().from(s.payPeriodBlocks)).toHaveLength(0);
      expect(
        await failure(
          as(owner, (tx) => tx.delete(s.payPeriodBlocks).where(eq(s.payPeriodBlocks.period, '2025-11-16'))),
        ),
      ).toMatch(/permission denied/u);
      // A reason says what it is about: members without a rate, or a currency, never both nor neither.
      const refused = async (values: Partial<typeof s.payPeriodBlocks.$inferInsert>) =>
        failure(
          admin((tx) => tx.insert(s.payPeriodBlocks).values({ ...block, period: '2025-11-01', ...values })),
        );
      expect(await refused({ memberIds: [] })).toMatch(/pay_period_blocks_reason_check/u);
      expect(await refused({ currency: 'USD' })).toMatch(/pay_period_blocks_reason_check/u);
      expect(await refused({ code: 'exchange_rate_missing_conflict' })).toMatch(
        /pay_period_blocks_reason_check/u,
      );
      expect(
        await refused({ code: 'exchange_rate_missing_conflict', memberIds: null, currency: 'EUR' }),
      ).toMatch(/pay_period_blocks_currency_check/u);
      expect(await refused({ code: 'pay_period_order_conflict' })).toMatch(/pay_period_blocks_code_check/u);
      await admin((tx) => tx.delete(s.payPeriodBlocks).where(eq(s.payPeriodBlocks.period, '2025-11-16')));
      expect(await as(lea, (tx) => tx.select().from(s.payPeriodBlocks))).toHaveLength(0);
    });
  });
});
