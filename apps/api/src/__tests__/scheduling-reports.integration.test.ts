import {
  AccountPayRulesIdSchema,
  AccountPayRulesListSchema,
  AccountPayRulesSchema,
  ApiErrorSchema,
  nextPayPeriod,
  newId,
  payPeriodOfDay,
  PlatformAccountIdSchema,
  previousPayPeriod,
  ShiftIdSchema,
  ShiftReportContextSchema,
  ShiftReportIdSchema,
  ShiftReportListSchema,
  ShiftReportSchema,
  TeamMemberSchema,
  ValidateShiftReportsResultSchema,
  type CreatorId,
  type PayPeriod,
  type PlatformAccountId,
  type ShiftId,
  type ShiftReport,
  type ShiftReportId,
  type TeamMember,
} from '@nirvana/contracts';
import { eq, lockMemberPeriod, schema, sql, type Transaction } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { lockWaits } from './support/lock-waits';
import { PARIS, parisDay, parisInstant } from './support/paris';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

/** Invented people, creators and accounts only (ADR 0010). */
const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const CREATOR = { email: 'creator@example.test', name: 'Creator', password: 'battery staple horse' };
const PASSWORD = 'staple battery horse';
const MINUTE = 60_000;

const codeOf = (response: LightMyRequestResponse): string => ApiErrorSchema.parse(response.json()).error.code;
const detailsOf = (response: LightMyRequestResponse) => ApiErrorSchema.parse(response.json()).error.details;

