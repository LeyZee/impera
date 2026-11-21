import {
  CommissionStatementIdSchema,
  CommissionStatementSchema,
  MeSchema,
  MyFiguresSchema,
  newId,
  PayPeriodSchema,
  PayrollPeriodSchema,
  ShiftReportEstimateSchema,
  ShiftReportIdSchema,
  ShiftReportSchema,
  ShiftSchema,
  ValidateShiftReportsResultSchema,
  type CommissionStatement,
  type CreatorId,
  type PlatformAccountId,
  type ShiftReport,
  type TeamMember,
} from '@impera/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { inventedLogo } from '../../modules/invoicing/infra/__tests__/invented-logo';
import type { Server } from '../../server';
import { clockedScheduling } from '../support/clocked-scheduling';
import { setUpInvoicing } from '../support/invoicing';
import { iso, parisInstant } from '../support/paris';
import { startPayrollTeam, type PayrollTeam } from '../support/payroll-team';

/** A fortnight of 2025 played by its people, on a clock the test moves; invented team and accounts (ADR 0010). */
const P = PayPeriodSchema.parse('2025-03-01');
const DAY = '2025-03-03';
const at = (minute: number): Date => parisInstant(DAY, minute);
const H = 60;
const QUIET = { warn: () => undefined, error: () => undefined };

/** What a statement adds up to (CommissionStatementSchema): every part of its total, said once. */
const partsOf = (statement: CommissionStatement): number =>
  statement.commissionMinor +
  (statement.teamShare?.amountMinor ?? 0) +
  (statement.tierBonus?.bonusMinor ?? 0) +
  statement.collectiveBonusMinor +
  statement.bonusesMinor -
  statement.penaltiesMinor +
  statement.carryOversInMinor +
  statement.adjustmentsMinor;

/**
 * The fortnight end to end through the routes (EQ-02, EQ-04, ADR 0032): the manager plans the shifts, each member takes
 * his post and reports his sales at its end, the manager validates the reports, pay computes the drafts, the period
 * ends at 00:00:30 on the 16th in Paris, the statements are validated and the owner pays. What a member reads of his
 * fortnight is the statement the agency validates and pays. Nothing of the journey is written in the base by hand.
 */
