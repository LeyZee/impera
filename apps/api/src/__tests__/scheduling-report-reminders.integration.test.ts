import { randomBytes } from 'node:crypto';

import {
  AccountPayRulesIdSchema,
  newId,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  ShiftReportIdSchema,
  TeamMemberSchema,
  type CreatorId,
  type EarningsSource,
  type PlatformAccountId,
  type ShiftId,
  type TeamMember,
} from '@impera/contracts';
import { eq, inArray, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { remindReports } from '../modules/scheduling/application/report-reminders';
import { createDrizzleReportReminderSource } from '../modules/scheduling/infra/report-reminders';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { parisDay } from './support/paris';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

/** Invented people, creators and accounts only (ADR 0010). */
const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const PASSWORD = 'staple battery horse';
const MINUTE = 60_000;

describe('Rappel du rapport de fin de shift (ADR 0077)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let ownerId: string;
  let owner: string;
  let anna: CreatorId;
  let declared: PlatformAccountId;
  let detected: PlatformAccountId;
  let withoutRules: PlatformAccountId;
  let theo: TeamMember;
  let lea: TeamMember;
  let theoCookie: string;
  /** The minute the shifts are placed from; the job runs at the real time, a few seconds later. */
  let base: number;

  const call = (method: 'POST', url: string, cookie: string, payload: object) =>
    server.inject({ method, url: `/v1${url}`, headers: { cookie, origin: DASHBOARD_ORIGIN }, payload });

  const addMember = async (email: string, displayName: string): Promise<TeamMember> => {
    const response = await call('POST', '/team/members', owner, {
      email,
      displayName,
      teamRole: 'chatter',
      creatorIds: [anna],
      firstName: displayName,
      lastName: 'Inventé',
      country: 'FR',
      timeZone: 'Europe/Paris',
      joinedOn: parisDay(-30),
      commission: { rateBps: 1000 },
      teamShareBps: null,
    });
    expect(response.statusCode).toBe(201);
    return TeamMemberSchema.parse(response.json());
  };

  const account = async (handle: string, source: EarningsSource | null): Promise<PlatformAccountId> => {
    const id = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id, creatorId: anna, platform: 'reveal', handle });
    if (source !== null) {
      await test.admin.db.insert(schema.accountPayRules).values({
        id: newId(AccountPayRulesIdSchema),
        creatorId: anna,
        platformAccountId: id,
        fromPeriod: '2020-01-01',
        currency: 'EUR',
        vatBps: 2000,
        platformFeeBps: 2000,
        earningsSource: source,
        createdBy: ownerId,
      });
    }
    return id;
  };

  /** A shift of ten minutes that ended `endedMinutesAgo` before the base minute. */
  const shift = async (
    member: TeamMember,
    platformAccountId: PlatformAccountId,
    endedMinutesAgo: number,
    cancelled = false,
  ): Promise<ShiftId> => {
    const id = newId(ShiftIdSchema);
    const endsAt = new Date(base - endedMinutesAgo * MINUTE);
    await test.admin.db.insert(schema.shifts).values({
      id,
      creatorId: anna,
      platformAccountId,
      memberId: member.id,
      startsAt: new Date(endsAt.getTime() - 10 * MINUTE),
      endsAt,
      cancelledAt: cancelled ? new Date(base) : null,
      createdBy: ownerId,
      updatedBy: ownerId,
    });
    return id;
  };

  const report = async (shiftId: ShiftId): Promise<void> => {
    const response = await call('POST', '/scheduling/shift-reports', theoCookie, {
      id: newId(ShiftReportIdSchema),
      shiftId,
      amountMinor: 1200,
      currency: 'EUR',
      correctsId: null,
      comment: null,
      incident: null,
    });
    expect(response.statusCode, response.body).toBe(201);
  };

  const delivered = () =>
    test.admin.db
      .select({
        userId: schema.notificationDeliveries.userId,
        reason: schema.notificationDeliveries.reason,
        objectKey: schema.notificationDeliveries.objectKey,
        decision: schema.notificationDeliveries.decision,
        title: schema.notificationDeliveries.title,
        url: schema.notificationDeliveries.url,
      })
      .from(schema.notificationDeliveries)
      .where(inArray(schema.notificationDeliveries.userId, [theo.userId, lea.userId]));

  const run = () => {
    const job = app.modules.scheduling.jobs.remindReports;
    if (job === null) throw new Error('push is off');
    return job();
  };

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    // A key for the push server's own key pair: without one, push is off and nothing is reminded.
    const config = testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_ADMIN_URL: test.adminUrl,
      CREDENTIALS_ENCRYPTION_KEYS: `v1:${randomBytes(32).toString('base64')}`,
    });
    app = await createApp(config, createLogger(config));
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    ({ userId: ownerId } = await createOwner(app.auth, app.db.db, OWNER));
    owner = await signIn(server, OWNER.email, OWNER.password);
    anna = (await app.modules.persona.creators.create({ displayName: 'Anna' })).id;
    declared = await account('anna-declaree', 'declared');
    detected = await account('anna-detectee', 'detected');
    withoutRules = await account('anna-sans-regles', null);
    theo = await addMember('theo@example.test', 'Théo');
    lea = await addMember('lea@example.test', 'Léa');
    const context = await app.auth.$context;
    await context.internalAdapter.linkAccount({
      userId: theo.userId,
      providerId: 'credential',
      accountId: theo.userId,
      password: await context.password.hash(PASSWORD),
    });
    theoCookie = await signIn(server, 'theo@example.test', PASSWORD);
    // Théo turned his quiet hours off: the second reminder rings whatever the hour the suite runs at.
    await test.admin.db
      .insert(schema.notificationPreferences)
      .values({ userId: theo.userId, quietStartMinute: 0, quietEndMinute: 0, dailyCap: 30 });
    base = Math.floor(Date.now() / MINUTE) * MINUTE;
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('reminds the member of a shift ended without its report, twice, and nothing else', async () => {
    const justEnded = await shift(theo, declared, 20);
    const lastNight = await shift(theo, declared, 12 * 60 + 10);
    await shift(theo, declared, 3 * 60); // between the two windows
    await shift(theo, declared, 2); // not yet: 15 minutes after the end
    await shift(theo, declared, 35, true); // cancelled
    await report(await shift(theo, declared, 50)); // its report is there
    await shift(theo, detected, 65); // paid on the sales read: the mini feedback is optional
    await shift(theo, withoutRules, 80); // no rules: the report would be refused
    await shift(lea, declared, 20);
    await test.admin.db
      .update(schema.teamMembers)
      .set({ status: 'left', leftOn: parisDay(0) })
      .where(eq(schema.teamMembers.id, lea.id));

    const first = await run();
    expect(first.outcomes).toEqual({ rang: 2 });
    const rows = await delivered();
    expect(rows.toSorted((a, b) => a.objectKey.localeCompare(b.objectKey))).toEqual(
      [
        {
          userId: theo.userId,
          reason: 'own_shift_end',
          objectKey: `shift-report:${justEnded}:1`,
          decision: 'rang',
          title: 'Rapport de fin de shift',
          url: '/aujourdhui',
        },
        {
          userId: theo.userId,
          reason: 'reminder',
          objectKey: `shift-report:${lastNight}:2`,
          decision: 'rang',
          title: 'Rapport de fin de shift',
          url: '/aujourdhui',
        },
      ].toSorted((a, b) => a.objectKey.localeCompare(b.objectKey)),
    );

    // Replayed, two workers, the next run within the window: each reminder rang once.
    const again = await run();
    expect(again.outcomes).toEqual({ duplicate: 2 });
    expect(await delivered()).toHaveLength(2);
  });

  it('rings nothing for a report sent between the read of the candidates and the reminder', async () => {
    const late = await shift(theo, declared, 95);
    const source = createDrizzleReportReminderSource(test.admin.db);
    const asked: string[] = [];
    await remindReports(
      {
        source: {
          candidatesUnscoped: async (now) => {
            const found = await source.candidatesUnscoped(now);
            expect(found).toContain(late);
            // Théo sends his report just after the candidates were read.
            await report(late);
            return found;
          },
          factsUnscoped: (shiftId) => source.factsUnscoped(shiftId),
        },
        notify: (request) => {
          asked.push(request.objectKey);
          return Promise.resolve('rang');
        },
      },
      () => new Date(),
    );
    expect(asked).not.toContain(`shift-report:${late}:1`);
  });
});
