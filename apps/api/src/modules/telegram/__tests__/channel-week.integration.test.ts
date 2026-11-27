import { randomBytes } from 'node:crypto';

import {
  ChannelPlannedPostSchema,
  ChannelWeekSchema,
  CreatorIdSchema,
  DEFAULT_TELEGRAM_CHANNEL_CONFIG,
  RedirectLinkIdSchema,
  TelegramBotIdSchema,
  TelegramChatIdSchema,
  newId,
  ok,
  type CreatorId,
  type RedirectLink,
} from '@impera/contracts';
import { eq, parseEncryptionKeys, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import type { LlmGateway } from '@impera/llm';
import type { preValidationAsyncHookHandler } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createTelegramModule, type TelegramModule } from '..';
import { testConfig } from '../../../__tests__/support/config';
import { createJobQueue, type JobQueue } from '../../../jobs';
import { createLogger } from '../../../logger';
import { buildServer } from '../../../server';
import type { ChannelVisualsSource } from '../domain/week-ports';
import { createChannelWeekStore } from '../infra/channel-week.store';
import { createPostgresChannelsStore } from '../infra/channels.store';
import { createPostgresTelegramStore } from '../infra/postgres.store';

import { FAKE_TOKEN, FakeTelegram } from './support/fake-telegram';

/**
 * Her channel's week on the real migrations (ADR 0162): planned, written, reviewed, sent once by the agency's bot
 * (FakeTelegram), and never reachable through another creator.
 */
