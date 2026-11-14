import {
  AccountPayRulesIdSchema,
  ApiErrorSchema,
  newId,
  payPeriodOfDay,
  PlatformAccountIdSchema,
  ShiftFeedbackIdSchema,
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
import { eq, schema } from '@impera/db';
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

  const call = (method: 'GET' | 'PUT', url: string, cookie: string, payload?: object) =>
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
