import { randomUUID } from 'node:crypto';

import {
  AccountPayRulesIdSchema,
  ApiErrorSchema,
  JOB_PAYLOADS,
  newId,
  payPeriodOfDay,
  PlatformAccountIdSchema,
  ShiftFeedbackIdSchema,
  ShiftFeedbackListSchema,
  ShiftFeedbackPendingSchema,
  ShiftFeedbackReadSchema,
  ShiftFeedbackSchema,
  ShiftIdSchema,
  TeamMemberSchema,
  type ConversationId,
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
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { parisDay, parisInstant } from './support/paris';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

/** Invented people, creators, accounts and fans only (ADR 0010). */
const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const PASSWORD = 'staple battery horse';
const MINUTE = 60_000;

const codeOf = (response: LightMyRequestResponse): string => ApiErrorSchema.parse(response.json()).error.code;

describe('Retour de fin de shift enrichi et léger (ADR 0170 § A, « ok rapport léger » du 26/11)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let ownerId: string;
  let owner: string;
  let ines: CreatorId;
  let inesMain: PlatformAccountId;
  let lou: TeamMember;
  let louCookie: string;

  /** Lou's shifts on Inès's read account: two days ago, yesterday (his last ended one), one starting now. */
  let older: ShiftId;
  let last: ShiftId;
  let current: ShiftId;
  /** A fan Lou wrote to during his last shift, and one written to the day before. */
  let alpha: ConversationId;
  let beta: ConversationId;

  const call = (method: 'GET' | 'PUT' | 'POST', url: string, cookie: string, payload?: object) =>
    server.inject({
      method,
      url: `/v1${url}`,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      ...(payload !== undefined && { payload }),
    });

  const put = (shiftId: ShiftId, body: Partial<PutShiftFeedbackBody> = {}) =>
    call('PUT', `/scheduling/shifts/${shiftId}/feedback`, louCookie, {
      id: newId(ShiftFeedbackIdSchema),
      nothingToReport: true,
      comment: null,
      incident: null,
      signals: [],
      ...body,
    });

  const shiftOn = async (startsAt: Date, endsAt: Date): Promise<ShiftId> => {
    const id = newId(ShiftIdSchema);
    await test.admin.db.insert(schema.shifts).values({
      id,
      creatorId: ines,
      platformAccountId: inesMain,
      memberId: lou.id,
      startsAt,
      endsAt,
      createdBy: ownerId,
      updatedBy: ownerId,
    });
    return id;
  };

  /** A fan's message on Inès's account at `at`: his conversation, made on its first message. */
  const fanWrites = async (name: string, at: Date): Promise<ConversationId> => {
    const { conversationId } = await app.modules.conversations.ingestMessage({
      creatorId: ines,
      platformAccountId: inesMain,
      platformConversationId: `c-${name}`,
      platformFanId: `f-${name}`,
      fanDisplayName: name,
      message: {
        ref: { platform: 'reveal', id: `m-${name}-${String(at.getTime())}` },
        conversationRef: { platform: 'reveal', id: `c-${name}` },
        direction: 'inbound',
        text: 'Salut',
        media: [],
        priceMinor: null,
        currency: null,
        isPaid: false,
        createdAt: at.toISOString(),
      },
      correlationId: 'seed',
    });
    return conversationId;
  };

  /** A line of a conversation's journal, as the copilot writes it, dated `at`. */
  const journal = async (
    conversationId: ConversationId,
    type: string,
    actor: string,
    at: Date,
    seq: number,
  ) => {
    await test.admin.db.insert(schema.conversationEvents).values({
      id: randomUUID(),
      creatorId: ines,
      conversationId,
      seq,
      type,
      payload: {},
      actor,
      correlationId: 'seed',
      createdAt: at,
    });
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
    ines = (await app.modules.persona.creators.create({ displayName: 'Inès' })).id;
    inesMain = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: inesMain, creatorId: ines, platform: 'reveal', handle: 'ines-inventee' });
    owner = await signIn(server, OWNER.email, OWNER.password);
    const made = await server.inject({
      method: 'POST',
      url: '/v1/team/members',
      headers: { cookie: owner, origin: DASHBOARD_ORIGIN },
      payload: {
        email: 'lou@example.test',
        displayName: 'Lou',
        teamRole: 'chatter',
        creatorIds: [ines],
        firstName: 'Lou',
        lastName: 'Inventé',
        country: 'FR',
        timeZone: 'Europe/Paris',
        joinedOn: parisDay(-30),
        commission: { rateBps: 1000 },
        teamShareBps: null,
      },
    });
    expect(made.statusCode).toBe(201);
    lou = TeamMemberSchema.parse(made.json());
    const context = await app.auth.$context;
    await context.internalAdapter.linkAccount({
      userId: lou.userId,
      providerId: 'credential',
      accountId: lou.userId,
      password: await context.password.hash(PASSWORD),
    });
    louCookie = await signIn(server, 'lou@example.test', PASSWORD);
    await test.admin.db.insert(schema.accountPayRules).values({
      id: newId(AccountPayRulesIdSchema),
      creatorId: ines,
      platformAccountId: inesMain,
      fromPeriod: '2020-01-01',
      currency: 'EUR',
      vatBps: 2000,
      platformFeeBps: 2000,
      earningsSource: 'detected',
      createdBy: ownerId,
    });

    older = await shiftOn(parisInstant(parisDay(-2), 600), parisInstant(parisDay(-2), 720));
    last = await shiftOn(parisInstant(parisDay(-1), 600), parisInstant(parisDay(-1), 720));
    const now = Math.floor(Date.now() / MINUTE) * MINUTE;
    current = await shiftOn(new Date(now - 5 * MINUTE), new Date(now + 180 * MINUTE));

    // During his last shift: Alpha writes twice, the agent hands one conversation over, Lou decides three drafts.
    const during = (minute: number) => parisInstant(parisDay(-1), minute);
    alpha = await fanWrites('Fan Alpha', during(630));
    await fanWrites('Fan Alpha', during(700));
    beta = await fanWrites('Fan Bêta', parisInstant(parisDay(-2), 650));
    await journal(alpha, 'draft_approved', `human:${lou.userId}`, during(640), 1001);
    await journal(alpha, 'draft_edited', `human:${lou.userId}`, during(650), 1002);
    await journal(alpha, 'draft_rejected', `human:${lou.userId}`, during(660), 1003);
    await journal(alpha, 'draft_edited', `human:${ownerId}`, during(661), 1004);
    await journal(alpha, 'handoff_requested', 'ai', during(670), 1005);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('shows his shift in figures, read by Impera: drafts he decided, handoffs, fans written to', async () => {
    const read = await call('GET', `/scheduling/shifts/${last}/feedback`, louCookie);
    expect(read.statusCode, read.body).toBe(200);
    const { feedback, digest } = ShiftFeedbackReadSchema.parse(read.json());
    expect(feedback).toBeNull();
    expect(digest.drafts).toEqual({ asIs: 1, edited: 1, rejected: 1 });
    expect(digest.handoffs).toBe(1);
    expect(digest.fans).toEqual([
      expect.objectContaining({ conversationId: alpha, name: 'Fan Alpha', messages: 2 }),
    ]);
    // The register says nothing here: no sales feed is set up for the account.
    expect(digest.sales).toEqual({ feed: 'none' });
  });

  it('owes one feedback at most: his last shift; « Je prends mon poste » asks for it first', async () => {
    const pending = ShiftFeedbackPendingSchema.parse(
      (await call('GET', '/scheduling/shift-feedback/pending', louCookie)).json(),
    );
    expect(pending.pending).toMatchObject({ shiftId: last, creatorId: ines, platformAccountId: inesMain });
    const held = await call('POST', `/scheduling/shifts/${current}/check-in`, louCookie);
    expect([held.statusCode, codeOf(held)]).toEqual([409, 'shift_check_in_feedback_due_conflict']);
    expect(ApiErrorSchema.parse(held.json()).error.details).toEqual({ shiftId: last });
    // The owner owes nothing: he has no shift.
    expect(
      ShiftFeedbackPendingSchema.parse(
        (await call('GET', '/scheduling/shift-feedback/pending', owner)).json(),
      ).pending,
    ).toBeNull();
  });

  it('refuses an older shift’s feedback: it expired, and counts « sans retour » for the owner', async () => {
    const expired = await put(older);
    expect([expired.statusCode, codeOf(expired)]).toEqual([409, 'shift_feedback_expired_conflict']);
    const period = payPeriodOfDay(parisDay(-2));
    const list = ShiftFeedbackListSchema.parse(
      (await call('GET', `/scheduling/shift-feedback?period=${period}`, owner)).json(),
    );
    expect(list.missing.map((one) => one.shiftId)).toContain(older);
    expect(list.missing.map((one) => one.shiftId)).not.toContain(last);
    expect(list.members.map((member) => member.id)).toContain(lou.id);
    // The chatter reads his own feedbacks, never the count of the agency.
    const his = ShiftFeedbackListSchema.parse(
      (await call('GET', `/scheduling/shift-feedback?period=${period}`, louCookie)).json(),
    );
    expect(his.missing).toEqual([]);
  });

  it('takes a fan of the shift only, and the closed answer only when it was asked', async () => {
    const stranger = await put(last, {
      nothingToReport: false,
      signals: [{ category: 'fan_request', text: 'Une vidéo en tenue de sport', conversationId: beta }],
    });
    expect([stranger.statusCode, codeOf(stranger)]).toEqual([409, 'shift_feedback_fan_conflict']);
    const unasked = await put(last, { draftReason: 'too_long' });
    expect([unasked.statusCode, codeOf(unasked)]).toEqual([409, 'shift_feedback_reason_conflict']);
  });

  it('writes a signal linked to a fan into his card, « par un chatteur », then lets him take his post', async () => {
    const made = await put(last, {
      nothingToReport: false,
      signals: [{ category: 'fan_request', text: 'Une vidéo en tenue de sport', conversationId: alpha }],
    });
    expect(made.statusCode, made.body).toBe(201);
    const feedback = ShiftFeedbackSchema.parse(made.json());
    expect(feedback.signals).toEqual([
      { category: 'fan_request', text: 'Une vidéo en tenue de sport', conversationId: alpha },
    ]);
    expect(feedback.draftReason).toBeNull();

    // The conversations' own job writes the note, as « Rendre la main » does, with its author; once per signal.
    const jobs = await test.admin.db.execute(
      sql`select key, payload from graphile_worker._private_jobs where key like 'conversation.record_facts:shift-feedback:%'`,
    );
    const JobSchema = z.object({
      key: z.string(),
      payload: JOB_PAYLOADS['conversation.record_facts'],
    });
    const queued = jobs.rows.map((raw) => JobSchema.parse(raw));
    expect(queued.map((job) => job.key)).toEqual([
      `conversation.record_facts:shift-feedback:${feedback.id}:0`,
    ]);
    expect(queued[0]?.payload).toMatchObject({
      creatorId: ines,
      conversationId: alpha,
      correlationId: `shift-feedback:${feedback.id}:0`,
      source: { kind: 'operator_note', note: 'Une vidéo en tenue de sport', userId: lou.userId },
    });

    expect(
      ShiftFeedbackPendingSchema.parse(
        (await call('GET', '/scheduling/shift-feedback/pending', louCookie)).json(),
      ).pending,
    ).toBeNull();
    const taken = await call('POST', `/scheduling/shifts/${current}/check-in`, louCookie);
    expect(taken.statusCode, taken.body).toBe(200);
    // Stored as sent: the linked fan in its signal.
    const [row] = await test.admin.db
      .select({ signals: schema.shiftFeedbacks.signals })
      .from(schema.shiftFeedbacks)
      .where(eq(schema.shiftFeedbacks.id, feedback.id));
    expect(row?.signals).toEqual([
      { category: 'fan_request', text: 'Une vidéo en tenue de sport', conversationId: alpha },
    ]);
  });
});
