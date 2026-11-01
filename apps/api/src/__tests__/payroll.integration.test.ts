import {
  AccountPayRulesIdSchema,
  CommissionRateIdSchema,
  PayPeriodPageSchema,
  BonusIdSchema,
  CollectiveGoalIdSchema,
  JOB_MAX_ATTEMPTS,
  newId,
  PayPeriodSchema,
  PayrollPeriodSchema,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  ShiftReportIdSchema,
  ShiftReportSchema,
  TeamMemberSchema,
  ValidateShiftReportsResultSchema,
  type CreatorId,
  type PayPeriod,
  type PlatformAccountId,
  type ShiftReportId,
  type TeamMember,
} from '@nirvana/contracts';
import { and, eq, lockPayrollClose, schema, sql, type Transaction } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { lockWaits } from './support/lock-waits';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

/** Invented people, creators and accounts only (ADR 0010). Periods of 2025: they have ended. */
const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const CREATOR = { email: 'creator@example.test', name: 'Creator', password: 'battery staple horse' };
const PASSWORD = 'staple battery horse';
const P0 = PayPeriodSchema.parse('2025-02-16');
const P1 = PayPeriodSchema.parse('2025-03-01');
const P2 = PayPeriodSchema.parse('2025-03-16');
const P3 = PayPeriodSchema.parse('2025-04-01');
const P4 = PayPeriodSchema.parse('2025-04-16');
const P5 = PayPeriodSchema.parse('2025-05-01');
const P6 = PayPeriodSchema.parse('2025-05-16');

const quiet = { warn: () => undefined, error: () => undefined };

