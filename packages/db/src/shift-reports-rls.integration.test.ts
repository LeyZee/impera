import {
  AccountPayRulesIdSchema,
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

import { withAdmin, withTenantMember } from './client';
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
describe('end-of-shift reports and pay rules (EQ-03): the member, the agency, four eyes', () => {
  let test: TestDb;
  const owner = newId(UserIdSchema);
  const manager = newId(UserIdSchema);
  const otherManager = newId(UserIdSchema);
  const chatterA = newId(UserIdSchema);
  const chatterB = newId(UserIdSchema);
  const memberOf = new Map<string, string>();
  const nora = { creatorId: newId(CreatorIdSchema), accountId: newId(PlatformAccountIdSchema) };
  const ines = { creatorId: newId(CreatorIdSchema), accountId: newId(PlatformAccountIdSchema) };
  let day = 0;

  const member = (userId: string): string => {
    const memberId = memberOf.get(userId);
    if (memberId === undefined) throw new Error('no member');
    return memberId;
  };

  /** A shift of `userId` on a day of its own, set by the owner. */
  const plan = async (creator: typeof nora, userId: string, year = 2026): Promise<string> => {
    day += 1;
    const startsAt = new Date(Date.UTC(year, 9, 1) + day * 86_400_000);
    const id = newId(ShiftIdSchema);
    await withAdmin(test.admin.db, (tx) =>
      tx.insert(s.shifts).values({
        id,
        creatorId: creator.creatorId,
        platformAccountId: creator.accountId,
        memberId: member(userId),
        startsAt,
        endsAt: new Date(startsAt.getTime() + 6 * 3_600_000),
        createdBy: owner,
        updatedBy: owner,
      }),
    );
    return id;
  };

  const reportRow = (
    shiftId: string,
    userId: string,
    values: Partial<typeof s.shiftReports.$inferInsert> = {},
  ) => ({
    id: newId(ShiftReportIdSchema),
    creatorId: nora.creatorId,
    platformAccountId: nora.accountId,
    shiftId,
    memberId: member(userId),
    period: '2026-10-01',
    amountMinor: 18_450,
    currency: 'EUR',
    status: 'submitted',
    submittedBy: userId,
    submittedAt: new Date(),
    createdBy: userId,
    ...values,
  });

  /** `by` writes a report or a correction under Nora. */
  const make = (by: string, row: typeof s.shiftReports.$inferInsert): Promise<unknown> =>
    withTenantMember(test.app.db, nora.creatorId, by, (tx) => tx.insert(s.shiftReports).values(row));

  /** `by` validates or sends back a report under Nora, naming the version it read. */
  const review = (
    by: string,
    id: string,
    status: 'validated' | 'rejected',
    values: Partial<typeof s.shiftReports.$inferInsert> = {},
  ) =>
    withTenantMember(test.app.db, nora.creatorId, by, (tx) =>
      tx
        .update(s.shiftReports)
        .set({
          status,
          version: sql`${s.shiftReports.version} + 1`,
          reviewedBy: by,
          reviewedAt: new Date(),
          reviewNote: status === 'rejected' ? 'Le pack de 40 € manque' : null,
          ...values,
        })
        .where(eq(s.shiftReports.id, id))
        .returning({ id: s.shiftReports.id }),
    );

  const read = (by: string, creator = nora) =>
    withTenantMember(test.app.db, creator.creatorId, by, (tx) =>
      tx.select({ id: s.shiftReports.id }).from(s.shiftReports),
    ).then((rows) => rows.map((row) => row.id));

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
        [otherManager, 'operator', 'manager'],
        [chatterA, 'operator', 'chatter'],
        [chatterB, 'operator', 'chatter'],
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

  describe('reports', () => {
    it('a member makes the report of their own shift and reads theirs; a colleague reads none; the agency all', async () => {
      const shift = await plan(nora, chatterA);
      const row = reportRow(shift, chatterA);
      await make(chatterA, row);
      expect(await read(chatterA)).toContain(row.id);
      expect(await read(chatterB)).not.toContain(row.id);
      expect(await read(manager)).toContain(row.id);
      expect(await read(owner)).toContain(row.id);
      // Under another creator, nobody reads it.
      expect(await read(manager, ines)).not.toContain(row.id);
    });

    it('nobody makes the report of someone else’s shift, under their name or under the member’s', async () => {
      const shift = await plan(nora, chatterA);
      expect(
        await failure(
          make(chatterB, reportRow(shift, chatterA, { submittedBy: chatterB, createdBy: chatterB })),
        ),
      ).toMatch(/row-level security/u);
      expect(await failure(make(chatterB, reportRow(shift, chatterB)))).toMatch(/shift_reports_shift_fk/u);
      // A manager makes no report for a chatter: the agency only corrects.
      expect(
        await failure(
          make(manager, reportRow(shift, chatterA, { submittedBy: manager, createdBy: manager })),
        ),
      ).toMatch(/row-level security/u);
    });

    it('keeps one report per shift, and a correction on a report of the same shift', async () => {
      const shift = await plan(nora, chatterA);
      const other = await plan(nora, chatterA);
      const first = reportRow(shift, chatterA);
      await make(chatterA, first);
      expect(await failure(make(chatterA, reportRow(shift, chatterA)))).toMatch(
        /shift_reports_shift_unique/u,
      );
      const elsewhere = reportRow(other, chatterA, { correctsId: first.id, amountMinor: -500 });
      expect(await failure(make(chatterA, elsewhere))).toMatch(/shift_reports_corrects_fk/u);
    });

    it('holds the contract’s amounts and texts', async () => {
      const shift = await plan(nora, chatterA);
      expect(await failure(make(chatterA, reportRow(shift, chatterA, { amountMinor: -1 })))).toMatch(
        /shift_reports_amount_check/u,
      );
      expect(await failure(make(chatterA, reportRow(shift, chatterA, { amountMinor: 5_000_001 })))).toMatch(
        /shift_reports_amount_check/u,
      );
      expect(await failure(make(chatterA, reportRow(shift, chatterA, { period: '2026-10-05' })))).toMatch(
        /shift_reports_period_check/u,
      );
      expect(await failure(make(chatterA, reportRow(shift, chatterA, { comment: '' })))).toMatch(
        /shift_reports_texts_check/u,
      );
      const report = reportRow(shift, chatterA);
      await make(chatterA, report);
      expect(
        await failure(make(chatterA, reportRow(shift, chatterA, { correctsId: report.id, amountMinor: 0 }))),
      ).toMatch(/shift_reports_amount_check/u);
      expect(
        await failure(
          make(
            chatterA,
            reportRow(shift, chatterA, { correctsId: report.id, amountMinor: -10, incident: 'Panne' }),
          ),
        ),
      ).toMatch(/shift_reports_incident_check/u);
    });

    it('the owner or an active manager reviews, never a report of their own shift', async () => {
      const managersShift = await plan(nora, manager);
      const managersReport = reportRow(managersShift, manager);
      await make(manager, managersReport);
      expect(await failure(review(manager, managersReport.id, 'validated'))).toMatch(/row-level security/u);
      expect(await review(owner, managersReport.id, 'validated')).toHaveLength(1);
      const shift = await plan(nora, chatterA);
      const report = reportRow(shift, chatterA);
      await make(chatterA, report);
      // A chatter reviews nothing, not even their own report.
      expect(await failure(review(chatterA, report.id, 'validated'))).toMatch(/row-level security/u);
      expect(await review(chatterB, report.id, 'validated')).toEqual([]);
      expect(await review(manager, report.id, 'validated')).toHaveLength(1);
    });

    it('a validated report never changes, a review never touches the amount, each change takes the next version', async () => {
      const shift = await plan(nora, chatterA);
      const report = reportRow(shift, chatterA);
      await make(chatterA, report);
      expect(await failure(review(manager, report.id, 'validated', { amountMinor: 1 }))).toMatch(
        /pay keeps its past/u,
      );
      expect(await failure(review(manager, report.id, 'validated', { version: 1 }))).toMatch(
        /pay keeps its past/u,
      );
      await review(manager, report.id, 'validated');
      // The member's policies no longer reach it; even the admin role cannot change or delete it.
      const changed = await withTenantMember(test.app.db, nora.creatorId, chatterA, (tx) =>
        tx
          .update(s.shiftReports)
          .set({ amountMinor: 20_000, version: 3, submittedAt: new Date() })
          .where(eq(s.shiftReports.id, report.id))
          .returning({ id: s.shiftReports.id }),
      );
      expect(changed).toEqual([]);
      const byAdmin = (change: 'update' | 'delete') =>
        withAdmin(test.admin.db, (tx) =>
          change === 'update'
            ? tx
                .update(s.shiftReports)
                .set({ amountMinor: 20_000, version: 3 })
                .where(eq(s.shiftReports.id, report.id))
            : tx.delete(s.shiftReports).where(eq(s.shiftReports.id, report.id)),
        );
      expect(await failure(byAdmin('update'))).toMatch(/pay keeps its past/u);
      expect(await failure(byAdmin('delete'))).toMatch(/pay keeps its past/u);
    });

    it('a report sent back goes to its member, who sends it again', async () => {
      const shift = await plan(nora, chatterA);
      const report = reportRow(shift, chatterA);
      await make(chatterA, report);
      expect(await review(manager, report.id, 'rejected')).toHaveLength(1);
      const again = (by: string) =>
        withTenantMember(test.app.db, nora.creatorId, by, (tx) =>
          tx
            .update(s.shiftReports)
            .set({
              status: 'submitted',
              amountMinor: 22_450,
              version: sql`${s.shiftReports.version} + 1`,
              submittedBy: by,
              submittedAt: new Date(),
              reviewedBy: null,
              reviewedAt: null,
              reviewNote: null,
            })
            .where(eq(s.shiftReports.id, report.id))
            .returning({ version: s.shiftReports.version }),
        );
      expect(await again(chatterB)).toEqual([]);
      expect(await again(chatterA)).toEqual([{ version: 3 }]);
    });

    it('four eyes on the agency’s corrections: a manager never reviews one they sent, the owner reviews theirs', async () => {
      const shift = await plan(nora, chatterA);
      const report = reportRow(shift, chatterA);
      await make(chatterA, report);
      await review(manager, report.id, 'validated');
      const correction = (by: string) =>
        reportRow(shift, chatterA, {
          correctsId: report.id,
          amountMinor: -2_000,
          byAgency: true,
          submittedBy: by,
          createdBy: by,
        });
      // A chatter makes no correction in the agency's name.
      expect(await failure(make(chatterA, correction(chatterA)))).toMatch(/row-level security/u);
      const managers = correction(manager);
      await make(manager, managers);
      expect(await failure(review(manager, managers.id, 'validated'))).toMatch(/row-level security/u);
      expect(await review(otherManager, managers.id, 'validated')).toHaveLength(1);
      const owners = correction(owner);
      await make(owner, owners);
      expect(await review(owner, owners.id, 'validated')).toHaveLength(1);
    });

    it('a shift that has its report is no longer cancelled', async () => {
      const shift = await plan(nora, chatterA, 2099);
      await make(chatterA, reportRow(shift, chatterA, { period: '2099-10-01' }));
      const cancelled = withTenantMember(test.app.db, nora.creatorId, manager, (tx) =>
        tx
          .update(s.shifts)
          .set({ cancelledAt: new Date(), updatedBy: manager })
          .where(eq(s.shifts.id, shift)),
      );
      expect(await failure(cancelled)).toMatch(/is no longer cancelled/u);
    });
  });

  describe('an account’s pay rules', () => {
    const rules = (by: string, fromPeriod: string) => ({
      id: newId(AccountPayRulesIdSchema),
      creatorId: ines.creatorId,
      platformAccountId: ines.accountId,
      fromPeriod,
      currency: 'EUR',
      vatBps: 2_000,
      platformFeeBps: 2_000,
      earningsSource: 'declared',
      createdBy: by,
    });
    const add = (by: string, row: ReturnType<typeof rules>) =>
      withTenantMember(test.app.db, ines.creatorId, by, (tx) => tx.insert(s.accountPayRules).values(row));
    const readRules = (by: string) =>
      withTenantMember(test.app.db, ines.creatorId, by, (tx) =>
        tx.select({ id: s.accountPayRules.id }).from(s.accountPayRules),
      );

    it('the owner alone adds them, one per account and period, never changed nor deleted', async () => {
      expect(await failure(add(manager, rules(manager, '2026-11-01')))).toMatch(/row-level security/u);
      const first = rules(owner, '2026-11-01');
      await add(owner, first);
      expect(await failure(add(owner, rules(owner, '2026-11-01')))).toMatch(
        /account_pay_rules_account_period_unique/u,
      );
      expect(await failure(add(owner, rules(owner, '2026-11-05')))).toMatch(
        /account_pay_rules_period_check/u,
      );
      expect(await failure(add(owner, { ...rules(owner, '2026-12-01'), vatBps: 10_001 }))).toMatch(
        /account_pay_rules_bps_check/u,
      );
      const changed = withTenantMember(test.app.db, ines.creatorId, owner, (tx) =>
        tx.update(s.accountPayRules).set({ vatBps: 0 }).where(eq(s.accountPayRules.id, first.id)),
      );
      expect(await failure(changed)).toMatch(/permission denied/u);
      const byAdmin = withAdmin(test.admin.db, (tx) =>
        tx.delete(s.accountPayRules).where(eq(s.accountPayRules.id, first.id)),
      );
      expect(await failure(byAdmin)).toMatch(/pay keeps its past/u);
    });

    it('the agency reads them, and a member who has a shift on the account; nobody else', async () => {
      await plan(ines, chatterA);
      expect(await readRules(manager)).not.toEqual([]);
      expect(await readRules(chatterA)).not.toEqual([]);
      expect(await readRules(chatterB)).toEqual([]);
    });
  });
});
