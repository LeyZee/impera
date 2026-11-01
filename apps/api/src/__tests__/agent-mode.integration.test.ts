import {
  AgentModeResultSchema,
  ApiErrorSchema,
  CreatorIdSchema,
  DashboardSchema,
  newId,
  PlatformAccountIdSchema,
  RESUME_SPACING_SECONDS,
  type ConversationId,
  type CreatorId,
} from '@nirvana/contracts';
import { and, eq, schema, sql } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { setKillSwitch } from '../ops';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

describe('PUT /v1/agent/mode', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let creatorId: CreatorId;
  let conversationId: ConversationId;
  let ownerCookie: string;
  let operatorCookie: string;

  const send = (method: 'PUT' | 'POST' | 'GET', url: string, payload?: object, cookie = ownerCookie) =>
    server.inject({
      method,
      url,
      ...(payload !== undefined && { payload }),
      headers: { cookie, origin: DASHBOARD_ORIGIN },
    });
  const setMode = (mode: string, cookie = ownerCookie) =>
    send('PUT', '/v1/agent/mode', { creatorId, mode }, cookie);
  const dashboard = async () =>
    DashboardSchema.parse((await send('GET', `/v1/dashboard?creatorId=${creatorId}`)).json());
  const dashboardMode = async () => (await dashboard()).mode;
  const creatorSwitches = () =>
    test.admin.db
      .select({ active: schema.killSwitches.active, setBy: schema.killSwitches.setBy })
      .from(schema.killSwitches)
      .where(and(eq(schema.killSwitches.scope, 'creator'), eq(schema.killSwitches.scopeId, creatorId)))
      .orderBy(schema.killSwitches.setAt);

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
      handle: 'test-agent-mode',
      sessionState: 'valid',
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
      .set({ role: 'operator', creatorIds: [newId(CreatorIdSchema)] })
      .where(eq(schema.user.id, userId));
    operatorCookie = await signIn(server, operator.email, operator.password);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('refuses Automatique while ADR 0019 keeps it locked, and writes nothing', async () => {
    const response = await setMode('auto');
    expect(response.statusCode).toBe(409);
    const { error } = ApiErrorSchema.parse(response.json());
    expect(error.code).toBe('agent_mode_conflict');
    expect(error.details['missing']).toContainEqual({ kind: 'blind_test' });
    expect(await creatorSwitches()).toEqual([]);
  });

  it('refuses a creator outside the operator’s list', async () => {
    expect((await setMode('stop', operatorCookie)).statusCode).toBe(403);
    expect(await creatorSwitches()).toEqual([]);
  });

  it('answers 404 for a creator that does not exist, not a 500 from the foreign key', async () => {
    const response = await send('PUT', '/v1/agent/mode', { creatorId: newId(CreatorIdSchema), mode: 'stop' });
    expect(response.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(response.json()).error.code).toBe('creator_not_found');
  });

  it('Arrêt sets her kill switch at once, with its event and its audit line', async () => {
    const response = await setMode('stop');
    expect(response.statusCode).toBe(200);
    expect(AgentModeResultSchema.parse(response.json())).toEqual({ mode: 'stop', globalStop: false });
    expect(await dashboardMode()).toBe('stop');

    const switches = await creatorSwitches();
    expect(switches).toHaveLength(1);
    expect(switches[0]?.active).toBe(true);
    expect(switches[0]?.setBy).toMatch(/^human:/);
    const [event] = await test.admin.db
      .select()
      .from(schema.domainEvents)
      .where(
        and(
          eq(schema.domainEvents.creatorId, creatorId),
          eq(schema.domainEvents.type, 'kill_switch_toggled'),
        ),
      );
    expect(event?.payload).toMatchObject({ scope: 'creator', scopeId: creatorId, active: true });
    const [audit] = await test.admin.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'kill_switch.on'));
    expect(audit).toMatchObject({ entity: 'kill_switch', entityId: creatorId });

    // A second Arrêt changes nothing: one row per change, not per click.
    expect((await setMode('stop')).json()).toEqual({ mode: 'stop', globalStop: false });
    expect(await creatorSwitches()).toHaveLength(1);
  });

  it('Copilote lifts the switch and brings a conversation in Automatique back to the copilot', async () => {
    // As if Automatique had opened (automatic-lock.integration.test.ts covers the lock itself).
    await test.admin.db
      .update(schema.conversations)
      .set({ mode: 'auto' })
      .where(eq(schema.conversations.id, conversationId));

    const response = await setMode('copilot');
    expect(response.json()).toEqual({ mode: 'copilot', globalStop: false });
    expect(await dashboardMode()).toBe('copilot');
    expect((await creatorSwitches()).map((s) => s.active)).toEqual([true, false]);
    const [conversation] = await test.admin.db
      .select({ mode: schema.conversations.mode })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId));
    expect(conversation?.mode).toBe('copilot');
  });

  it('answers, after the stop, a fan who wrote during it (recette R-G2)', async () => {
    const respondJobs = async () =>
      (
        await test.admin.db.execute<{ due: boolean }>(sql`
          select run_at <= now() + interval '1 second' as due from graphile_worker._private_jobs
          where key = ${`conversation.respond:${conversationId}`}`)
      ).rows;
    expect((await setMode('stop')).statusCode).toBe(200);
    // Julien is still waiting (pending) and his answer already ran during the stop: it found the switch, did nothing.
    await test.admin.db.execute(
      sql`delete from graphile_worker._private_jobs where key = ${`conversation.respond:${conversationId}`}`,
    );
    expect(await respondJobs()).toEqual([]);

    expect((await setMode('copilot')).statusCode).toBe(200);
    expect(await respondJobs()).toEqual([{ due: true }]);

    // A click that lifts nothing enqueues nothing more.
    await test.admin.db.execute(
      sql`delete from graphile_worker._private_jobs where key = ${`conversation.respond:${conversationId}`}`,
    );
    expect((await setMode('copilot')).statusCode).toBe(200);
    expect(await respondJobs()).toEqual([]);
  });

  it('answers the fans who waited one after the other, the longest wait first', async () => {
    const platformAccountId = PlatformAccountIdSchema.parse(
      (
        await test.admin.db
          .select({ id: schema.platformAccounts.id })
          .from(schema.platformAccounts)
          .where(eq(schema.platformAccounts.creatorId, creatorId))
      )[0]?.id,
    );
    const { conversationId: later } = await app.modules.conversations.ingestMessage({
      creatorId,
      platformAccountId,
      platformConversationId: 'c-basile',
      platformFanId: 'f-basile',
      fanDisplayName: 'Basile',
      message: {
        ref: { platform: 'reveal', id: 'm-basile' },
        conversationRef: { platform: 'reveal', id: 'c-basile' },
        direction: 'inbound',
        text: 'Coucou',
        media: [],
        priceMinor: null,
        currency: null,
        isPaid: false,
        createdAt: new Date().toISOString(),
      },
      correlationId: 'seed-basile',
    });
    const first = `conversation.respond:${conversationId}`;
    const second = `conversation.respond:${later}`;
    const delays = async () =>
      (
        await test.admin.db.execute<{ key: string; delay: number }>(sql`
          select key, extract(epoch from run_at - now())::float as delay from graphile_worker._private_jobs
          where key in (${first}, ${second})`)
      ).rows;
    const clear = () =>
      test.admin.db.execute(
        sql`delete from graphile_worker._private_jobs where key in (${first}, ${second})`,
      );

    expect((await setMode('stop')).statusCode).toBe(200);
    await clear();
    expect((await setMode('copilot')).statusCode).toBe(200);
    const byKey = new Map((await delays()).map((row) => [row.key, row.delay]));
    // Julien wrote first: answered now; Basile one spacing later, not at the same second.
    expect(byKey.get(first)).toBeLessThanOrEqual(1);
    expect(byKey.get(second)).toBeGreaterThan(RESUME_SPACING_SECONDS - 2);
    expect(byKey.get(second)).toBeLessThanOrEqual(RESUME_SPACING_SECONDS + 1);

    // Basile leaves the waiting list: the tests below count on Julien alone.
    await clear();
    await test.admin.db
      .update(schema.conversations)
      .set({ state: 'idle' })
      .where(eq(schema.conversations.id, later));
  });

  it('answers Arrêt to Copilote while the global switch stays on', async () => {
    await setKillSwitch(test.admin.db, { active: true, scope: 'global', scopeId: null, reason: 'test' });
    expect((await setMode('copilot')).json()).toEqual({ mode: 'stop', globalStop: true });
    // The Dashboard, reloaded, says the same and why.
    expect(await dashboard()).toMatchObject({ mode: 'stop', globalStop: true });
    await test.admin.db.execute(
      sql`delete from graphile_worker._private_jobs where key = ${`conversation.respond:${conversationId}`}`,
    );
    await setKillSwitch(test.admin.db, { active: false, scope: 'global', scopeId: null, reason: 'test' });
    expect(await dashboardMode()).toBe('copilot');
    // Lifted from the terminal too, the fan who waited gets his answer.
    const [job] = (
      await test.admin.db.execute<{ due: boolean }>(sql`
        select run_at <= now() + interval '1 second' as due from graphile_worker._private_jobs
        where key = ${`conversation.respond:${conversationId}`}`)
    ).rows;
    expect(job).toEqual({ due: true });
  });

  it('applies clicks sent together one after the other', async () => {
    const before = (await creatorSwitches()).length;
    const modes = ['stop', 'copilot', 'stop', 'copilot', 'stop', 'stop', 'copilot', 'stop'];
    const responses = await Promise.all(modes.map((mode) => setMode(mode)));
    expect(responses.every((r) => r.statusCode === 200)).toBe(true);

    // Serialised: every new row flips the one before it, and the latest row is the mode now shown.
    const rows = (await creatorSwitches()).slice(before - 1).map((s) => s.active);
    for (let i = 1; i < rows.length; i += 1) expect(rows[i]).toBe(!rows[i - 1]);
    expect(await dashboardMode()).toBe(rows.at(-1) === true ? 'stop' : 'copilot');
  });
});
