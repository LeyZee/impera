import {
  ApiErrorSchema,
  BlindTestResultSchema,
  CreatorIdSchema,
  DashboardSchema,
  DraftIdSchema,
  newId,
  PersonaVersionIdSchema,
  PlatformAccountIdSchema,
  type ConversationId,
  type CreatorId,
} from '@nirvana/contracts';
import { and, eq, schema, sql } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { DEFAULT_LLM_CONFIG, loadPrompt } from '@nirvana/llm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

/** The version the server writes with, as the composition root reads it. */
const VOICE = {
  voicePrompt: loadPrompt('voice').header.version,
  voiceModel: DEFAULT_LLM_CONFIG.roles.voice.model,
};
const NO_LOG = { info: () => undefined, warn: () => undefined };

describe('the server lock of Automatique (ADR 0019)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let creatorId: CreatorId;
  let conversationId: ConversationId;
  /** Her first active persona version: what the drafts below prove by default. */
  let firstPersona: string;
  let ownerCookie: string;
  let operatorCookie: string;
  let decidedAt = Date.parse('2026-10-19T08:00:00.000Z');

  const send = (method: 'PUT' | 'POST' | 'GET', url: string, payload?: object, cookie = ownerCookie) =>
    server.inject({
      method,
      url,
      ...(payload !== undefined && { payload }),
      headers: { cookie, origin: DASHBOARD_ORIGIN },
    });
  const setAgentMode = (mode: string) => send('PUT', '/v1/agent/mode', { creatorId, mode });
  const setConversationMode = (mode: string) =>
    send('POST', `/v1/conversations/${conversationId}/mode?creatorId=${creatorId}`, { mode });
  const recordBlindTest = (rate: number, cookie = ownerCookie) =>
    send('POST', `/v1/creators/${creatorId}/blind-tests`, { rate }, cookie);
  const dashboard = async () =>
    DashboardSchema.parse((await send('GET', `/v1/dashboard?creatorId=${creatorId}`)).json());
  const conversationMode = async () => {
    const [row] = await test.admin.db
      .select({ mode: schema.conversations.mode })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId));
    return row?.mode;
  };
  const closedEvents = () =>
    test.admin.db
      .select({ payload: schema.domainEvents.payload })
      .from(schema.domainEvents)
      .where(
        and(eq(schema.domainEvents.creatorId, creatorId), eq(schema.domainEvents.type, 'automatic_closed')),
      );

  /** Drafts a chatter decided, each newer than the last; by default the active voice and her first persona. */
  const decide = async (
    count: number,
    status: 'sent' | 'rejected',
    voice = VOICE,
    personaVersionId: string | null = firstPersona,
  ) => {
    for (let i = 0; i < count; i += 1) {
      decidedAt += 1_000;
      await test.admin.db.insert(schema.drafts).values({
        id: newId(DraftIdSchema),
        creatorId,
        conversationId,
        status,
        bubbles: ['Coucou'],
        promptHashes: { ...voice },
        personaVersionId,
        decidedBy: 'human:seed',
        decidedAt: new Date(decidedAt),
        idempotencyKey: `seed:${String(decidedAt)}`,
        createdAt: new Date(decidedAt - 60_000),
      });
    }
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

    creatorId = newId(CreatorIdSchema);
    const platformAccountId = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: creatorId, displayName: 'Lina', timezone: 'Europe/Paris' });
    await test.admin.db.insert(schema.platformAccounts).values({
      id: platformAccountId,
      creatorId,
      platform: 'reveal',
      handle: 'test-automatic-lock',
      sessionState: 'valid',
    });
    // Without an active persona nothing opens Automatique (recette 28/10, G4): she has one from the start here.
    firstPersona = newId(PersonaVersionIdSchema);
    await test.admin.db.insert(schema.personaVersions).values({
      id: firstPersona,
      creatorId,
      version: 'test-0',
      sourcePath: 'personas/example.yaml',
      content: {},
      contentHash: 'test-0',
      isActive: true,
      activatedAt: new Date(),
    });
    ({ conversationId } = await app.modules.conversations.ingestMessage({
      creatorId,
      platformAccountId,
      platformConversationId: 'c-julien',
      platformFanId: 'f-julien',
      fanDisplayName: 'Julien',
      message: {
        ref: { platform: 'reveal', id: 'm-julien' },
        conversationRef: { platform: 'reveal', id: 'c-julien' },
        direction: 'inbound',
        text: 'Salut',
        media: [],
        priceMinor: null,
        currency: null,
        isPaid: false,
        createdAt: new Date().toISOString(),
      },
      correlationId: 'seed',
    }));

    const owner = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
    await createOwner(app.auth, app.db.db, owner);
    ownerCookie = await signIn(server, owner.email, owner.password);
    const operator = { email: 'operator@example.test', name: 'Operator', password: 'correct horse battery' };
    const { userId } = await createOwner(app.auth, app.db.db, operator);
    await test.admin.db
      .update(schema.user)
      .set({ role: 'operator', creatorIds: [creatorId] })
      .where(eq(schema.user.id, userId));
    operatorCookie = await signIn(server, operator.email, operator.password);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('refuses Automatique through both doors and says what is missing', async () => {
    // A perfect rate on another voice version proves nothing for this one.
    await decide(150, 'sent', { voicePrompt: VOICE.voicePrompt, voiceModel: 'another-model' });
    await decide(90, 'sent');

    for (const response of [await setAgentMode('auto'), await setConversationMode('auto')]) {
      expect(response.statusCode).toBe(409);
      const { error } = ApiErrorSchema.parse(response.json());
      expect(error.code).toBe('agent_mode_conflict');
      expect(error.details).toEqual({
        missing: [{ kind: 'decided_drafts', value: 90, target: 100 }, { kind: 'blind_test' }],
      });
    }
    expect(await conversationMode()).toBe('copilot');
    expect((await dashboard()).automatic.missing).toEqual([
      { kind: 'decided_drafts', value: 90, target: 100 },
      { kind: 'blind_test' },
    ]);
  });

  it('lets only the owner record a blind test, stamped with the active version', async () => {
    expect((await recordBlindTest(85, operatorCookie)).statusCode).toBe(403);
    expect((await recordBlindTest(101)).statusCode).toBe(400);

    await decide(20, 'sent');
    const failed = BlindTestResultSchema.parse((await recordBlindTest(79.94)).json());
    expect(failed).toMatchObject({ ...VOICE, rate: 79.9, passed: false });
    expect(failed.automatic).toEqual({ open: false, missing: [{ kind: 'blind_test' }] });

    const passed = await recordBlindTest(84.5);
    expect(passed.statusCode).toBe(201);
    expect(BlindTestResultSchema.parse(passed.json())).toMatchObject({
      rate: 84.5,
      passed: true,
      automatic: { open: true, missing: [] },
    });
    const [audit] = await test.admin.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'blind_test.record'))
      .limit(1);
    expect(audit).toMatchObject({ entity: 'creator', entityId: creatorId });
  });

  it('opens Automatique once the lock is open, and the Dashboard says so', async () => {
    const response = await setAgentMode('auto');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ mode: 'auto', globalStop: false });
    expect(await conversationMode()).toBe('auto');
    expect(await dashboard()).toMatchObject({ mode: 'auto', automatic: { open: true, missing: [] } });
  });

  it('closes on its own when the live rate falls, at the next answer, and tells the owner once', async () => {
    // 110 sent and 50 rejected among the last 160: 68.8 %.
    await decide(50, 'rejected');
    await app.modules.conversations.jobs.respond(
      { creatorId, conversationId, correlationId: 'fall' },
      NO_LOG,
    );
    expect(await conversationMode()).toBe('copilot');
    const events = await closedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({
      ...VOICE,
      missing: [{ kind: 'live_rate', value: 68.8, target: 80 }],
      conversations: 1,
    });

    // Nothing in automatic any more: a second answer closes nothing and says nothing.
    await app.modules.conversations.jobs.respond(
      { creatorId, conversationId, correlationId: 'again' },
      NO_LOG,
    );
    expect(await closedEvents()).toHaveLength(1);
    expect((await dashboard()).mode).toBe('copilot');
  });

  it('closes at once when a later blind test of the version fails', async () => {
    await decide(300, 'sent');
    expect((await setConversationMode('auto')).statusCode).toBe(204);
    expect(BlindTestResultSchema.parse((await recordBlindTest(60)).json()).automatic.open).toBe(false);
    expect(await conversationMode()).toBe('copilot');
    expect(await closedEvents()).toHaveLength(2);
  });

  it('proves nothing for a new persona: activating one closes Automatique until she proves it (ADR 0022)', async () => {
    expect(BlindTestResultSchema.parse((await recordBlindTest(90)).json()).automatic.open).toBe(true);
    expect((await setConversationMode('auto')).statusCode).toBe(204);

    const personaVersionId = newId(PersonaVersionIdSchema);
    await test.admin.db
      .update(schema.personaVersions)
      .set({ isActive: false })
      .where(eq(schema.personaVersions.id, firstPersona));
    await test.admin.db.insert(schema.personaVersions).values({
      id: personaVersionId,
      creatorId,
      version: 'test-1',
      sourcePath: 'personas/example.yaml',
      content: {},
      contentHash: 'test',
      isActive: true,
      activatedAt: new Date(),
    });
    expect((await dashboard()).automatic.missing).toEqual([
      { kind: 'live_rate', value: null, target: 80 },
      { kind: 'decided_drafts', value: 0, target: 100 },
      { kind: 'blind_test' },
    ]);
    await app.modules.conversations.jobs.respond(
      { creatorId, conversationId, correlationId: 'persona' },
      NO_LOG,
    );
    expect(await conversationMode()).toBe('copilot');
    expect(await closedEvents()).toHaveLength(3);

    // Her drafts and blind test with this persona open it again; the test is stamped with the persona.
    await decide(120, 'sent', VOICE, personaVersionId);
    expect(BlindTestResultSchema.parse((await recordBlindTest(85)).json()).automatic.open).toBe(true);
    const [latest] = await test.admin.db
      .select({ personaVersionId: schema.blindTests.personaVersionId })
      .from(schema.blindTests)
      .where(eq(schema.blindTests.creatorId, creatorId))
      .orderBy(sql`${schema.blindTests.recordedAt} desc`)
      .limit(1);
    expect(latest?.personaVersionId).toBe(personaVersionId);
  });

  it('closes when she no longer has an active persona, whatever her drafts proved (recette 28/10, G4)', async () => {
    expect((await setConversationMode('auto')).statusCode).toBe(204);
    await test.admin.db
      .update(schema.personaVersions)
      .set({ isActive: false })
      .where(eq(schema.personaVersions.creatorId, creatorId));
    const { missing } = (await dashboard()).automatic;
    expect(missing[0]).toEqual({ kind: 'active_persona' });
    for (const response of [await setAgentMode('auto'), await setConversationMode('auto')]) {
      expect(response.statusCode).toBe(409);
    }
    await app.modules.conversations.jobs.respond(
      { creatorId, conversationId, correlationId: 'no-persona' },
      NO_LOG,
    );
    expect(await conversationMode()).toBe('copilot');
    const events = await closedEvents();
    expect(z.object({ missing: z.array(z.unknown()) }).parse(events.at(-1)?.payload).missing[0]).toEqual({
      kind: 'active_persona',
    });
  });
});