describe('her channel’s week on Postgres', () => {
  let test: TestDb;
  let queue: JobQueue;
  let server: Awaited<ReturnType<typeof buildServer>>;
  let module: TelegramModule;
  let nora: CreatorId;
  let lea: CreatorId;
  const telegram = new FakeTelegram();
  // Friday 20 November 2026, noon in Paris: this week gets planned from now on, the next one from Saturday 18 h.
  let now = new Date('2026-11-20T11:00:00Z');
  const linkId = RedirectLinkIdSchema.parse(newId(RedirectLinkIdSchema));
  const link: RedirectLink = {
    id: linkId,
    name: 'Reveal',
    url: 'https://example.test/r',
    destination: 'mon Reveal',
  };
  const voice: LlmGateway['channelPost'] = (input) =>
    Promise.resolve(
      ok({
        output:
          input.kind === 'poll'
            ? { kind: 'poll' as const, question: 'Verte ou noire ?', options: ['Verte', 'Noire'] }
            : { kind: 'post' as const, text: `Coucou (${input.kind})` },
        meta: { provider: 'xai', model: 'grok-4.7', isFallback: false, latencyMs: 1, promptHash: 'test' },
      }),
    );
  const visual = {
    mediaId: newId(CreatorIdSchema),
    kind: 'video' as const,
    description: 'Une nouvelle lingerie noire',
  };
  const visuals: ChannelVisualsSource = {
    eveningCandidates: (creatorId) => Promise.resolve(creatorId === nora ? [visual] : []),
    telegramStock: () => Promise.resolve([]),
    file: () =>
      Promise.resolve({ bytes: new Uint8Array([1, 2, 3]), filename: 'video.mp4', mime: 'video/mp4' }),
  };
  const config = testConfig();
  const headers = { 'x-test-role': 'owner', origin: config.WEB_ORIGIN };
  const ownerOnly: preValidationAsyncHookHandler = async (request, reply) => {
    if (request.headers['x-test-role'] !== 'owner') {
      await reply.code(403).send({ error: 'forbidden' });
      return;
    }
    request.user = {
      id: 'owner-week',
      email: 'owner@example.test',
      name: 'Charles',
      role: 'owner',
      creatorIds: [],
      routedCreatorIds: [],
      shiftCreatorIds: [],
    };
  };
  const pass: preValidationAsyncHookHandler = () => Promise.resolve();

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    queue = await createJobQueue(test.admin.pool);
    nora = newId(CreatorIdSchema);
    lea = newId(CreatorIdSchema);
    await test.admin.db.insert(schema.creators).values([
      { id: nora, nameKey: nora, displayName: 'Nora', timezone: 'Europe/Paris' },
      { id: lea, nameKey: lea, displayName: 'Léa', timezone: 'Europe/Paris' },
    ]);
    await test.admin.db
      .insert(schema.user)
      .values({ id: 'owner-week', name: 'Charles', email: 'owner@example.test', emailVerified: true });
    const store = createPostgresTelegramStore({
      adminDb: test.service.db,
      keys: parseEncryptionKeys(`v1:${randomBytes(32).toString('base64')}`),
    });
    module = createTelegramModule({
      bots: store.bots,
      deliveries: store.deliveries,
      channels: createPostgresChannelsStore(test.service.db),
      channel: telegram,
      channelLinks: () => Promise.resolve([link]),
      clock: { now: () => now },
      webOrigin: 'https://crm.example.test',
      channelWriter: {
        persona: () =>
          Promise.resolve({
            version: '2.0.0',
            creatorName: 'Nora',
            personaSheet: 'identity:\n  first_name: Nora',
            check: () => [],
          }),
        gateway: { channelPost: voice },
      },
      channelWeek: createChannelWeekStore(test.app.db),
      channelVisuals: visuals,
    });
    telegram.addBot(FAKE_TOKEN, 'agence_bot');
    const added = await module.addBot(FAKE_TOKEN);
    if (!added.ok) throw new Error('bot refused');
    telegram.updates.push(
      {
        kind: 'membership',
        updateId: 1,
        telegramChatId: '-2001',
        title: 'Canal N',
        chatKind: 'channel',
        membership: 'member',
        canPost: true,
      },
      {
        kind: 'membership',
        updateId: 2,
        telegramChatId: '-2002',
        title: 'Canal L',
        chatKind: 'channel',
        membership: 'member',
        canPost: true,
      },
    );
    await module.jobs.pollUpdates(TelegramBotIdSchema.parse(added.value.id), 0);
    const chats = await test.admin.db.select().from(schema.telegramChats);
    const chatOf = (title: string) =>
      TelegramChatIdSchema.parse(chats.find((chat) => chat.title === title)?.id);
    for (const [creatorId, title] of [
      [nora, 'Canal N'],
      [lea, 'Canal L'],
    ] as const) {
      const saved = await module.saveChannel(
        creatorId,
        // Switched on for her only: Léa's stays off, as every channel is until the owner says so.
        {
          ...DEFAULT_TELEGRAM_CHANNEL_CONFIG,
          chatId: chatOf(title),
          links: [link],
          channelLinkId: linkId,
          publishing: creatorId === nora,
        },
        'owner-week',
      );
      if (!saved?.ok) throw new Error('channel refused');
    }
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: [module.routes({ guard: ownerOnly, recentLogin: pass })],
      readiness: () =>
        Promise.resolve({ isReady: true, checks: { database: true, migrations: true, worker: true } }),
    });
  });

  afterAll(async () => {
    await server.close();
    await queue.close();
    await test.close();
  });

  const weekOf = async (creatorId: string, week: string) => {
    const response = await server.inject({
      method: 'GET',
      url: `/v1/creators/${creatorId}/telegram-channel/week?week=${week}`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    return ChannelWeekSchema.parse(response.json());
  };

  it('plans what is left of this week, writes it, and plans the next one only from Saturday 18 h', async () => {
    await module.jobs.channelWeek();
    const thisWeek = await weekOf(nora, '2026-11-16');
    // Friday afternoon and evening, Saturday and Sunday: 2 + 3 + 3.
    expect(thisWeek.total).toBe(8);
    expect(thisWeek.posts.every((post) => post.draft !== null)).toBe(true);
    expect((await weekOf(nora, '2026-11-23')).total).toBe(0);

    now = new Date('2026-11-21T17:30:00Z');
    await module.jobs.channelWeek();
    expect((await weekOf(nora, '2026-11-23')).total).toBe(21);
    // A replay plans nothing more.
    await module.jobs.channelWeek();
    expect((await weekOf(nora, '2026-11-23')).total).toBe(21);
  });

  it('validates, edits and removes a post by the owner’s name; a removed post is replaced at once', async () => {
    const week = await weekOf(nora, '2026-11-23');
    const [first, second] = week.posts.filter((post) => post.kind !== 'poll');
    if (first === undefined || second === undefined) throw new Error('no post');
    const gesture = (id: string, body: object) =>
      server.inject({
        method: 'POST',
        url: `/v1/creators/${nora}/telegram-channel/posts/${id}`,
        headers,
        payload: body,
      });

    const validated = ChannelPlannedPostSchema.parse(
      (await gesture(first.id, { gesture: 'validate' })).json(),
    );
    expect(validated.locked).toBe(true);
    expect(validated.review?.byName).toBe('Charles');

    const edited = ChannelPlannedPostSchema.parse(
      (await gesture(second.id, { gesture: 'edit', text: 'Mon texte à moi' })).json(),
    );
    expect(edited.draft?.kind === 'post' && edited.draft.html).toContain('Mon texte à moi');

    expect((await gesture(second.id, { gesture: 'remove' })).statusCode).toBe(200);
    const after = await weekOf(nora, '2026-11-23');
    const replacement = after.posts.find((post) => post.replacesId === second.id);
    expect(replacement?.state).toBe('planned');
    expect(after.total).toBe(21);
  });

  it('never reaches a post of hers through another creator', async () => {
    const [post] = (await weekOf(nora, '2026-11-23')).posts;
    if (post === undefined) throw new Error('no post');
    const response = await server.inject({
      method: 'POST',
      url: `/v1/creators/${lea}/telegram-channel/posts/${post.id}`,
      headers,
      payload: { gesture: 'remove' },
    });
    expect(response.statusCode).toBe(404);
    const refused = await server.inject({
      method: 'GET',
      url: `/v1/creators/${nora}/telegram-channel/week?week=2026-11-23`,
      headers: { ...headers, 'x-test-role': 'creator' },
    });
    expect(refused.statusCode).toBe(403);
  });

  it('sends a due post once, with its visual and its link; a replay sends nothing more', async () => {
    const week = await weekOf(nora, '2026-11-23');
    // The one still planned: the gestures above may have removed the first and planned its replacement.
    const main = week.posts.find(
      (post) => post.kind === 'main' && post.day === '2026-11-23' && post.state === 'planned',
    );
    if (main === undefined) throw new Error('no main post');
    now = new Date(new Date(main.at).getTime() + 30_000);
    await module.jobs.channelSend();
    await module.jobs.channelSend();
    const published = telegram.published.filter((message) => message.chatId === '-2001');
    const videos = published.filter((message) => message.kind === 'video');
    expect(videos).toHaveLength(1);
    expect(videos[0]?.kind === 'video' && videos[0].html).toContain('https://example.test/r');
    const [row] = await test.admin.db
      .select()
      .from(schema.telegramChannelPosts)
      .where(eq(schema.telegramChannelPosts.id, main.id));
    expect(row?.state).toBe('sent');
  });

  it('never sends again a post whose answer was lost, and says so', async () => {
    const week = await weekOf(nora, '2026-11-23');
    const next = week.posts.find((post) => post.state === 'planned' && new Date(post.at) > now);
    if (next === undefined) throw new Error('no next post');
    now = new Date(new Date(next.at).getTime() + 30_000);
    telegram.failNext('publish', { kind: 'unreachable' });
    const before = telegram.published.length;
    await module.jobs.channelSend();
    await module.jobs.channelSend();
    expect(telegram.published.length).toBe(before);
    const after = (await weekOf(nora, '2026-11-23')).posts.find((post) => post.id === next.id);
    expect(after?.state).toBe('failed');
    expect(after?.reason).toContain('pas renvoyé');
  });

  it('sends nothing on a channel whose publishing is off, nor a post past its window', async () => {
    const before = telegram.published.length;
    await module.jobs.channelSend();
    expect(telegram.published.length).toBe(before);
    const lea_ = (await weekOf(lea, '2026-11-23')).posts.filter((post) => post.state === 'skipped');
    expect(lea_.length).toBeGreaterThan(0);
    expect(lea_.every((post) => post.reason?.includes('éteinte') === true)).toBe(true);
    // Wednesday at midnight in Paris, after an outage: her posts left behind are skipped, never sent in a burst.
    now = new Date('2026-11-25T23:00:00Z');
    await module.jobs.channelSend();
    expect(telegram.published.length).toBe(before);
    const late = (await weekOf(nora, '2026-11-23')).posts.filter(
      (post) => post.reason?.includes('dépassée') === true,
    );
    expect(late.length).toBeGreaterThan(0);
  });

  it('refuses a gesture once the hour has passed', async () => {
    const week = await weekOf(nora, '2026-11-23');
    const past = week.posts.find((post) => post.state === 'planned' && new Date(post.at) <= now);
    const sent = week.posts.find((post) => post.state === 'sent');
    const target = past ?? sent;
    if (target === undefined) throw new Error('no past post');
    const response = await server.inject({
      method: 'POST',
      url: `/v1/creators/${nora}/telegram-channel/posts/${target.id}`,
      headers,
      payload: { gesture: 'validate' },
    });
    expect(response.statusCode).toBe(400);
  });
});