describe('the fortnight of a chatter and of a manager with a team share, through the routes', () => {
  let team: PayrollTeam;
  let planning: Server;
  let now = at(8 * H);
  let theo: TeamMember;
  let lea: TeamMember;
  let mona: TeamMember;
  let theoCookie: string;
  let leaCookie: string;
  let monaCookie: string;
  const reports = new Map<string, ShiftReport>();

  const get = async (url: string, cookie: string, via?: Server) => {
    const response = await team.call('GET', url, cookie, undefined, via);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<unknown>();
  };
  const periodAs = async (cookie: string) =>
    PayrollPeriodSchema.parse(await get(`/payroll/periods/${P}`, cookie));
  const statementIn = async (cookie: string, member: TeamMember) => {
    const found = (await periodAs(cookie)).statements.find((one) => one.memberId === member.id);
    if (found === undefined) throw new Error(`no statement of ${member.displayName}`);
    return found;
  };
  const shiftCreatorsOf = async (cookie: string) => MeSchema.parse(await get('/me', cookie)).shiftCreatorIds;

  /** `planner` puts `member` on `account` of `creator` from `from` to `to` (minutes of the day, Paris). */
  const plan = async (
    planner: string,
    member: TeamMember,
    creator: CreatorId,
    account: PlatformAccountId,
    from: number,
    to: number,
  ) => {
    const made = await team.call(
      'POST',
      '/scheduling/shifts',
      planner,
      {
        memberId: member.id,
        creatorId: creator,
        platformAccountId: account,
        startsAt: iso(at(from)),
        endsAt: iso(at(to)),
      },
      planning,
    );
    expect(made.statusCode, made.body).toBe(201);
    return ShiftSchema.parse(made.json());
  };

  /** `member` reports his sales of the shift, as the report panel sends them. */
  const report = async (member: TeamMember, cookie: string, shiftId: string, amountMinor: number) => {
    const made = await team.call(
      'POST',
      '/scheduling/shift-reports',
      cookie,
      {
        id: newId(ShiftReportIdSchema),
        shiftId,
        amountMinor,
        currency: 'EUR',
        correctsId: null,
        comment: null,
        incident: null,
      },
      planning,
    );
    expect(made.statusCode, made.body).toBe(201);
    const stored = ShiftReportSchema.parse(made.json());
    reports.set(member.id, stored);
    return stored;
  };

  const validateReports = async (cookie: string, members: readonly TeamMember[]) => {
    const body = {
      reports: members.map((member) => {
        const made = reports.get(member.id);
        if (made === undefined) throw new Error(`no report of ${member.displayName}`);
        return { id: made.id, version: made.version };
      }),
    };
    const answer = await team.call('POST', '/scheduling/shift-reports/validate', cookie, body, planning);
    expect(answer.statusCode, answer.body).toBe(200);
    return ValidateShiftReportsResultSchema.parse(answer.json()).results.map((result) => result.outcome);
  };

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'), {
      accessClock: () => now,
      payrollClock: () => now,
    });
    planning = await clockedScheduling(team, () => now);
    ({ member: theo, cookie: theoCookie } = await team.addMember('theo@recette.test', 'Théo'));
    ({ member: lea, cookie: leaCookie } = await team.addMember(
      'lea@recette.test',
      'Léa',
      'chatter',
      '2025-01-01',
      { rateBps: 2_500 },
    ));
    ({ member: mona, cookie: monaCookie } = await team.addMember(
      'mona@recette.test',
      'Mona',
      'manager',
      '2025-01-01',
      { rateBps: 1_000, teamShareBps: 500 },
    ));
  });

  afterAll(async () => {
    await planning.close();
    await team.close();
  });

  it('plans the shifts, opens each post for its hours, and takes each report at the end of its shift', async () => {
    // Monday March 3rd, 8:00 in Paris: the manager plans her chatters, the owner plans her.
    const theos = await plan(monaCookie, theo, team.anna, team.annas, 10 * H, 14 * H);
    const leas = await plan(monaCookie, lea, team.bea, team.beas, 10 * H, 14 * H);
    const monas = await plan(team.owner, mona, team.anna, team.annas, 15 * H, 17 * H);
    expect(await shiftCreatorsOf(theoCookie)).toEqual([]);

    // Noon: Théo and Léa are at their post, each on the creator of his shift.
    now = at(12 * H);
    expect(await shiftCreatorsOf(theoCookie)).toEqual([team.anna]);
    expect(await shiftCreatorsOf(leaCookie)).toEqual([team.bea]);
    const early = await team.call(
      'POST',
      '/scheduling/shift-reports',
      theoCookie,
      {
        id: newId(ShiftReportIdSchema),
        shiftId: theos.id,
        amountMinor: 50_000,
        currency: 'EUR',
        correctsId: null,
        comment: null,
        incident: null,
      },
      planning,
    );
    expect(team.refusal(early).code).toBe('shift_report_early_conflict');

    // 13:45, the report opens: what the amount typed brings him, then his report.
    now = at(13 * H + 45);
    const estimate = ShiftReportEstimateSchema.parse(
      await get(`/payroll/shifts/${theos.id}/estimate?amountMinor=50000`, theoCookie),
    );
    // 500 € declared, 20 % platform fee: 400 € net, at his 20 %.
    expect(estimate.commissionMinor).toBe(8_000);
    expect(await report(theo, theoCookie, theos.id, 50_000)).toMatchObject({
      status: 'submitted',
      period: P,
    });
    await report(lea, leaCookie, leas.id, 20_000);

    now = at(16 * H + 45);
    await report(mona, monaCookie, monas.id, 10_000);
    now = at(18 * H);
    expect(await shiftCreatorsOf(theoCookie)).toEqual([]);
  });

  it('validates the reports with four eyes and has pay compute the drafts from them', async () => {
    await team.forgetJobs(P);
    // The manager validates her chatters, never her own: the owner validates hers.
    expect(await validateReports(monaCookie, [mona])).toEqual(['refused']);
    expect(await validateReports(monaCookie, [theo, lea])).toEqual(['validated', 'validated']);
    expect(await validateReports(team.owner, [mona])).toEqual(['validated']);
    expect(await team.jobsFor(P)).toEqual([{ period: P }]);
    expect(await team.recalculate(P)).toEqual([{ period: P, outcome: 'written', written: 3 }]);

    // Théo's fortnight as he reads it, during the fortnight: his net, then his statement, at his rate.
    const figures = MyFiguresSchema.parse(await get('/payroll/my-figures', theoCookie));
    expect(figures.period).toBe(P);
    expect(figures.nets).toEqual([{ currency: 'EUR', netMinor: 40_000 }]);
    const own = await periodAs(theoCookie);
    expect(own.statements.map((one) => one.memberId)).toEqual([theo.id]);
    expect(own.statements[0]).toMatchObject({
      status: 'draft',
      netMinor: 40_000,
      commissionMinor: 8_000,
      teamShare: null,
      totalMinor: 8_000,
      team: null,
    });
    // Léa at her own 25 % of 160 € net.
    expect(await statementIn(leaCookie, lea)).toMatchObject({ netMinor: 16_000, commissionMinor: 4_000 });
  });

  it('validates the statements once the fortnight has ended, at 00:00:30 on the 16th in Paris', async () => {
    const theoDraft = await statementIn(team.owner, theo);
    const validate = (cookie: string, statement: CommissionStatement) =>
      team.call('POST', `/payroll/statements/${statement.id}/validate`, cookie, {
        revision: statement.revision,
      });
    // The last minute of the 15th: the fortnight is still running.
    now = parisInstant('2025-03-15', 23 * H + 59);
    expect(team.refusal(await validate(monaCookie, theoDraft)).code).toBe(
      'commission_statement_open_conflict',
    );

    now = new Date(parisInstant('2025-03-16', 0).getTime() + 30_000);
    expect((await periodAs(team.owner)).ended).toBe(true);
    for (const member of [theo, lea]) {
      const done = await validate(monaCookie, await statementIn(monaCookie, member));
      expect(done.statusCode, done.body).toBe(200);
    }
    expect(team.refusal(await validate(monaCookie, await statementIn(monaCookie, mona))).code).toBe(
      'payroll_own_forbidden',
    );
    const monas = await validate(team.owner, await statementIn(team.owner, mona));
    expect(monas.statusCode, monas.body).toBe(200);

    // Mona: 10 % of her own 80 € net, and 5 % of the net of the others, Théo's 400 € and Léa's 160 €.
    expect(CommissionStatementSchema.parse(monas.json())).toMatchObject({
      status: 'validated',
      netMinor: 8_000,
      commissionMinor: 800,
      teamShare: { baseNetMinor: 56_000, bps: 500, amountMinor: 2_800 },
      totalMinor: 3_600,
      payableMinor: 3_600,
    });
    const all = await periodAs(team.owner);
    for (const statement of all.statements)
      expect(partsOf(statement), statement.memberId).toBe(statement.totalMinor);
    expect(all.summary).toMatchObject({
      statements: { draft: 0, validated: 3, paid: 0, carried: 0 },
      netMinor: 64_000,
      payableMinor: 8_000 + 4_000 + 3_600,
      validatedPayableMinor: 8_000 + 4_000 + 3_600,
    });

    // Théo never reads Mona's share nor the team's net; Mona reads her own statement as the owner validated it.
    const theoView = await periodAs(theoCookie);
    expect(theoView.statements.map((one) => one.memberId)).toEqual([theo.id]);
    expect(theoView.statements[0]?.team).toBeNull();
    expect(theoView.pace.lateNetMinor).toBeNull();
    expect(JSON.stringify(theoView)).not.toContain('"baseNetMinor"');
    expect(await statementIn(monaCookie, mona)).toMatchObject({
      teamShare: { amountMinor: 2_800 },
      totalMinor: 3_600,
    });
  });

  it('has the owner pay each statement, and each member reads it paid for the amount validated', async () => {
    const invoicing = await setUpInvoicing(team, inventedLogo(), [
      { member: theo, prefix: 'THEO', legalName: 'Théo Inventé' },
      { member: lea, prefix: 'LEA', legalName: 'Léa Inventée' },
      { member: mona, prefix: 'MONA', legalName: 'Mona Inventée' },
    ]);
    for (const [member, cookie] of [
      [theo, theoCookie],
      [lea, leaCookie],
      [mona, monaCookie],
    ] as const) {
      await invoicing.acceptMandate(member);
      const validated = await statementIn(team.owner, member);
      await team.app.modules.invoicing.jobs.issueInvoices(
        CommissionStatementIdSchema.parse(validated.id),
        QUIET,
      );
      const pay = (by: string) =>
        team.call('POST', `/payroll/statements/${validated.id}/pay`, by, {
          revision: validated.revision,
          paidOn: '2025-03-16',
          method: 'worldremit',
          sentMinor: validated.payableMinor,
        });
      expect(team.refusal(await pay(monaCookie)).code).toBe('payroll_forbidden');
      const paid = await pay(team.owner);
      expect(paid.statusCode, paid.body).toBe(200);

      // What the member reads is what the owner validated and paid, to the cent.
      const seen = await statementIn(cookie, member);
      expect(seen).toMatchObject({
        status: 'paid',
        totalMinor: validated.totalMinor,
        payableMinor: validated.payableMinor,
        payment: { paidOn: '2025-03-16', sentMinor: validated.payableMinor },
      });
    }
    expect((await statementIn(theoCookie, theo)).payableMinor).toBe(8_000);
    expect((await periodAs(team.owner)).summary).toMatchObject({
      statements: { draft: 0, validated: 0, paid: 3, carried: 0 },
      paidMinor: 15_600,
    });
  });
});
