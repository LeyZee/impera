import {
  CreatorConversationSchema,
  CreatorFanPageSchema,
  CreatorIdSchema,
  CreatorMessagePageSchema,
  FanIdSchema,
  newId,
  PlatformAccountIdSchema,
  type ConversationId,
  type CreatorId,
  type FanId,
} from '@nirvana/contracts';
import { and, eq, schema, sql } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { fixedComposer } from './support/composer';
import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';

/**
 * The creator's own space (CR-02, ADR 0042 § 2): her fans and their conversations, read through her own door, a
 * message never with its author, each opening in the audit log. Invented data only (ADR 0010).
 */
describe('/v1/creator-space', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let creatorCookie: string;
  let creatorUserId: string;
  let otherCookie: string;
  let operatorCookie: string;
  let nora: CreatorId;
  let ines: CreatorId;
  const conversations = new Map<string, { conversationId: ConversationId; fanId: FanId }>();

  async function get(url: string, cookie: string) {
    return server.inject({ method: 'GET', url, headers: { cookie, origin: DASHBOARD_ORIGIN } });
  }

  async function seedCreator(label: string): Promise<{ creatorId: CreatorId; accountId: string }> {
    const creatorId = newId(CreatorIdSchema);
    const accountId = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: creatorId, displayName: label, timezone: 'Europe/Paris' });
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: accountId, creatorId, platform: 'reveal', handle: `h-${label}` });
    return { creatorId, accountId: PlatformAccountIdSchema.parse(accountId) };
  }

  async function message(input: {
    creatorId: CreatorId;
    accountId: string;
    fan: string;
    ref: string;
    direction: 'inbound' | 'outbound';
    text: string;
    at: string;
    price?: { minor: number; currency: 'EUR' | 'USD'; paid: boolean };
  }) {
    const result = await app.modules.conversations.ingestMessage({
      creatorId: input.creatorId,
      platformAccountId: PlatformAccountIdSchema.parse(input.accountId),
      platformConversationId: `c-${input.fan}`,
      platformFanId: `f-${input.fan}`,
      fanDisplayName: input.fan,
      message: {
        ref: { platform: 'reveal', id: input.ref },
        conversationRef: { platform: 'reveal', id: `c-${input.fan}` },
        direction: input.direction,
        text: input.text,
        media: [],
        priceMinor: input.price?.minor ?? null,
        currency: input.price?.currency ?? null,
        isPaid: input.price?.paid ?? false,
        createdAt: input.at,
      },
      correlationId: 'seed',
    });
    const [row] = await test.admin.db
      .select({ fanId: schema.conversations.fanId })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, result.conversationId));
    if (row === undefined) throw new Error('conversation not ingested');
    conversations.set(input.fan, {
      conversationId: result.conversationId,
      fanId: FanIdSchema.parse(row.fanId),
    });
    return result;
  }

  async function account(email: string, set: { role: 'creator' | 'operator'; creatorIds: string[] }) {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    await test.admin.db.update(schema.user).set(set).where(eq(schema.user.id, userId));
    return { userId, cookie: await signIn(server, email, PASSWORD) };
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
    app = await createApp(config, createLogger(config), { composer: fixedComposer });
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    const a = await seedCreator('Nora');
    const b = await seedCreator('Ines');
    nora = a.creatorId;
    ines = b.creatorId;
    await message({
      ...a,
      fan: 'Julien',
      ref: 'j1',
      direction: 'inbound',
      text: 'Salut',
      at: '2026-11-01T10:00:00Z',
    });
    await message({
      ...a,
      fan: 'Julien',
      ref: 'j2',
      direction: 'outbound',
      text: 'Un petit cadeau pour toi',
      at: '2026-11-01T10:05:00Z',
      price: { minor: 1500, currency: 'EUR', paid: true },
    });
    await message({
      ...a,
      fan: 'Julien',
      ref: 'j3',
      direction: 'outbound',
      text: 'Et celui-ci, pas encore ouvert',
      at: '2026-11-01T10:06:00Z',
      price: { minor: 2500, currency: 'EUR', paid: false },
    });
    await message({
      ...a,
      fan: 'Marc',
      ref: 'm1',
      direction: 'inbound',
      text: 'Coucou',
      at: '2026-11-02T09:00:00Z',
    });
    await message({
      ...b,
      fan: 'Paul',
      ref: 'p1',
      direction: 'inbound',
      text: 'Hello',
      at: '2026-11-02T09:00:00Z',
    });
    // Written by the agent: the author is a column, never read for her.
    await test.admin.db
      .update(schema.messages)
      .set({ author: 'ai' })
      .where(and(eq(schema.messages.creatorId, nora), eq(schema.messages.platformMessageId, 'j2')));
    const julien = conversations.get('Julien');
    if (julien === undefined) throw new Error('seed failed');
    await app.modules.fans.proposeFacts(nora, julien.fanId, [
      {
        category: 'life',
        key: 'job',
        value: 'Infirmier de nuit',
        kind: 'declared',
        confidence: 0.9,
        sourceMessageId: null,
        observedAt: new Date('2026-11-01T10:00:00Z'),
      },
      // Deduced by the model, and his buying profile: never hers to read.
      {
        category: 'interests',
        key: 'hobby',
        value: 'Aime sans doute la randonnée',
        kind: 'inferred',
        confidence: 0.6,
        sourceMessageId: null,
        observedAt: new Date('2026-11-01T10:00:00Z'),
      },
      {
        category: 'commercial',
        key: 'budget',
        value: 'Achète les packs à 20 €',
        kind: 'declared',
        confidence: 0.9,
        sourceMessageId: null,
        observedAt: new Date('2026-11-01T10:00:00Z'),
      },
    ]);
    ({ userId: creatorUserId, cookie: creatorCookie } = await account('nora@example.test', {
      role: 'creator',
      creatorIds: [nora],
    }));
    ({ cookie: otherCookie } = await account('ines@example.test', { role: 'creator', creatorIds: [ines] }));
    ({ cookie: operatorCookie } = await account('ope@example.test', {
      role: 'operator',
      creatorIds: [nora],
    }));
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('lists her fans, last seen first, with what each paid, never another creator’s', async () => {
    const response = await get('/v1/creator-space/fans', creatorCookie);
    expect(response.statusCode, response.body).toBe(200);
    const page = CreatorFanPageSchema.parse(response.json());
    expect(page.items.map((fan) => fan.displayName)).toEqual(['Marc', 'Julien']);
    const julien = page.items.find((fan) => fan.displayName === 'Julien');
    expect(julien?.spent).toEqual({ eurMinor: 1500, usdMinor: 0 });
    expect(julien?.conversationId).toBe(conversations.get('Julien')?.conversationId);
    expect(page.items.find((fan) => fan.displayName === 'Marc')?.spent).toEqual({ eurMinor: 0, usdMinor: 0 });

    const other = CreatorFanPageSchema.parse((await get('/v1/creator-space/fans', otherCookie)).json());
    expect(other.items.map((fan) => fan.displayName)).toEqual(['Paul']);
  });

  it('pages her fans by cursor', async () => {
    const first = CreatorFanPageSchema.parse(
      (await get('/v1/creator-space/fans?limit=1', creatorCookie)).json(),
    );
    expect(first.items.map((fan) => fan.displayName)).toEqual(['Marc']);
    const second = CreatorFanPageSchema.parse(
      (await get(`/v1/creator-space/fans?limit=1&cursor=${first.nextCursor ?? ''}`, creatorCookie)).json(),
    );
    expect(second.items.map((fan) => fan.displayName)).toEqual(['Julien']);
    expect(second.nextCursor).toBeNull();
  });

  it('opens her conversation with what her fan said himself, and writes each opening in the audit log', async () => {
    const julien = conversations.get('Julien');
    const response = await get(
      `/v1/creator-space/conversations/${julien?.conversationId ?? ''}`,
      creatorCookie,
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(CreatorConversationSchema.parse(response.json())).toEqual({
      id: julien?.conversationId,
      fan: { id: julien?.fanId, displayName: 'Julien', notes: ['Infirmier de nuit'] },
    });
    await get(`/v1/creator-space/conversations/${julien?.conversationId ?? ''}`, creatorCookie);
    const opened = await test.admin.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, 'conversation.open'), eq(schema.auditLog.userId, creatorUserId)));
    expect(opened).toHaveLength(2);
    expect(opened[0]).toMatchObject({
      entity: 'conversation',
      entityId: julien?.conversationId,
      details: { creatorId: nora, by: 'creator' },
    });
  });

  it('reads the messages newest first, with their direction and price, never their author nor their draft', async () => {
    const julien = conversations.get('Julien');
    const response = await get(
      `/v1/creator-space/conversations/${julien?.conversationId ?? ''}/messages`,
      creatorCookie,
    );
    expect(response.statusCode, response.body).toBe(200);
    const body: unknown = response.json();
    const page = CreatorMessagePageSchema.parse(body);
    expect(page.items.map((m) => [m.direction, m.text, m.priceMinor, m.isPaid])).toEqual([
      ['outbound', 'Et celui-ci, pas encore ouvert', 2500, false],
      ['outbound', 'Un petit cadeau pour toi', 1500, true],
      ['inbound', 'Salut', null, false],
    ]);
    expect(response.body).not.toMatch(/"author"|"draftId"/u);
  });

  it('answers 404 for another creator’s conversation, on the conversation and on its messages, and writes nothing', async () => {
    const paul = conversations.get('Paul');
    for (const url of [
      `/v1/creator-space/conversations/${paul?.conversationId ?? ''}`,
      `/v1/creator-space/conversations/${paul?.conversationId ?? ''}/messages`,
    ]) {
      const response = await get(url, creatorCookie);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: 'conversation_not_found' } });
    }
    const opened = await test.admin.db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, 'conversation.open'),
          eq(schema.auditLog.entityId, paul?.conversationId ?? ''),
        ),
      );
    expect(opened).toHaveLength(0);
  });

  it('is for a creator’s account only: an operator of her creator is refused', async () => {
    for (const url of [
      '/v1/creator-space/fans',
      `/v1/creator-space/conversations/${conversations.get('Julien')?.conversationId ?? ''}`,
    ]) {
      const response = await get(url, operatorCookie);
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'role_forbidden' } });
    }
  });

  it('offers her no route that writes to a fan', async () => {
    const julien = conversations.get('Julien');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const response = await server.inject({
        method,
        url: `/v1/creator-space/conversations/${julien?.conversationId ?? ''}/messages`,
        headers: { cookie: creatorCookie, origin: DASHBOARD_ORIGIN },
        payload: { text: 'coucou' },
      });
      // No such route: Fastify answers 405 where the path has a GET, never a write.
      expect(response.statusCode).toBe(405);
    }
    const [{ count } = { count: -1 }] = await test.admin.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.messages)
      .where(eq(schema.messages.text, 'coucou'));
    expect(count).toBe(0);
  });
});
