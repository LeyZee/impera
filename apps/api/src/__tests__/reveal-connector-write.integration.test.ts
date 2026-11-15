import { randomBytes } from 'node:crypto';

import {
  ConversationIdSchema,
  CreatorIdSchema,
  FanIdSchema,
  newId,
  PlatformAccountIdSchema,
  type CreatorId,
  type PlatformAccountId,
} from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { revealApiConnectors, type RevealFetch } from '../modules/connectors';

import { createFakeReveal, type FakeReveal } from './fake-reveal/server';
import { fixedComposer } from './support/composer';
import { testConfig } from './support/config';
import { LogSink } from './support/log-sink';

const SESSION_KEYS = `v1:${randomBytes(32).toString('base64')}`;
const eur = (amountMinor: number) => ({ amountMinor, currency: 'EUR' as const });

/**
 * P2-03: Reveal's writes through the `connectors` module, its write guard and the real `connector_sends` table, on
 * FakeReveal's `quiet` world (two invented fans, nothing said yet). The connector reads FakeReveal's clock.
 */
describe('Reveal connector: writes on FakeReveal (P2-03)', () => {
  let test: TestDb;
  let app: App;
  let fake: FakeReveal;
  let creatorId: CreatorId;
  let accountId: PlatformAccountId;
  let logger: ReturnType<typeof createLogger>;
  /** Every send that reached FakeReveal. */
  const posts: string[] = [];

  const conversation = () => ({
    id: newId(ConversationIdSchema),
    creatorId,
    platformAccountId: accountId,
    fanId: newId(FanIdSchema),
    platformConversationId: 'conv_01',
  });

  async function sends() {
    const result = await test.admin.db.execute(
      sql`select idempotency_key, state, platform_message_id, fingerprint from connector_sends
           where platform_account_id = ${accountId} order by created_at`,
    );
    return z
      .array(
        z.object({
          idempotency_key: z.string(),
          state: z.string(),
          platform_message_id: z.string().nullable(),
          fingerprint: z.string(),
        }),
      )
      .parse(result.rows);
  }

  async function scenario(events: object[]): Promise<void> {
    const response = await fake.app.inject({ method: 'POST', url: '/__scenario', payload: { events } });
    expect(response.statusCode).toBe(200);
  }

  async function allowWrites(writes: boolean): Promise<void> {
    await test.admin.db
      .update(schema.platformAccounts)
      .set({ connectorConfig: { writes } })
      .where(eq(schema.platformAccounts.id, accountId));
  }

  beforeAll(async () => {
    fake = createFakeReveal({ fixture: 'quiet' });
    const fetch: RevealFetch = (url, init) => {
      if (init.method === 'POST' && new URL(url).pathname.endsWith('/messages')) posts.push(url);
      return fake.fetch(url, init);
    };
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_SERVICE_URL: test.serviceUrl,
      SESSION_ENCRYPTION_KEYS: SESSION_KEYS,
    });
    logger = createLogger(config, new LogSink());
    app = await createApp(config, logger, {
      composer: fixedComposer,
      connectorsClock: () => fake.now(),
      connectorRegistry: {
        reveal: revealApiConnectors({ fetch, baseUrl: 'https://reveal.test', now: () => fake.now() }),
      },
    });
    creatorId = newId(CreatorIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: creatorId, displayName: 'Test', timezone: 'Europe/Paris' });
    accountId = newId(PlatformAccountIdSchema);
    await test.admin.db.insert(schema.platformAccounts).values({
      id: accountId,
      creatorId,
      platform: 'reveal',
      handle: 'creatrice_test',
      sessionState: 'none',
    });
    await app.modules.connectors.sessions.store({
      platformAccountId: accountId,
      session: JSON.stringify({
        v: 1,
        bearer: fake.authorization.slice('Bearer '.length),
        userId: fake.userId,
        modelId: fake.modelId,
        userAgent: 'Mozilla/5.0 (test)',
        capturedAt: '2026-10-01T00:00:00.000Z',
      }),
      correlationId: 'test',
      userId: null,
    });
  });

  afterAll(async () => {
    await app.shutdown();
    await test.close();
    await fake.app.close();
  });

  it('with the write guard off (the default), nothing is recorded and nothing reaches Reveal', async () => {
    const { outboundSender, writes } = app.modules.connectors;
    const refusals = await Promise.all([
      outboundSender.sendText(conversation(), 'Coucou', 'off-1').catch((error: unknown) => error),
      writes
        .sendScriptStep(conversation(), { platform: 'reveal', id: 'sequence_1' }, 0, eur(500), 'off-2')
        .catch((error: unknown) => error),
      writes
        .setFanNote(conversation(), 'fan_01', 'Prénom : Prénom01', 'off-3')
        .catch((error: unknown) => error),
    ]);
    expect(refusals.map((error) => (error instanceof Error ? error.message : error))).toEqual([
      'Envoi désactivé pour ce compte (garde d’écriture)',
      'Envoi désactivé pour ce compte (garde d’écriture)',
      'Envoi désactivé pour ce compte (garde d’écriture)',
    ]);
    expect(await sends()).toEqual([]);
    expect(posts).toEqual([]);
  });

  it('records each send before Reveal is called, and a lost answer is found again instead of sent twice', async () => {
    await allowWrites(true);
    const { outboundSender } = app.modules.connectors;
    const sent = await outboundSender.sendText(conversation(), 'Coucou toi', 'send-1');
    expect(await sends()).toEqual([
      expect.objectContaining({
        idempotency_key: 'send-1',
        state: 'sent',
        platform_message_id: sent.messageRef.id,
      }),
    ]);

    await scenario([{ type: 'send_answer_lost', times: 1 }]);
    const lost: unknown = await outboundSender
      .sendText(conversation(), 'Tu es là ?', 'send-2')
      .catch((error: unknown) => error);
    expect(lost).toMatchObject({ code: 'connector_transient' });
    expect((await sends())[1]).toMatchObject({ idempotency_key: 'send-2', state: 'pending' });
    const before = posts.length;
    expect(await outboundSender.verifySent(conversation(), 'send-2', null)).toMatchObject({ status: 'sent' });
    const retried = await outboundSender.sendText(conversation(), 'Tu es là ?', 'send-2');
    expect(posts.length).toBe(before);
    expect((await sends())[1]).toMatchObject({ state: 'sent', platform_message_id: retried.messageRef.id });
    expect(fake.state().messages.filter((m) => m.content === 'Tu es là ?')).toHaveLength(1);
  });

  it('a script step sent by the connector is ingested as ours, a chatter’s message as a human’s', async () => {
    await scenario([{ type: 'fan_message', conversationId: 'conv_01', text: 'Salut' }]);
    const step = await app.modules.connectors.writes.sendScriptStep(
      conversation(),
      { platform: 'reveal', id: 'sequence_2' },
      0,
      eur(500),
      'step-1',
    );
    await fake.app.inject({
      method: 'POST',
      url: '/conversations/conv_01/messages',
      headers: { authorization: fake.authorization },
      payload: { message: { content: 'Message du chatteur', isUnread: true }, mediaIds: [], files: [] },
    });
    await app.modules.connectors.jobs.poll(
      { creatorId, platformAccountId: accountId, correlationId: 'test' },
      logger,
    );
    const rows = await test.admin.db
      .select({ id: schema.messages.platformMessageId, author: schema.messages.author })
      .from(schema.messages)
      .where(eq(schema.messages.platformAccountId, accountId));
    const authors = new Map(rows.map((row) => [row.id, row.author]));
    expect(authors.get(step.messageRef.id)).toBe('ai');
    const chatter = fake.state().messages.find((m) => m.content === 'Message du chatteur');
    expect(authors.get(chatter?.id ?? '')).toBe('human');
  });

  it('a step whose price changed on Reveal since it was validated: refused, nothing recorded, nothing sent', async () => {
    await allowWrites(true);
    await scenario([{ type: 'script_changed', scriptId: 'script_4_1', priceCents: 700 }]);
    const before = posts.length;
    const refused: unknown = await app.modules.connectors.writes
      .sendScriptStep(conversation(), { platform: 'reveal', id: 'sequence_4' }, 0, eur(500), 'price-1')
      .catch((error: unknown) => error);
    expect(refused).toMatchObject({ code: 'script_price_changed' });
    expect(posts.length).toBe(before);
    expect((await sends()).map((send) => send.idempotency_key)).not.toContain('price-1');
    const sent = await app.modules.connectors.writes.sendScriptStep(
      conversation(),
      { platform: 'reveal', id: 'sequence_4' },
      0,
      eur(700),
      'price-2',
    );
    expect(fake.state().messages.find((m) => m.id === sent.messageRef.id)?.bundle?.priceCents).toBe(700);
  });
});
