import { randomBytes } from 'node:crypto';

import {
  CreatorIdSchema,
  DomainError,
  DraftIdSchema,
  PersonaVersionIdSchema,
  newId,
  PlatformAccountIdSchema,
  UserIdSchema,
  type ConversationId,
  type CreatorId,
  type DraftId,
  type PlatformAccountId,
  type SendResult,
  type TelegramChatId,
} from '@nirvana/contracts';
import { eq, parseEncryptionKeys, schema, sql } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { createJobQueue, type JobQueue } from '../jobs';
import {
  createConversationsModule,
  type ConversationsModule,
  type DraftComposer,
  type OutboundSender,
} from '../modules/conversations';
import { createFansModule } from '../modules/fans';
import { createTelegramModule, type TelegramModule } from '../modules/telegram';
import { FAKE_TOKEN, FakeTelegram, joined } from '../modules/telegram/__tests__/support/fake-telegram';
import { createPostgresTelegramStore } from '../modules/telegram/infra/postgres.store';

const PASS_GUARD = {
  forCreator: () => Promise.resolve({ check: () => ({ isBlocked: false, codes: [] }) }),
};
const NO_LOG = { info: () => undefined, warn: () => undefined };
const USER = UserIdSchema.parse('0199f2a0-0000-7000-8000-0000000000e2');
const VOICE = { voicePrompt: 'voice@e2e', voiceModel: 'model-e2e' };

/** Fails every send with a timeout: the third attempt is the last. */
class FailingSender implements OutboundSender {
  sendText(): Promise<SendResult> {
    return Promise.reject(new DomainError('connector_timeout', 'timeout'));
  }
  sendMedia(): Promise<SendResult> {
    return Promise.reject(new Error('not used'));
  }
  verifySent(): Promise<{ status: 'not_found' }> {
    return Promise.resolve({ status: 'not_found' });
  }
}

/** A model that never answers: the engine hands the conversation to the humans. */
const DOWN_COMPOSER: DraftComposer = {
  compose: () => Promise.reject(new Error('model down')),
};

/**
 * From a conversation to a Telegram group (ADR 0020, recette R-G4 and R-G5): the real `conversations` module writes
 * the outbox, the trigger enqueues the scan, the real `telegram` module turns the events into messages. Only Telegram
 * itself is played by FakeTelegram, and the platform by a sender that always fails.
 */
