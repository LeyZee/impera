import {
  CreatorIdSchema,
  newId,
  PlatformAccountIdSchema,
  type CreatorId,
  type OpenCustomOrder,
  type PlatformAccountId,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import type { DraftComposer } from '../modules/conversations';

import { testConfig } from './support/config';

type ComposeResult = Awaited<ReturnType<DraftComposer['compose']>>;

const NO_LOG = { info: () => undefined, warn: () => undefined };

/** His order after her first question: neutral, invented (ADR 0010). */
const ASKED: OpenCustomOrder = {
  state: 'gathering',
  format: 'video',
  supplements: [],
  minutes: null,
  details: { what: 'test' },
  questionsAsked: 1,
};

/** She asks one light question about his order: the turn the engine hands back. */
const QUESTION: ComposeResult = {
  kind: 'draft',
  bubbles: ['mmh raconte 🙈'],
  softViolations: [],
  costUsd: 0,
  customOrderTurn: {
    kind: 'reply',
    brief: 'Lui demander combien de temps.',
    guards: ['no_commitment', 'no_tip_request'],
    order: ASKED,
    event: { type: 'custom_order_gathering', asked: 'duration' },
  },
};

/**
 * The composition root hands the `custom-orders` store to the conversations' turn (ADR 0159 § A): his order, decided
 * by the turn, lands in `custom_orders` under her RLS, as the real app runs it.
 */
describe('custom orders wired into the agent turn', () => {
  let test: TestDb;
  let app: App;
  let creatorId: CreatorId;
  let platformAccountId: PlatformAccountId;
  const composer: DraftComposer = { compose: () => Promise.resolve(QUESTION) };

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
    app = await createApp(config, createLogger(config), { composer });
    creatorId = newId(CreatorIdSchema);
    platformAccountId = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: creatorId, displayName: 'Test', timezone: 'Europe/Paris' });
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: platformAccountId, creatorId, platform: 'reveal', handle: 'wiring' });
  });

  afterAll(async () => {
    await app.shutdown();
    await test.close();
  });

  it('keeps the order the turn decided, in the real store', async () => {
    const { conversationId } = await app.modules.conversations.ingestMessage({
      creatorId,
      platformAccountId,
      platformConversationId: 'c-wired',
      platformFanId: 'fan-wired',
      fanDisplayName: 'Julien',
      message: {
        ref: { platform: 'reveal', id: 'm-wired' },
        conversationRef: { platform: 'reveal', id: 'c-wired' },
        direction: 'inbound',
        text: 'Tu me ferais une vidéo rien que pour moi ?',
        media: [],
        priceMinor: null,
        currency: null,
        isPaid: false,
        createdAt: new Date(Date.UTC(2026, 10, 20, 20, 0, 0)).toISOString(),
      },
      correlationId: 'test',
    });
    await app.modules.conversations.jobs.respond(
      { creatorId, conversationId, correlationId: 'test' },
      NO_LOG,
    );

    const rows = await test.admin.db
      .select()
      .from(schema.customOrders)
      .where(eq(schema.customOrders.creatorId, creatorId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      state: 'gathering',
      format: 'video',
      questionsAsked: 1,
      lastInboundMessageId: 'm-wired',
    });
  });
});