describe('Équipe › Paie : le recalcul des brouillons et la lecture d’une quinzaine (EQ-04, ADR 0032)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let ownerId: string;
  let owner: string;
  let creator: string;
  let anna: CreatorId;
  let main: PlatformAccountId;
  let dollars: PlatformAccountId;
  let theo: TeamMember;
  let lea: TeamMember;
  let theoCookie: string;
  let hour = 0;

  const call = (method: 'GET' | 'POST', url: string, cookie: string, payload?: object) =>
    server.inject({
      method,
      url: `/v1${url}`,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      ...(payload !== undefined && { payload }),
    });

  const addMember = async (
    email: string,
    displayName: string,
    joinedOn = '2025-01-01',
  ): Promise<{ member: TeamMember; cookie: string }> => {
    const response = await call('POST', '/team/members', owner, {
      email,
      displayName,
      teamRole: 'chatter',
      creatorIds: [anna],
      firstName: displayName,
      lastName: 'Inventé',
      country: 'FR',
      timeZone: 'Europe/Paris',
      joinedOn,
      commission: { rateBps: 2_000 },
      teamShareBps: null,
    });
    expect(response.statusCode, response.body).toBe(201);
    const member = TeamMemberSchema.parse(response.json());
    const context = await app.auth.$context;
    await context.internalAdapter.linkAccount({
      userId: member.userId,
      providerId: 'credential',
      accountId: member.userId,
      password: await context.password.hash(PASSWORD),
    });
    return { member, cookie: await signIn(server, email, PASSWORD) };
  };

  /** A shift of `member` in `period`, ended, written as the planning would have. */
  const shiftIn = async (member: TeamMember, period: PayPeriod, account = main) => {
    const id = newId(ShiftIdSchema);
    hour += 3;
    const startsAt = new Date(`${period}T06:00:00Z`);
    startsAt.setUTCHours(startsAt.getUTCHours() + (hour % 200));
    await test.admin.db.insert(schema.shifts).values({
      id,
      creatorId: anna,
      platformAccountId: account,
      memberId: member.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 2 * 3_600_000),
      createdBy: ownerId,
      updatedBy: ownerId,
    });
    return { id, startsAt };
  };

  /** A validated report of `member` for `period`, as a validation leaves it. */
  const validated = async (
    member: TeamMember,
    period: PayPeriod,
    amountMinor: number,
    account = main,
  ): Promise<ShiftReportId> => {
    const shift = await shiftIn(member, period, account);
    const id = newId(ShiftReportIdSchema);
    await test.admin.db.insert(schema.shiftReports).values({
      id,
      creatorId: anna,
      platformAccountId: account,
      shiftId: shift.id,
      memberId: member.id,
      period,
      amountMinor,
      currency: account === dollars ? 'USD' : 'EUR',
      status: 'validated',
      submittedBy: member.userId,
      submittedAt: shift.startsAt,
      reviewedBy: ownerId,
      reviewedAt: shift.startsAt,
      createdBy: member.userId,
    });
    return id;
  };

  const statementsOf = (period: PayPeriod) =>
    test.admin.db
      .select()
      .from(schema.commissionStatements)
      .where(eq(schema.commissionStatements.period, period))
      .orderBy(schema.commissionStatements.memberId);

  const linesOf = async (statementId: string, revision: number) =>
    test.admin.db
      .select()
      .from(schema.commissionStatementLines)
      .where(
        and(
          eq(schema.commissionStatementLines.statementId, statementId),
          eq(schema.commissionStatementLines.revision, revision),
        ),
      );

  const statementOf = async (member: TeamMember, period: PayPeriod) => {
    const found = (await statementsOf(period)).find((row) => row.memberId === member.id);
    if (found === undefined) throw new Error('no statement');
    return found;
  };

  const recalculate = (period: PayPeriod) => app.modules.payroll.jobs.recalculate(period, quiet);

  const untilWaitingOnAdvisoryLock = async (): Promise<void> => {
    const waiting = () => lockWaits(test.admin.db);
    for (let tries = 0; (await waiting()) < 1; tries += 1) {
      if (tries > 250) throw new Error('nobody waited for the lock');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  /** Holds `payroll.close` in an admin transaction, as a validation does, until `release` writes and commits. */
  const holdingTheClose = () => {
    let release: (write: (tx: Transaction) => Promise<void>) => void = () => undefined;
    let held: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      held = resolve;
    });
    const done = test.admin.db.transaction(async (tx) => {
      await lockPayrollClose(tx);
      const then = new Promise<(tx: Transaction) => Promise<void>>((resolve) => {
        release = resolve;
      });
      held();
      await (
        await then
      )(tx);
    });
    return {
      ready,
      done,
      release: (write: (tx: Transaction) => Promise<void>) => {
        release(write);
      },
    };
  };

  const periodAs = async (cookie: string, period: PayPeriod) => {
    const response = await call('GET', `/payroll/periods/${period}`, cookie);
    expect(response.statusCode, response.body).toBe(200);
    return PayrollPeriodSchema.parse(response.json());
  };

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
    app = await createApp(config, createLogger(config));
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    ({ userId: ownerId } = await createOwner(app.auth, app.db.db, OWNER));
    anna = (await app.modules.persona.creators.create({ displayName: 'Anna' })).id;
    main = newId(PlatformAccountIdSchema);
    dollars = newId(PlatformAccountIdSchema);
    await test.admin.db.insert(schema.platformAccounts).values([
      { id: main, creatorId: anna, platform: 'reveal', handle: 'anna-invente' },
      { id: dollars, creatorId: anna, platform: 'reveal', handle: 'anna-dollars-invente' },
    ]);
    await test.admin.db.insert(schema.accountPayRules).values([
      {
        id: newId(AccountPayRulesIdSchema),
        creatorId: anna,
        platformAccountId: main,
        fromPeriod: '2020-01-01',
        currency: 'EUR',
        vatBps: 0,
        platformFeeBps: 2_000,
        earningsSource: 'declared',
        createdBy: ownerId,
      },
      {
        id: newId(AccountPayRulesIdSchema),
        creatorId: anna,
        platformAccountId: dollars,
        fromPeriod: '2020-01-01',
        currency: 'USD',
        vatBps: 0,
        platformFeeBps: 2_000,
        earningsSource: 'declared',
        createdBy: ownerId,
      },
    ]);
    const { userId: creatorUserId } = await createOwner(app.auth, app.db.db, CREATOR);
    await test.admin.db
      .update(schema.user)
      .set({ role: 'creator', creatorIds: [anna] })
      .where(eq(schema.user.id, creatorUserId));
    owner = await signIn(server, OWNER.email, OWNER.password);
    creator = await signIn(server, CREATOR.email, CREATOR.password);
    ({ member: theo, cookie: theoCookie } = await addMember('theo@example.test', 'Théo'));
    ({ member: lea } = await addMember('lea@example.test', 'Léa'));
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('never guesses a rate: a period paid in dollars without one read is left uncomputed', async () => {
    await validated(theo, P3, 10_000, dollars);
    expect(await recalculate(P3)).toEqual([{ period: P3, outcome: 'blocked', written: 0 }]);
    expect(await statementsOf(P3)).toEqual([]);
    // The period says it, to the agency and to a member alike (recette du 28/10, Équipe G1).
    expect((await periodAs(owner, P3)).blocked).toMatchObject({
      code: 'exchange_rate_missing_conflict',
      currency: 'USD',
    });
    expect((await periodAs(theoCookie, P3)).blocked?.code).toBe('exchange_rate_missing_conflict');
    // Its period is written all the same, from midnight to midnight in the agency's zone (summer time from March 30).
    const [window] = await test.admin.db
      .select()
      .from(schema.payPeriods)
      .where(eq(schema.payPeriods.period, P3));
    expect(window?.startsAt.toISOString()).toBe('2025-03-31T22:00:00.000Z');
    expect(window?.endsAt.toISOString()).toBe('2025-04-15T22:00:00.000Z');
  });

  it('writes a draft per member from the validated reports, then nothing on a replay', async () => {
    const theoSale = await validated(theo, P1, 10_000);
    const leaSale = await validated(lea, P1, 5_000);
    expect(await recalculate(P1)).toEqual([{ period: P1, outcome: 'written', written: 2 }]);
    const theos = await statementOf(theo, P1);
    // 100 € gross, 20 % fee: 80 € net, 16 € of commission; the team made 120 € net.
    expect(theos).toMatchObject({ status: 'draft', revision: 1, netMinor: 8_000, commissionMinor: 1_600 });
    expect(theos.teamNetMinor).toBe(12_000);
    expect((await linesOf(theos.id, 1)).map((line) => line.shiftReportIds)).toEqual([[theoSale]]);
    expect((await linesOf((await statementOf(lea, P1)).id, 1)).map((line) => line.shiftReportIds)).toEqual([
      [leaSale],
    ]);

    expect(await recalculate(P1)).toEqual([{ period: P1, outcome: 'unchanged', written: 0 }]);
    expect((await statementOf(theo, P1)).revision).toBe(1);
    expect(await linesOf(theos.id, 2)).toEqual([]);
  });

  it('takes the next revision of the drafts a new report changes, keeping the lines of the one before', async () => {
    const before = await statementOf(theo, P1);
    await validated(theo, P1, 2_500);
    await recalculate(P1);
    const after = await statementOf(theo, P1);
    expect(after).toMatchObject({ id: before.id, revision: 2, netMinor: 10_000 });
    expect(after.inputsHash).not.toBe(before.inputsHash);
    expect(await linesOf(after.id, 1)).toHaveLength(1);
    expect((await linesOf(after.id, 2))[0]?.shiftReportIds).toHaveLength(2);
    // The team's net moved, and Léa's draft with it: the period is computed whole.
    expect((await statementOf(lea, P1)).teamNetMinor).toBe(14_000);
  });

  it('gives one draft per member when two recalculations run at once', async () => {
    await validated(theo, P2, 4_000);
    await validated(lea, P2, 6_000);
    const outcomes = await Promise.all([recalculate(P2), recalculate(P2)]);
    expect(
      outcomes
        .flat()
        .map((one) => one.outcome)
        .sort(),
    ).toEqual(['unchanged', 'written']);
    expect((await statementsOf(P2)).map((row) => row.revision)).toEqual([1, 1]);
  });

  it('waits for whoever holds the closing’s lock, and computes what they committed', async () => {
    await validated(theo, P4, 4_000);
    const validation = holdingTheClose();
    await validation.ready;
    const running = recalculate(P4);
    await untilWaitingOnAdvisoryLock();
    validation.release(async (tx) => {
      await tx.insert(schema.bonuses).values({
        id: newId(BonusIdSchema),
        memberId: theo.id,
        period: P4,
        amountMinor: 1_000,
        reason: 'Week-end tenu',
        createdBy: ownerId,
      });
    });
    await validation.done;
    expect(await running).toEqual([{ period: P4, outcome: 'written', written: 1 }]);
    expect(await statementOf(theo, P4)).toMatchObject({ revision: 1, bonusesMinor: 1_000 });
  });

  it('counts a report validated after its period’s closing on the team’s first open period, from where it came', async () => {
    const counted = (await test.admin.db.select().from(schema.shiftReports)).filter(
      (row) => row.period === P1 && row.status === 'validated',
    );
    // The closing of March 1st as a first validation writes it (ADR 0032; its code comes with the validation).
    await test.admin.db.transaction(async (tx) => {
      await tx.insert(schema.payPeriodClosings).values({
        period: P1,
        teamNetMinor: 14_000,
        collective: null,
        exchangeRates: [],
        closedBy: ownerId,
      });
      await tx
        .insert(schema.payPeriodReports)
        .values(counted.map((row) => ({ shiftReportId: row.id, period: P1, memberId: row.memberId })));
    });
    const late = await validated(theo, P1, 1_000);

    expect(await recalculate(P1)).toEqual([
      { period: P1, outcome: 'unchanged', written: 0 },
      { period: P2, outcome: 'written', written: 2 },
    ]);
    const theos = await statementOf(theo, P2);
    const lines = await linesOf(theos.id, theos.revision);
    expect(lines.flatMap((line) => line.lateReports)).toEqual([
      { shiftReportId: late, period: P1, grossMinor: 1_000 },
    ]);
    expect(lines.flatMap((line) => line.shiftReportIds)).toContain(late);
    // 40 € + 10 € gross: 40 € net.
    expect(theos.netMinor).toBe(4_000);
    // Before the first closing, a period is never computed again; the first open one is, should a report wait.
    expect(await recalculate(P0)).toEqual([
      { period: P0, outcome: 'never', written: 0 },
      { period: P2, outcome: 'unchanged', written: 0 },
    ]);
  });

  it('shows a period to the agency whole, and to a member their own, with the goal reached but never the team’s net', async () => {
    const all = await periodAs(owner, P1);
    expect(all.statements.map((one) => one.memberId).sort()).toEqual([theo.id, lea.id].sort());
    expect(all).toMatchObject({
      ended: true,
      beforeFirstClosing: false,
      closing: { period: P1, closedBy: ownerId, exchangeRates: [] },
    });
    // A member reads of a closing its date only.
    expect((await periodAs(theoCookie, P1)).closing).toEqual({
      ...all.closing,
      closedBy: null,
      exchangeRates: null,
    });
    expect(all.statements.find((one) => one.memberId === lea.id)).toMatchObject({
      canValidate: true,
      team: { netMinor: 14_000, collective: null },
    });

    const own = await periodAs(theoCookie, P2);
    expect(own.statements.map((one) => one.memberId)).toEqual([theo.id]);
    expect(own.statements[0]).toMatchObject({ canValidate: false, team: null });
    expect(own.statements[0]?.lines.flatMap((line) => line.lateReports)).toHaveLength(1);
    expect(own.closing).toBeNull();

    await test.admin.db.insert(schema.collectiveGoals).values({
      id: newId(CollectiveGoalIdSchema),
      period: P2,
      targetMinor: 20_000,
      tiers: [{ reachedBps: 5_000, bonusMinor: 3_000 }],
      createdBy: ownerId,
    });
    await recalculate(P2);
    const followed = await periodAs(theoCookie, P2);
    // 40 € + 48 € of 200 €: 44 %, under the tier of 50 %; the agency reads the net, the member the percentage only.
    expect(followed.statements[0]?.team).toEqual({
      netMinor: null,
      collective: { reachedBps: 4_400, tier: null },
    });
    expect(
      (await periodAs(owner, P2)).statements.find((one) => one.memberId === theo.id)?.team?.netMinor,
    ).toBe(8_800);
    expect(followed.collectiveGoal?.targetMinor).toBe(20_000);

    expect((await call('GET', `/payroll/periods/${P1}`, creator)).statusCode).toBe(403);
    expect((await call('GET', '/payroll/periods/2025-03-02', owner)).statusCode).toBe(400);
  });

  it('shows a suspended manager his own statement only, like a chatter (ADR 0024)', async () => {
    const leaCookie = await signIn(server, 'lea@example.test', PASSWORD);
    const setLea = (values: { teamRole: 'chatter' | 'manager'; status: 'active' | 'suspended' }) =>
      test.admin.db.update(schema.teamMembers).set(values).where(eq(schema.teamMembers.id, lea.id));
    await setLea({ teamRole: 'manager', status: 'active' });
    expect((await periodAs(leaCookie, P1)).statements.map((one) => one.memberId).sort()).toEqual(
      [theo.id, lea.id].sort(),
    );
    await setLea({ teamRole: 'manager', status: 'suspended' });
    const own = await periodAs(leaCookie, P1);
    expect(own.statements.map((one) => one.memberId)).toEqual([lea.id]);
    expect(own.statements[0]?.team).toBeNull();
    await setLea({ teamRole: 'chatter', status: 'active' });
  });

  /** A report `member` makes on a shift of `period`, submitted. */
  const madeReport = async (member: TeamMember, cookie: string, period: PayPeriod) => {
    const shift = await shiftIn(member, period);
    const made = await call('POST', '/scheduling/shift-reports', cookie, {
      id: newId(ShiftReportIdSchema),
      shiftId: shift.id,
      amountMinor: 1_000,
      currency: 'EUR',
      correctsId: null,
      comment: null,
      incident: null,
    });
    expect(made.statusCode, made.body).toBe(201);
    return ShiftReportSchema.parse(made.json());
  };
  const recalculationsOf = async (period: PayPeriod) =>
    (
      await test.admin.db.execute<{ payload: unknown; run_at: Date; max_attempts: unknown }>(
        sql`select payload, run_at, max_attempts from graphile_worker._private_jobs
            where key = ${`payroll.recalculate:${period}`}`,
      )
    ).rows.map((row) => ({
      payload: row.payload,
      runAt: new Date(row.run_at).getTime(),
      maxAttempts: row.max_attempts,
    }));
  const forgetRecalculations = (period: PayPeriod) =>
    test.admin.db.execute(
      sql`delete from graphile_worker._private_jobs where key = ${`payroll.recalculate:${period}`}`,
    );
  const validateReport = async (report: { id: string; version: number }) => {
    const validation = await call('POST', '/scheduling/shift-reports/validate', owner, { reports: [report] });
    expect(validation.statusCode, validation.body).toBe(200);
    return ValidateShiftReportsResultSchema.parse(validation.json()).results;
  };

  it('enqueues the recalculation of a report’s period when it is validated', async () => {
    const report = await madeReport(lea, await signIn(server, 'lea@example.test', PASSWORD), P2);
    await forgetRecalculations(P2);
    expect((await validateReport(report))[0]?.outcome).toBe('validated');
    expect(await recalculationsOf(P2)).toEqual([
      expect.objectContaining({
        payload: { period: P2 },
        maxAttempts: JOB_MAX_ATTEMPTS['payroll.recalculate'],
      }),
    ]);
  });

  it('merges a burst of validations into one recalculation, and enqueues none for a refused one', async () => {
    const leaCookie = await signIn(server, 'lea@example.test', PASSWORD);
    const [first, second, stale] = [
      await madeReport(lea, leaCookie, P2),
      await madeReport(theo, theoCookie, P2),
      await madeReport(lea, leaCookie, P2),
    ];
    await forgetRecalculations(P2);

    // Refused (a version the report no longer has): its transaction is undone, the job with it.
    expect(await validateReport({ id: stale.id, version: stale.version + 1 })).toEqual([
      { outcome: 'refused', id: stale.id, code: 'shift_report_changed_conflict' },
    ]);
    expect(await recalculationsOf(P2)).toEqual([]);

    // Two validations one after the other: one job for the period, put back after the last one (`replace`).
    expect((await validateReport(first))[0]?.outcome).toBe('validated');
    const [once] = await recalculationsOf(P2);
    expect((await validateReport(second))[0]?.outcome).toBe('validated');
    const burst = await recalculationsOf(P2);
    expect(burst.map((job) => job.payload)).toEqual([{ period: P2 }]);
    expect(burst[0]?.runAt).toBeGreaterThanOrEqual(once?.runAt ?? Number.POSITIVE_INFINITY);
  });

  it('says a period before the team’s first closing is closed without a statement, its late report counted on the first open one', async () => {
    const late = await validated(lea, P0, 2_000);

    // Léa's draft of March 16th takes the late report, and Théo's the team's net it raises toward their goal.
    expect(await recalculate(P0)).toEqual([
      { period: P0, outcome: 'never', written: 0 },
      { period: P2, outcome: 'written', written: 2 },
    ]);
    const leas = await statementOf(lea, P2);
    expect((await linesOf(leas.id, leas.revision)).flatMap((line) => line.lateReports)).toEqual([
      { shiftReportId: late, period: P0, grossMinor: 2_000 },
    ]);
    expect(await periodAs(owner, P0)).toMatchObject({
      beforeFirstClosing: true,
      closing: null,
      statements: [],
    });
    expect(await periodAs(theoCookie, P0)).toMatchObject({ beforeFirstClosing: true, statements: [] });
    expect((await periodAs(owner, P2)).beforeFirstClosing).toBe(false);
  });

  it('records a period blocked by a member without a rate, shows it, and lifts it once the data is corrected', async () => {
    // Théo's draft is computed; then Basile, whose first rate starts at his arrival in June, has a report of May
    // (Équipe B2: an old report from before his arrival). The whole period stops computing, Théo's draft with it.
    await validated(theo, P5, 3_000);
    expect(await recalculate(P5)).toEqual([{ period: P5, outcome: 'written', written: 1 }]);
    const { member: basile } = await addMember('basile@example.test', 'Basile', '2025-06-01');
    await validated(basile, P5, 1_000);
    expect(await recalculate(P5)).toEqual([{ period: P5, outcome: 'blocked', written: 0 }]);

    const blocked = await periodAs(owner, P5);
    expect(blocked.blocked).toMatchObject({
      code: 'commission_rate_missing_conflict',
      memberIds: [basile.id],
    });
    // The stale draft is still there: the block is what says it is out of date.
    expect(blocked.statements.map((one) => one.memberId)).toEqual([theo.id]);
    // A colleague reads that the period is blocked, never who lacks a rate.
    expect((await periodAs(theoCookie, P5)).blocked).toMatchObject({
      code: 'commission_rate_missing_conflict',
      memberIds: [],
    });
    const list = await call('GET', '/payroll/periods?limit=50', owner);
    expect(list.statusCode, list.body).toBe(200);
    const listed = PayPeriodPageSchema.parse(list.json()).items.find((item) => item.window.period === P5);
    expect(listed?.blocked).toMatchObject({
      code: 'commission_rate_missing_conflict',
      memberIds: [basile.id],
    });

    // A replay keeps when the block began.
    const since = blocked.blocked?.since;
    expect(await recalculate(P5)).toEqual([{ period: P5, outcome: 'blocked', written: 0 }]);
    expect((await periodAs(owner, P5)).blocked?.since).toBe(since);

    // A data correction the product refuses (a rate never goes back, ADR 0031 and the card of 28/10), only possible on
    // rows written before #290: a rate for Basile from May 1st. The next computation passes and lifts the block.
    await test.admin.db.insert(schema.memberCommissionRates).values({
      id: newId(CommissionRateIdSchema),
      memberId: basile.id,
      rateBps: 2_000,
      effectiveFrom: P5,
      createdBy: ownerId,
    });
    // Basile's first draft, and Théo's next revision: the team's net moved.
    expect(await recalculate(P5)).toEqual([{ period: P5, outcome: 'written', written: 2 }]);
    const lifted = await periodAs(owner, P5);
    expect(lifted.blocked).toBeNull();
    expect(lifted.statements.map((one) => one.memberId).sort()).toEqual([theo.id, basile.id].sort());
    expect(
      await test.admin.db.select().from(schema.payPeriodBlocks).where(eq(schema.payPeriodBlocks.period, P5)),
    ).toEqual([]);
  });

  it('lists a blocked period without any statement: to the agency, and to the member it is about', async () => {
    // Iris arrives in August; her only report is of May 16th: nobody has a statement there, the period is blocked.
    const { member: iris, cookie: irisCookie } = await addMember('iris@example.test', 'Iris', '2025-08-01');
    await validated(iris, P6, 1_500);
    expect(await recalculate(P6)).toEqual([{ period: P6, outcome: 'blocked', written: 0 }]);
    expect(await statementsOf(P6)).toEqual([]);

    const listOf = async (cookie: string) => {
      const response = await call('GET', '/payroll/periods?limit=50', cookie);
      expect(response.statusCode, response.body).toBe(200);
      return PayPeriodPageSchema.parse(response.json()).items.find((item) => item.window.period === P6);
    };
    expect(await listOf(owner)).toMatchObject({
      blocked: { code: 'commission_rate_missing_conflict', memberIds: [iris.id] },
      statements: { draft: 0, validated: 0, paid: 0, carried: 0 },
      netMinor: 0,
      payableMinor: 0,
      paidMinor: 0,
    });
    expect((await listOf(irisCookie))?.blocked).toMatchObject({ memberIds: [iris.id] });
    // A colleague with nothing there does not get the period in their list.
    expect(await listOf(theoCookie)).toBeUndefined();
  });
});
