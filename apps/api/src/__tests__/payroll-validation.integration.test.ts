import {
  BonusIdSchema,
  CommissionRateIdSchema,
  CommissionStatementSchema,
  newId,
  payPeriodAt,
  PayPeriodSchema,
  type CreatorId,
  type PayPeriod,
  type ShiftReportId,
  type TeamMember,
} from '@nirvana/contracts';
import { eq, schema, sql } from '@nirvana/db';
import type { TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import type { App } from '../composition-root';
import { createLogger } from '../logger';
import { createPayrollModule } from '../modules/payroll';
import { buildServer } from '../server';

import { testConfig } from './support/config';
import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

/** Periods of 2025: they have ended. */
const Q0 = PayPeriodSchema.parse('2025-04-16');
const Q1 = PayPeriodSchema.parse('2025-05-01');
const Q2 = PayPeriodSchema.parse('2025-05-16');
const Q3 = PayPeriodSchema.parse('2025-06-01');
const Q4 = PayPeriodSchema.parse('2025-06-16');
const Q5 = PayPeriodSchema.parse('2025-07-01');
const Q6 = PayPeriodSchema.parse('2025-07-16');
const Q7 = PayPeriodSchema.parse('2025-08-01');
const Q8 = PayPeriodSchema.parse('2025-08-16');
const Q9 = PayPeriodSchema.parse('2025-09-01');
const Q10 = PayPeriodSchema.parse('2025-09-16');
const Q11 = PayPeriodSchema.parse('2025-10-01');
const Q12 = PayPeriodSchema.parse('2025-10-16');
const Q13 = PayPeriodSchema.parse('2025-11-01');
const Q14 = PayPeriodSchema.parse('2025-11-16');
const Q15 = PayPeriodSchema.parse('2025-12-01');

describe('Équipe › Paie : la validation qui clôture la quinzaine (EQ-04, ADR 0032)', () => {
  let team: PayrollTeam;
  let test: TestDb;
  let app: App;
  let ownerId: string;
  let owner: string;
  let anna: CreatorId;
  let theo: TeamMember;
  let lea: TeamMember;
  let mona: TeamMember;
  let theoCookie: string;
  let monaCookie: string;
  let theoQ1: ShiftReportId;

  const addMember: PayrollTeam['addMember'] = (...args) => team.addMember(...args);
  const report: PayrollTeam['report'] = (...args) => team.report(...args);
  const recalculate: PayrollTeam['recalculate'] = (period) => team.recalculate(period);
  const statementOf: PayrollTeam['statementOf'] = (...args) => team.statementOf(...args);
  const validate: PayrollTeam['validate'] = (...args) => team.validate(...args);
  const refusal: PayrollTeam['refusal'] = (response) => team.refusal(response);
  const closingOf: PayrollTeam['closingOf'] = (period) => team.closingOf(period);
  const jobsFor: PayrollTeam['jobsFor'] = (period) => team.jobsFor(period);
  const forgetJobs: PayrollTeam['forgetJobs'] = (period) => team.forgetJobs(period);

  const registryOf = async (period: PayPeriod) =>
    (
      await test.admin.db
        .select({ id: schema.payPeriodReports.shiftReportId })
        .from(schema.payPeriodReports)
        .where(eq(schema.payPeriodReports.period, period))
    )
      .map((row) => row.id)
      .sort();

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'));
    ({ test, app, ownerId, owner, anna } = team);
    ({ member: theo, cookie: theoCookie } = await addMember('theo@example.test', 'Théo'));
    ({ member: lea } = await addMember('lea@example.test', 'Léa'));
    ({ member: mona, cookie: monaCookie } = await addMember('mona@example.test', 'Mona', 'manager'));
  });

  afterAll(() => team.close());

  it('starts the team’s closings at the earliest period that pays, never leaving one behind', async () => {
    await test.admin.db.insert(schema.bonuses).values({
      id: newId(BonusIdSchema),
      memberId: lea.id,
      period: Q0,
      amountMinor: 2_000,
      reason: 'Renfort du samedi',
      createdBy: ownerId,
    });
    theoQ1 = await report(theo, Q1, 10_000);
    await recalculate(Q1);
    expect(refusal(await validate(owner, theo, Q1))).toEqual(
      expect.objectContaining({ code: 'pay_period_order_conflict', details: { period: Q0 } }),
    );
    expect(await test.admin.db.select().from(schema.payPeriodClosings)).toEqual([]);
    // Pay writes the bonus's period, and its statement closes first.
    await recalculate(Q0);
    expect((await validate(owner, lea, Q0)).statusCode).toBe(200);
    expect(await closingOf(Q0)).toMatchObject({ teamNetMinor: 0 });
  });

  it('closes the period at its first validation, for the team, with every creator’s reports', async () => {
    const leas = await report(lea, Q1, 5_000, { account: team.beas });
    await recalculate(Q1);
    await forgetJobs(Q1);

    // Four eyes: never one's own, and a member reads no one else's.
    expect(refusal(await validate(theoCookie, theo, Q1)).code).toBe('payroll_own_forbidden');
    expect(refusal(await validate(theoCookie, lea, Q1)).code).toBe('commission_statement_not_found');
    expect(await closingOf(Q1)).toBeUndefined();

    const validated = await validate(owner, lea, Q1);
    expect(validated.statusCode, validated.body).toBe(200);
    expect(CommissionStatementSchema.parse(validated.json())).toMatchObject({
      status: 'validated',
      validatedBy: ownerId,
      canValidate: false,
    });
    // 150 € gross, 20 % fee: the team made 120 € net, frozen with the reports of both creators.
    expect(await closingOf(Q1)).toMatchObject({ teamNetMinor: 12_000, closedBy: ownerId, exchangeRates: [] });
    expect(await registryOf(Q1)).toEqual([theoQ1, leas].sort());
    // Léa's 8 € are under the 15 € minimum: carried to the next period by the validation itself.
    const [carried] = await test.admin.db
      .select()
      .from(schema.carryOvers)
      .where(eq(schema.carryOvers.memberId, lea.id));
    expect(carried).toMatchObject({ fromPeriod: Q1, toPeriod: Q2, amountMinor: 800 });
    expect(await jobsFor(Q1)).toEqual([{ period: Q1 }]);
    const audit = await test.admin.db
      .select({ action: schema.auditLog.action, entityId: schema.auditLog.entityId })
      .from(schema.auditLog)
      .where(sql`${schema.auditLog.action} in ('pay_period.close', 'commission_statement.validate')`);
    expect(audit.filter((row) => row.entityId === Q1).map((row) => row.action)).toEqual(['pay_period.close']);
    expect(audit.filter((row) => row.action === 'commission_statement.validate')).toHaveLength(2);

    // The second statement is validated on the closing, which stays as it was.
    expect((await validate(owner, theo, Q1)).statusCode).toBe(200);
    expect(refusal(await validate(owner, theo, Q1)).code).toBe('commission_statement_status_conflict');
    expect(await test.admin.db.select().from(schema.payPeriodClosings)).toHaveLength(2);
  });

  it('waits for the reports of the period still under review, then lets a manager close it', async () => {
    await report(theo, Q2, 10_000);
    const waiting = await report(lea, Q2, 3_000, { account: team.beas, status: 'submitted' });
    await recalculate(Q2);

    const refused = await validate(owner, theo, Q2);
    expect(refusal(refused)).toEqual(
      expect.objectContaining({ code: 'pay_period_reports_pending_conflict', details: { count: 1 } }),
    );
    expect(await closingOf(Q2)).toBeUndefined();

    await test.admin.db
      .update(schema.shiftReports)
      .set({
        status: 'rejected',
        version: 2,
        reviewedBy: ownerId,
        reviewedAt: new Date(),
        reviewNote: 'À reprendre',
      })
      .where(eq(schema.shiftReports.id, waiting));
    const validated = await validate(monaCookie, theo, Q2);
    expect(validated.statusCode, validated.body).toBe(200);
    expect(await closingOf(Q2)).toMatchObject({ closedBy: mona.userId, teamNetMinor: 8_000 });
    // Léa's carry-over came in: her draft of the period exists, and validates on the same closing.
    expect((await validate(monaCookie, lea, Q2)).statusCode).toBe(200);
    // Her 8 € are still under the minimum: carried a second time, and her next period pays them (ADR 0038).
    const carried = await test.admin.db
      .select({
        fromPeriod: schema.carryOvers.fromPeriod,
        amountMinor: schema.carryOvers.amountMinor,
        rank: schema.carryOvers.rank,
      })
      .from(schema.carryOvers)
      .where(eq(schema.carryOvers.memberId, lea.id))
      .orderBy(schema.carryOvers.fromPeriod);
    expect(carried).toEqual([
      { fromPeriod: Q1, amountMinor: 800, rank: 1 },
      { fromPeriod: Q2, amountMinor: 800, rank: 2 },
    ]);
    await recalculate(Q3);
    expect(await statementOf(lea, Q3)).toMatchObject({
      carryOversInMinor: 800,
      totalMinor: 800,
      carryOverOutMinor: 0,
      payableMinor: 800,
      engineVersion: 'nirvana-2',
    });
  });

  it('counts a report of a closed period, validated late, at the next closing, from where it came', async () => {
    await report(theo, Q3, 10_000);
    const late = await report(theo, Q1, 1_000);
    expect((await recalculate(Q1)).map((one) => [one.period, one.outcome])).toEqual([
      [Q1, 'unchanged'],
      [Q3, 'written'],
    ]);
    const validated = await validate(owner, theo, Q3);
    expect(validated.statusCode, validated.body).toBe(200);
    expect(await registryOf(Q3)).toContain(late);
    expect(await registryOf(Q1)).not.toContain(late);
    const statement = CommissionStatementSchema.parse(validated.json());
    expect(statement.lines.flatMap((line) => line.lateReports)).toEqual([
      { shiftReportId: late, period: Q1, grossMinor: 1_000 },
    ]);
  });

  it('refuses a statement a colleague’s report changed since, and computes it again', async () => {
    await report(theo, Q4, 10_000);
    await report(lea, Q4, 6_000);
    await recalculate(Q4);
    await report(lea, Q4, 1_000);
    await forgetJobs(Q4);

    const refused = await validate(owner, theo, Q4);
    expect(refusal(refused).code).toBe('commission_statement_changed_conflict');
    expect(await closingOf(Q4)).toBeUndefined();
    expect((await statementOf(theo, Q4)).status).toBe('draft');
    expect(await jobsFor(Q4)).toEqual([{ period: Q4 }]);

    await recalculate(Q4);
    expect((await statementOf(theo, Q4)).revision).toBe(2);
    expect((await validate(owner, theo, Q4)).statusCode).toBe(200);
    expect((await closingOf(Q4))?.teamNetMinor).toBe(13_600);
  });

  // Théo makes enough each period to be paid (16 € of commission, over the 15 € minimum): nothing of his is carried.
  it('closes an empty period on the way, and never skips one that pays', async () => {
    await report(theo, Q6, 10_000);
    await recalculate(Q6);
    // Pay never wrote Q5 (its hourly job did not run): nothing to close it on, and the validation says which one.
    expect(refusal(await validate(owner, theo, Q6))).toEqual(
      expect.objectContaining({ code: 'pay_period_not_computed_conflict', details: { period: Q5 } }),
    );
    expect(await closingOf(Q6)).toBeUndefined();

    await recalculate(Q5);
    const validated = await validate(owner, theo, Q6);
    expect(validated.statusCode, validated.body).toBe(200);
    expect(await closingOf(Q5)).toMatchObject({ teamNetMinor: 0 });
    expect(await registryOf(Q5)).toEqual([]);
    expect(await closingOf(Q6)).toMatchObject({ teamNetMinor: 8_000 });

    // A bonus makes Q7 pay Sam: Q8 waits for it.
    const { member: sam } = await addMember('sam@example.test', 'Sam');
    await test.admin.db.insert(schema.bonuses).values({
      id: newId(BonusIdSchema),
      memberId: sam.id,
      period: Q7,
      amountMinor: 2_000,
      reason: 'Week-end tenu',
      createdBy: ownerId,
    });
    await recalculate(Q7);
    await report(theo, Q8, 10_000);
    await recalculate(Q8);
    expect(refusal(await validate(owner, theo, Q8))).toEqual(
      expect.objectContaining({ code: 'pay_period_order_conflict', details: { period: Q7 } }),
    );
    expect(await closingOf(Q7)).toBeUndefined();
    expect((await validate(owner, sam, Q7)).statusCode).toBe(200);
    expect((await validate(owner, theo, Q8)).statusCode).toBe(200);
  });

  it('validates two statements of an open period at once, beside a recalculation: one closing, no deadlock', async () => {
    const { member: nina } = await addMember('nina@example.test', 'Nina');
    await report(theo, Q9, 10_000);
    await report(nina, Q9, 10_000, { account: team.beas });
    await recalculate(Q9);
    const [one, other] = await Promise.all([
      validate(owner, theo, Q9),
      validate(monaCookie, nina, Q9),
      recalculate(Q9),
    ]);
    expect([one.statusCode, other.statusCode]).toEqual([200, 200]);
    expect(await closingOf(Q9)).toMatchObject({ teamNetMinor: 16_000 });
    expect(await registryOf(Q9)).toHaveLength(2);
  });

  it('refuses to close when the member who validates cannot read every report it counts', async () => {
    await report(theo, Q10, 10_000);
    await report(lea, Q10, 1_000, { account: team.beas });
    await recalculate(Q10);
    // A pay module that reads Anna only, as a validator who could not read Béa would.
    const blind = createPayrollModule({
      db: app.db.db,
      adminDb: app.adminDb.db,
      reads: {
        validatedReportsUnscoped: app.modules.scheduling.pay.validatedReportsUnscoped,
        validatedReportsScoped: app.modules.scheduling.pay.validatedReportsScoped,
        reportsAwaitingReviewScoped: app.modules.scheduling.pay.reportsAwaitingReviewScoped,
        agencyTimeZone: app.modules.scheduling.pay.agencyTimeZone,
        members: app.modules.team.pay.members,
        creatorIds: () => Promise.resolve([anna]),
      },
      rateJobSince: null,
    });
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
    const blindServer = await buildServer({
      config,
      logger: createLogger(config),
      routes: [blind.routes(app.requireRole)],
      readiness: app.readiness,
    });
    try {
      expect(refusal(await validate(owner, theo, Q10, blindServer))).toEqual(
        expect.objectContaining({ code: 'pay_period_reports_unread_conflict', details: { count: 1 } }),
      );
    } finally {
      await blindServer.close();
    }
    expect(await closingOf(Q10)).toBeUndefined();
    expect((await validate(owner, theo, Q10)).statusCode).toBe(200);
    // Léa's statement of the same period waits for her earlier one, still a draft since June.
    expect(refusal(await validate(owner, lea, Q10))).toEqual(
      expect.objectContaining({
        code: 'commission_statement_order_conflict',
        details: { statementId: (await statementOf(lea, Q3)).id },
      }),
    );
  });

  it('sends a report validated during a closing to the next open period, counted once', async () => {
    const during = await report(theo, Q10, 500, { status: 'submitted' });
    await report(theo, Q11, 10_000);
    await recalculate(Q11);
    // The report's validation is written and not committed while the period closes: the closing never sees it.
    const client = await test.admin.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `update shift_reports set status = 'validated', version = version + 1, reviewed_by = $1, reviewed_at = now()
          where id = $2`,
        [ownerId, during],
      );
      expect((await validate(owner, theo, Q11)).statusCode).toBe(200);
      await client.query('commit');
    } finally {
      client.release();
    }
    expect(await registryOf(Q11)).not.toContain(during);
    expect((await recalculate(Q10)).map((one) => [one.period, one.outcome])).toEqual([
      [Q10, 'unchanged'],
      [Q12, 'written'],
    ]);
    const next = await statementOf(theo, Q12);
    const lines = await test.admin.db
      .select()
      .from(schema.commissionStatementLines)
      .where(eq(schema.commissionStatementLines.statementId, next.id));
    expect(lines.flatMap((line) => line.lateReports)).toEqual([
      { shiftReportId: during, period: Q10, grossMinor: 500 },
    ]);
  });

  it('waits for a statement a closed period owes the member before their next one validates', async () => {
    const { member: zoe } = await addMember('zoe@example.test', 'Zoé');
    // A bonus after Q12's last recalculation: Théo's statement does not change, Zoé is owed one pay has not written.
    await test.admin.db.insert(schema.bonuses).values({
      id: newId(BonusIdSchema),
      memberId: zoe.id,
      period: Q12,
      amountMinor: 2_000,
      reason: 'Renfort du dimanche',
      createdBy: ownerId,
    });
    expect((await validate(owner, theo, Q12)).statusCode).toBe(200);
    await report(zoe, Q13, 10_000);
    await recalculate(Q13);
    expect(refusal(await validate(owner, zoe, Q13))).toEqual(
      expect.objectContaining({ code: 'commission_statement_order_conflict', details: { period: Q12 } }),
    );
    expect(await closingOf(Q13)).toBeUndefined();

    await recalculate(Q12);
    expect((await statementOf(zoe, Q12)).bonusesMinor).toBe(2_000);
    expect((await validate(owner, zoe, Q12)).statusCode).toBe(200);
    expect((await validate(owner, zoe, Q13)).statusCode).toBe(200);
  });

  it('validates nothing of a period that does not compute: the ECB rate missing, then read', async () => {
    // A period that does not compute does not validate (recette du 28/10, G1): the validation computes it again under
    // `payroll.close` and refuses with the same code, writing nothing. `pay_period_blocks` is only what is shown.
    // Ugo's draft is computed; then a sale in dollars without a rate read stops the period.
    const { member: ugo } = await addMember('ugo@example.test', 'Ugo');
    await report(ugo, Q14, 4_000);
    await recalculate(Q14);
    await report(ugo, Q14, 1_000, { currency: 'USD' });
    expect(await recalculate(Q14)).toEqual([{ period: Q14, outcome: 'blocked', written: 0 }]);
    expect(refusal(await validate(owner, ugo, Q14)).code).toBe('exchange_rate_missing_conflict');
    expect(await closingOf(Q14)).toBeUndefined();
    expect((await statementOf(ugo, Q14)).status).toBe('draft');

    // The rate of the period's last working day: the next computation passes, lifts the block, and the new revision
    // validates.
    await test.admin.db.insert(schema.exchangeRates).values({
      currency: 'USD',
      day: '2025-11-28',
      rateMicros: 920_000,
      source: 'BCE, taux de référence',
      fetchedAt: new Date('2025-11-28T15:07:00Z'),
    });
    expect(await recalculate(Q14)).toEqual([{ period: Q14, outcome: 'written', written: 1 }]);
    const passed = await validate(owner, ugo, Q14);
    expect(passed.statusCode, passed.body).toBe(200);
  });

  it('validates nothing of a period that does not compute: a member without a rate, then the data corrected', async () => {
    // Vic arrives on December 16th, his first rate with him; a report of his on December 1st is a row written before
    // #290 (the planning refuses it since). The whole period stops computing, Wren's draft with it.
    const { member: wren } = await addMember('wren@example.test', 'Wren');
    await report(wren, Q15, 3_000);
    await recalculate(Q15);
    const { member: vic } = await addMember('vic@example.test', 'Vic', 'chatter', '2025-12-16');
    await report(vic, Q15, 1_000);
    expect(await recalculate(Q15)).toEqual([{ period: Q15, outcome: 'blocked', written: 0 }]);
    expect(refusal(await validate(owner, wren, Q15)).code).toBe('commission_rate_missing_conflict');
    expect(await closingOf(Q15)).toBeUndefined();
    expect((await statementOf(wren, Q15)).status).toBe('draft');

    // A data correction the product refuses (a rate never goes back): a rate for Vic from December 1st.
    await test.admin.db.insert(schema.memberCommissionRates).values({
      id: newId(CommissionRateIdSchema),
      memberId: vic.id,
      rateBps: 2_000,
      effectiveFrom: Q15,
      createdBy: ownerId,
    });
    expect(await recalculate(Q15)).toMatchObject([{ period: Q15, outcome: 'written' }]);
    const passed = await validate(owner, wren, Q15);
    expect(passed.statusCode, passed.body).toBe(200);
  });

  it('refuses a period that has not ended in the agency’s zone', async () => {
    const current = payPeriodAt(new Date(), 'Europe/Paris');
    await report(lea, current, 1_000);
    await recalculate(current);
    expect(refusal(await validate(owner, lea, current)).code).toBe('commission_statement_open_conflict');
  });
});
