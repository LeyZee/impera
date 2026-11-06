import {
  CommissionStatementIdSchema,
  InvoiceIdSchema,
  newId,
  PayAdjustmentIdSchema,
  PayAdjustmentSchema,
  PayPeriodSchema,
  ShiftReportIdSchema,
  type InvoiceId,
  type PayPeriod,
  type ShiftReportId,
  type TeamMember,
} from '@impera/contracts';
import { and, eq, schema, sql, withMember } from '@impera/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { inventedLogo } from '../modules/invoicing/infra/__tests__/invented-logo';

import { setUpInvoicing } from './support/invoicing';
import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

/** Periods of 2025, ended: Théo and Noa leave on the 10th of May, so Q1 is the fortnight of their departure. */
const Q1 = PayPeriodSchema.parse('2025-05-01');
const Q2 = PayPeriodSchema.parse('2025-05-16');
const Q3 = PayPeriodSchema.parse('2025-06-01');
const LEFT_ON = '2025-05-10';

const DAY = 86_400_000;
const FinalSchema = z.object({ final: z.boolean() });
const OpenSchema = z.object({ open: z.coerce.number() });
const quiet = { warn: () => undefined, error: () => undefined };

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

describe('Équipe › départ : le relevé final d’un membre parti (EQ-14, ADR 0072)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;
  let noa: TeamMember;
  let lea: TeamMember;
  let noasReport: ShiftReportId;
  /** The team's clock: the system's, unless a test makes a member leave on a day already past. */
  let teamNow: Date | null = null;
  /** Pay's clock: the system's, unless a test issues in the past. */
  let shift = 0;

  const db = () => team.test.admin.db;
  const invoicingModule = () => team.app.modules.invoicing;
  /** Whether the member's statement of `period` is final, as its rules say. */
  const finalOf = async (member: TeamMember, period: PayPeriod) =>
    FinalSchema.parse((await team.statementOf(member, period)).rules).final;

  /** Makes `member` leave through Équipe, on `day` by the team's clock. */
  async function leave(member: TeamMember, day: string): Promise<void> {
    teamNow = new Date(`${day}T10:00:00Z`);
    try {
      const response = await team.call('PUT', `/team/members/${member.id}/status`, team.owner, {
        status: 'left',
      });
      expect(response.statusCode, response.body).toBe(200);
    } finally {
      teamNow = null;
    }
  }

  /** Issues the invoice of the member's validated statement of `period`, `daysAgo` days ago by pay's clock. */
  async function issued(member: TeamMember, period: PayPeriod, daysAgo: number): Promise<InvoiceId> {
    const { id } = await team.statementOf(member, period);
    shift = daysAgo * DAY;
    try {
      await invoicingModule().jobs.issueInvoices(CommissionStatementIdSchema.parse(id), quiet);
    } finally {
      shift = 0;
    }
    const [invoice] = await db()
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(and(eq(schema.invoices.statementId, id), eq(schema.invoices.kind, 'invoice')));
    if (invoice === undefined) throw new Error('no invoice');
    return InvoiceIdSchema.parse(invoice.id);
  }

  /** How many of the member's invoices and credit notes await an answer or stay contested, as the base counts them. */
  const documentsOpen = async (member: TeamMember) => {
    const result = await db().execute(sql`select member_documents_open(${member.id}::uuid) as open`);
    return OpenSchema.parse(result.rows[0]).open;
  };

  /** The validation as the owner would write it past the API: only the base's guards stand. */
  const validatedInBase = async (member: TeamMember, period: PayPeriod) => {
    const { id } = await team.statementOf(member, period);
    return withMember(team.app.db.db, team.ownerId, (tx) =>
      tx
        .update(schema.commissionStatements)
        .set({ status: 'validated', validatedAt: new Date(), validatedBy: team.ownerId })
        .where(eq(schema.commissionStatements.id, id)),
    );
  };

  /**
   * Writes `final` in the rules of the member's draft of `period`, in its next revision, as a statement computed by
   * another code would. Its lines stay on the revision before: only a draft without lines can be validated after it.
   */
  const finalWritten = async (member: TeamMember, period: PayPeriod, final: boolean) => {
    const { id } = await team.statementOf(member, period);
    await db()
      .update(schema.commissionStatements)
      .set({
        rules: sql`${schema.commissionStatements.rules} || jsonb_build_object('final', ${final}::boolean)`,
        revision: sql`${schema.commissionStatements.revision} + 1`,
      })
      .where(eq(schema.commissionStatements.id, id));
  };

  /**
   * Writes a written-off balance on the member's draft of `period`, in its next revision, its payable moved so that it
   * still adds up: only the check on the balance itself stands in the way.
   */
  const writtenOffInBase = async (member: TeamMember, period: PayPeriod, writtenOffMinor: number) => {
    const { id } = await team.statementOf(member, period);
    return db()
      .update(schema.commissionStatements)
      .set({
        writtenOffMinor,
        payableMinor: sql`${schema.commissionStatements.payableMinor} - ${writtenOffMinor}::integer`,
        revision: sql`${schema.commissionStatements.revision} + 1`,
      })
      .where(eq(schema.commissionStatements.id, id));
  };

  /**
   * Writes the amounts of the member's draft of `period` in its next revision, its payable what they leave: only the
   * check on the written-off balance stands in the way (ADR 0072 § 4).
   */
  const amountsInBase = async (
    member: TeamMember,
    period: PayPeriod,
    amounts: { totalMinor: number; carryOverOutMinor: number; writtenOffMinor: number },
  ) => {
    const { id } = await team.statementOf(member, period);
    return db()
      .update(schema.commissionStatements)
      .set({
        ...amounts,
        payableMinor: amounts.totalMinor - amounts.carryOverOutMinor - amounts.writtenOffMinor,
        revision: sql`${schema.commissionStatements.revision} + 1`,
      })
      .where(eq(schema.commissionStatements.id, id));
  };

  const statementsOf = (member: TeamMember, period: PayPeriod) =>
    db()
      .select({ id: schema.commissionStatements.id })
      .from(schema.commissionStatements)
      .where(
        and(
          eq(schema.commissionStatements.memberId, member.id),
          eq(schema.commissionStatements.period, period),
        ),
      );

  /** The member's drafts, wherever pay put them. */
  const draftsOf = (member: TeamMember) =>
    db()
      .select()
      .from(schema.commissionStatements)
      .where(
        and(
          eq(schema.commissionStatements.memberId, member.id),
          eq(schema.commissionStatements.status, 'draft'),
        ),
      );

  const leftOnOf = async (member: TeamMember) => {
    const [row] = await db()
      .select({ leftOn: schema.teamMembers.leftOn })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.id, member.id));
    return row?.leftOn;
  };

  /** An adjustment by the owner, as Paie sends it; the server chooses its period. */
  const adjusted = (member: TeamMember, amountMinor: number, id = newId(PayAdjustmentIdSchema)) =>
    team.call('POST', '/payroll/adjustments', team.owner, {
      id,
      memberId: member.id,
      amountMinor,
      reason: 'Ajustement inventé',
      correctsStatementId: null,
    });

  /** The period an adjustment landed on, from its answer. */
  const landedOn = (response: { json: () => unknown }): PayPeriod =>
    PayAdjustmentSchema.parse(response.json()).period;

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'), {
      payrollClock: () => new Date(Date.now() - shift),
      teamClock: () => teamNow ?? new Date(),
    });
    ({ member: theo } = await team.addMember('theo@example.test', 'Théo'));
    ({ member: noa } = await team.addMember('noa@example.test', 'Noa'));
    ({ member: lea } = await team.addMember('lea@example.test', 'Léa'));
    const invoicing = await setUpInvoicing(team, inventedLogo(), [
      { member: theo, prefix: 'THEO', legalName: 'Théo Inventé' },
      { member: noa, prefix: 'NOA', legalName: 'Noa Inventée' },
      { member: lea, prefix: 'LEA', legalName: 'Léa Inventée' },
    ]);
    for (const member of [theo, noa, lea]) await invoicing.acceptMandate(member);
    // 100 € for Théo and Léa: 16 € each. 50 € for Noa: 8 €, under the 15 € minimum.
    await team.report(theo, Q1, 10_000);
    noasReport = await team.report(noa, Q1, 5_000);
    await team.report(lea, Q1, 10_000);
    await team.report(lea, Q2, 10_000);
    await leave(theo, LEFT_ON);
    await leave(noa, LEFT_ON);
    await team.recalculate(Q1);
  });

  afterAll(() => team.close());

  it('keeps the day of the click as the day he left, and makes the fortnight of his departure his final one, with no empty statement after it', async () => {
    expect(await leftOnOf(theo)).toBe(LEFT_ON);
    expect(await leftOnOf(lea)).toBeNull();
    expect(await finalOf(theo, Q1)).toBe(true);
    expect(await finalOf(lea, Q1)).toBe(false);

    // Nothing lands after it: no statement, neither in the fortnight after nor later (ADR 0072 § 2).
    await team.recalculate(Q2);
    await team.recalculate(Q3);
    expect(await statementsOf(theo, Q2)).toEqual([]);
    expect(await statementsOf(theo, Q3)).toEqual([]);
    expect(await finalOf(lea, Q2)).toBe(false);
  });

  it('pays him in the fortnight of his departure all he is owed, under the minimum, at the normal cycle (ADR 0072 § 1, ADR 0038)', async () => {
    expect(await team.statementOf(noa, Q1)).toMatchObject({
      totalMinor: 800,
      carryOverOutMinor: 0,
      writtenOffMinor: 0,
      payableMinor: 800,
    });
    expect(await finalOf(noa, Q1)).toBe(true);
    expect((await team.validate(team.owner, noa, Q1)).statusCode).toBe(200);
  });

  it('gives him a final statement after it only when something lands, validated even while one of his documents awaits an answer (ADR 0072 § 2 and 3)', async () => {
    for (const member of [lea, theo])
      expect((await team.validate(team.owner, member, Q1)).statusCode).toBe(200);
    // Issued yesterday by pay's clock: he has seven days to answer.
    await issued(theo, Q1, 1);
    expect(await documentsOpen(theo)).toBe(1);

    const created = await adjusted(theo, 1_000);
    expect(created.statusCode, created.body).toBe(201);
    const after = landedOn(created);
    expect(after).toBe(Q2);
    await team.recalculate(Q2);
    expect(await team.statementOf(theo, Q2)).toMatchObject({
      status: 'draft',
      adjustmentsMinor: 1_000,
      totalMinor: 1_000,
      payableMinor: 1_000,
    });
    expect(await finalOf(theo, Q2)).toBe(true);

    // A statement of his from the fortnight of his departure on that is not final never validates.
    await finalWritten(theo, Q2, false);
    expect(await failure(validatedInBase(theo, Q2))).toMatch(
      /is final from the fortnight of his departure on/u,
    );
    await finalWritten(theo, Q2, true);

    expect(await documentsOpen(theo)).toBe(1);
    const validated = await team.validate(team.owner, theo, Q2);
    expect(validated.statusCode, validated.body).toBe(200);
    expect((await team.statementOf(theo, Q2)).status).toBe('validated');
  });

  it('writes off the negative total of his final statement, which a refund may bring, and carries nothing (ADR 0072 § 4)', async () => {
    // A correction of his report, validated by the agency once the fortnight of his departure is paid: −50 €, so −8 €.
    const [original] = await db()
      .select()
      .from(schema.shiftReports)
      .where(eq(schema.shiftReports.id, noasReport));
    if (original === undefined) throw new Error('no report');
    const now = new Date();
    await db()
      .insert(schema.shiftReports)
      .values({
        id: newId(ShiftReportIdSchema),
        creatorId: original.creatorId,
        platformAccountId: original.platformAccountId,
        shiftId: original.shiftId,
        memberId: original.memberId,
        period: original.period,
        correctsId: original.id,
        amountMinor: -5_000,
        currency: original.currency,
        status: 'validated',
        byAgency: true,
        submittedBy: team.ownerId,
        submittedAt: now,
        reviewedBy: team.ownerId,
        reviewedAt: now,
        createdBy: team.ownerId,
      });
    for (const period of [Q2, Q3]) await team.recalculate(period);
    const [late, ...others] = await draftsOf(noa);
    expect(others).toEqual([]);
    expect(late).toMatchObject({
      totalMinor: -800,
      carryOverOutMinor: 0,
      writtenOffMinor: -800,
      payableMinor: 0,
    });
    if (late === undefined) throw new Error('no statement');
    expect(FinalSchema.parse(late.rules).final).toBe(true);

    const period = PayPeriodSchema.parse(late.period);
    const validated = await team.validate(team.owner, noa, period);
    expect(validated.statusCode, validated.body).toBe(200);
    // Nothing carried: no statement of his after it.
    const next = period === Q2 ? Q3 : PayPeriodSchema.parse('2025-06-16');
    await team.recalculate(next);
    expect(await statementsOf(noa, next)).toEqual([]);
  });

  it('refuses an adjustment that would bring the total of a member who left below zero, under the lock, never for one present (ADR 0072 § 5)', async () => {
    const audited = await team.audited('pay_adjustment.create');
    const added = await adjusted(theo, 1_000);
    expect(added.statusCode, added.body).toBe(201);
    const period = landedOn(added);

    const id = newId(PayAdjustmentIdSchema);
    const refused = await adjusted(theo, -1_500, id);
    expect([refused.statusCode, team.refusal(refused)]).toEqual([
      409,
      { code: 'pay_adjustment_below_zero_conflict', details: { totalMinor: -500, memberId: theo.id } },
    ]);
    // Nothing written: neither the adjustment nor its audit.
    expect(await db().select().from(schema.payAdjustments).where(eq(schema.payAdjustments.id, id))).toEqual(
      [],
    );
    expect(await team.audited('pay_adjustment.create')).toBe(audited + 1);

    // Down to zero, and no further.
    expect((await adjusted(theo, -1_000)).statusCode).toBe(201);
    expect(team.refusal(await adjusted(theo, -1)).details).toEqual({ totalMinor: -1, memberId: theo.id });

    // Two sent together, each fine alone, together below zero: the lock lets one through.
    expect((await adjusted(theo, 1_200)).statusCode).toBe(201);
    const both = await Promise.all([adjusted(theo, -1_000), adjusted(theo, -1_000)]);
    expect(both.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    await team.recalculate(period);
    expect(await team.statementOf(theo, period)).toMatchObject({ totalMinor: 200, payableMinor: 200 });

    // A member present carries a negative total, as before (ADR 0038).
    const leas = await adjusted(lea, -5_000);
    expect(leas.statusCode, leas.body).toBe(201);
    await team.recalculate(landedOn(leas));
    expect(await team.statementOf(lea, landedOn(leas))).toMatchObject({
      totalMinor: 1_600 - 5_000,
      carryOverOutMinor: 1_600 - 5_000,
      writtenOffMinor: 0,
      payableMinor: 0,
    });
  });

  it('keeps in the base a final statement to a member who left, and a written-off balance to a final statement, never positive', async () => {
    // Léa has not left: her draft of Q2 is not final, and neither validates final nor writes off.
    expect(await failure(writtenOffInBase(lea, Q2, -100))).toMatch(
      /commission_statements_written_off_check/u,
    );
    await finalWritten(lea, Q2, true);
    expect(await failure(validatedInBase(lea, Q2))).toMatch(/only a member who left has final statements/u);
    await finalWritten(lea, Q2, false);

    // Théo's draft is final: a balance written off is below zero, never above.
    const [draft] = await draftsOf(theo);
    if (draft === undefined) throw new Error('no draft');
    const period = PayPeriodSchema.parse(draft.period);
    expect(await failure(writtenOffInBase(theo, period, 100))).toMatch(
      /commission_statements_written_off_check/u,
    );
    // All of a total below zero, nothing carried: never a part of it, never on a total above zero, which would pay
    // more than the total.
    const before = {
      totalMinor: draft.totalMinor,
      carryOverOutMinor: draft.carryOverOutMinor,
      writtenOffMinor: draft.writtenOffMinor,
    };
    expect(
      await failure(
        amountsInBase(theo, period, { totalMinor: 10_000, carryOverOutMinor: 0, writtenOffMinor: -5_000 }),
      ),
    ).toMatch(/commission_statements_written_off_check/u);
    expect(
      await failure(
        amountsInBase(theo, period, { totalMinor: -500, carryOverOutMinor: -300, writtenOffMinor: -200 }),
      ),
    ).toMatch(/commission_statements_written_off_check/u);
    await amountsInBase(theo, period, { totalMinor: -500, carryOverOutMinor: 0, writtenOffMinor: -500 });
    await amountsInBase(theo, period, before);
  });

  it('keeps in the base the day he left with his status, and never moves it while he is gone', async () => {
    const set = (member: TeamMember, values: Partial<typeof schema.teamMembers.$inferInsert>) =>
      failure(db().update(schema.teamMembers).set(values).where(eq(schema.teamMembers.id, member.id)));
    expect(await set(theo, { leftOn: '2025-05-11' })).toMatch(/that day never moves while he is gone/u);
    expect(await set(theo, { leftOn: null })).toMatch(/team_members_left_check/u);
    expect(await set(lea, { status: 'left' })).toMatch(/team_members_left_check/u);
    expect(await set(lea, { leftOn: LEFT_ON })).toMatch(/team_members_left_check/u);
    expect(await leftOnOf(theo)).toBe(LEFT_ON);
  });

  it('reads in the base the period that holds a day, whatever the session’s time zone', async () => {
    const periods = await db().transaction(async (tx) => {
      await tx.execute(sql`set local time zone 'Pacific/Kiritimati'`);
      const result = await tx.execute<{ day: string; period: string }>(sql`
        select day::text, pay_period_of(day)::text as period
        from unnest(array['2025-05-01', '2025-05-15', '2025-05-16', '2025-05-31', '2024-02-29']::date[]) as day`);
      return result.rows.map((row) => [row.day, row.period]);
    });
    expect(periods).toEqual([
      ['2025-05-01', '2025-05-01'],
      ['2025-05-15', '2025-05-01'],
      ['2025-05-16', '2025-05-16'],
      ['2025-05-31', '2025-05-16'],
      ['2024-02-29', '2024-02-16'],
    ]);
  });
});
