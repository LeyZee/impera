import {
  ConversationDetailSchema,
  ConversationIdSchema,
  DesireCurveSchema,
  EventIdSchema,
  MediaAssetIdSchema,
  MeSchema,
  CreatorIdSchema,
  MessageViewSchema,
  newId,
  pageOf,
  ConversationSummarySchema,
  PlatformAccountIdSchema,
  TeamMemberIdSchema,
  type ConversationId,
  type CreatorId,
} from '@nirvana/contracts';
import { eq, schema, sql } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { fixedComposer } from './support/composer';
import { testConfig } from './support/config';
import { activateDemoPersona } from './support/persona';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const NO_LOG = { info: () => undefined, warn: () => undefined };

describe('/v1/conversations', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let ownerCookie: string;
  let operatorCookie: string;
  let creatorId: CreatorId;
  const conversationIds: ConversationId[] = [];

  async function call(method: 'GET' | 'POST', url: string, cookie: string, payload?: object) {
    return server.inject({
      method,
      url,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      ...(payload === undefined ? {} : { payload }),
    });
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

    creatorId = newId(CreatorIdSchema);
    const platformAccountId = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: creatorId, displayName: 'Test', timezone: 'Europe/Paris' });
    await activateDemoPersona(app, creatorId);
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: platformAccountId, creatorId, platform: 'reveal', handle: 'test-http' });
    for (const name of ['Julien', 'Marc']) {
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
      conversationIds.push(conversationId);
    }

    const owner = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
    await createOwner(app.auth, app.db.db, owner);
    ownerCookie = await signIn(server, owner.email, owner.password);
    // An operator of another creator: same account flow, then the role and scope an owner would give.
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

  it('lists the conversations by cursor pages, most recent first', async () => {
    const first = await call('GET', `/v1/conversations?creatorId=${creatorId}&limit=1`, ownerCookie);
    expect(first.statusCode, first.body).toBe(200);
    const page1 = pageOf(ConversationSummarySchema).parse(first.json());
    expect(page1.items.map((item) => item.fanDisplayName)).toEqual(['Marc']);
    expect(page1.nextCursor).not.toBeNull();

    const second = await call(
      'GET',
      `/v1/conversations?creatorId=${creatorId}&limit=1&cursor=${page1.nextCursor ?? ''}`,
      ownerCookie,
    );
    const page2 = pageOf(ConversationSummarySchema).parse(second.json());
    expect(page2.items.map((item) => item.fanDisplayName)).toEqual(['Julien']);
    expect(page2.nextCursor).toBeNull();
  });

  it('shows a conversation with its open draft and its messages', async () => {
    const id = conversationIds[0]!;
    const detail = ConversationDetailSchema.parse(
      (await call('GET', `/v1/conversations/${id}?creatorId=${creatorId}`, ownerCookie)).json(),
    );
    expect(detail).toMatchObject({ state: 'awaiting_approval', unreadCount: 1, fanDisplayName: 'Julien' });
    expect(detail.openDrafts).toHaveLength(1);

    const messages = pageOf(MessageViewSchema).parse(
      (await call('GET', `/v1/conversations/${id}/messages?creatorId=${creatorId}`, ownerCookie)).json(),
    );
    expect(messages.items.map((message) => message.text)).toEqual(["Salut, c'est Julien"]);
    expect(messages.items[0]?.media).toEqual([]);
  });

  it('refuses bubbles a hard guard blocks, then approves an edited draft once; a second decision is a conflict', async () => {
    const id = conversationIds[0]!;
    const detail = ConversationDetailSchema.parse(
      (await call('GET', `/v1/conversations/${id}?creatorId=${creatorId}`, ownerCookie)).json(),
    );
    const draftId = detail.openDrafts[0]!.id;
    const base = `/v1/conversations/${id}/drafts/${draftId}`;

    // A chatter's words pass the hard guards too (revue 09, G5), split over two bubbles or not.
    for (const bubbles of [['Je suis une IA'], ['Pour être honnête je suis une', 'IA']]) {
      const refused = await call('POST', `${base}/approve?creatorId=${creatorId}`, ownerCookie, { bubbles });
      expect(refused.statusCode, refused.body).toBe(422);
      expect(refused.json()).toMatchObject({
        error: { code: 'draft_unprocessable', details: { guards: ['ai_disclosure'] } },
      });
    }
    // A draft never carries a media: announcing one he will not receive is refused too (P3-13).
    const announced = await call('POST', `${base}/approve?creatorId=${creatorId}`, ownerCookie, {
      bubbles: ['Regarde, je t’envoie une photo 😘'],
    });
    expect(announced.statusCode, announced.body).toBe(422);
    expect(announced.json()).toMatchObject({
      error: { code: 'draft_unprocessable', details: { guards: ['media_not_sent'] } },
    });
    const [stillOpen] = await test.admin.db
      .select({ status: schema.drafts.status })
      .from(schema.drafts)
      .where(eq(schema.drafts.id, draftId));
    expect(stillOpen?.status).toBe('pending');

    const approved = await call('POST', `${base}/approve?creatorId=${creatorId}`, ownerCookie, {
      bubbles: ['Coucou Julien'],
    });
    expect(approved.statusCode, approved.body).toBe(204);
    const rejected = await call('POST', `${base}/reject?creatorId=${creatorId}`, ownerCookie, {});
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json()).toMatchObject({ error: { code: 'draft_conflict' } });
  });

  it('shows, in error, the draft whose send failed for good, until the conversation leaves the error', async () => {
    const id = conversationIds[0]!;
    const read = async () =>
      ConversationDetailSchema.parse(
        (await call('GET', `/v1/conversations/${id}?creatorId=${creatorId}`, ownerCookie)).json(),
      );
    const sending = await read();
    expect(sending.failedDraft).toBeNull();
    const draftId = sending.openDrafts[0]!.id;
    // The last attempt: whatever the platform answers, nothing retries it.
    await app.modules.conversations.jobs.send(
      { creatorId, conversationId: id, draftId, correlationId: 'test' },
      NO_LOG,
      3,
    );

    const failed = await read();
    expect(failed).toMatchObject({ state: 'error', openDrafts: [] });
    expect(failed.failedDraft).toMatchObject({
      id: draftId,
      status: 'failed',
      finalBubbles: ['Coucou Julien'],
    });

    const takeover = await call(
      'POST',
      `/v1/conversations/${id}/takeover?creatorId=${creatorId}`,
      ownerCookie,
      {},
    );
    expect(takeover.statusCode, takeover.body).toBe(204);
    expect((await read()).failedDraft).toBeNull();
  });

  it('takes over and releases a conversation', async () => {
    const id = conversationIds[1]!;
    const takeover = await call(
      'POST',
      `/v1/conversations/${id}/takeover?creatorId=${creatorId}`,
      ownerCookie,
      {},
    );
    expect(takeover.statusCode, takeover.body).toBe(204);
    const detail = ConversationDetailSchema.parse(
      (await call('GET', `/v1/conversations/${id}?creatorId=${creatorId}`, ownerCookie)).json(),
    );
    expect(detail).toMatchObject({ state: 'human', openDrafts: [] });
    // The outbox copy names the conversation, so a Telegram alert sent for it can be closed (ADR 0020).
    const published = await test.admin.db
      .select({ payload: schema.domainEvents.payload })
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.type, 'takeover_started'));
    expect(published.map((event) => event.payload)).toContainEqual(
      expect.objectContaining({ conversationId: id }),
    );
    const release = await call(
      'POST',
      `/v1/conversations/${id}/release?creatorId=${creatorId}`,
      ownerCookie,
      {},
    );
    expect(release.statusCode).toBe(204);
    const audit = await test.admin.db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, id));
    expect(audit.map((entry) => entry.action)).toEqual(['conversation.takeover', 'conversation.release']);
  });

  it('keeps an operator out of a creator they do not handle', async () => {
    const response = await call('GET', `/v1/conversations?creatorId=${creatorId}`, operatorCookie);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'creator_forbidden' } });
  });

  it('keeps a creator out of every conversation, even her own (ADR 0023)', async () => {
    const creator = { email: 'creatrice@example.test', name: 'Créatrice', password: 'correct horse battery' };
    const { userId } = await createOwner(app.auth, app.db.db, creator);
    await test.admin.db
      .update(schema.user)
      .set({ role: 'creator', creatorIds: [creatorId] })
      .where(eq(schema.user.id, userId));
    const cookie = await signIn(server, creator.email, creator.password);
    const id = conversationIds[0] ?? newId(ConversationIdSchema);
    for (const url of [
      `/v1/conversations?creatorId=${creatorId}`,
      `/v1/conversations/${id}?creatorId=${creatorId}`,
      `/v1/conversations/${id}/messages?creatorId=${creatorId}`,
      `/v1/conversations/${id}/events?creatorId=${creatorId}`,
      `/v1/conversations/${id}/desire?creatorId=${creatorId}`,
    ]) {
      const response = await call('GET', url, cookie);
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'role_forbidden' } });
    }
  });

  it('lets a team chatter reach only the conversations routed to him, and a manager every one (ADR 0024)', async () => {
    const people = { chatter: 'chatter@example.test', manager: 'manager@example.test' } as const;
    const routed = conversationIds[0] ?? newId(ConversationIdSchema);
    const other = conversationIds[1] ?? newId(ConversationIdSchema);
    const cookies = { chatter: '', manager: '' };
    for (const teamRole of ['chatter', 'manager'] as const) {
      const email = people[teamRole];
      const { userId } = await createOwner(app.auth, app.db.db, {
        email,
        name: teamRole,
        password: 'correct horse battery',
      });
      await test.admin.db
        .update(schema.user)
        .set({ role: 'operator', creatorIds: [creatorId] })
        .where(eq(schema.user.id, userId));
      // Invented members (ADR 0010).
      await test.admin.db.insert(schema.teamMembers).values({
        id: newId(TeamMemberIdSchema),
        userId,
        teamRole,
        firstName: 'Prénom',
        lastName: 'Inventé',
        displayName: teamRole,
        country: 'BJ',
        timeZone: 'Africa/Porto-Novo',
        joinedOn: '2026-10-01',
      });
      if (teamRole === 'chatter') {
        await test.admin.db
          .update(schema.conversations)
          .set({ routedToUserId: userId })
          .where(eq(schema.conversations.id, routed));
      }
      cookies[teamRole] = await signIn(server, email, 'correct horse battery');
    }
    const { chatter, manager } = cookies;

    const me = MeSchema.parse((await call('GET', '/v1/me', chatter)).json());
    expect(me).toMatchObject({ creatorIds: [], routedCreatorIds: [creatorId], teamScope: 'self' });

    const list = pageOf(ConversationSummarySchema).parse(
      (await call('GET', `/v1/conversations?creatorId=${creatorId}`, chatter)).json(),
    );
    expect(list.items.map((item) => item.id)).toEqual([routed]);
    expect(
      (await call('GET', `/v1/conversations/${routed}?creatorId=${creatorId}`, chatter)).statusCode,
    ).toBe(200);
    expect(
      (await call('GET', `/v1/conversations/${routed}/desire?creatorId=${creatorId}`, chatter)).statusCode,
    ).toBe(200);
    for (const url of [
      `/v1/conversations/${other}?creatorId=${creatorId}`,
      `/v1/conversations/${other}/messages?creatorId=${creatorId}`,
      `/v1/conversations/${other}/events?creatorId=${creatorId}`,
      `/v1/conversations/${other}/desire?creatorId=${creatorId}`,
    ]) {
      const refused = await call('GET', url, chatter);
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({ error: { code: 'conversation_forbidden' } });
    }
    expect(
      (await call('POST', `/v1/conversations/${other}/takeover?creatorId=${creatorId}`, chatter, {}))
        .statusCode,
    ).toBe(403);
    // The whole creator stays closed to him: her mode, her Dashboard.
    const mode = await call('POST', `/v1/conversations/${routed}/mode?creatorId=${creatorId}`, chatter, {
      mode: 'copilot',
    });
    expect(mode.json()).toMatchObject({ error: { code: 'creator_forbidden' } });
    expect((await call('GET', `/v1/dashboard?creatorId=${creatorId}&period=day`, chatter)).statusCode).toBe(
      403,
    );
    // He acts on the conversation routed to him.
    expect(
      (await call('POST', `/v1/conversations/${routed}/takeover?creatorId=${creatorId}`, chatter, {}))
        .statusCode,
    ).toBe(204);
    expect(
      (await call('POST', `/v1/conversations/${routed}/release?creatorId=${creatorId}`, chatter, {}))
        .statusCode,
    ).toBe(204);

    // « Rendre la main » ends the routing: the conversation is closed to him again.
    const after = await call('GET', `/v1/conversations/${routed}?creatorId=${creatorId}`, chatter);
    expect(after.statusCode).toBe(403);
    expect(after.json()).toMatchObject({ error: { code: 'conversation_forbidden' } });

    const all = pageOf(ConversationSummarySchema).parse(
      (await call('GET', `/v1/conversations?creatorId=${creatorId}`, manager)).json(),
    );
    expect(all.items).toHaveLength(2);

    // A suspended manager keeps his sign-in but drops to `self` (ADR 0024): no conversation is routed to him.
    await test.admin.db
      .update(schema.teamMembers)
      .set({ status: 'suspended' })
      .where(eq(schema.teamMembers.displayName, 'manager'));
    expect(MeSchema.parse((await call('GET', '/v1/me', manager)).json())).toMatchObject({
      creatorIds: [],
      routedCreatorIds: [creatorId],
      teamScope: 'self',
    });
    const suspended = pageOf(ConversationSummarySchema).parse(
      (await call('GET', `/v1/conversations?creatorId=${creatorId}`, manager)).json(),
    );
    expect(suspended.items).toEqual([]);
    for (const id of [routed, other]) {
      const refused = await call('GET', `/v1/conversations/${id}/messages?creatorId=${creatorId}`, manager);
      expect(refused.statusCode).toBe(403);
    }
  });

  it('shows his desire score cooled to now with the band of that score, and none before a first score (P3-12)', async () => {
    const [scoredId, unscoredId] = conversationIds;
    if (scoredId === undefined || unscoredId === undefined) throw new Error('seed missing');
    // Stored at 80 (« chaud ») one half-life ago: it reads 40 now, so « joueur », whatever the stored band says.
    await test.admin.db
      .update(schema.conversations)
      .set({ desireScore: 80, desireBand: 'hot', desireAt: new Date(Date.now() - 90 * 60_000) })
      .where(eq(schema.conversations.id, scoredId));

    const list = pageOf(ConversationSummarySchema).parse(
      (await call('GET', `/v1/conversations?creatorId=${creatorId}`, ownerCookie)).json(),
    );
    const desireOf = (id: ConversationId) => list.items.find((item) => item.id === id)?.desire;
    expect(desireOf(scoredId)).toEqual({ score: 40, band: 'playful' });
    expect(desireOf(unscoredId)).toBeNull();
    const detail = ConversationDetailSchema.parse(
      (await call('GET', `/v1/conversations/${scoredId}?creatorId=${creatorId}`, ownerCookie)).json(),
    );
    expect(detail.desire).toEqual({ score: 40, band: 'playful' });
  });

  it('reads the desire curve from the journal, oldest first, the 200 most recent points (P3-12)', async () => {
    const id = conversationIds[1] ?? newId(ConversationIdSchema);
    const empty = await call('GET', `/v1/conversations/${id}/desire?creatorId=${creatorId}`, ownerCookie);
    expect(empty.statusCode, empty.body).toBe(200);
    expect(DesireCurveSchema.parse(empty.json())).toEqual({ points: [] });

    const [last] = await test.admin.db
      .select({ seq: schema.conversationEvents.seq })
      .from(schema.conversationEvents)
      .where(eq(schema.conversationEvents.conversationId, id))
      .orderBy(sql`${schema.conversationEvents.seq} desc`)
      .limit(1);
    const start = last?.seq ?? 0;
    const t0 = Date.parse('2026-10-17T20:00:00Z');
    // 205 changes: 1 → 205 % 100, each one minute after the last; the first one has no score before it.
    await test.admin.db.insert(schema.conversationEvents).values(
      Array.from({ length: 205 }, (_, index) => ({
        id: newId(EventIdSchema),
        creatorId,
        conversationId: id,
        seq: start + index + 1,
        type: 'desire_scored',
        payload: {
          before: index === 0 ? null : index % 100,
          score: (index + 1) % 100,
          signals: index === 204 ? ['intent:flirt', 'suggestive_emoji', 'suggestive_emoji'] : ['long_reply'],
          weightsVersion: 'w1',
        },
        actor: 'ai',
        correlationId: 'test',
        createdAt: new Date(t0 + index * 60_000),
      })),
    );

    const response = await call('GET', `/v1/conversations/${id}/desire?creatorId=${creatorId}`, ownerCookie);
    expect(response.statusCode, response.body).toBe(200);
    const { points } = DesireCurveSchema.parse(response.json());
    expect(points).toHaveLength(200);
    // The five oldest fall out: the curve starts at the sixth change.
    expect(points[0]).toEqual({
      at: new Date(t0 + 5 * 60_000).toISOString(),
      before: 5,
      score: 6,
      signals: ['long_reply'],
    });
    expect(points.at(-1)).toEqual({
      at: new Date(t0 + 204 * 60_000).toISOString(),
      before: 4,
      score: 5,
      signals: ['intent:flirt', 'suggestive_emoji', 'suggestive_emoji'],
    });
    expect(points.map((point) => point.at)).toEqual(points.map((point) => point.at).toSorted());
  });

  it('answers 404 for a conversation that does not exist and 400 for a bad cursor', async () => {
    const missing = await call(
      'GET',
      `/v1/conversations/${newId(CreatorIdSchema)}?creatorId=${creatorId}`,
      ownerCookie,
    );
    expect(missing.statusCode).toBe(404);
    // Its messages, events and curve too, never an empty page (recette 28/10): an id that does not exist, or one of
    // another creator, which her RLS does not show.
    const other = newId(CreatorIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: other, nameKey: other, displayName: 'Autre', timezone: 'Europe/Paris' });
    const ours = conversationIds[0]!;
    for (const [id, creator] of [
      [newId(ConversationIdSchema), creatorId],
      [ours, other],
    ] as const) {
      for (const read of ['messages', 'events', 'desire']) {
        const answer = await call('GET', `/v1/conversations/${id}/${read}?creatorId=${creator}`, ownerCookie);
        expect([read, answer.statusCode, answer.json<{ error: { code: string } }>().error.code]).toEqual([
          read,
          404,
          'conversation_not_found',
        ]);
      }
    }
    const badCursor = await call('GET', `/v1/conversations?creatorId=${creatorId}&cursor=nope`, ownerCookie);
    expect(badCursor.statusCode).toBe(400);
  });

  it('says when he wrote on the platform, not when a capture read it back', async () => {
    const [account] = await test.admin.db
      .select({ id: schema.platformAccounts.id })
      .from(schema.platformAccounts)
      .where(eq(schema.platformAccounts.creatorId, creatorId));
    if (account === undefined) throw new Error('no account');
    // Read back five hours after he wrote it.
    const wrote = new Date(Date.now() - 5 * 3_600_000).toISOString();
    const { conversationId } = await app.modules.conversations.ingestMessage({
      creatorId,
      platformAccountId: PlatformAccountIdSchema.parse(account.id),
      platformConversationId: 'c-Basile',
      platformFanId: 'f-Basile',
      fanDisplayName: 'Basile',
      message: {
        ref: { platform: 'reveal', id: 'm-Basile' },
        conversationRef: { platform: 'reveal', id: 'c-Basile' },
        direction: 'inbound',
        text: 'Tu es là ?',
        media: [],
        priceMinor: null,
        currency: null,
        isPaid: false,
        createdAt: wrote,
      },
      correlationId: 'capture',
    });
    const detail = ConversationDetailSchema.parse(
      (await call('GET', `/v1/conversations/${conversationId}?creatorId=${creatorId}`, ownerCookie)).json(),
    );
    expect(detail.lastInboundAt).toBe(wrote);
    const list = pageOf(ConversationSummarySchema).parse(
      (await call('GET', `/v1/conversations?creatorId=${creatorId}`, ownerCookie)).json(),
    );
    expect(list.items.find((item) => item.id === conversationId)?.lastInboundAt).toBe(wrote);
  });

  it('pages through rows of the same millisecond without skipping one, microseconds kept in the cursor', async () => {
    // Postgres keeps microseconds; a cursor cut to the millisecond skipped what sorted after it within that millisecond.
    const id = conversationIds[1]!;
    const [account] = await test.admin.db
      .select({ id: schema.platformAccounts.id })
      .from(schema.platformAccounts)
      .where(eq(schema.platformAccounts.creatorId, creatorId));
    if (account === undefined) throw new Error('no account');
    for (const n of [2, 3]) {
      await app.modules.conversations.ingestMessage({
        creatorId,
        platformAccountId: PlatformAccountIdSchema.parse(account.id),
        platformConversationId: 'c-Marc',
        platformFanId: 'f-Marc',
        fanDisplayName: 'Marc',
        message: {
          ref: { platform: 'reveal', id: `m-Marc-${String(n)}` },
          conversationRef: { platform: 'reveal', id: 'c-Marc' },
          direction: 'inbound',
          text: `Message ${String(n)}`,
          media: [],
          priceMinor: null,
          currency: null,
          isPaid: false,
          createdAt: new Date().toISOString(),
        },
        correlationId: 'same-ms',
      });
    }
    await test.admin.db
      .execute(sql`update messages set platform_created_at = '2026-10-01T10:00:00.000Z'::timestamptz
      + (row_number_us * interval '1 microsecond')
      from (select id as mid, (row_number() over (order by id)) * 100 as row_number_us from messages
        where conversation_id = ${id}) ranked
      where messages.id = ranked.mid`);
    await test.admin.db
      .execute(sql`update conversations set updated_at = '2026-10-01T10:00:00.000Z'::timestamptz
      + (row_number_us * interval '1 microsecond')
      from (select id as cid, (row_number() over (order by id)) * 100 as row_number_us from conversations
        where creator_id = ${creatorId}) ranked
      where conversations.id = ranked.cid`);

    async function walk(path: string): Promise<string[]> {
      const seen: string[] = [];
      let cursor: string | null = '';
      while (cursor !== null) {
        const url = `${path}${path.includes('?') ? '&' : '?'}creatorId=${creatorId}&limit=1${cursor === '' ? '' : `&cursor=${cursor}`}`;
        const response = await call('GET', url, ownerCookie);
        expect(response.statusCode, response.body).toBe(200);
        const body = z
          .object({ items: z.array(z.object({ id: z.string() })), nextCursor: z.string().nullable() })
          .parse(response.json());
        seen.push(...body.items.map((item) => item.id));
        cursor = body.nextCursor;
      }
      return seen;
    }

    const messages = await walk(`/v1/conversations/${id}/messages`);
    expect(messages).toHaveLength(3);
    expect(new Set(messages).size).toBe(3);
    const conversations = await walk('/v1/conversations');
    expect(conversations).toHaveLength(3);
    expect(new Set(conversations).size).toBe(3);
  });

  it('says which media a message carries, and what it shows once the media module described it (SUIVI-26)', async () => {
    const platformAccountId = (
      await test.admin.db
        .select({ id: schema.platformAccounts.id })
        .from(schema.platformAccounts)
        .where(eq(schema.platformAccounts.creatorId, creatorId))
    )[0]!.id;
    const { conversationId } = await app.modules.conversations.ingestMessage({
      creatorId,
      platformAccountId: PlatformAccountIdSchema.parse(platformAccountId),
      platformConversationId: 'c-Leo',
      platformFanId: 'f-Leo',
      fanDisplayName: 'Léo',
      message: {
        ref: { platform: 'reveal', id: 'm-Leo' },
        conversationRef: { platform: 'reveal', id: 'c-Leo' },
        direction: 'inbound',
        text: '',
        media: [
          { ref: { platform: 'reveal', id: 'media-1' }, kind: 'image', isLocked: false },
          { ref: { platform: 'reveal', id: 'media-2' }, kind: 'video', isLocked: true },
        ],
        priceMinor: null,
        currency: null,
        isPaid: false,
        createdAt: new Date().toISOString(),
      },
      correlationId: 'media',
    });
    const read = async () =>
      pageOf(MessageViewSchema).parse(
        (
          await call(
            'GET',
            `/v1/conversations/${conversationId}/messages?creatorId=${creatorId}`,
            ownerCookie,
          )
        ).json(),
      ).items[0]?.media;
    // Listed by the platform, not described yet: the kind and the lock only.
    expect(await read()).toEqual([
      { kind: 'image', isLocked: false, description: null },
      { kind: 'video', isLocked: true, description: null },
    ]);
    // Stored and described by the media module (invented content, ADR 0010): the latest description is shown.
    const [photo, video] = [newId(MediaAssetIdSchema), newId(MediaAssetIdSchema)];
    await test.admin.db.insert(schema.mediaAssets).values(
      [photo, video].map((id, index) => ({
        id,
        creatorId,
        kind: index === 0 ? 'image' : 'video',
        origin: 'fan',
        storageKey: `test/${id}`,
        mime: index === 0 ? 'image/jpeg' : 'video/mp4',
        bytes: 1000,
        sha256: id,
      })),
    );
    const description = (factualDescription: string, owner = creatorId, mediaAssetId = photo) => ({
      id: newId(z.uuid()),
      creatorId: owner,
      mediaAssetId,
      vocabularyVersion: '1',
      content: { factualDescription },
      model: 'test',
      promptHash: 'test',
    });
    await test.admin.db.insert(schema.mediaDescriptions).values({
      ...description('Une ancienne description.'),
      createdAt: new Date(Date.now() - 60_000),
    });
    await test.admin.db.insert(schema.mediaDescriptions).values(description('Un chat sur un canapé.'));
    await test.admin.db
      .update(schema.messages)
      .set({ mediaIds: [photo, video] })
      .where(eq(schema.messages.conversationId, conversationId));
    expect(await read()).toEqual([
      { kind: 'image', isLocked: false, description: 'Un chat sur un canapé.' },
      { kind: 'video', isLocked: true, description: null },
    ]);
    // Lists that do not match one to one: no description rather than a wrong one.
    await test.admin.db
      .update(schema.messages)
      .set({ mediaIds: [photo] })
      .where(eq(schema.messages.conversationId, conversationId));
    expect(await read()).toEqual([
      { kind: 'image', isLocked: false, description: null },
      { kind: 'video', isLocked: true, description: null },
    ]);
    // Another creator's described media, even if cited, never shows: the reader reads under her RLS.
    const other = newId(CreatorIdSchema);
    const foreign = newId(MediaAssetIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: other, nameKey: other, displayName: 'Autre', timezone: 'Europe/Paris' });
    await test.admin.db.insert(schema.mediaAssets).values({
      id: foreign,
      creatorId: other,
      kind: 'video',
      origin: 'fan',
      storageKey: `test/${foreign}`,
      mime: 'video/mp4',
      bytes: 1000,
      sha256: foreign,
    });
    await test.admin.db
      .insert(schema.mediaDescriptions)
      .values(description('Une vidéo d’une autre créatrice.', other, foreign));
    await test.admin.db
      .update(schema.messages)
      .set({ mediaIds: [photo, foreign] })
      .where(eq(schema.messages.conversationId, conversationId));
    expect(await read()).toEqual([
      { kind: 'image', isLocked: false, description: 'Un chat sur un canapé.' },
      { kind: 'video', isLocked: true, description: null },
    ]);
  });
});