describe('Équipe › Rapports de fin de shift (/v1/scheduling, EQ-03, ADR 0023)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let ownerId: string;
  let owner: string;
  let creator: string;
  let anna: CreatorId;
  let ines: CreatorId;
  let annaMain: PlatformAccountId;
  let annaSecond: PlatformAccountId;
  let annaThird: PlatformAccountId;
  let inesMain: PlatformAccountId;
  let theo: TeamMember;
  let basile: TeamMember;
  let nora: TeamMember;
  let iris: TeamMember;
  let theoCookie: string;
  let basileCookie: string;
  let noraCookie: string;
  let irisCookie: string;

  /** Theo's shifts: yesterday's, two days before's on another day, a cancelled one, one closing now, one later. */
  let theoPast: ShiftId;
  let theoOther: ShiftId;
  let theoCancelled: ShiftId;
  let theoNow: ShiftId;
  let theoLater: ShiftId;
  let noraPast: ShiftId;
  let basileSecond: ShiftId;
  let basileInes: ShiftId;
  let irisNow: ShiftId;
  let theoPeriod: PayPeriod;

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie: string, payload?: object) =>
    server.inject({
      method,
      url: `/v1${url}`,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      ...(payload !== undefined && { payload }),
    });

  const addMember = async (body: {
    email: string;
    displayName: string;
    teamRole: 'chatter' | 'manager';
    creatorIds: CreatorId[];
  }): Promise<{ member: TeamMember; cookie: string }> => {
    const response = await call('POST', '/team/members', owner, {
      ...body,
      firstName: body.displayName,
      lastName: 'Inventé',
      country: 'FR',
      timeZone: 'Europe/Paris',
      joinedOn: parisDay(-30),
      commission: { rateBps: 1000 },
      teamShareBps: body.teamRole === 'manager' ? 500 : null,
    });
    expect(response.statusCode).toBe(201);
    const member = TeamMemberSchema.parse(response.json());
    const context = await app.auth.$context;
    await context.internalAdapter.linkAccount({
      userId: member.userId,
      providerId: 'credential',
      accountId: member.userId,
      password: await context.password.hash(PASSWORD),
    });
    return { member, cookie: await signIn(server, body.email, PASSWORD) };
  };

  /** A shift written as the planning would have, ended ones included (the planning never writes the past). */
  const shiftOn = async (
    member: TeamMember,
    creatorId: CreatorId,
    platformAccountId: PlatformAccountId,
    startsAt: Date,
    endsAt: Date,
    cancelled = false,
  ): Promise<ShiftId> => {
    const id = newId(ShiftIdSchema);
    await test.admin.db.insert(schema.shifts).values({
      id,
      creatorId,
      platformAccountId,
      memberId: member.id,
      startsAt,
      endsAt,
      cancelledAt: cancelled ? endsAt : null,
      createdBy: ownerId,
      updatedBy: ownerId,
    });
    return id;
  };

  /** 10:00 to 12:00 in Paris, `days` from today. */
  const morningOf = (days: number): [Date, Date] => [
    parisInstant(parisDay(days), 600),
    parisInstant(parisDay(days), 720),
  ];

  const rulesFor = (
    platformAccountId: PlatformAccountId,
    creatorId: CreatorId,
    source: 'declared' | 'detected',
  ) =>
    test.admin.db.insert(schema.accountPayRules).values({
      id: newId(AccountPayRulesIdSchema),
      creatorId,
      platformAccountId,
      fromPeriod: '2020-01-01',
      currency: 'EUR',
      vatBps: 2000,
      platformFeeBps: 2000,
      earningsSource: source,
      createdBy: ownerId,
    });

  const make = (
    cookie: string,
    shiftId: ShiftId,
    amountMinor: number,
    extra: {
      id?: ShiftReportId;
      correctsId?: ShiftReportId;
      currency?: 'EUR' | 'USD';
      comment?: string;
      incident?: string;
    } = {},
  ) =>
    call('POST', '/scheduling/shift-reports', cookie, {
      id: extra.id ?? newId(ShiftReportIdSchema),
      shiftId,
      amountMinor,
      currency: extra.currency ?? 'EUR',
      correctsId: extra.correctsId ?? null,
      comment: extra.comment ?? null,
      incident: extra.incident ?? null,
    });

  const reportOf = (response: LightMyRequestResponse, status = 201): ShiftReport => {
    expect(response.statusCode, response.body).toBe(status);
    return ShiftReportSchema.parse(response.json());
  };

  const validate = async (cookie: string, reports: readonly ShiftReport[]) => {
    const response = await call('POST', '/scheduling/shift-reports/validate', cookie, {
      reports: reports.map((one) => ({ id: one.id, version: one.version })),
    });
    expect(response.statusCode).toBe(200);
    return ValidateShiftReportsResultSchema.parse(response.json()).results;
  };

  /** What a validation answered, the validated reports by id, status and version. */
  const outcomes = (results: Awaited<ReturnType<typeof validate>>) =>
    results.map((one) =>
      one.outcome === 'validated'
        ? { validated: one.report.id, status: one.report.status, version: one.report.version }
        : { refused: one.id, code: one.code },
    );

  const list = async (cookie: string, period?: PayPeriod) => {
    const query = period === undefined ? '' : `?period=${period}`;
    const response = await call('GET', `/scheduling/shift-reports${query}`, cookie);
    expect(response.statusCode).toBe(200);
    return ShiftReportListSchema.parse(response.json());
  };

  /** How many locks someone waits on in this test's database, of `kind` or of any kind. */
  const waitingOnLocks = (kind: 'advisory' | null): Promise<number> => lockWaits(test.admin.db, kind);

  const untilWaiting = async (kind: 'advisory' | null, count = 1): Promise<void> => {
    for (let tries = 0; (await waitingOnLocks(kind)) < count; tries += 1) {
      if (tries > 250) throw new Error('nobody waited for the lock');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  /**
   * Holds what `hold` takes in an admin transaction until `release`, which may write in it before it commits: another
   * writer at the same moment, for the locks.
   */
  const holding = (hold: (tx: Transaction) => Promise<void>) => {
    type Then = ((tx: Transaction) => Promise<void>) | null;
    let release: (then: Then) => void = () => undefined;
    let held: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      held = resolve;
    });
    const done = test.admin.db.transaction(async (tx) => {
      await hold(tx);
      const then = new Promise<Then>((resolve) => {
        release = resolve;
      });
      held();
      const write = await then;
      if (write !== null) await write(tx);
    });
    return {
      ready,
      done,
      release: (then: Then = null) => {
        release(then);
      },
    };
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
    ines = (await app.modules.persona.creators.create({ displayName: 'Inès' })).id;
    annaMain = newId(PlatformAccountIdSchema);
    annaSecond = newId(PlatformAccountIdSchema);
    annaThird = newId(PlatformAccountIdSchema);
    inesMain = newId(PlatformAccountIdSchema);
    await test.admin.db.insert(schema.platformAccounts).values([
      { id: annaMain, creatorId: anna, platform: 'reveal', handle: 'anna-invente' },
      { id: annaSecond, creatorId: anna, platform: 'reveal', handle: 'anna-bis-invente' },
      { id: annaThird, creatorId: anna, platform: 'reveal', handle: 'anna-ter-invente' },
      { id: inesMain, creatorId: ines, platform: 'reveal', handle: 'ines-inventee' },
    ]);
    const { userId: creatorUserId } = await createOwner(app.auth, app.db.db, CREATOR);
    await test.admin.db
      .update(schema.user)
      .set({ role: 'creator', creatorIds: [anna] })
      .where(eq(schema.user.id, creatorUserId));
    owner = await signIn(server, OWNER.email, OWNER.password);
    creator = await signIn(server, CREATOR.email, CREATOR.password);
    ({ member: theo, cookie: theoCookie } = await addMember({
      email: 'theo@example.test',
      displayName: 'Théo',
      teamRole: 'chatter',
      creatorIds: [anna],
    }));
    ({ member: basile, cookie: basileCookie } = await addMember({
      email: 'basile@example.test',
      displayName: 'Basile',
      teamRole: 'chatter',
      creatorIds: [anna, ines],
    }));
    ({ member: nora, cookie: noraCookie } = await addMember({
      email: 'nora@example.test',
      displayName: 'Nora',
      teamRole: 'manager',
      creatorIds: [anna, ines],
    }));
    ({ member: iris, cookie: irisCookie } = await addMember({
      email: 'iris@example.test',
      displayName: 'Iris',
      teamRole: 'manager',
      creatorIds: [anna],
    }));

    // No rules on the second account; the sales of Inès's account are read, never declared.
    await rulesFor(annaMain, anna, 'declared');
    await rulesFor(annaThird, anna, 'declared');
    await rulesFor(inesMain, ines, 'detected');

    const now = Math.floor(Date.now() / MINUTE) * MINUTE;
    const at = (minutes: number) => new Date(now + minutes * MINUTE);
    theoPast = await shiftOn(theo, anna, annaMain, ...morningOf(-1));
    noraPast = await shiftOn(nora, anna, annaMain, ...morningOf(-2));
    theoOther = await shiftOn(theo, anna, annaMain, ...morningOf(-3));
    theoCancelled = await shiftOn(theo, anna, annaMain, ...morningOf(-4), true);
    theoNow = await shiftOn(theo, anna, annaMain, at(-90), at(20));
    theoLater = await shiftOn(theo, anna, annaMain, at(60), at(180));
    basileSecond = await shiftOn(basile, anna, annaSecond, ...morningOf(-1));
    basileInes = await shiftOn(basile, ines, inesMain, ...morningOf(-2));
    irisNow = await shiftOn(iris, anna, annaThird, at(-60), at(20));
    theoPeriod = payPeriodOfDay(parisDay(-1));
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  let theoReport: ShiftReport;
  let noraReport: ShiftReport;
  let theoNowReport: ShiftReport;

  it('opens the panel on the member’s shift: its period, when it opens, the rules in force', async () => {
    const response = await call('GET', `/scheduling/shifts/${theoPast}/report`, theoCookie);
    expect(response.statusCode).toBe(200);
    const context = ShiftReportContextSchema.parse(response.json());
    expect(context).toMatchObject({
      shift: { id: theoPast, memberId: theo.id },
      account: { id: annaMain, creatorName: 'Anna' },
      period: theoPeriod,
      rules: { currency: 'EUR', earningsSource: 'declared' },
      reports: [],
    });
    expect(Date.parse(context.opensAt)).toBe(morningOf(-1)[1].getTime() - 30 * MINUTE);
    const later = ShiftReportContextSchema.parse(
      (await call('GET', `/scheduling/shifts/${theoLater}/report`, owner)).json(),
    );
    expect(Date.parse(later.opensAt)).toBe(Date.parse(later.shift.endsAt) - 30 * MINUTE);
    const none = await call('GET', `/scheduling/shifts/${annaSecond}/report`, theoCookie);
    expect([none.statusCode, codeOf(none)]).toEqual([404, 'shift_not_found']);
    const colleague = await call('GET', `/scheduling/shifts/${theoPast}/report`, basileCookie);
    expect([colleague.statusCode, codeOf(colleague)]).toEqual([404, 'shift_not_found']);
    const noRules = ShiftReportContextSchema.parse(
      (await call('GET', `/scheduling/shifts/${basileSecond}/report`, basileCookie)).json(),
    );
    expect(noRules.rules).toBeNull();
    expect((await call('GET', `/scheduling/shifts/${theoPast}/report`, creator)).statusCode).toBe(403);
  });

  it('records the member’s report once, and answers a retry with it', async () => {
    const body = {
      id: newId(ShiftReportIdSchema),
      shiftId: theoPast,
      amountMinor: 12_345,
      currency: 'EUR',
      comment: '  Bonne soirée  ',
      incident: 'Connexion coupée vingt minutes',
    };
    theoReport = reportOf(await call('POST', '/scheduling/shift-reports', theoCookie, body));
    expect(theoReport).toMatchObject({
      shiftId: theoPast,
      creatorId: anna,
      platformAccountId: annaMain,
      memberId: theo.id,
      period: theoPeriod,
      correctsId: null,
      amount: { amountMinor: 12_345, currency: 'EUR' },
      comment: 'Bonne soirée',
      incident: 'Connexion coupée vingt minutes',
      status: 'submitted',
      version: 1,
      byAgency: false,
      canReview: false,
      reviewedAt: null,
      reviewNote: null,
    });
    expect(reportOf(await call('POST', '/scheduling/shift-reports', theoCookie, body), 200)).toEqual(
      theoReport,
    );
    const other = await call('POST', '/scheduling/shift-reports', theoCookie, { ...body, amountMinor: 1 });
    expect([other.statusCode, codeOf(other)]).toEqual([409, 'shift_report_conflict']);
    const second = await make(theoCookie, theoPast, 1);
    expect([second.statusCode, codeOf(second), detailsOf(second)]).toEqual([
      409,
      'shift_report_exists_conflict',
      { shiftReportId: theoReport.id },
    ]);
    // The same id sent by someone else is never their retry.
    const stolen = await call('POST', '/scheduling/shift-reports', owner, body);
    expect([stolen.statusCode, codeOf(stolen)]).toEqual([409, 'shift_report_conflict']);
  });

  it('takes a report as the shift closes, never before, and never on a cancelled shift', async () => {
    const early = await make(theoCookie, theoLater, 0);
    expect([early.statusCode, codeOf(early)]).toEqual([409, 'shift_report_early_conflict']);
    expect(detailsOf(early)).toHaveProperty('opensAt');
    const cancelled = await make(theoCookie, theoCancelled, 0);
    expect([cancelled.statusCode, codeOf(cancelled)]).toEqual([404, 'shift_not_found']);
    // A shift that sold nothing says so.
    theoNowReport = reportOf(await make(theoCookie, theoNow, 0, { comment: 'Soirée calme' }));
    expect(theoNowReport.amount.amountMinor).toBe(0);
  });

  it('takes a report from the shift’s member alone', async () => {
    const manager = await make(noraCookie, theoOther, 100);
    expect([manager.statusCode, codeOf(manager)]).toEqual([403, 'shift_report_forbidden']);
    const ownerMade = await make(owner, theoOther, 100);
    expect([ownerMade.statusCode, codeOf(ownerMade)]).toEqual([403, 'shift_report_forbidden']);
    const colleague = await make(basileCookie, theoOther, 100);
    expect([colleague.statusCode, codeOf(colleague)]).toEqual([404, 'shift_not_found']);
    const negative = await make(theoCookie, theoOther, -1);
    expect([negative.statusCode, codeOf(negative)]).toEqual([400, 'request_invalid']);
  });

  it('needs the account’s rules for the period, in their currency, never on read sales', async () => {
    const missing = await make(basileCookie, basileSecond, 100);
    expect([missing.statusCode, codeOf(missing)]).toEqual([409, 'pay_rules_missing_conflict']);
    const detected = await make(basileCookie, basileInes, 100);
    expect([detected.statusCode, codeOf(detected)]).toEqual([409, 'shift_report_detected_conflict']);
    const dollars = await make(theoCookie, theoOther, 100, { currency: 'USD' });
    expect([dollars.statusCode, codeOf(dollars)]).toEqual([409, 'shift_report_currency_conflict']);
  });

  it('lets its member change it from the version they read, and no one else', async () => {
    const path = `/scheduling/shift-reports/${theoReport.id}`;
    const changed = reportOf(
      await call('PATCH', path, theoCookie, { version: 1, amountMinor: 13_000, comment: null }),
      200,
    );
    expect(changed).toMatchObject({
      amount: { amountMinor: 13_000 },
      comment: null,
      incident: 'Connexion coupée vingt minutes',
      status: 'submitted',
      version: 2,
    });
    const stale = await call('PATCH', path, theoCookie, { version: 1, amountMinor: 1 });
    expect([stale.statusCode, codeOf(stale)]).toEqual([409, 'shift_report_changed_conflict']);
    const manager = await call('PATCH', path, noraCookie, { version: 2, amountMinor: 1 });
    expect([manager.statusCode, codeOf(manager)]).toEqual([403, 'shift_report_forbidden']);
    // Sent again as it is while submitted: nothing changes, not even the version.
    expect(reportOf(await call('PATCH', path, theoCookie, { version: 2 }), 200)).toEqual(changed);
    const missing = await call(
      'PATCH',
      `/scheduling/shift-reports/${newId(ShiftReportIdSchema)}`,
      theoCookie,
      {
        version: 1,
      },
    );
    expect([missing.statusCode, codeOf(missing)]).toEqual([404, 'shift_report_not_found']);
    theoReport = changed;
  });

  it('goes back to its member with a note, and comes back submitted', async () => {
    const own = await call('POST', '/scheduling/shift-reports/validate', theoCookie, {
      reports: [{ id: theoReport.id, version: 2 }],
    });
    expect([own.statusCode, codeOf(own)]).toEqual([403, 'shift_report_forbidden']);
    const path = `/scheduling/shift-reports/${theoReport.id}/reject`;
    const rejected = reportOf(
      await call('POST', path, noraCookie, { version: 2, note: 'Il manque le pourboire de 22 h' }),
      200,
    );
    expect(rejected).toMatchObject({
      status: 'rejected',
      version: 3,
      reviewNote: 'Il manque le pourboire de 22 h',
    });
    expect(rejected.reviewedAt).not.toBeNull();
    const twice = await call('POST', path, irisCookie, { version: 3, note: 'Encore' });
    expect([twice.statusCode, codeOf(twice)]).toEqual([409, 'shift_report_changed_conflict']);
    const again = reportOf(
      await call('PATCH', `/scheduling/shift-reports/${theoReport.id}`, theoCookie, { version: 3 }),
      200,
    );
    expect(again).toMatchObject({
      status: 'submitted',
      version: 4,
      amount: { amountMinor: 13_000 },
      reviewedAt: null,
      reviewNote: null,
    });
    theoReport = again;
  });

  it('validates in one gesture what was read, each report on its own', async () => {
    const unknown = { ...theoReport, id: newId(ShiftReportIdSchema) };
    const stale = { ...theoNowReport, version: theoNowReport.version + 1 };
    const results = await validate(noraCookie, [theoReport, unknown, stale]);
    expect(outcomes(results)).toEqual([
      { validated: theoReport.id, status: 'validated', version: 5 },
      { refused: unknown.id, code: 'shift_report_not_found' },
      { refused: theoNowReport.id, code: 'shift_report_changed_conflict' },
    ]);
    const [first] = results;
    if (first?.outcome !== 'validated') throw new Error('not validated');
    theoReport = first.report;
    expect(theoReport.canReview).toBe(false);
    const changed = await call('PATCH', `/scheduling/shift-reports/${theoReport.id}`, theoCookie, {
      version: 5,
      amountMinor: 1,
    });
    expect([changed.statusCode, codeOf(changed)]).toEqual([409, 'shift_report_validated_conflict']);
    const rejected = await call('POST', `/scheduling/shift-reports/${theoReport.id}/reject`, irisCookie, {
      version: 5,
      note: 'Trop tard',
    });
    expect([rejected.statusCode, codeOf(rejected)]).toEqual([409, 'shift_report_changed_conflict']);
  });

  it('four eyes: nobody reviews their own shift, the agency sees what it may review', async () => {
    noraReport = reportOf(await make(noraCookie, noraPast, 5_000));
    expect(noraReport.canReview).toBe(false);
    expect(await validate(noraCookie, [noraReport])).toEqual([
      { outcome: 'refused', id: noraReport.id, code: 'shift_report_own_review_forbidden' },
    ]);
    const open = await list(irisCookie);
    expect(open.reports.find((one) => one.id === noraReport.id)?.canReview).toBe(true);
    expect(open.reports.find((one) => one.id === theoNowReport.id)?.canReview).toBe(true);
    const [validated] = await validate(irisCookie, [noraReport]);
    expect(validated).toMatchObject({ outcome: 'validated', report: { status: 'validated' } });
  });

  let ownerCorrection: ShiftReport;
  let noraCorrection: ShiftReport;

  it('corrects a validated report, never a correction nor a report not yet validated', async () => {
    ownerCorrection = reportOf(
      await make(owner, theoPast, -3_000, { correctsId: theoReport.id, comment: 'Remboursement' }),
    );
    expect(ownerCorrection).toMatchObject({
      correctsId: theoReport.id,
      memberId: theo.id,
      period: theoPeriod,
      amount: { amountMinor: -3_000 },
      status: 'submitted',
      byAgency: true,
      canReview: true,
    });
    noraCorrection = reportOf(await make(noraCookie, theoPast, -1_000, { correctsId: theoReport.id }));
    expect(noraCorrection).toMatchObject({ byAgency: true, canReview: false });
    const theoCorrection = reportOf(await make(theoCookie, theoPast, 500, { correctsId: theoReport.id }));
    expect(theoCorrection).toMatchObject({ byAgency: false });

    const ofACorrection = await make(owner, theoPast, 100, { correctsId: ownerCorrection.id });
    expect([ofACorrection.statusCode, codeOf(ofACorrection)]).toEqual([400, 'request_invalid']);
    const notValidated = await make(owner, theoNow, 100, { correctsId: theoNowReport.id });
    expect([notValidated.statusCode, codeOf(notValidated)]).toEqual([409, 'shift_report_validated_conflict']);
    const otherShift = await make(owner, theoOther, 100, { correctsId: theoReport.id });
    expect([otherShift.statusCode, codeOf(otherShift)]).toEqual([404, 'shift_report_not_found']);
    const colleague = await make(basileCookie, theoPast, 100, { correctsId: theoReport.id });
    expect([colleague.statusCode, codeOf(colleague)]).toEqual([404, 'shift_not_found']);
    const withIncident = await make(theoCookie, theoPast, 100, {
      correctsId: theoReport.id,
      incident: 'Panne',
    });
    expect([withIncident.statusCode, codeOf(withIncident)]).toEqual([400, 'request_invalid']);
  });

  it('the owner reviews their own correction; a manager never theirs', async () => {
    expect(outcomes(await validate(owner, [ownerCorrection]))).toEqual([
      { validated: ownerCorrection.id, status: 'validated', version: 2 },
    ]);
    expect(await validate(noraCookie, [noraCorrection])).toEqual([
      { outcome: 'refused', id: noraCorrection.id, code: 'shift_report_own_review_forbidden' },
    ]);
    const [byIris] = await validate(irisCookie, [noraCorrection]);
    expect(byIris).toMatchObject({ outcome: 'validated' });
  });

  it('never lets the shift’s validated total go below 0, made or validated', async () => {
    // Validated: 13 000 − 3 000 − 1 000 = 9 000; Théo’s + 500 waits.
    const tooMuch = await make(owner, theoPast, -9_001, { correctsId: theoReport.id });
    expect([tooMuch.statusCode, codeOf(tooMuch)]).toEqual([409, 'shift_report_total_conflict']);
    const first = reportOf(await make(owner, theoPast, -5_000, { correctsId: theoReport.id }));
    const second = reportOf(await make(owner, theoPast, -5_000, { correctsId: theoReport.id }));
    expect(outcomes(await validate(irisCookie, [first, second]))).toEqual([
      { validated: first.id, status: 'validated', version: 2 },
      { refused: second.id, code: 'shift_report_total_conflict' },
    ]);
  });

  it('lists a period for its member, and what is still open for the agency', async () => {
    const theos = await list(theoCookie, theoPeriod);
    expect(theos.reports.map((one) => one.id)).toContain(theoReport.id);
    expect(theos.reports.every((one) => one.memberId === theo.id)).toBe(true);
    expect(theos.shifts.map((one) => one.id)).toContain(theoPast);
    expect(theos.shifts.every((one) => one.memberId === theo.id)).toBe(true);
    expect(theos.shifts.map((one) => one.id)).not.toContain(theoLater);
    expect(theos.shifts.map((one) => one.id)).not.toContain(theoCancelled);
    expect(theos.members.map((one) => one.id)).toEqual([theo.id]);
    expect(theos.accounts.map((one) => one.id)).toEqual([annaMain]);

    const basiles = await list(basileCookie, payPeriodOfDay(parisDay(-1)));
    expect(basiles.reports).toEqual([]);
    if (payPeriodOfDay(parisDay(-2)) === payPeriodOfDay(parisDay(-1))) {
      // A « Sans rapport » line for each shift, on both creators.
      expect(new Set(basiles.shifts.map((one) => one.id))).toEqual(new Set([basileSecond, basileInes]));
    }

    const open = await list(noraCookie);
    expect(open.reports.every((one) => one.status === 'submitted' || one.status === 'rejected')).toBe(true);
    expect(open.reports.map((one) => one.id)).toContain(theoNowReport.id);
    expect(open.reports.map((one) => one.id)).not.toContain(theoReport.id);
    expect(open.shifts.map((one) => one.id)).toEqual(expect.arrayContaining([theoNow, theoPast]));
    expect(open.members.map((one) => one.id)).toContain(theo.id);
  });

  it('keeps a reported shift from being cancelled', async () => {
    const cancel = await call('DELETE', `/scheduling/shifts/${theoNow}`, owner);
    expect([cancel.statusCode, codeOf(cancel), detailsOf(cancel)]).toEqual([
      409,
      'shift_report_exists_conflict',
      { shiftReportId: theoNowReport.id },
    ]);
  });

  it('waits on the lock (member, period) that pay’s validation takes too', async () => {
    const lock = holding((tx) => lockMemberPeriod(tx, theo.id, theoPeriod));
    await lock.ready;
    const correcting = make(theoCookie, theoPast, 100, { correctsId: theoReport.id });
    await untilWaiting('advisory');
    lock.release();
    await lock.done;
    expect((await correcting).statusCode).toBe(201);
  });

  it('answers the same report sent twice at once with the one it made', async () => {
    // A double click or a network retry: both wait on the lock, the second finds the first's report under it.
    const shiftId = await shiftOn(
      basile,
      anna,
      annaMain,
      parisInstant(parisDay(-1), 840),
      parisInstant(parisDay(-1), 960),
    );
    const lock = holding((tx) => lockMemberPeriod(tx, basile.id, theoPeriod));
    await lock.ready;
    const id = newId(ShiftReportIdSchema);
    const twice = Promise.all([
      make(basileCookie, shiftId, 4_200, { id }),
      make(basileCookie, shiftId, 4_200, { id }),
    ]);
    await untilWaiting('advisory', 2);
    lock.release();
    await lock.done;
    const answers = await twice;
    expect(answers.map((one) => one.statusCode).toSorted()).toEqual([200, 201]);
    const [first, second] = answers.map((one) => ShiftReportSchema.parse(one.json()));
    expect(second).toEqual(first);
    expect(first).toMatchObject({ id, shiftId, memberId: basile.id, period: theoPeriod });
  });

  it('reads the shift again under the lock, and keeps no report on a shift changed meanwhile', async () => {
    // The planning keeps the start and the member of a started shift (migration 0021): these shifts have not started,
    // and what the test holds is that nothing is decided on the shift read before the lock.
    const sentWhile = async (
      minutes: number,
      change: (tx: Transaction, shiftId: ShiftId) => Promise<void>,
    ) => {
      const startsAt = new Date((Math.floor(Date.now() / MINUTE) + minutes) * MINUTE);
      const shiftId = await shiftOn(
        basile,
        anna,
        annaThird,
        startsAt,
        new Date(startsAt.getTime() + 20 * MINUTE),
      );
      const period = payPeriodOfDay(new Intl.DateTimeFormat('en-CA', { timeZone: PARIS }).format(startsAt));
      const meanwhile = holding((tx) => lockMemberPeriod(tx, basile.id, period));
      await meanwhile.ready;
      const making = make(basileCookie, shiftId, 3_100);
      await untilWaiting('advisory');
      meanwhile.release((tx) => change(tx, shiftId));
      await meanwhile.done;
      const made = await making;
      const kept = await test.admin.db.execute<{ count: number }>(
        sql`select count(*)::int as count from shift_reports where shift_id = ${shiftId}`,
      );
      return [made.statusCode, codeOf(made), kept.rows[0]?.count];
    };
    // Moved by the planning: the period and the window it was read with no longer hold.
    const moved = await sentWhile(60, async (tx, shiftId) => {
      await tx.execute(
        sql`update shifts set starts_at = starts_at + interval '5 minutes' where id = ${shiftId}`,
      );
    });
    expect(moved).toEqual([409, 'shift_report_changed_conflict', 0]);
    // Given to another member by a swap: the lock was not theirs, and the chatter no longer reads the shift.
    const given = await sentWhile(100, async (tx, shiftId) => {
      await tx.execute(sql`update shifts set member_id = ${nora.id} where id = ${shiftId}`);
    });
    expect(given).toEqual([404, 'shift_not_found', 0]);
  });

  it('never keeps a report made while its shift was being cancelled', async () => {
    // The planning's cancellation locks the shift's row `for update` first (`lockShift`).
    const cancel = holding(async (tx) => {
      await tx.execute(sql`select 1 from shifts where id = ${irisNow} for update`);
    });
    await cancel.ready;
    const making = make(irisCookie, irisNow, 2_000);
    await untilWaiting(null);
    cancel.release(async (tx) => {
      await tx.execute(sql`update shifts set cancelled_at = now() where id = ${irisNow}`);
    });
    await cancel.done;
    const made = await making;
    expect([made.statusCode, codeOf(made)]).toEqual([404, 'shift_not_found']);
    const kept = await test.admin.db.execute<{ count: number }>(
      sql`select count(*)::int as count from shift_reports where shift_id = ${irisNow}`,
    );
    expect(kept.rows[0]?.count).toBe(0);
  });

  describe('an account’s pay rules (/v1/team/pay-rules)', () => {
    const currentPeriod = () => payPeriodOfDay(parisDay(0));
    const rulesBody = (platformAccountId: PlatformAccountId, fromPeriod: PayPeriod) => ({
      id: newId(AccountPayRulesIdSchema),
      platformAccountId,
      fromPeriod,
      currency: 'EUR',
      vatBps: 2000,
      platformFeeBps: 2000,
      earningsSource: 'declared',
    });
    const add = (cookie: string, body: object) => call('POST', '/team/pay-rules', cookie, body);

    it('lists every account with its rules newest first, and the period running now', async () => {
      const response = await call('GET', '/team/pay-rules', noraCookie);
      expect(response.statusCode).toBe(200);
      const read = AccountPayRulesListSchema.parse(response.json());
      expect(read.currentPeriod).toBe(currentPeriod());
      expect(read.accounts.map((one) => one.account.handle)).toEqual([
        'anna-bis-invente',
        'anna-invente',
        'anna-ter-invente',
        'ines-inventee',
      ]);
      expect(read.accounts.find((one) => one.account.id === annaMain)?.rules).toMatchObject([
        { fromPeriod: '2020-01-01', currency: 'EUR', earningsSource: 'declared', vatBps: 2000 },
      ]);
      expect(read.accounts.find((one) => one.account.id === annaSecond)?.rules).toEqual([]);
      const chatter = await call('GET', '/team/pay-rules', theoCookie);
      expect([chatter.statusCode, codeOf(chatter)]).toEqual([403, 'role_forbidden']);
      expect((await call('GET', '/team/pay-rules', creator)).statusCode).toBe(403);
    });

    it('lets the owner start an account’s first rules with the period running now, once', async () => {
      const body = rulesBody(annaSecond, currentPeriod());
      const response = await add(owner, body);
      expect(response.statusCode, response.body).toBe(201);
      const rules = AccountPayRulesSchema.parse(response.json());
      expect(rules).toMatchObject({ ...body, creatorId: anna });
      const retry = await add(owner, body);
      expect([retry.statusCode, AccountPayRulesSchema.parse(retry.json())]).toEqual([200, rules]);
      const other = await add(owner, { ...body, vatBps: 550 });
      expect([other.statusCode, codeOf(other)]).toEqual([409, 'pay_rules_conflict']);
      const twice = await add(owner, rulesBody(annaSecond, currentPeriod()));
      expect([twice.statusCode, codeOf(twice), detailsOf(twice)]).toEqual([
        409,
        'pay_rules_period_conflict',
        { accountPayRulesId: rules.id },
      ]);
      const read = AccountPayRulesListSchema.parse((await call('GET', '/team/pay-rules', owner)).json());
      expect(read.accounts.find((one) => one.account.id === annaSecond)?.rules.map((one) => one.id)).toEqual([
        rules.id,
      ]);
    });

    it('starts new rules with a period that has not begun, never under way', async () => {
      const now = await add(owner, rulesBody(annaMain, currentPeriod()));
      expect([now.statusCode, codeOf(now)]).toEqual([400, 'pay_rules_period_invalid']);
      const past = await add(owner, rulesBody(annaThird, previousPayPeriod(currentPeriod())));
      expect([past.statusCode, codeOf(past)]).toEqual([400, 'pay_rules_period_invalid']);
      const next = await add(owner, { ...rulesBody(annaMain, nextPayPeriod(currentPeriod())), vatBps: 550 });
      expect(next.statusCode, next.body).toBe(201);
      const read = AccountPayRulesListSchema.parse((await call('GET', '/team/pay-rules', owner)).json());
      expect(
        read.accounts.find((one) => one.account.id === annaMain)?.rules.map((one) => one.fromPeriod),
      ).toEqual([nextPayPeriod(currentPeriod()), '2020-01-01']);
    });

    it('waits for the sales to be recorded before reading them, and is the owner’s alone', async () => {
      const detected = await add(owner, {
        ...rulesBody(annaThird, nextPayPeriod(currentPeriod())),
        earningsSource: 'detected',
      });
      expect([detected.statusCode, codeOf(detected)]).toEqual([409, 'pay_rules_source_conflict']);
      const unknown = await add(owner, rulesBody(newId(PlatformAccountIdSchema), currentPeriod()));
      expect([unknown.statusCode, codeOf(unknown)]).toEqual([404, 'platform_account_not_found']);
      const manager = await add(noraCookie, rulesBody(annaThird, nextPayPeriod(currentPeriod())));
      expect(manager.statusCode).toBe(403);
      const changed = test.admin.db
        .update(schema.accountPayRules)
        .set({ vatBps: 0 })
        .where(eq(schema.accountPayRules.platformAccountId, annaSecond));
      await expect(changed).rejects.toThrow();
    });
  });
});
