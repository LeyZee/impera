import {
  AccountPayRulesIdSchema,
  ApiErrorSchema,
  newId,
  payPeriodOfDay,
  PlatformAccountIdSchema,
  ShiftFeedbackIdSchema,
  ShiftFeedbackListSchema,
  ShiftFeedbackReadSchema,
  ShiftFeedbackSchema,
  ShiftIdSchema,
  TeamMemberSchema,
  type CreatorId,
  type PlatformAccountId,
  type PutShiftFeedbackBody,
  type ShiftId,
  type TeamMember,
} from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { parisDay, parisInstant } from './support/paris';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

/** Invented people, creators and accounts only (ADR 0010). */
const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const CREATOR = { email: 'creator@example.test', name: 'Creator', password: 'battery staple horse' };
const PASSWORD = 'staple battery horse';
const MINUTE = 60_000;

const codeOf = (response: LightMyRequestResponse): string => ApiErrorSchema.parse(response.json()).error.code;

describe('Équipe › Mini feedback de fin de shift (/v1/scheduling, ADR 0050 § 10)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let ownerId: string;
  let owner: string;
  let creator: string;
  let anna: CreatorId;
  let ines: CreatorId;
  let annaMain: PlatformAccountId;
  let inesMain: PlatformAccountId;
  let basile: TeamMember;
  let basileCookie: string;
  let noraCookie: string;

  /** Basile's shifts: yesterday on Inès's read account, yesterday on Anna's declared one, one ending later, one cancelled. */
  let onRead: ShiftId;
  let onDeclared: ShiftId;
  let later: ShiftId;
  let cancelled: ShiftId;

  const call = (method: 'GET' | 'PUT' | 'POST', url: string, cookie: string, payload?: object) =>
    server.inject({
      method,
      url: `/v1${url}`,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      ...(payload !== undefined && { payload }),
    });

  const put = (cookie: string, shiftId: ShiftId, body: Partial<PutShiftFeedbackBody> = {}) =>
    call('PUT', `/scheduling/shifts/${shiftId}/feedback`, cookie, {
      id: newId(ShiftFeedbackIdSchema),
      nothingToReport: false,
      comment: null,
      incident: null,
      signals: [],
      ...body,
    });

  const addMember = async (
    email: string,
    displayName: string,
    teamRole: 'chatter' | 'manager',
    creatorIds: readonly CreatorId[] = [anna, ines],
  ) => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/team/members',
      headers: { cookie: owner, origin: DASHBOARD_ORIGIN },
      payload: {
        email,
        displayName,
        teamRole,
        creatorIds,
        firstName: displayName,
        lastName: 'Inventé',
        country: 'FR',
        timeZone: 'Europe/Paris',
        joinedOn: parisDay(-30),
        commission: { rateBps: 1000 },
        teamShareBps: teamRole === 'manager' ? 500 : null,
      },
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

  const shiftOn = async (
    creatorId: CreatorId,
    platformAccountId: PlatformAccountId,
    startsAt: Date,
    endsAt: Date,
    isCancelled = false,
  ): Promise<ShiftId> => {
    const id = newId(ShiftIdSchema);
    await test.admin.db.insert(schema.shifts).values({
      id,
      creatorId,
      platformAccountId,
      memberId: basile.id,
      startsAt,
      endsAt,
      cancelledAt: isCancelled ? endsAt : null,
      createdBy: ownerId,
      updatedBy: ownerId,
    });
    return id;
  };

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
    ines = (await app.modules.persona.creators.create({ displayName: 'Inès' })).id;
    annaMain = newId(PlatformAccountIdSchema);
    inesMain = newId(PlatformAccountIdSchema);
    await test.admin.db.insert(schema.platformAccounts).values([
      { id: annaMain, creatorId: anna, platform: 'reveal', handle: 'anna-invente' },
      { id: inesMain, creatorId: ines, platform: 'reveal', handle: 'ines-inventee' },
    ]);
    const { userId: creatorUserId } = await createOwner(app.auth, app.db.db, CREATOR);
    await test.admin.db
      .update(schema.user)
      .set({ role: 'creator', creatorIds: [ines] })
      .where(eq(schema.user.id, creatorUserId));
    owner = await signIn(server, OWNER.email, OWNER.password);
    creator = await signIn(server, CREATOR.email, CREATOR.password);
    ({ member: basile, cookie: basileCookie } = await addMember('basile@example.test', 'Basile', 'chatter'));
    ({ cookie: noraCookie } = await addMember('nora@example.test', 'Nora', 'manager'));

    // Inès's sales are read (written as the switch of CRM-03 will); Anna's account is paid on its reports.
    for (const [platformAccountId, creatorId, source] of [
      [annaMain, anna, 'declared'],
      [inesMain, ines, 'detected'],
    ] as const) {
      await test.admin.db.insert(schema.accountPayRules).values({
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
    }

    const now = Math.floor(Date.now() / MINUTE) * MINUTE;
    const yesterday = (): [Date, Date] => [parisInstant(parisDay(-1), 600), parisInstant(parisDay(-1), 720)];
    onRead = await shiftOn(ines, inesMain, ...yesterday());
    onDeclared = await shiftOn(
      anna,
      annaMain,
      parisInstant(parisDay(-1), 780),
      parisInstant(parisDay(-1), 900),
    );
    later = await shiftOn(ines, inesMain, new Date(now + 60 * MINUTE), new Date(now + 180 * MINUTE));
    cancelled = await shiftOn(
      ines,
      inesMain,
      parisInstant(parisDay(-2), 600),
      parisInstant(parisDay(-2), 720),
      true,
    );
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('records the member’s word on a read account, once, without any amount', async () => {
    expect(
      ShiftFeedbackReadSchema.parse(
        (await call('GET', `/scheduling/shifts/${onRead}/feedback`, basileCookie)).json(),
      ),
    ).toEqual({ feedback: null });
    const id = newId(ShiftFeedbackIdSchema);
    const body = {
      id,
      comment: 'Soirée calme',
      signals: [{ category: 'missing_content' as const, text: 'Un fan demande une vidéo en extérieur' }],
    };
    const made = await put(basileCookie, onRead, body);
    expect(made.statusCode, made.body).toBe(201);
    const feedback = ShiftFeedbackSchema.parse(made.json());
    expect(feedback).toMatchObject({
      id,
      shiftId: onRead,
      memberId: basile.id,
      platformAccountId: inesMain,
      period: payPeriodOfDay(parisDay(-1)),
      nothingToReport: false,
      comment: 'Soirée calme',
      incident: null,
    });
    expect(Object.keys(feedback).some((key) => /amount|minor/iu.test(key))).toBe(false);

    // A retry gives it back; the same id with other words, or a second feedback, is refused.
    const again = await put(basileCookie, onRead, body);
    expect([again.statusCode, ShiftFeedbackSchema.parse(again.json()).id]).toEqual([200, id]);
    const other = await put(basileCookie, onRead, { ...body, comment: 'Autre chose' });
    expect([other.statusCode, codeOf(other)]).toEqual([409, 'shift_feedback_conflict']);
    const second = await put(basileCookie, onRead, { nothingToReport: true });
    expect([second.statusCode, codeOf(second)]).toEqual([409, 'shift_feedback_exists_conflict']);
  });

  it('is read by the member, the owner and a manager, never by the creator', async () => {
    for (const cookie of [basileCookie, owner, noraCookie]) {
      const read = await call('GET', `/scheduling/shifts/${onRead}/feedback`, cookie);
      expect(read.statusCode).toBe(200);
      expect(ShiftFeedbackReadSchema.parse(read.json()).feedback?.shiftId).toBe(onRead);
    }
    expect((await call('GET', `/scheduling/shifts/${onRead}/feedback`, creator)).statusCode).toBe(403);
  });

  it('answers a shift he does not see as an unknown one, never telling it exists', async () => {
    // A chatter on Anna alone, and one on both who is not the shift's member: Basile's shift on Inès is not theirs.
    const { cookie: annaOnly } = await addMember('paul@example.test', 'Paul', 'chatter', [anna]);
    const { cookie: colleague } = await addMember('lea@example.test', 'Léa', 'chatter');
    for (const cookie of [annaOnly, colleague]) {
      for (const shiftId of [onRead, newId(ShiftIdSchema)]) {
        const read = await call('GET', `/scheduling/shifts/${shiftId}/feedback`, cookie);
        expect([read.statusCode, codeOf(read)]).toEqual([404, 'shift_not_found']);
      }
    }
  });

  it('is the shift’s member’s alone, at the end of the shift, on a shift that happened', async () => {
    const manager = await put(noraCookie, later, { nothingToReport: true });
    expect([manager.statusCode, codeOf(manager)]).toEqual([403, 'shift_feedback_forbidden']);
    const early = await put(basileCookie, later, { nothingToReport: true });
    expect([early.statusCode, codeOf(early)]).toEqual([409, 'shift_feedback_early_conflict']);
    const gone = await put(basileCookie, cancelled, { nothingToReport: true });
    expect([gone.statusCode, codeOf(gone)]).toEqual([404, 'shift_not_found']);
  });

  it('is refused on an account paid on its reports: the report is due there', async () => {
    const declared = await put(basileCookie, onDeclared, { nothingToReport: true });
    expect([declared.statusCode, codeOf(declared)]).toEqual([409, 'shift_feedback_declared_conflict']);
  });

  it('says something or nothing to report, never both, never neither', async () => {
    const both = await put(basileCookie, onDeclared, { nothingToReport: true, comment: 'Calme' });
    expect([both.statusCode, codeOf(both)]).toEqual([400, 'request_invalid']);
    const neither = await put(basileCookie, onDeclared, {});
    expect([neither.statusCode, codeOf(neither)]).toEqual([400, 'request_invalid']);
  });

  it('tells the agency of an incident at once, and follows it « Vu » then « Réglé »', async () => {
    const incidentShift = await shiftOn(
      ines,
      inesMain,
      parisInstant(parisDay(-3), 600),
      parisInstant(parisDay(-3), 720),
    );
    const made = await put(basileCookie, incidentShift, { incident: 'Le fan menace de signaler le compte' });
    expect(made.statusCode, made.body).toBe(201);
    const incident = ShiftFeedbackSchema.parse(made.json());
    expect(incident).toMatchObject({ incidentSeenAt: null, incidentResolvedAt: null });

    // The phones of the agency are told by a job, once per incident; a feedback without one tells nobody.
    const jobs = await test.admin.db.execute(
      sql`select key, payload from graphile_worker._private_jobs where key like 'scheduling.notify_incident:%'`,
    );
    expect(jobs.rows).toEqual([
      {
        key: `scheduling.notify_incident:${incident.id}`,
        payload: { shiftFeedbackId: incident.id, creatorId: ines },
      },
    ]);

    // Without a period: the incidents still open, every period, for the owner and the manager.
    for (const cookie of [owner, noraCookie]) {
      const open = await call('GET', '/scheduling/shift-feedback', cookie);
      expect(open.statusCode, open.body).toBe(200);
      const list = ShiftFeedbackListSchema.parse(open.json());
      expect(list.feedbacks.map((line) => line.id)).toEqual([incident.id]);
      expect(list.members.map((member) => member.id)).toContain(basile.id);
      expect(list.accounts.map((account) => account.id)).toContain(inesMain);
    }
    // A period: every feedback of it, the open incident first.
    const period = payPeriodOfDay(parisDay(-3));
    if (period === payPeriodOfDay(parisDay(-1))) {
      const all = ShiftFeedbackListSchema.parse(
        (await call('GET', `/scheduling/shift-feedback?period=${period}`, owner)).json(),
      );
      expect(all.feedbacks[0]?.id).toBe(incident.id);
      expect(all.feedbacks.length).toBeGreaterThan(1);
    }

    const step = (cookie: string, id: string, said: 'seen' | 'resolved') =>
      call('POST', `/scheduling/shift-feedback/${id}/incident`, cookie, { step: said });

    // A manager whose list lacks the creator neither reads it nor says « Vu » nor « Réglé » (Sécurité, #992).
    const { cookie: offList } = await addMember('mila@example.test', 'Mila', 'manager', [anna]);
    const blind = ShiftFeedbackListSchema.parse(
      (await call('GET', '/scheduling/shift-feedback', offList)).json(),
    );
    expect(blind.feedbacks).toEqual([]);
    const blindPeriod = ShiftFeedbackListSchema.parse(
      (
        await call('GET', `/scheduling/shift-feedback?period=${payPeriodOfDay(parisDay(-3))}`, offList)
      ).json(),
    );
    expect(blindPeriod.feedbacks.map((line) => line.id)).not.toContain(incident.id);
    for (const said of ['seen', 'resolved'] as const) {
      const refused = await step(offList, incident.id, said);
      expect([refused.statusCode, codeOf(refused)]).toEqual([404, 'shift_feedback_not_found']);
    }

    // Neither the chatter who wrote it nor the creator says « Vu »; a feedback without incident has none.
    const own = await step(basileCookie, incident.id, 'seen');
    expect([own.statusCode, codeOf(own)]).toEqual([403, 'shift_incident_forbidden']);
    expect((await step(creator, incident.id, 'seen')).statusCode).toBe(403);
    const quiet = ShiftFeedbackReadSchema.parse(
      (await call('GET', `/scheduling/shifts/${onRead}/feedback`, owner)).json(),
    ).feedback;
    const none = await step(owner, quiet?.id ?? newId(ShiftFeedbackIdSchema), 'seen');
    expect([none.statusCode, codeOf(none)]).toEqual([404, 'shift_feedback_not_found']);
    const unknown = await step(owner, newId(ShiftFeedbackIdSchema), 'seen');
    expect([unknown.statusCode, codeOf(unknown)]).toEqual([404, 'shift_feedback_not_found']);

    // The manager says « Vu », the owner « Réglé »; the same step again gives back what is recorded.
    const seen = await step(noraCookie, incident.id, 'seen');
    expect(seen.statusCode, seen.body).toBe(200);
    const seenAt = ShiftFeedbackSchema.parse(seen.json()).incidentSeenAt;
    expect(seenAt).not.toBeNull();
    const seenAgain = ShiftFeedbackSchema.parse((await step(owner, incident.id, 'seen')).json());
    expect(seenAgain.incidentSeenAt).toBe(seenAt);
    const resolved = ShiftFeedbackSchema.parse((await step(owner, incident.id, 'resolved')).json());
    expect(resolved.incidentResolvedAt).not.toBeNull();

    // The chatter reads where it stands; the agency's list of open incidents is empty again.
    const mine = ShiftFeedbackReadSchema.parse(
      (await call('GET', `/scheduling/shifts/${incidentShift}/feedback`, basileCookie)).json(),
    ).feedback;
    expect(mine).toMatchObject({ incidentSeenAt: seenAt, incidentResolvedAt: resolved.incidentResolvedAt });
    const after = ShiftFeedbackListSchema.parse(
      (await call('GET', '/scheduling/shift-feedback', owner)).json(),
    );
    expect(after.feedbacks).toEqual([]);

    const audit = await test.admin.db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, incident.id));
    expect(
      audit
        .map((row) => row.action)
        .filter((action) => action.startsWith('shift_incident.'))
        .sort(),
    ).toEqual(['shift_incident.resolved', 'shift_incident.seen']);
    // The steps are never undone.
    await expect(
      test.admin.db
        .delete(schema.shiftIncidentSteps)
        .where(eq(schema.shiftIncidentSteps.shiftFeedbackId, incident.id)),
    ).rejects.toThrow();
  });

  it('gives a chatter his own feedbacks only', async () => {
    const { cookie: colleague } = await addMember('remi@example.test', 'Rémi', 'chatter');
    const theirs = ShiftFeedbackListSchema.parse(
      (
        await call('GET', `/scheduling/shift-feedback?period=${payPeriodOfDay(parisDay(-1))}`, colleague)
      ).json(),
    );
    expect(theirs.feedbacks).toEqual([]);
    const his = ShiftFeedbackListSchema.parse(
      (
        await call('GET', `/scheduling/shift-feedback?period=${payPeriodOfDay(parisDay(-1))}`, basileCookie)
      ).json(),
    );
    expect(his.feedbacks.every((line) => line.memberId === basile.id)).toBe(true);
    expect(his.feedbacks.length).toBeGreaterThan(0);
  });

  it('is never rewritten nor deleted, whoever asks', async () => {
    await expect(
      test.admin.db
        .update(schema.shiftFeedbacks)
        .set({ comment: 'Réécrit' })
        .where(eq(schema.shiftFeedbacks.shiftId, onRead)),
    ).rejects.toThrow();
    await expect(
      test.admin.db.delete(schema.shiftFeedbacks).where(eq(schema.shiftFeedbacks.shiftId, onRead)),
    ).rejects.toThrow();
  });
});
