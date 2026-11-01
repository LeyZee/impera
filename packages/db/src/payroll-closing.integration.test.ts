import {
  BonusIdSchema,
  CommissionStatementIdSchema,
  CreatorIdSchema,
  newId,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  ShiftReportIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
} from '@nirvana/contracts';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { enterCreator, withAdmin, withMember, type Transaction } from './client';
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

const NOT_ENDED = /has not ended/u;
const IN_ORDER = /periods close in order/u;
const OWN_CLOSING = /closing of its own transaction/u;
const COUNTED = /a counted report is validated/u;
const CARRIES = /does not carry the closing/u;
const KEPT = /pay keeps its past/u;
const RLS = /row-level security/u;
const HASH = 'a'.repeat(64);

/** Invented people and creators only (ADR 0010). Periods of 2025, ended, and one of 2099 that has not. */
describe('the closing of a pay period for the whole team (ADR 0032, migration 0029)', () => {
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
  const [P1, P2, P3] = ['2025-03-01', '2025-03-16', '2025-04-01'] as const;
  const FUTURE = '2099-01-01';
  const usd = {
    currency: 'USD',
    day: '2025-04-15',
    rateMicros: 920_000,
    source: 'test',
    fetchedAt: '2025-04-15T16:00:00Z',
  };

  const member = (userId: string): string => {
    const memberId = memberOf.get(userId);
    if (memberId === undefined) throw new Error('no member');
    return memberId;
  };

  const admin = <T>(fn: Parameters<typeof withAdmin<T>>[1]): Promise<T> => withAdmin(test.admin.db, fn);
  const as = <T>(userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withMember(test.app.db, userId, async (tx) => {
      // The registry reads the report under the policies: its creator is entered, as the closing's loop does.
      await enterCreator(tx, nora.creatorId, [nora.creatorId]);
      return fn(tx);
    });

  const closing = (period: string, values: Partial<typeof s.payPeriodClosings.$inferInsert> = {}) => ({
    period,
    teamNetMinor: 30_000,
    exchangeRates: [usd],
    closedBy: owner,
    ...values,
  });

  const counted = (reportId: string, userId: string, period: string) => ({
    shiftReportId: reportId,
    period,
    memberId: member(userId),
  });

  /** A report of `userId` for `period`, on a shift of its own, validated unless said otherwise. */
  let hour = 0;
  const report = async (userId: string, period: string, status: 'validated' | 'submitted' = 'validated') => {
    const shiftId = newId(ShiftIdSchema);
    const id = newId(ShiftReportIdSchema);
    hour += 3;
    const startsAt = new Date(Date.UTC(2025, 2, 1, hour));
    await admin(async (tx) => {
      await tx.insert(s.shifts).values({
        id: shiftId,
        creatorId: nora.creatorId,
        platformAccountId: nora.accountId,
        memberId: member(userId),
        startsAt,
        endsAt: new Date(startsAt.getTime() + 2 * 3_600_000),
        createdBy: owner,
        updatedBy: owner,
      });
      const reviewed = status === 'validated';
      await tx.insert(s.shiftReports).values({
        id,
        creatorId: nora.creatorId,
        platformAccountId: nora.accountId,
        shiftId,
        memberId: member(userId),
        period,
        amountMinor: 10_000,
        currency: 'USD',
        status,
        submittedBy: userId,
        submittedAt: startsAt,
        reviewedBy: reviewed ? owner : null,
        reviewedAt: reviewed ? startsAt : null,
        createdBy: userId,
      });
    });
    return id;
  };

  /** A draft of `userId` for `period` that counts `reportIds`, as the job writes it. */
  const draft = async (
    userId: string,
    period: string,
    reportIds: readonly string[],
    values: Partial<typeof s.commissionStatements.$inferInsert> = {},
  ) => {
    const id = newId(CommissionStatementIdSchema);
    await admin(async (tx) => {
      await tx.insert(s.commissionStatements).values({
        id,
        memberId: member(userId),
        period,
        status: 'draft',
        revision: 1,
        engineVersion: 'nirvana-1',
        inputsHash: HASH,
        netMinor: 0,
        commissionMinor: 0,
        collectiveBonusMinor: 0,
        bonusesMinor: 0,
        penaltiesRequestedMinor: 0,
        penaltiesMinor: 0,
        carryOversInMinor: 0,
        adjustmentsMinor: 0,
        totalMinor: 0,
        carryOverOutMinor: 0,
        payableMinor: 0,
        teamNetMinor: 30_000,
        rules: { exchangeRates: [usd] },
        counted: {},
        computedAt: new Date(),
        ...values,
      });
      await lines(tx, id, 1, reportIds);
    });
    return id;
  };

  const lines = async (
    tx: Transaction,
    statementId: string,
    revision: number,
    reportIds: readonly string[],
  ) => {
    if (reportIds.length === 0) return;
    await tx.insert(s.commissionStatementLines).values({
      id: newId(CommissionStatementIdSchema),
      statementId,
      revision,
      platformAccountId: nora.accountId,
      currency: 'USD',
      vatBps: 0,
      platformFeeBps: 2_000,
      rateMicros: 920_000,
      grossMinor: 10_000 * reportIds.length,
      grossEurMinor: 9_200 * reportIds.length,
      exclVatMinor: 9_200 * reportIds.length,
      netMinor: 7_360 * reportIds.length,
      commissionMinor: 736 * reportIds.length,
      shiftReportIds: [...reportIds],
      lateReports: [],
    });
  };

  const validate = (by: string, id: string) =>
    as(by, (tx) =>
      tx
        .update(s.commissionStatements)
        .set({ status: 'validated', validatedAt: new Date(), validatedBy: by })
        .where(eq(s.commissionStatements.id, id))
        .returning({ id: s.commissionStatements.id }),
    );

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
          joinedOn: '2025-01-01',
        });
      }
      for (const period of ['2025-02-16', P1, P2, P3, '2025-04-16', FUTURE]) {
        const startsAt = new Date(`${period}T00:00:00+01:00`);
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

  it('closes a period once it has ended, the earliest first, then one after the other', async () => {
    await draft(theo, P1, []);
    expect(await failure(as(owner, (tx) => tx.insert(s.payPeriodClosings).values(closing(FUTURE))))).toMatch(
      NOT_ENDED,
    );
    // Theo has a statement on March 1st: March 16th cannot close first.
    expect(await failure(as(owner, (tx) => tx.insert(s.payPeriodClosings).values(closing(P2))))).toMatch(
      IN_ORDER,
    );
    // Only the owner or an active manager closes, in their own name.
    expect(await failure(as(theo, (tx) => tx.insert(s.payPeriodClosings).values(closing(P1))))).toMatch(RLS);
    expect(
      await failure(
        as(manager, (tx) => tx.insert(s.payPeriodClosings).values(closing(P1, { closedBy: owner }))),
      ),
    ).toMatch(RLS);
    // Closed now, whatever the writer said.
    await as(owner, (tx) =>
      tx.insert(s.payPeriodClosings).values(closing(P1, { closedAt: new Date('2001-01-01T00:00:00Z') })),
    );
    const [closed] = await as(theo, (tx) =>
      tx.select({ closedAt: s.payPeriodClosings.closedAt }).from(s.payPeriodClosings),
    );
    expect(closed?.closedAt.getUTCFullYear()).toBeGreaterThan(2001);
    // The next one is March 16th, not April 1st.
    expect(await failure(as(owner, (tx) => tx.insert(s.payPeriodClosings).values(closing(P3))))).toMatch(
      IN_ORDER,
    );
    expect(await failure(admin((tx) => tx.update(s.payPeriodClosings).set({ teamNetMinor: 1 })))).toMatch(
      KEPT,
    );
    expect(await failure(admin((tx) => tx.delete(s.payPeriodClosings)))).toMatch(KEPT);
    // Nothing lands on a period before the first closing: it is never computed again.
    expect(
      await failure(
        as(owner, (tx) =>
          tx.insert(s.bonuses).values({
            id: newId(BonusIdSchema),
            memberId: member(lea),
            period: '2025-02-16',
            amountMinor: 1_000,
            reason: 'Ancienne quinzaine',
            createdBy: owner,
          }),
        ),
      ),
    ).toMatch(/period already validated/u);
  });

  it('counts a report once, validated, its member’s, of its period or before, in its closing’s transaction', async () => {
    const late = await report(theo, P1);
    const theirs = await report(theo, P2);
    const leas = await report(lea, P2);
    const waiting = await report(lea, P2, 'submitted');
    const later = await report(theo, P3);
    /** Inside the closing's transaction, a refused row is tried in a savepoint so that the closing goes on. */
    const refused = (tx: Transaction, row: ReturnType<typeof counted>) =>
      failure(tx.transaction((savepoint) => savepoint.insert(s.payPeriodReports).values(row)));

    await as(owner, async (tx) => {
      await tx.insert(s.payPeriodClosings).values(closing(P2));
      expect(await refused(tx, counted(later, theo, P2))).toMatch(COUNTED);
      expect(await refused(tx, counted(waiting, lea, P2))).toMatch(COUNTED);
      expect(await refused(tx, counted(leas, theo, P2))).toMatch(COUNTED);
      // Late: of March 1st, closed without it, counted on March 16th.
      await tx
        .insert(s.payPeriodReports)
        .values([counted(theirs, theo, P2), counted(late, theo, P2), counted(leas, lea, P2)]);
      expect(await refused(tx, counted(theirs, theo, P2))).toMatch(/duplicate key/u);
    });

    // A report validated after the closing is never added to it: it waits for the next one.
    const after = await report(lea, P2);
    expect(
      await failure(as(owner, (tx) => tx.insert(s.payPeriodReports).values(counted(after, lea, P2)))),
    ).toMatch(OWN_CLOSING);
    // A closing written in a savepoint does not count for the transaction: refused, never let through.
    expect(
      await failure(
        as(owner, async (tx) => {
          await tx.transaction((savepoint) => savepoint.insert(s.payPeriodClosings).values(closing(P3)));
          await tx.insert(s.payPeriodReports).values(counted(later, theo, P3));
        }),
      ),
    ).toMatch(OWN_CLOSING);
    // A chatter reads only their own counted reports, and the registry never changes.
    const seen = await as(lea, (tx) =>
      tx.select({ id: s.payPeriodReports.shiftReportId }).from(s.payPeriodReports),
    );
    expect(seen.map((row) => row.id)).toEqual([leas]);
    expect(await failure(admin((tx) => tx.update(s.payPeriodReports).set({ period: P1 })))).toMatch(KEPT);
    expect(await failure(admin((tx) => tx.delete(s.payPeriodReports)))).toMatch(KEPT);
  });

  it('validates a statement that carries its closing: team net, rates, and exactly the reports counted', async () => {
    const leas = await report(lea, P3);
    const basiles = await report(basile, P3);
    const gone = await report(basile, P3);
    const managers = await report(manager, P3);
    const lea3 = await draft(lea, P3, [leas]);
    // Basile's draft was computed before the closing, with a report the closing will not count.
    const basile3 = await draft(basile, P3, [basiles, gone]);
    // The manager's report is counted, but his draft does not have it.
    const manager3 = await draft(manager, P3, []);
    const iris3 = await draft(iris, P3, [], { teamNetMinor: 29_999 });
    const lou3 = await draft(lou, P3, [], { rules: { exchangeRates: [] } });

    // No closing yet: nothing validates.
    expect(await failure(validate(owner, lea3))).toMatch(CARRIES);
    await as(owner, async (tx) => {
      await tx.insert(s.payPeriodClosings).values(closing(P3));
      await tx
        .insert(s.payPeriodReports)
        .values([counted(leas, lea, P3), counted(basiles, basile, P3), counted(managers, manager, P3)]);
    });

    expect(await validate(owner, lea3)).toEqual([{ id: lea3 }]);
    expect(await failure(validate(owner, basile3))).toMatch(CARRIES);
    expect(await failure(validate(owner, manager3))).toMatch(CARRIES);
    expect(await failure(validate(owner, iris3))).toMatch(CARRIES);
    expect(await failure(validate(owner, lou3))).toMatch(CARRIES);

    // Computed again on the closing, Basile's statement validates; the report gone waits for the next period.
    await admin(async (tx) => {
      await tx
        .update(s.commissionStatements)
        .set({ revision: 2 })
        .where(eq(s.commissionStatements.id, basile3));
      await lines(tx, basile3, 2, [basiles]);
    });
    expect(await validate(owner, basile3)).toEqual([{ id: basile3 }]);
    const [left] = await admin((tx) =>
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(s.payPeriodReports)
        .where(eq(s.payPeriodReports.shiftReportId, gone)),
    );
    expect(left?.count).toBe(0);
  });
});
