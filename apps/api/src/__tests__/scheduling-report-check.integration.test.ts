import {
  AccountPayRulesIdSchema,
  ApiErrorSchema,
  newId,
  payPeriodAt,
  payPeriodOfDay,
  PlatformAccountIdSchema,
  ReportGapThresholdSchema,
  SalesLineIdSchema,
  ShiftIdSchema,
  ShiftReportIdSchema,
  ShiftReportListSchema,
  ShiftReportSchema,
  TeamMemberSchema,
  ValidateShiftReportsResultSchema,
  type CreatorId,
  type PlatformAccountId,
  type ShiftId,
  type ShiftReport,
  type TeamMember,
} from '@impera/contracts';
import { and, eq, lockMemberPeriod, schema, sql, withTenantMember, type Transaction } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { lockWaits } from './support/lock-waits';
import { parisDay, parisInstant } from './support/paris';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

/** Invented people, creators, accounts and sales only (ADR 0010). */
const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const PASSWORD = 'staple battery horse';
const MODEL = 'model-anna-inventee';
const THEO_ON_REVEAL = 'chatter-theo-invente';
const HOUR = 60 * 60_000;

const codeOf = (response: LightMyRequestResponse): string => ApiErrorSchema.parse(response.json()).error.code;

describe('Rapports de fin de shift comparés à Reveal (ADR 0073)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let ownerId: string;
  let owner: string;
  let anna: CreatorId;
  let annaMain: PlatformAccountId;
  let theo: TeamMember;
  let nora: TeamMember;
  let theoCookie: string;
  let noraCookie: string;
  let sale = 0;

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, cookie: string, payload?: object) =>
    server.inject({
      method,
      url: `/v1${url}`,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      ...(payload !== undefined && { payload }),
    });

  const addMember = async (email: string, displayName: string, teamRole: 'chatter' | 'manager') => {
    const response = await call('POST', '/team/members', owner, {
      email,
      displayName,
      teamRole,
      creatorIds: [anna],
      firstName: displayName,
      lastName: 'Inventé',
      country: 'FR',
      timeZone: 'Europe/Paris',
      joinedOn: parisDay(-30),
      commission: { rateBps: 1000 },
      teamShareBps: teamRole === 'manager' ? 500 : null,
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
    return { member, cookie: await signIn(server, email, PASSWORD) };
  };

  /** Theo's shift of 10:00 to 12:00 in Paris, `days` from today, written as the planning would have. */
  const shiftOf = async (days: number, start = 600): Promise<ShiftId> => {
    const id = newId(ShiftIdSchema);
    await test.admin.db.insert(schema.shifts).values({
      id,
      creatorId: anna,
      platformAccountId: annaMain,
      memberId: theo.id,
      startsAt: parisInstant(parisDay(days), start),
      endsAt: parisInstant(parisDay(days), start + 120),
      createdBy: ownerId,
      updatedBy: ownerId,
    });
    return id;
  };

  /**
   * A sale made on Reveal, `minute` of `day` in Paris, of `grossMinor` including VAT; its refund if asked. Theo's
   * unless another platform chatter is named.
   */
  const sold = async (
    days: number,
    minute: number,
    grossMinor: number,
    refundedMinor = 0,
    platformChatterId = THEO_ON_REVEAL,
  ): Promise<void> => {
    sale += 1;
    const line = {
      creatorId: anna,
      platformAccountId: annaMain,
      platform: 'reveal',
      platformSaleId: `vente-inventee-${String(sale)}`,
      saleType: 'ppv',
      status: 'paid',
      platformModelId: MODEL,
      platformChatterId,
      platformFanId: null,
      currency: 'EUR',
      position: `p-${String(sale)}`,
      inputsHash: `h-${String(sale)}`,
    };
    const amounts = (gross: number) => ({
      grossInclVatMinor: gross,
      grossExclVatMinor: gross,
      netMinor: gross,
      agencyMinor: gross,
      creatorMinor: 0,
    });
    const occurredAt = parisInstant(parisDay(days), minute);
    await test.admin.db
      .insert(schema.platformSales)
      .values({ id: newId(SalesLineIdSchema), ...line, ...amounts(grossMinor), event: 'sale', occurredAt });
    if (refundedMinor > 0) {
      await test.admin.db.insert(schema.platformSales).values({
        id: newId(SalesLineIdSchema),
        ...line,
        ...amounts(refundedMinor),
        event: 'refund',
        status: 'refunded',
        occurredAt: new Date(occurredAt.getTime() + HOUR),
        position: `p-${String(sale)}-r`,
        inputsHash: `h-${String(sale)}-r`,
      });
    }
  };

  /** The register read to its end `ago` milliseconds ago, and read just now unless said. */
  const feedRead = (caughtUpAt: Date | null, readAt: Date | null = new Date()) =>
    test.admin.db
      .update(schema.salesFeedCursors)
      .set({ caughtUpAt, readAt })
      .where(eq(schema.salesFeedCursors.platform, 'reveal'));

  const report = async (shiftId: ShiftId, amountMinor: number): Promise<ShiftReport> => {
    const response = await call('POST', '/scheduling/shift-reports', theoCookie, {
      id: newId(ShiftReportIdSchema),
      shiftId,
      amountMinor,
      currency: 'EUR',
      correctsId: null,
      comment: null,
      incident: null,
    });
    expect(response.statusCode, response.body).toBe(201);
    return ShiftReportSchema.parse(response.json());
  };

  const listed = async (cookie: string, one: ShiftReport): Promise<ShiftReport> => {
    const response = await call('GET', `/scheduling/shift-reports?period=${one.period}`, cookie);
    expect(response.statusCode).toBe(200);
    const found = ShiftReportListSchema.parse(response.json()).reports.find((listed) => listed.id === one.id);
    if (found === undefined) throw new Error('report not listed');
    return found;
  };

  const validate = async (one: ShiftReport) => {
    const response = await call('POST', '/scheduling/shift-reports/validate', noraCookie, {
      reports: [{ id: one.id, version: one.version }],
    });
    expect(response.statusCode).toBe(200);
    const [result] = ValidateShiftReportsResultSchema.parse(response.json()).results;
    if (result === undefined) throw new Error('no result');
    return result;
  };

  const stored = async (id: string) => {
    const [row] = await test.admin.db
      .select()
      .from(schema.shiftReports)
      .where(eq(schema.shiftReports.id, id));
    if (row === undefined) throw new Error('report not stored');
    return row;
  };

  const run = () => app.modules.scheduling.jobs.checkReports();

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
    app = await createApp(config, createLogger(config));
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    ({ userId: ownerId } = await createOwner(app.auth, app.db.db, OWNER));
    anna = (await app.modules.persona.creators.create({ displayName: 'Anna' })).id;
    annaMain = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: annaMain, creatorId: anna, platform: 'reveal', handle: 'anna-invente' });
    await test.admin.db.insert(schema.accountPayRules).values({
      id: newId(AccountPayRulesIdSchema),
      creatorId: anna,
      platformAccountId: annaMain,
      fromPeriod: '2020-01-01',
      currency: 'EUR',
      vatBps: 2000,
      platformFeeBps: 2000,
      earningsSource: 'declared',
      createdBy: ownerId,
    });
    owner = await signIn(server, OWNER.email, OWNER.password);
    ({ member: theo, cookie: theoCookie } = await addMember('theo@example.test', 'Théo', 'chatter'));
    ({ member: nora, cookie: noraCookie } = await addMember('nora@example.test', 'Nora', 'manager'));
    // Reveal's register is read for the agency: Anna's model and Theo are linked by the owner (ADR 0050).
    await test.admin.db.insert(schema.salesFeedCursors).values({ platform: 'reveal', position: 'p-0' });
    await feedRead(new Date());
    await test.admin.db
      .insert(schema.salesFeedModels)
      .values({ platform: 'reveal', platformModelId: MODEL, platformAccountId: annaMain, creatorId: anna });
    await test.admin.db.insert(schema.salesFeedChatters).values({
      platform: 'reveal',
      platformChatterId: THEO_ON_REVEAL,
      kind: 'member',
      memberId: theo.id,
    });
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('gives the owner the threshold, 1 % or 5 € by default, and only the owner changes it (§ 3)', async () => {
    const read = await call('GET', '/scheduling/report-gap', noraCookie);
    expect(read.statusCode).toBe(200);
    expect(ReportGapThresholdSchema.parse(read.json())).toEqual({ bps: 100, minor: 500 });
    expect(codeOf(await call('GET', '/scheduling/report-gap', theoCookie))).toBe('shift_report_forbidden');
    const refused = await call('PUT', '/scheduling/report-gap', noraCookie, { bps: 200, minor: 0 });
    expect(refused.statusCode).toBe(403);
    const saved = await call('PUT', '/scheduling/report-gap', owner, { bps: 200, minor: 1_000 });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(
      ReportGapThresholdSchema.parse((await call('GET', '/scheduling/report-gap', owner)).json()),
    ).toEqual({
      bps: 200,
      minor: 1_000,
    });
    const back = await call('PUT', '/scheduling/report-gap', owner, { bps: 100, minor: 500 });
    expect(back.statusCode).toBe(200);
  });

  it('validates by itself a report within the threshold and not above Reveal, once, in no one’s name (§ 4)', async () => {
    const shift = await shiftOf(-1);
    // 120,00 € sold, 20,00 € of it refunded since: Reveal read 100,00 €. A sale outside the window is not the shift's,
    // nor one in it by another platform chatter (ADR 0050 § 5).
    await sold(-1, 630, 12_000, 2_000);
    await sold(-1, 760, 5_000);
    await sold(-1, 640, 4_000, 0, 'pseudo-d-un-collegue');
    const declared = await report(shift, 9_700);
    expect(declared.check).toEqual({
      state: 'complete',
      readMinor: 10_000,
      gapMinor: -300,
      verdict: 'within',
      explainBy: null,
    });

    expect(await run()).toMatchObject({ validated: 1 });
    const done = await listed(noraCookie, declared);
    expect(done).toMatchObject({ status: 'validated', reviewKind: 'automatic', version: 2 });
    expect(done.check).toMatchObject({ verdict: 'within', readMinor: 10_000 });
    expect(await stored(declared.id)).toMatchObject({ reviewedBy: null, reviewKind: 'automatic' });
    const [audit] = await test.admin.db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.entityId, declared.id),
          eq(schema.auditLog.action, 'shift_report.auto_validate'),
        ),
      );
    expect(audit).toMatchObject({ userId: null, details: { version: 2, readMinor: 10_000, gapMinor: -300 } });

    // Replayed, it validates nothing twice.
    expect(await run()).toEqual({ checked: 0, validated: 0 });
    expect((await stored(declared.id)).version).toBe(2);
  });

  it('waits for the window, a quarter of an hour and a read to the register’s end (§ 2)', async () => {
    const shift = await shiftOf(-2);
    await sold(-2, 640, 4_000);
    await feedRead(parisInstant(parisDay(-2), 735));
    const declared = await report(shift, 4_000);
    expect(declared.check).toEqual({ state: 'provisional', readMinor: 4_000 });
    expect(await run()).toMatchObject({ validated: 0 });
    expect((await stored(declared.id)).status).toBe('submitted');

    await feedRead(new Date());
    expect(await run()).toMatchObject({ validated: 1 });
    expect((await stored(declared.id)).reviewKind).toBe('automatic');
  });

  it('holds a report a cent above Reveal for its member, who explains it, then a person validates (§ 5)', async () => {
    const shift = await shiftOf(-1, 840);
    await sold(-1, 870, 6_000);
    const declared = await report(shift, 6_001);
    expect(declared.check).toMatchObject({ state: 'complete', verdict: 'gap', gapMinor: 1 });
    expect(await run()).toMatchObject({ validated: 0 });

    const refused = await validate(declared);
    expect(refused).toMatchObject({ outcome: 'refused', code: 'shift_report_gap_conflict' });

    const explained = await call('PATCH', `/scheduling/shift-reports/${declared.id}`, theoCookie, {
      version: declared.version,
      amountMinor: 6_001,
      explanation: 'Un pourboire payé à part, il apparaîtra demain.',
    });
    expect(explained.statusCode, explained.body).toBe(200);
    const answered = ShiftReportSchema.parse(explained.json());
    expect(answered.explanation).toBe('Un pourboire payé à part, il apparaîtra demain.');

    const validated = await validate(answered);
    expect(validated).toMatchObject({ outcome: 'validated' });
    const row = await stored(declared.id);
    expect(row).toMatchObject({ status: 'validated', reviewKind: 'human', reviewedBy: nora.userId });
    expect(row.reviewCheck).toMatchObject({ check: { verdict: 'gap' }, threshold: { bps: 100, minor: 500 } });
  });

  it('no longer waits once the 48 hours after the shift are over', async () => {
    const shift = await shiftOf(-3);
    await sold(-3, 650, 10_000);
    const declared = await report(shift, 8_000);
    expect(declared.check).toMatchObject({ verdict: 'gap', gapMinor: -2_000 });
    expect(await validate(declared)).toMatchObject({ outcome: 'validated' });
  });

  it('blocks nothing while the feed is cut: no comparison, a person validates (§ 7)', async () => {
    const shift = await shiftOf(-4);
    await sold(-4, 650, 1_000);
    await feedRead(new Date(), new Date(Date.now() - 3 * HOUR));
    const declared = await report(shift, 9_999);
    expect(declared.check).toEqual({ state: 'unavailable', reason: 'feed_off' });
    expect(await run()).toMatchObject({ validated: 0 });
    expect(await validate(declared)).toMatchObject({ outcome: 'validated' });
    await feedRead(new Date());
  });

  it('never validates an amount it did not compare: changed under the lock, the report waits (§ 4)', async () => {
    const shift = await shiftOf(-2, 840);
    await sold(-2, 870, 3_000);
    const declared = await report(shift, 3_000);
    const period = payPeriodOfDay(parisDay(-2));
    let release: (then: (tx: Transaction) => Promise<void>) => void = () => undefined;
    let held: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      held = resolve;
    });
    const holder = test.admin.db.transaction(async (tx) => {
      await lockMemberPeriod(tx, theo.id, period);
      const then = new Promise<(tx: Transaction) => Promise<void>>((resolve) => {
        release = resolve;
      });
      held();
      await (
        await then
      )(tx);
    });
    await ready;
    const job = run();
    for (let tries = 0; (await lockWaits(test.admin.db, 'advisory')) < 1; tries += 1) {
      if (tries > 250) throw new Error('the job never waited for the lock');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    // Theo raises his amount above Reveal while the job waits: it must read it again, not validate 30,00 €.
    release(async (tx) => {
      await tx
        .update(schema.shiftReports)
        .set({ amountMinor: 3_500, version: sql`${schema.shiftReports.version} + 1` })
        .where(eq(schema.shiftReports.id, declared.id));
    });
    await holder;
    expect(await job).toMatchObject({ validated: 0 });
    expect(await stored(declared.id)).toMatchObject({ status: 'submitted', amountMinor: 3_500, version: 2 });
  });

  it('keeps `automatic` from every person: the policies refuse it even to a manager', async () => {
    const shift = await shiftOf(-5);
    const declared = await report(shift, 1_000);
    await expect(
      withTenantMember(app.db.db, anna, nora.userId, (tx) =>
        tx
          .update(schema.shiftReports)
          .set({
            status: 'validated',
            version: declared.version + 1,
            reviewedAt: new Date(),
            reviewedBy: null,
            reviewKind: 'automatic',
          })
          .where(eq(schema.shiftReports.id, declared.id)),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });

  it('goes through every candidate: older reports a person still has to decide never hide a newer one', async () => {
    // More gaps than one page of the check, sent before: Theo declared 1,00 € on each of these short shifts, where
    // Reveal read nothing. They wait for a person, and stay submitted.
    const held = 201;
    const first = parisInstant(parisDay(-10), 0);
    for (let index = 0; index < held; index += 1) {
      const startsAt = new Date(first.getTime() + index * 5 * 60_000);
      const endsAt = new Date(startsAt.getTime() + 5 * 60_000);
      const shiftId = newId(ShiftIdSchema);
      await test.admin.db.insert(schema.shifts).values({
        id: shiftId,
        creatorId: anna,
        platformAccountId: annaMain,
        memberId: theo.id,
        startsAt,
        endsAt,
        createdBy: ownerId,
        updatedBy: ownerId,
      });
      await test.admin.db.insert(schema.shiftReports).values({
        id: newId(ShiftReportIdSchema),
        creatorId: anna,
        platformAccountId: annaMain,
        shiftId,
        memberId: theo.id,
        period: payPeriodAt(startsAt, 'Europe/Paris'),
        amountMinor: 100,
        currency: 'EUR',
        status: 'submitted',
        submittedBy: theo.userId,
        submittedAt: endsAt,
        createdBy: theo.userId,
      });
    }
    // A newer report, within the threshold: the check finds it behind them.
    const shift = await shiftOf(-6);
    await sold(-6, 630, 10_000);
    const declared = await report(shift, 10_000);
    await feedRead(new Date());

    await run();
    expect(await stored(declared.id)).toMatchObject({ status: 'validated', reviewKind: 'automatic' });
    const waiting = await test.admin.db
      .select({ id: schema.shiftReports.id })
      .from(schema.shiftReports)
      .where(and(eq(schema.shiftReports.status, 'submitted'), eq(schema.shiftReports.amountMinor, 100)));
    expect(waiting).toHaveLength(held);
  });
});
