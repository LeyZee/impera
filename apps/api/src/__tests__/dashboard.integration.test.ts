import {
  ConversationDetailSchema,
  CreatorIdSchema,
  DashboardSchema,
  TodosAcrossCreatorsSchema,
  DEFAULT_AGENT_HOURS,
  DraftIdSchema,
  EventIdSchema,
  KillSwitchIdSchema,
  localClock,
  MessageIdSchema,
  newId,
  PlatformAccountIdSchema,
  TeamMemberIdSchema,
  type AgentHours,
  type ConversationId,
  type CreatorId,
  type PlatformAccountId,
} from '@nirvana/contracts';
import { eq, schema, sql } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { loadPrompt } from '@nirvana/llm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import type { DraftComposer } from '../modules/conversations';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { activateDemoPersona } from './support/persona';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const NO_LOG = { info: () => undefined, warn: () => undefined };

/** Drafts written by the configured voice version: they count for the live rate. */
const versionedComposer: DraftComposer = {
  compose: () =>
    Promise.resolve({
      kind: 'draft',
      bubbles: ['Coucou toi ✨'],
      softViolations: [],
      costUsd: 0,
      voice: { voicePrompt: loadPrompt('voice').header.version, voiceModel: 'grok-4.7' },
    }),
};

describe('GET /v1/dashboard', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let creatorId: CreatorId;
  let platformAccountId: PlatformAccountId;
  let ownerCookie: string;
  let operatorCookie: string;
  let creatorCookie: string;
  const conversations = new Map<string, ConversationId>();

  const call = (url: string, cookie?: string) =>
    server.inject({
      method: 'GET',
      url,
      headers: { origin: DASHBOARD_ORIGIN, ...(cookie !== undefined && { cookie }) },
    });
  const post = (url: string, payload: object) =>
    server.inject({
      method: 'POST',
      url,
      payload,
      headers: { cookie: ownerCookie, origin: DASHBOARD_ORIGIN },
    });

  async function openDraft(conversationId: ConversationId): Promise<string> {
    const detail = ConversationDetailSchema.parse(
      (await call(`/v1/conversations/${conversationId}?creatorId=${creatorId}`, ownerCookie)).json(),
    );
    const draft = detail.openDrafts[0];
    if (draft === undefined) throw new Error('no open draft');
    return draft.id;
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
    app = await createApp(config, createLogger(config), { composer: versionedComposer });
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });

    creatorId = newId(CreatorIdSchema);
    platformAccountId = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: creatorId, displayName: 'Lina', timezone: 'America/Montreal' });
    await activateDemoPersona(app, creatorId);
    await test.admin.db.insert(schema.platformAccounts).values({
      id: platformAccountId,
      creatorId,
      platform: 'reveal',
      handle: 'test-dashboard',
      sessionState: 'valid',
      lastPollAt: new Date(),
    });
    for (const name of ['Julien', 'Marc', 'Leo']) {
      const { conversationId } = await app.modules.conversations.ingestMessage({
        creatorId,
        platformAccountId,
        platformConversationId: `c-${name}`,
        platformFanId: `f-${name}`,
        fanDisplayName: name,
        message: {
          ref: { platform: 'reveal', id: `m-${name}` },
          conversationRef: { platform: 'reveal', id: `c-${name}` },
          direction: 'inbound',
          text: `Salut, c'est ${name}`,
          media: [],
          priceMinor: null,
          currency: null,
          isPaid: false,
          createdAt: new Date().toISOString(),
        },
        correlationId: 'seed',
      });
      await app.modules.conversations.jobs.respond(
        { creatorId, conversationId, correlationId: 'seed' },
        NO_LOG,
      );
      conversations.set(name, conversationId);
    }

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
    const herself = { email: 'creator@example.test', name: 'Lina', password: 'correct horse battery' };
    const { userId: herId } = await createOwner(app.auth, app.db.db, herself);
    await test.admin.db
      .update(schema.user)
      .set({ role: 'creator', creatorIds: [creatorId] })
      .where(eq(schema.user.id, herId));
    creatorCookie = await signIn(server, herself.email, herself.password);

    // Julien's draft goes out as written, Marc's after an edit: one of two without a change.
    const julien = conversations.get('Julien')!;
    const marc = conversations.get('Marc')!;
    const leo = conversations.get('Leo')!;
    const base = (id: ConversationId, draftId: string) => `/v1/conversations/${id}/drafts/${draftId}`;
    expect(
      (await post(`${base(julien, await openDraft(julien))}/approve?creatorId=${creatorId}`, {})).statusCode,
    ).toBe(204);
    expect(
      (
        await post(`${base(marc, await openDraft(marc))}/approve?creatorId=${creatorId}`, {
          bubbles: ['Coucou Marc'],
        })
      ).statusCode,
    ).toBe(204);

    // Leo may be a minor: the agent handed him over.
    expect((await post(`/v1/conversations/${leo}/takeover?creatorId=${creatorId}`, {})).statusCode).toBe(204);
    await test.admin.db.execute(sql`
      insert into conversation_events (id, creator_id, conversation_id, seq, type, payload, actor, correlation_id)
      select ${newId(EventIdSchema)}::uuid, ${creatorId}::uuid, ${leo}::uuid, max(seq) + 1, 'handoff_requested',
             ${JSON.stringify({ conversationId: leo, cause: 'minor' })}::jsonb, 'ai', 'seed'
      from conversation_events where conversation_id = ${leo}::uuid`);

    // Julien unlocked a paid message the agent sent.
    await test.admin.db.insert(schema.messages).values({
      id: newId(MessageIdSchema),
      creatorId,
      platformAccountId,
      conversationId: julien,
      platformMessageId: 'paid-1',
      direction: 'outbound',
      author: 'ai',
      text: 'Pour toi',
      priceMinor: 2_500,
      currency: 'EUR',
      isPaid: true,
      platformCreatedAt: new Date(),
    });
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('asks for a session and for a creator of your own', async () => {
    expect((await call(`/v1/dashboard?creatorId=${creatorId}`)).statusCode).toBe(401);
    const forbidden = await call(`/v1/dashboard?creatorId=${creatorId}`, operatorCookie);
    expect(forbidden.statusCode).toBe(403);
    expect((await call(`/v1/dashboard?creatorId=${newId(CreatorIdSchema)}`, ownerCookie)).statusCode).toBe(
      404,
    );
  });

  it('counts the jobs the worker gave up on or has no task for, hers and those of no creator only', async () => {
    const dead = async () => {
      const response = await call(`/v1/dashboard?creatorId=${creatorId}&period=week`, ownerCookie);
      return DashboardSchema.parse(response.json()).jobs.dead;
    };
    const before = (await dead()) ?? 0;
    for (const payload of [{ creatorId }, { creatorId: '0190a000-0000-7000-8000-000000000000' }, {}]) {
      await test.admin.db.execute(sql`
        select graphile_worker.add_job('conversation.respond', ${JSON.stringify(payload)}::json,
          max_attempts => 1, run_at => now() + interval '1 day')`);
      await test.admin.db.execute(sql`
        update graphile_worker._private_jobs set attempts = max_attempts, last_error = 'test'
        where id = (select max(id) from graphile_worker._private_jobs)`);
    }
    expect(await dead()).toBe(before + 2);

    // No worker task takes `fans.refresh_summary` yet: due for an hour, it never spends an attempt.
    for (const [task, runAt] of [
      ['fans.refresh_summary', sql`now() - interval '1 hour'`],
      ['fans.refresh_summary', sql`now()`],
      ['conversation.respond', sql`now() - interval '1 hour'`],
    ] as const) {
      await test.admin.db.execute(sql`
        select graphile_worker.add_job(${task}, ${JSON.stringify({ creatorId })}::json, run_at => ${runAt})`);
    }
    expect(await dead()).toBe(before + 3);
  });

  it('computes the dashboard of one creator from her conversations', async () => {
    const response = await call(`/v1/dashboard?creatorId=${creatorId}&period=week`, ownerCookie);
    expect(response.statusCode, response.body).toBe(200);
    const dashboard = DashboardSchema.parse(response.json());

    expect(dashboard.creator).toMatchObject({ name: 'Lina', timezone: 'America/Montreal' });
    expect(dashboard.period).toBe('week');
    expect(dashboard.mode).toBe('copilot');
    expect(dashboard.globalStop).toBe(false);
    // No key in the environment nor in Services: the screen says « Clé manquante », not a breakdown.
    expect(dashboard.voice).toMatchObject({ ok: false, keyMissing: true });
    expect(dashboard.liveRate).toEqual({ rate: 50, target: 80, decided: 2, threeWeeksAgo: null });
    expect(dashboard.automatic).toEqual({
      open: false,
      missing: [
        { kind: 'live_rate', value: 50, target: 80 },
        { kind: 'decided_drafts', value: 2, target: 100 },
        { kind: 'blind_test' },
      ],
    });
    expect(dashboard.reveal).toMatchObject({ connected: true, conversations: 3 });
    expect(dashboard.guards.today.minor).toBe(1);
    expect(dashboard.budget).toMatchObject({ cap: 20, alertAt: 16, costPerEuroSold: null });
    expect(dashboard.todos.map((t) => [t.title, t.kind, t.tone])).toEqual([['Leo', 'minor', 'bad']]);
    expect(dashboard.fans.map((f) => [f.name, f.spent, f.byAgent])).toEqual([['Julien', 25, 25]]);
    // « Ouvrir dans Suivi » in the fan reader opens his conversation.
    expect(dashboard.fans[0]?.conversationId).toBe(conversations.get('Julien'));
  });

  it('shows a creator her aggregates, never a conversation nor a fan', async () => {
    const response = await call(`/v1/dashboard?creatorId=${creatorId}&period=week`, creatorCookie);
    expect(response.statusCode, response.body).toBe(200);
    const dashboard = DashboardSchema.parse(response.json());
    expect(dashboard.todos).toEqual([]);
    expect(dashboard.fans).toEqual([]);
    expect(response.body).not.toContain('Leo');
    expect(response.body).not.toContain('Julien');
    expect(dashboard.reveal).toMatchObject({ connected: true, conversations: 3 });
    expect(dashboard.guards.today.minor).toBe(1);
    expect(dashboard.budget.spentToday).toBeNull();
    expect(dashboard.jobs.dead).toBeNull();
  });

  it('asks a human to look at a send that failed for good', async () => {
    // Marc's approved draft could not leave: the conversation stops in `error` and nothing retries it.
    const marc = conversations.get('Marc')!;
    await test.admin.db.execute(sql`
      insert into conversation_events (id, creator_id, conversation_id, seq, type, payload, actor, correlation_id)
      select ${newId(EventIdSchema)}::uuid, ${creatorId}::uuid, ${marc}::uuid, max(seq) + 1, 'send_failed',
             ${JSON.stringify({ draftId: newId(DraftIdSchema), idempotencyKey: 'seed', attempt: 1, isFinal: true })}::jsonb,
             'system', 'seed'
      from conversation_events where conversation_id = ${marc}::uuid`);
    await test.admin.db.execute(sql`update conversations set state = 'error' where id = ${marc}::uuid`);

    const dashboard = DashboardSchema.parse(
      (await call(`/v1/dashboard?creatorId=${creatorId}`, ownerCookie)).json(),
    );
    expect(dashboard.todos.map((t) => [t.title, t.kind, t.tone])).toEqual([
      ['Leo', 'minor', 'bad'],
      ['Marc', 'send_failed', 'warn'],
    ]);
  });

  it('shows a message left with nothing under way for 30 minutes, except while Reveal is unread (P3-11)', async () => {
    const longAgo = new Date(Date.now() - 40 * 60_000);
    const seed = async (name: string, at: Date): Promise<ConversationId> => {
      const { conversationId } = await app.modules.conversations.ingestMessage({
        creatorId,
        platformAccountId,
        platformConversationId: `c-${name}`,
        platformFanId: `f-${name}`,
        fanDisplayName: name,
        message: {
          ref: { platform: 'reveal', id: `m-${name}` },
          conversationRef: { platform: 'reveal', id: `c-${name}` },
          direction: 'inbound',
          text: `Coucou, c'est ${name}`,
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
    const setState = (id: ConversationId, state: string, at: Date, lastOutboundAt: Date | null = null) =>
      test.admin.db.execute(sql`
        update conversations set state = ${state}, last_inbound_at = ${at.toISOString()}::timestamptz,
               last_outbound_at = ${lastOutboundAt?.toISOString() ?? null}::timestamptz
        where id = ${id}::uuid`);
    // Nico rests unanswered; Sami's respond never ended; Ines was answered; Theo just wrote.
    const later = new Date(longAgo.getTime() + 60_000);
    await setState(await seed('Nico', longAgo), 'idle', longAgo);
    await setState(await seed('Sami', later), 'pending', later);
    await setState(await seed('Ines', longAgo), 'idle', longAgo, later);
    await seed('Theo', new Date());

    const read = async () =>
      DashboardSchema.parse((await call(`/v1/dashboard?creatorId=${creatorId}`, ownerCookie)).json()).todos;
    const todos = await read();
    expect(todos.map((t) => [t.title, t.kind, t.tone])).toEqual([
      ['Leo', 'minor', 'bad'],
      ['Nico', 'unanswered', 'warn'],
      ['Sami', 'unanswered', 'warn'],
      ['Marc', 'send_failed', 'warn'],
    ]);
    expect(todos[1]?.waitingMinutes).toBeGreaterThanOrEqual(39);

    // Her hours (P3-14): out of her slots the net is silent, and from her opening it counts again.
    const slotFrom = (minutesAgo: number) => {
      const start = localClock(new Date(Date.now() - minutesAgo * 60_000), 'America/Montreal');
      return {
        mode: 'slots' as const,
        slots: [
          {
            day: start.day,
            startMinute: start.minute,
            endMinute: (start.minute + minutesAgo + 60) % 1440,
            enabled: true,
          },
        ],
      };
    };
    const hoursAre = (reply: AgentHours['reply'] | null) =>
      test.admin.db
        .update(schema.creators)
        .set({ agentHours: reply === null ? null : { ...DEFAULT_AGENT_HOURS, reply } })
        .where(eq(schema.creators.id, creatorId));
    // Closed: her only slot is in three hours.
    const later3h = localClock(new Date(Date.now() + 3 * 3_600_000), 'America/Montreal');
    await hoursAre({
      mode: 'slots',
      slots: [
        {
          day: later3h.day,
          startMinute: later3h.minute,
          endMinute: (later3h.minute + 60) % 1440,
          enabled: true,
        },
      ],
    });
    expect((await read()).map((t) => t.kind)).toEqual(['minor', 'send_failed']);
    // Opened ten minutes ago: not yet thirty minutes of hers.
    await hoursAre(slotFrom(10));
    expect((await read()).map((t) => t.kind)).toEqual(['minor', 'send_failed']);
    // Opened 35 minutes ago: back in the net, still waiting since his message 40 minutes ago, not since her opening.
    await hoursAre(slotFrom(35));
    const fromOpening = await read();
    expect(fromOpening.map((t) => [t.title, t.kind])).toEqual([
      ['Leo', 'minor'],
      ['Nico', 'unanswered'],
      ['Sami', 'unanswered'],
      ['Marc', 'send_failed'],
    ]);
    expect(fromOpening[1]?.waitingMinutes).toBeGreaterThanOrEqual(39);
    await hoursAre(null);

    // An expired Reveal session says it all: the net stays quiet, the rest still waits.
    const sessionIs = (state: 'valid' | 'expired') =>
      test.admin.db
        .update(schema.platformAccounts)
        .set({ sessionState: state })
        .where(eq(schema.platformAccounts.id, platformAccountId));
    await sessionIs('expired');
    expect((await read()).map((t) => t.kind)).toEqual(['minor', 'send_failed']);
    await sessionIs('valid');
  });

  it('keeps the grave lines only while she is stopped (choix de Charles, 28/10)', async () => {
    const read = async () =>
      DashboardSchema.parse((await call(`/v1/dashboard?creatorId=${creatorId}`, ownerCookie)).json());
    const running = await read();
    expect(running.todos.map((t) => t.kind)).toEqual(
      expect.arrayContaining(['minor', 'unanswered', 'send_failed']),
    );
    const stopIs = (active: boolean) =>
      test.admin.db.insert(schema.killSwitches).values({
        id: newId(KillSwitchIdSchema),
        scope: 'creator',
        scopeId: creatorId,
        creatorId,
        active,
        reason: 'test',
        setBy: 'test',
        // The latest row of her scope wins: one millisecond apart is enough.
        setAt: new Date(),
      });

    // Arrêt: Leo, who may be a minor, still waits for a human; the draft, the failed send and the net leave.
    await stopIs(true);
    const stopped = await read();
    expect(stopped.mode).toBe('stop');
    expect(stopped.todos.map((t) => [t.title, t.kind, t.tone])).toEqual([['Leo', 'minor', 'bad']]);

    // Back on: every line comes back.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await stopIs(false);
    expect((await read()).todos.map((t) => t.kind)).toEqual(running.todos.map((t) => t.kind));
  });

  it('lists a handoff until the hand is given back, never a takeover a person chose (recette 28/10)', async () => {
    const seed = async (name: string): Promise<ConversationId> => {
      const { conversationId } = await app.modules.conversations.ingestMessage({
        creatorId,
        platformAccountId,
        platformConversationId: `c-${name}`,
        platformFanId: `f-${name}`,
        fanDisplayName: name,
        message: {
          ref: { platform: 'reveal', id: `m-${name}` },
          conversationRef: { platform: 'reveal', id: `c-${name}` },
          direction: 'inbound',
          text: `Bonsoir, c'est ${name}`,
          media: [],
          priceMinor: null,
          currency: null,
          isPaid: false,
          createdAt: new Date().toISOString(),
        },
        correlationId: 'seed',
      });
      return conversationId;
    };
    const act = async (id: ConversationId, action: 'takeover' | 'release') => {
      expect((await post(`/v1/conversations/${id}/${action}?creatorId=${creatorId}`, {})).statusCode).toBe(
        204,
      );
    };
    const titles = async () =>
      DashboardSchema.parse(
        (await call(`/v1/dashboard?creatorId=${creatorId}`, ownerCookie)).json(),
      ).todos.map((t) => t.title);

    // Nina: a person took the hand of their own accord, without any handoff.
    await act(await seed('Nina'), 'takeover');
    // Paul: the agent handed him over for a meeting, a person gave the hand back, then took it again.
    const paul = await seed('Paul');
    await act(paul, 'takeover');
    await test.admin.db.execute(sql`
      insert into conversation_events (id, creator_id, conversation_id, seq, type, payload, actor, correlation_id)
      select ${newId(EventIdSchema)}::uuid, ${creatorId}::uuid, ${paul}::uuid, max(seq) + 1, 'handoff_requested',
             ${JSON.stringify({ conversationId: paul, cause: 'meeting' })}::jsonb, 'ai', 'seed'
      from conversation_events where conversation_id = ${paul}::uuid`);
    expect(await titles()).toContain('Paul');
    await act(paul, 'release');
    await act(paul, 'takeover');

    const listed = await titles();
    expect(listed).toContain('Leo');
    expect(listed).not.toContain('Nina');
    expect(listed).not.toContain('Paul');
  });

  it('ranks the best fans on their sales in euros, dollars at the last ECB rate known (choix de Charles, 28/10)', async () => {
    const marc = conversations.get('Marc')!;
    const sale = (id: string, author: 'ai' | 'human', priceMinor: number, currency: 'EUR' | 'USD') =>
      test.admin.db.insert(schema.messages).values({
        id: newId(MessageIdSchema),
        creatorId,
        platformAccountId,
        conversationId: marc,
        platformMessageId: id,
        direction: 'outbound',
        author,
        text: 'Pour toi',
        priceMinor,
        currency,
        isPaid: true,
        platformCreatedAt: new Date(),
      });
    // Marc: 10 € sold by a chatter, 30 $ by the agent. Julien: 25 € by the agent.
    await sale('paid-marc-eur', 'human', 1_000, 'EUR');
    await sale('paid-marc-usd', 'ai', 3_000, 'USD');
    const read = async (cookie = ownerCookie) =>
      DashboardSchema.parse((await call(`/v1/dashboard?creatorId=${creatorId}&period=week`, cookie)).json());

    // No rate yet: his dollars do not count, and the screen is told so.
    const without = await read();
    expect(without.fans.map((f) => [f.name, f.spent, f.byAgent])).toEqual([
      ['Julien', 25, 25],
      ['Marc', 10, 0],
    ]);
    expect(without.usdSales).toEqual({ seen: true, rate: null });

    // Pay's job wrote two days; the latest counts: 30 $ × 0.9 = 27 €, 37 € in all, ahead of Julien.
    await test.admin.db.insert(schema.exchangeRates).values([
      {
        currency: 'USD',
        day: '2026-10-26',
        rateMicros: 800_000,
        source: 'BCE, taux de référence',
        fetchedAt: new Date(),
      },
      {
        currency: 'USD',
        day: '2026-10-27',
        rateMicros: 900_000,
        source: 'BCE, taux de référence',
        fetchedAt: new Date(),
      },
    ]);
    const converted = await read();
    expect(converted.fans.map((f) => [f.name, f.spent, f.byAgent])).toEqual([
      ['Marc', 37, 27],
      ['Julien', 25, 25],
    ]);
    expect(converted.fans[0]?.conversationId).toBe(marc);
    expect(converted.usdSales).toEqual({ seen: true, rate: { day: '2026-10-27' } });

    // Her own Dashboard keeps no fan, and says nothing of them.
    expect((await read(creatorCookie)).usdSales).toEqual({ seen: false, rate: null });
  });

  it('leaves out a paid message at a zero price, a negative one refused by the base (recette 28/10, #296)', async () => {
    const leo = conversations.get('Leo')!;
    const sale = (id: string, priceMinor: number, currency: 'EUR' | 'USD') =>
      test.admin.db.insert(schema.messages).values({
        id: newId(MessageIdSchema),
        creatorId,
        platformAccountId,
        conversationId: leo,
        platformMessageId: id,
        direction: 'outbound',
        author: 'ai',
        text: 'Pour toi',
        priceMinor,
        currency,
        isPaid: true,
        platformCreatedAt: new Date(),
      });
    await test.admin.db
      .insert(schema.exchangeRates)
      .values({
        currency: 'USD',
        day: '2026-10-27',
        rateMicros: 900_000,
        source: 'BCE, taux de référence',
        fetchedAt: new Date(),
      })
      .onConflictDoNothing();
    // A negative price is refused by the base (migration 0036); a zero price is allowed and never counts.
    await sale('paid-leo-eur', 1_000, 'EUR');
    await expect(sale('paid-leo-usd-negative', -5_000, 'USD')).rejects.toHaveProperty(
      'cause.constraint',
      'messages_price_minor_check',
    );
    await sale('paid-leo-eur-zero', 0, 'EUR');
    const response = await call(`/v1/dashboard?creatorId=${creatorId}&period=week`, ownerCookie);
    expect(response.statusCode).toBe(200);
    const dashboard = DashboardSchema.parse(response.json());
    expect(dashboard.fans.filter((f) => f.name === 'Leo').map((f) => [f.spent, f.byAgent])).toEqual([
      [10, 10],
    ]);
  });

  it('says Reveal is read late once three of its polls have gone by without a read (recette 28/10, G8)', async () => {
    const account = (set: Partial<typeof schema.platformAccounts.$inferInsert>) =>
      test.admin.db
        .update(schema.platformAccounts)
        .set(set)
        .where(eq(schema.platformAccounts.id, platformAccountId));
    const reveal = async () =>
      DashboardSchema.parse((await call(`/v1/dashboard?creatorId=${creatorId}`, ownerCookie)).json()).reveal;

    expect(await reveal()).toMatchObject({ connected: true, late: false });
    // The session holds, but nothing read it for an hour: the default rhythm (60 s + 20 s) allows 7 minutes.
    await account({ lastPollAt: new Date(Date.now() - 3_600_000) });
    expect(await reveal()).toMatchObject({ connected: true, late: true });
    // An account read every hour is not late after one.
    await account({ connectorConfig: { pollIntervalSeconds: 3_600, jitterSeconds: 300 } });
    expect(await reveal()).toMatchObject({ connected: true, late: false });
    await account({ lastPollAt: new Date(), connectorConfig: {} });
    // The session set an hour ago and never read (worker stopped, first read failed): late from the first day.
    await account({ lastPollAt: null, sessionUpdatedAt: new Date(Date.now() - 3_600_000) });
    expect(await reveal()).toMatchObject({ connected: true, late: true });
    // Set a minute ago: the first read may still come.
    await account({ sessionUpdatedAt: new Date(Date.now() - 60_000) });
    expect(await reveal()).toMatchObject({ connected: true, late: false });
    // Captured again a minute ago, last read three hours ago: the new session waits for its first poll.
    await account({
      lastPollAt: new Date(Date.now() - 3 * 3_600_000),
      sessionUpdatedAt: new Date(Date.now() - 60_000),
    });
    expect(await reveal()).toMatchObject({ connected: true, late: false });
    await account({ lastPollAt: new Date() });
  });

  it('gathers « À traiter » of every creator followed, each line naming hers, never one not followed (SUIVI-09)', async () => {
    // Inès, a second invented creator (ADR 0010): Arthur's send failed for good.
    const ines = newId(CreatorIdSchema);
    const inesAccount = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: ines, nameKey: ines, displayName: 'Inès', timezone: 'Europe/Paris' });
    await test.admin.db.insert(schema.platformAccounts).values({
      id: inesAccount,
      creatorId: ines,
      platform: 'reveal',
      handle: 'test-dashboard-ines',
      sessionState: 'valid',
      lastPollAt: new Date(),
    });
    const { conversationId: arthur } = await app.modules.conversations.ingestMessage({
      creatorId: ines,
      platformAccountId: inesAccount,
      platformConversationId: 'c-Arthur',
      platformFanId: 'f-Arthur',
      fanDisplayName: 'Arthur',
      message: {
        ref: { platform: 'reveal', id: 'm-Arthur' },
        conversationRef: { platform: 'reveal', id: 'c-Arthur' },
        direction: 'inbound',
        text: 'Salut',
        media: [],
        priceMinor: null,
        currency: null,
        isPaid: false,
        createdAt: new Date().toISOString(),
      },
      correlationId: 'seed',
    });
    await test.admin.db.execute(sql`update conversations set state = 'error' where id = ${arthur}::uuid`);

    const todosOf = async (cookie: string) =>
      TodosAcrossCreatorsSchema.parse((await call('/v1/dashboard/todos', cookie)).json());
    // The owner follows both: one list, each line with its creator, the gravest first.
    const all = await todosOf(ownerCookie);
    expect(all.items.find((t) => t.conversationId === arthur)).toMatchObject({
      creatorId: ines,
      creatorName: 'Inès',
      kind: 'send_failed',
    });
    expect(all.items.some((t) => t.creatorId === creatorId && t.creatorName === 'Lina')).toBe(true);
    const tones = all.items.map((t) => t.tone);
    expect(tones).toEqual([...tones].sort((a, b) => Number(b === 'bad') - Number(a === 'bad')));
    // The count of each creator, for the Dashboard's picker (DASH-03).
    for (const creator of all.creators) {
      const hers = all.items.filter((t) => t.creatorId === creator.creatorId);
      expect(creator).toEqual({
        creatorId: creator.creatorId,
        name: creator.creatorId === ines ? 'Inès' : 'Lina',
        todos: hers.length,
        grave: hers.filter((t) => t.tone === 'bad').length,
      });
    }
    expect(all.creators.map((c) => c.creatorId).sort()).toEqual([creatorId, ines].sort());

    // A chatter of Inès alone reads hers only; one of no existing creator reads nothing; a creator never.
    const chatter = {
      email: 'ines-chatter@example.test',
      name: 'Chatter',
      password: 'correct horse battery',
    };
    const { userId } = await createOwner(app.auth, app.db.db, chatter);
    await test.admin.db
      .update(schema.user)
      .set({ role: 'operator', creatorIds: [ines] })
      .where(eq(schema.user.id, userId));
    const hers = await todosOf(await signIn(server, chatter.email, chatter.password));
    expect(hers.items.map((t) => [t.creatorName, t.conversationId])).toEqual([['Inès', arthur]]);
    expect(hers.creators).toEqual([{ creatorId: ines, name: 'Inès', todos: 1, grave: 0 }]);
    expect(await todosOf(operatorCookie)).toEqual({ items: [], creators: [] });
    // A team chatter of Inès reads only the conversations routed to him: her queue is not his, even Arthur's.
    const routedChatter = {
      email: 'ines-routed@example.test',
      name: 'Routed',
      password: 'correct horse battery',
    };
    const routed = (await createOwner(app.auth, app.db.db, routedChatter)).userId;
    await test.admin.db
      .update(schema.user)
      .set({ role: 'operator', creatorIds: [ines] })
      .where(eq(schema.user.id, routed));
    // An invented member (ADR 0010).
    await test.admin.db.insert(schema.teamMembers).values({
      id: newId(TeamMemberIdSchema),
      userId: routed,
      teamRole: 'chatter',
      firstName: 'Prénom',
      lastName: 'Inventé',
      displayName: 'Chatteur',
      country: 'BJ',
      timeZone: 'Africa/Porto-Novo',
      joinedOn: '2026-10-01',
    });
    await test.admin.db
      .update(schema.conversations)
      .set({ routedToUserId: routed })
      .where(eq(schema.conversations.id, arthur));
    expect(await todosOf(await signIn(server, routedChatter.email, routedChatter.password))).toEqual({
      items: [],
      creators: [],
    });
    expect((await call('/v1/dashboard/todos', creatorCookie)).statusCode).toBe(403);
    expect((await call('/v1/dashboard/todos')).statusCode).toBe(401);
  });
});