describe('Telegram alerts from the conversations module', () => {
  let test: TestDb;
  let queue: JobQueue;
  let creatorId: CreatorId;
  let platformAccountId: PlatformAccountId;
  let conversations: ConversationsModule;
  let handingOver: ConversationsModule;
  let telegram: FakeTelegram;
  let module: TelegramModule;
  let chatId: TelegramChatId;
  let offsetMs = 0;
  let counter = 0;
  let sentBefore = 0;
  let editsBefore = 0;
  const clock = { now: () => new Date(Date.now() + offsetMs) };

  const command = (conversationId: ConversationId) => ({
    creatorId,
    conversationId,
    userId: USER,
    correlationId: 'e2e',
  });

  async function ingest(): Promise<ConversationId> {
    counter += 1;
    const conversation = `c-e2e-${String(counter)}`;
    const { conversationId } = await conversations.ingestMessage({
      creatorId,
      platformAccountId,
      platformConversationId: conversation,
      platformFanId: `fan-${conversation}`,
      fanDisplayName: 'Julien',
      message: {
        ref: { platform: 'reveal', id: `m-${String(counter)}` },
        conversationRef: { platform: 'reveal', id: conversation },
        direction: 'inbound',
        text: 'texte du fan qui ne sort jamais',
        media: [],
        priceMinor: null,
        currency: null,
        isPaid: false,
        createdAt: new Date().toISOString(),
      },
      correlationId: 'e2e',
    });
    return conversationId;
  }

  async function lastDraft(conversationId: ConversationId): Promise<DraftId> {
    const [draft] = await test.admin.db
      .select()
      .from(schema.drafts)
      .where(eq(schema.drafts.conversationId, conversationId))
      .orderBy(sql`${schema.drafts.createdAt} desc`)
      .limit(1);
    if (draft === undefined) throw new Error('no draft');
    return DraftIdSchema.parse(draft.id);
  }

  /** What the worker does on its own: one scan, then the group's flushes, each once the group's pace allows. */
  async function deliver(): Promise<void> {
    await module.jobs.scan();
    for (let i = 0; i < 3; i += 1) {
      offsetMs += 10_000;
      await module.jobs.flushChat(chatId);
    }
  }

  const texts = () => telegram.sent.slice(sentBefore).map((message) => message.text);
  const edits = () => telegram.edits.slice(editsBefore).map((edit) => edit.text);

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    queue = await createJobQueue(test.admin.pool);
    creatorId = newId(CreatorIdSchema);
    platformAccountId = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: creatorId, displayName: 'Démo', timezone: 'Europe/Paris' });
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: platformAccountId, creatorId, platform: 'reveal', handle: 'test' });
    await test.admin.db
      .insert(schema.user)
      .values({ id: USER, name: 'Nora Vidal', email: 'nora@example.test' })
      .onConflictDoNothing();

    // One group for the whole file, as in production: the scan re-reads a window behind its cursor, and a new
    // group would get the earlier tests' alerts again.
    telegram = new FakeTelegram();
    const store = createPostgresTelegramStore({
      adminDb: test.admin.db,
      keys: parseEncryptionKeys(`v1:${randomBytes(32).toString('base64')}`),
    });
    module = createTelegramModule({
      bots: store.bots,
      deliveries: store.deliveries,
      channel: telegram,
      clock,
      webOrigin: 'https://crm.example.test',
      onUncovered: () => undefined,
      resealTokens: store.resealTokens,
    });
    telegram.addBot(FAKE_TOKEN, 'demo_bot');
    const added = await module.addBot(FAKE_TOKEN);
    if (!added.ok) throw new Error(added.error.message);
    telegram.updates.push(joined(1, '-100', 'Groupe démo'));
    await module.jobs.pollUpdates(added.value.id, 0);
    const { bots, routes, version } = await module.overview();
    const chat = bots[0]?.chats[0];
    if (chat === undefined) throw new Error('group not found');
    chatId = chat.id;
    const saved = await module.saveRoutes(version, [
      ...routes,
      ...(['urgent', 'important', 'info'] as const).map((topic) => ({ creatorId: null, topic, chatId })),
    ]);
    if (!saved.ok) throw new Error('routes not saved');
  });

  afterAll(async () => {
    await queue.close();
    await test.close();
  });

  beforeEach(() => {
    const fans = createFansModule({ db: test.app.db, adminDb: test.admin.db });
    const deps = {
      db: test.app.db,
      fans,
      sender: new FailingSender(),
      requireRole: () => () => Promise.resolve(),
      recentLogin: () => Promise.resolve(),
      voice: VOICE,
      guard: PASS_GUARD,
    };
    conversations = createConversationsModule(deps);
    handingOver = createConversationsModule({ ...deps, composer: DOWN_COMPOSER });

    sentBefore = telegram.sent.length;
    editsBefore = telegram.edits.length;
  });

  it('opens an alert on a handoff and closes it when a chatter takes the conversation', async () => {
    const conversationId = await ingest();
    await handingOver.jobs.respond({ creatorId, conversationId, correlationId: 'e2e' }, NO_LOG);
    await deliver();
    expect(texts()).toHaveLength(1);
    expect(texts()[0]).toContain('Le modèle ne répond plus');

    // Already the humans' after the handoff: taking it used to answer 409 (R-G4).
    await conversations.takeover({ ...command(conversationId), reason: 'Je prends' });
    await deliver();
    expect(edits()).toHaveLength(1);
    expect(edits()[0]).toMatch(/✓ Pris en main par Nora$/);
    expect(JSON.stringify(texts())).not.toContain('texte du fan');
  });

  it('closes the handoff alert when the conversation is given back to the agent', async () => {
    const conversationId = await ingest();
    await handingOver.jobs.respond({ creatorId, conversationId, correlationId: 'e2e' }, NO_LOG);
    await deliver();
    await conversations.release(command(conversationId));
    await deliver();
    expect(edits()).toHaveLength(1);
    expect(edits()[0]).toMatch(/✓ Rendu à l’agent par Nora$/);
  });

  it('tells the group once when a message of the agent cannot leave, without the platform’s words', async () => {
    const conversationId = await ingest();
    await conversations.jobs.respond({ creatorId, conversationId, correlationId: 'e2e' }, NO_LOG);
    const draftId = await lastDraft(conversationId);
    await conversations.approveDraft({ ...command(conversationId), draftId, bubbles: ['Coucou'] });
    const payload = { creatorId, conversationId, draftId, correlationId: 'e2e' };
    for (const attempt of [1, 2]) {
      await expect(conversations.jobs.send(payload, NO_LOG, attempt)).rejects.toThrow();
    }
    await conversations.jobs.send(payload, NO_LOG, 3);
    await deliver();
    expect(texts()).toHaveLength(1);
    expect(texts()[0]).toContain('Un message de l’agent n’a pas pu partir');
    expect(texts()[0]).not.toContain('connector_timeout');
    expect(texts()[0]).not.toContain('Coucou');

    await conversations.release(command(conversationId));
    await deliver();
    expect(edits()[0]).toMatch(/✓ Rendu à l’agent par Nora$/);
  });

  it('tells the group once when Automatique closes on its own, without the voice', async () => {
    const conversationId = await ingest();
    // Automatique opens only with an active persona version, proved by her drafts (recette 28/10, G4).
    const personaVersionId = newId(PersonaVersionIdSchema);
    await test.admin.db.insert(schema.personaVersions).values({
      id: personaVersionId,
      creatorId,
      version: 'e2e',
      sourcePath: 'personas/example.yaml',
      content: {},
      contentHash: 'e2e',
      isActive: true,
      activatedAt: new Date(),
    });
    const decided = (count: number, status: 'sent' | 'rejected', offset: number) =>
      test.admin.db.insert(schema.drafts).values(
        Array.from({ length: count }, (_, i) => ({
          id: newId(DraftIdSchema),
          creatorId,
          conversationId,
          status,
          promptHashes: VOICE,
          personaVersionId,
          decidedAt: new Date(Date.now() - (offset + i + 1) * 1_000),
          idempotencyKey: `e2e:${status}:${String(offset + i)}`,
        })),
      );
    await decided(110, 'sent', 0);
    await conversations.recordBlindTest({ creatorId, userId: USER, rate: 90, correlationId: 'e2e' });
    await conversations.setMode({ ...command(conversationId), mode: 'auto' });
    // 50 rejected among the last 160: the live rate falls under 80 %, the next answer closes Automatique.
    await test.admin.db
      .update(schema.drafts)
      .set({ decidedAt: new Date(Date.now() - 200_000) })
      .where(eq(schema.drafts.conversationId, conversationId));
    await decided(50, 'rejected', -150);
    await conversations.jobs.respond({ creatorId, conversationId, correlationId: 'e2e' }, NO_LOG);
    await deliver();
    expect(texts()).toHaveLength(1);
    expect(texts()[0]).toContain('Automatique refermé');
    expect(texts()[0]).toContain('objectif : 80 %');
    expect(texts()[0]).not.toContain('voice@e2e');
    expect(texts()[0]).not.toContain('model-e2e');
  });
});
