import {
  CreatorConversationSchema,
  CreatorFanPageSchema,
  CreatorIdSchema,
  CreatorMessagePageSchema,
  DraftIdSchema,
  EventIdSchema,
  FanIdSchema,
  AuditEntryIdSchema,
  newId,
  PlatformAccountIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
  type ConversationId,
  type CreatorId,
  type FanId,
} from '@impera/contracts';
import { and, eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
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
 * The creator's own space (CR-02, ADR 0042 § 2): her fans and their conversations, read through her own door, each of
 * her messages with who wrote it and nothing more of the agency (ADR 0065 § 1), each opening in the audit log.
 * Invented data only (ADR 0010).
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
  let noraAccount: string;
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
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
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
    noraAccount = a.accountId;
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
    // Written by the agent: she reads « Automatique », never the column.
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

  it('opens her conversation with her fan’s pseudo and none of his notes, and writes each opening in the audit log', async () => {
    const julien = conversations.get('Julien');
    const response = await get(
      `/v1/creator-space/conversations/${julien?.conversationId ?? ''}`,
      creatorCookie,
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(CreatorConversationSchema.parse(response.json())).toEqual({
      id: julien?.conversationId,
      fan: { id: julien?.fanId, displayName: 'Julien' },
    });
    // What the agency knows of him stays its own (Charles, 03/11): no fact, declared or not.
    expect(response.body).not.toMatch(/Infirmier|randonnée|packs/u);
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

  it('reads the messages newest first, with their direction, price and writer, never their author nor their draft', async () => {
    const julien = conversations.get('Julien');
    const response = await get(
      `/v1/creator-space/conversations/${julien?.conversationId ?? ''}/messages`,
      creatorCookie,
    );
    expect(response.statusCode, response.body).toBe(200);
    const body: unknown = response.json();
    const page = CreatorMessagePageSchema.parse(body);
    expect(page.items.map((m) => [m.direction, m.text, m.priceMinor, m.isPaid, m.writtenBy])).toEqual([
      ['outbound', 'Et celui-ci, pas encore ouvert', 2500, false, { kind: 'platform' }],
      ['outbound', 'Un petit cadeau pour toi', 1500, true, { kind: 'ai' }],
      ['inbound', 'Salut', null, false, null],
    ]);
    expect(response.body).not.toMatch(/"author"|"draftId"/u);
  });

  it('names who wrote each of her messages: the chatter who corrected a draft, the AI, the platform (ADR 0065 § 1)', async () => {
    const at = (minute: number) => `2026-11-04T10:${String(minute).padStart(2, '0')}:00Z`;
    const seed = { creatorId: nora, accountId: noraAccount, fan: 'Hugo', direction: 'outbound' } as const;
    await message({ ...seed, ref: 'h1', direction: 'inbound', text: 'Tu fais quoi ?', at: at(0) });
    await message({ ...seed, ref: 'h2', text: 'Je pensais à toi', at: at(1) });
    await message({ ...seed, ref: 'h3', text: 'Corrigé par Kofi', at: at(2) });
    await message({ ...seed, ref: 'h4', text: 'Écrit sur la plateforme', at: at(3) });
    await message({ ...seed, ref: 'h5', text: 'Corrigé par le propriétaire', at: at(4) });
    const hugo = conversations.get('Hugo')?.conversationId;
    if (hugo === undefined) throw new Error('seed failed');

    // Kofi, a chatter of the team; the owner corrects too, with no member record.
    const kofi = newId(UserIdSchema);
    const owner = newId(UserIdSchema);
    await test.admin.db.insert(schema.user).values([
      { id: kofi, name: 'Kofi Compte', email: 'kofi@example.test' },
      { id: owner, name: 'Propriétaire Inventé', email: 'patron@example.test', role: 'owner' },
    ]);
    await test.admin.db.insert(schema.teamMembers).values({
      id: newId(TeamMemberIdSchema),
      userId: kofi,
      teamRole: 'chatter',
      firstName: 'Kofi',
      lastName: 'Inventé',
      displayName: 'Kofi',
      country: 'BJ',
      timeZone: 'Africa/Porto-Novo',
      joinedOn: '2026-09-01',
    });

    // h2: the agent's draft sent as proposed; h3 and h5: drafts corrected before they left; h4: no draft.
    const drafts = { h2: newId(DraftIdSchema), h3: newId(DraftIdSchema), h5: newId(DraftIdSchema) };
    await test.admin.db.insert(schema.drafts).values(
      Object.entries(drafts).map(([ref, id]) => ({
        id,
        creatorId: nora,
        conversationId: hugo,
        status: 'sent',
        bubbles: ['Brouillon de l’agent'],
        idempotencyKey: `writer:${ref}`,
      })),
    );
    for (const [ref, author] of [
      ['h2', 'ai'],
      ['h3', 'human'],
      ['h4', 'human'],
      ['h5', 'human'],
    ] as const) {
      const draftId = ref === 'h4' ? null : drafts[ref];
      await test.admin.db
        .update(schema.messages)
        .set({ author, draftId })
        .where(and(eq(schema.messages.creatorId, nora), eq(schema.messages.platformMessageId, ref)));
    }
    for (const [draftId, userId, type] of [
      [drafts.h2, kofi, 'draft_approved'],
      [drafts.h3, kofi, 'draft_edited'],
      [drafts.h5, owner, 'draft_edited'],
    ] as const) {
      const [last] = await test.admin.db
        .select({ seq: sql<number>`max(${schema.conversationEvents.seq})::int` })
        .from(schema.conversationEvents)
        .where(eq(schema.conversationEvents.conversationId, hugo));
      await test.admin.db.insert(schema.conversationEvents).values({
        id: newId(EventIdSchema),
        creatorId: nora,
        conversationId: hugo,
        seq: (last?.seq ?? 0) + 1,
        type,
        payload: {
          draftId,
          status: type === 'draft_edited' ? 'edited' : 'approved',
          decidedBy: userId,
          ...(type === 'draft_edited' && { editedBubbles: ['Le texte corrigé'] }),
        },
        actor: `human:${userId}`,
        correlationId: 'writer',
      });
    }

    const response = await get(`/v1/creator-space/conversations/${hugo}/messages`, creatorCookie);
    expect(response.statusCode, response.body).toBe(200);
    const page = CreatorMessagePageSchema.parse(response.json());
    expect(page.items.map((m) => [m.text, m.writtenBy])).toEqual([
      ['Corrigé par le propriétaire', { kind: 'agency' }],
      ['Écrit sur la plateforme', { kind: 'platform' }],
      ['Corrigé par Kofi', { kind: 'chatter', displayName: 'Kofi' }],
      ['Je pensais à toi', { kind: 'ai' }],
      ['Tu fais quoi ?', null],
    ]);
    // Nothing else of the agency: no draft, no reviewer, no account of the chatter, no edit.
    expect(response.body).not.toMatch(
      /"author"|"draftId"|decidedBy|Kofi Compte|kofi@|Propriétaire|Brouillon de l’agent|Le texte corrigé/u,
    );
    expect(response.body).not.toContain(kofi);
  });

  it('never reads a thread without a trace: a read of its messages with no recent opening is written as one', async () => {
    const marc = conversations.get('Marc');
    const messagesOf = () =>
      get(`/v1/creator-space/conversations/${marc?.conversationId ?? ''}/messages`, creatorCookie);
    const openings = () =>
      test.admin.db
        .select()
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.action, 'conversation.open'),
            eq(schema.auditLog.entityId, marc?.conversationId ?? ''),
          ),
        );
    // An opening of hers older than the window covers nothing.
    await test.admin.db.insert(schema.auditLog).values({
      id: newId(AuditEntryIdSchema),
      userId: creatorUserId,
      action: 'conversation.open',
      entity: 'conversation',
      entityId: marc?.conversationId ?? '',
      details: { creatorId: nora, by: 'creator' },
      createdAt: new Date(Date.now() - 16 * 60_000),
    });
    // A direct call, no recent opening before it: written at once.
    expect((await messagesOf()).statusCode).toBe(200);
    const written = await openings();
    expect(written).toHaveLength(2);
    expect(written).toContainEqual(
      expect.objectContaining({
        userId: creatorUserId,
        entity: 'conversation',
        details: { creatorId: nora, by: 'creator', via: 'messages' },
      }),
    );
    // The screen reads again every 30 s: covered by that trace, nothing more.
    expect((await messagesOf()).statusCode).toBe(200);
    expect(await openings()).toHaveLength(2);
    // Her opening is always written.
    await get(`/v1/creator-space/conversations/${marc?.conversationId ?? ''}`, creatorCookie);
    expect(await openings()).toHaveLength(3);
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
