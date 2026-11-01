import {
  CommissionStatementIdSchema,
  InvoiceIdSchema,
  PayPeriodSchema,
  type InvoiceId,
  type PayPeriod,
  type TeamMember,
} from '@nirvana/contracts';
import { and, eq, schema, sql, withMember } from '@nirvana/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { inventedLogo } from '../modules/payroll/infra/__tests__/invented-logo';

import { setUpInvoicing } from './support/invoicing';
import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

/** Periods of 2025, ended: Théo and Noa leave on the 10th of May, so Q1 is their departure fortnight, Q2 their closing one. */
const Q1 = PayPeriodSchema.parse('2025-05-01');
const Q2 = PayPeriodSchema.parse('2025-05-16');
const Q3 = PayPeriodSchema.parse('2025-06-01');
const LEFT_ON = '2025-05-10';

const DAY = 86_400_000;
const FinalSchema = z.object({ final: z.boolean() });
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

describe('Équipe › départ : la quinzaine de clôture d’un membre parti (EQ-14 lot 1, ADR 0039 § 6)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;
  let noa: TeamMember;
  let lea: TeamMember;
  /** The team's clock: the system's, unless a test makes a member leave on a day already past. */
  let teamNow: Date | null = null;
  /** Pay's clock: the system's, unless a test issues in the past. */
  let shift = 0;

  const db = () => team.test.admin.db;
  const payroll = () => team.app.modules.payroll;
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
      await payroll().jobs.issueInvoices(CommissionStatementIdSchema.parse(id), quiet);
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

  const leftOnOf = async (member: TeamMember) => {
    const [row] = await db()
      .select({ leftOn: schema.teamMembers.leftOn })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.id, member.id));
    return row?.leftOn;
  };

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
    // 100 € for Théo and Léa: 16 € each. 50 € for Noa: 8 €, under the 15 € minimum, carried to Q2.
    await team.report(theo, Q1, 10_000);
    await team.report(noa, Q1, 5_000);
    await team.report(lea, Q1, 10_000);
    await team.report(lea, Q2, 10_000);
    await leave(theo, LEFT_ON);
    await leave(noa, LEFT_ON);
    await team.recalculate(Q1);
  });

  afterAll(() => team.close());

  it('keeps the day of the click as the day he left, and gives him a final statement in his closing fortnight, even without activity', async () => {
    expect(await leftOnOf(theo)).toBe(LEFT_ON);
    expect(await leftOnOf(lea)).toBeNull();
    // His departure fortnight is an ordinary one.
    expect(await finalOf(theo, Q1)).toBe(false);

    await team.recalculate(Q2);
    const closing = await team.statementOf(theo, Q2);
    expect(closing).toMatchObject({ status: 'draft', totalMinor: 0, payableMinor: 0 });
    expect(await finalOf(theo, Q2)).toBe(true);
    expect(await finalOf(lea, Q2)).toBe(false);

    // After it, nothing more without activity.
    await team.recalculate(Q3);
    expect(await statementsOf(theo, Q3)).toEqual([]);
  });

  it('validates his final statement once none of his documents awaits an answer, in the API and in the base', async () => {
    for (const member of [lea, theo])
      expect((await team.validate(team.owner, member, Q1)).statusCode).toBe(200);
    // Issued ten days ago by pay's clock: seven days to answer, over three days ago, and he can no longer sign in.
    const invoiceId = await issued(theo, Q1, 10);
    expect((await team.validate(team.owner, lea, Q2)).statusCode).toBe(200);
    await team.recalculate(Q2);

    const waiting = await team.validate(team.owner, theo, Q2);
    expect([waiting.statusCode, team.refusal(waiting)]).toEqual([
      409,
      { code: 'commission_statement_documents_open_conflict', details: { count: 1 } },
    ]);
    expect(await failure(validatedInBase(theo, Q2))).toMatch(/waits until no document of its member/u);
    // A statement of his from the closing fortnight on that is not final never validates either.
    await finalWritten(theo, Q2, false);
    expect(await failure(validatedInBase(theo, Q2))).toMatch(/is final from his closing fortnight on/u);
    await finalWritten(theo, Q2, true);

    expect(await payroll().jobs.lapseInvoice(invoiceId, quiet)).toBe('lapsed');
    expect((await team.validate(team.owner, theo, Q2)).statusCode).toBe(200);
    expect((await team.statementOf(theo, Q2)).status).toBe('validated');
  });

  it('pays him from his closing fortnight on all he is owed, under the minimum and with its carry-over (ADR 0038)', async () => {
    const departure = await team.statementOf(noa, Q1);
    expect(departure).toMatchObject({ totalMinor: 800, carryOverOutMinor: 800, payableMinor: 0 });
    expect((await team.validate(team.owner, noa, Q1)).statusCode).toBe(200);

    await team.recalculate(Q2);
    const closing = await team.statementOf(noa, Q2);
    expect(closing).toMatchObject({
      carryOversInMinor: 800,
      totalMinor: 800,
      carryOverOutMinor: 0,
      payableMinor: 800,
    });
    expect(await finalOf(noa, Q2)).toBe(true);
    expect((await team.validate(team.owner, noa, Q2)).statusCode).toBe(200);
  });

  it('refuses in the base a final statement for a member who has not left', async () => {
    await team.report(lea, Q3, 10_000);
    await team.recalculate(Q3);
    // Her draft keeps the lines of its revision before: nothing validates it after this test.
    await finalWritten(lea, Q3, true);
    expect(await failure(validatedInBase(lea, Q3))).toMatch(/only a member who left has final statements/u);
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
