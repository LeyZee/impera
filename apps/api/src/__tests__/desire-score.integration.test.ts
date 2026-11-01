import {
  CreatorIdSchema,
  DraftIdSchema,
  newId,
  PlatformAccountIdSchema,
  UserIdSchema,
  type ConversationId,
  type CreatorId,
  type DesireSignal,
  type PlatformAccountId,
  type SendResult,
} from '@nirvana/contracts';
import { and, eq, schema } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createJobQueue, type JobQueue } from '../jobs';
import {
  createConversationsModule,
  type Clock,
  type ConversationsModule,
  type DraftComposer,
  type OutboundSender,
} from '../modules/conversations';
import { createFansModule } from '../modules/fans';

const T0 = new Date('2026-10-17T20:00:00.000Z');
const MINUTE_MS = 60_000;
const PASS_GUARD = {
  forCreator: () => Promise.resolve({ check: () => ({ isBlocked: false, codes: [] }) }),
};
const NO_LOG = { info: () => undefined, warn: () => undefined };
const USER = UserIdSchema.parse('0199f2a0-0000-7000-8000-000000000003');

type ComposeInput = Parameters<DraftComposer['compose']>[0];
type ComposeResult = Awaited<ReturnType<DraftComposer['compose']>>;

class TestClock implements Clock {
  current = T0;
  now(): Date {
    return this.current;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

class FakeSender implements OutboundSender {
  sendText(): Promise<SendResult> {
    return Promise.reject(new Error('not used'));
  }
  sendMedia(): Promise<SendResult> {
    return Promise.reject(new Error('not used'));
  }
  verifySent(): Promise<{ status: 'not_found' }> {
    return Promise.resolve({ status: 'not_found' });
  }
}

/** Answers what the test says, in order, records what it was asked, and runs `during` while it « thinks ». */
class ScriptedComposer implements DraftComposer {
  readonly inputs: ComposeInput[] = [];
  readonly results: ComposeResult[] = [];
  during: (() => Promise<unknown>) | null = null;

  async compose(input: ComposeInput): Promise<ComposeResult> {
    this.inputs.push(input);
    const next = this.results.shift();
    if (next === undefined) throw new Error('no scripted result');
    if (this.during !== null) await this.during();
    return next;
  }
}

const scored = (
  before: number | null,
  score: number,
  signals: readonly DesireSignal[] = ['intent:flirt'],
) => ({
  before,
  score,
  signals,
  weightsVersion: 'w1',
});

const draftWith = (desire?: ReturnType<typeof scored>): ComposeResult => ({
  kind: 'draft',
  bubbles: ['Coucou toi'],
  softViolations: [],
  costUsd: 0,
  ...(desire !== undefined && { desire }),
});

/** P3-12: the engine scores the fan's desire with each answer; the worker journals each change and projects it. */
describe('conversation.respond with a desire score', () => {
  let test: TestDb;
  let queue: JobQueue;
  let clock: TestClock;
  let composer: ScriptedComposer;
  let conversations: ConversationsModule;
  let creatorId: CreatorId;
  let platformAccountId: PlatformAccountId;
  let counter = 0;

  async function fanWrites(conversation: string, text = 'Tu fais quoi ce soir ?'): Promise<ConversationId> {
    counter += 1;
    const { conversationId } = await conversations.ingestMessage({
      creatorId,
      platformAccountId,
      platformConversationId: conversation,
      platformFanId: `fan-${conversation}`,
      fanDisplayName: 'Théo',
      message: {
        ref: { platform: 'reveal', id: `ds-${String(counter)}` },
        conversationRef: { platform: 'reveal', id: conversation },
        direction: 'inbound',
        text,
        media: [],
        priceMinor: null,
        currency: null,
        isPaid: false,
        createdAt: clock.now().toISOString(),
      },
      correlationId: 'test',
    });
    return conversationId;
  }

  async function scoredEvents(conversationId: ConversationId) {
    const rows = await test.admin.db
      .select({ type: schema.conversationEvents.type, payload: schema.conversationEvents.payload })
      .from(schema.conversationEvents)
      .where(eq(schema.conversationEvents.conversationId, conversationId))
      .orderBy(schema.conversationEvents.seq);
    return rows.filter((row) => row.type === 'desire_scored').map((row) => row.payload);
  }

  async function row(conversationId: ConversationId) {
    const [found] = await test.admin.db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId));
    if (found === undefined) throw new Error('no conversation');
    return found;
  }

  const respond = (conversationId: ConversationId) =>
    conversations.jobs.respond({ creatorId, conversationId, correlationId: 'test' }, NO_LOG);

  /** The operator rejects the draft, so that the conversation is at rest for his next message. */
  async function reject(conversationId: ConversationId) {
    const [pending] = await test.admin.db
      .select({ id: schema.drafts.id })
      .from(schema.drafts)
      .where(and(eq(schema.drafts.conversationId, conversationId), eq(schema.drafts.status, 'pending')));
    if (pending === undefined) throw new Error('no pending draft');
    await conversations.rejectDraft({
      creatorId,
      conversationId,
      draftId: DraftIdSchema.parse(pending.id),
      userId: USER,
      correlationId: 'test',
    });
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    queue = await createJobQueue(test.admin.pool);
    creatorId = newId(CreatorIdSchema);
    platformAccountId = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: creatorId, displayName: 'Nora Vidal', timezone: 'Europe/Paris' });
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: platformAccountId, creatorId, platform: 'reveal', handle: 'desire-score' });
  });

  afterAll(async () => {
    await queue.close();
    await test.close();
  });

  beforeEach(() => {
    clock = new TestClock();
    composer = new ScriptedComposer();
    conversations = createConversationsModule({
      db: test.app.db,
      fans: createFansModule({ db: test.app.db, adminDb: test.admin.db }),
      sender: new FakeSender(),
      requireRole: () => () => Promise.resolve(),
      recentLogin: () => Promise.resolve(),
      voice: { voicePrompt: 'voice@test', voiceModel: 'model-test' },
      guard: PASS_GUARD,
      composer,
      clock,
    });
  });

  it('journals each change with the answer, writes nothing when the score holds, and rebuilds it exactly', async () => {
    const conversationId = await fanWrites('ds-change');
    clock.advance(MINUTE_MS);
    composer.results.push(draftWith(scored(null, 45)));
    await respond(conversationId);
    const firstAt = clock.now();
    expect(composer.inputs[0]?.desire).toBeUndefined();
    expect(await row(conversationId)).toMatchObject({
      desireScore: 45,
      desireBand: 'playful',
      desireAt: firstAt,
    });

    // The score did not move from where it cooled: the engine gives none, and nothing is written, not even the time.
    await reject(conversationId);
    clock.advance(10 * MINUTE_MS);
    await fanWrites('ds-change', 'Et toi ?');
    clock.advance(MINUTE_MS);
    composer.results.push(draftWith());
    await respond(conversationId);
    expect(composer.inputs[1]?.desire).toEqual({ score: 45, at: firstAt });
    expect(await row(conversationId)).toMatchObject({ desireScore: 45, desireAt: firstAt });

    // A hold that hands him over carries its score too.
    await reject(conversationId);
    await fanWrites('ds-change', 'Montre-moi');
    clock.advance(MINUTE_MS);
    composer.results.push({
      kind: 'held',
      reason: 'handoff',
      detail: ['sale'],
      costUsd: 0,
      desire: scored(40, 72, ['intent:asks_for_media']),
    });
    await respond(conversationId);
    expect(await row(conversationId)).toMatchObject({
      state: 'human',
      desireScore: 72,
      desireBand: 'hot',
      desireAt: clock.now(),
    });
    expect(await scoredEvents(conversationId)).toEqual([
      { before: null, score: 45, signals: ['intent:flirt'], weightsVersion: 'w1' },
      { before: 40, score: 72, signals: ['intent:asks_for_media'], weightsVersion: 'w1' },
    ]);

    const live = await row(conversationId);
    const rebuilt = await conversations.rebuildProjection(creatorId, conversationId);
    expect(rebuilt).toMatchObject({
      desireScore: live.desireScore,
      desireBand: live.desireBand,
      desireAt: live.desireAt,
    });
  });

  it('writes no score with a result dropped because he wrote again', async () => {
    const conversationId = await fanWrites('ds-dropped');
    clock.advance(MINUTE_MS);
    composer.results.push(draftWith(scored(null, 60)));
    composer.during = () => fanWrites('ds-dropped', 'Allô ?');
    await respond(conversationId);
    expect(await scoredEvents(conversationId)).toEqual([]);
    expect((await row(conversationId)).desireScore).toBeNull();
  });

  it('keeps at most twenty signals when the engine sends more', async () => {
    const conversationId = await fanWrites('ds-bounds');
    clock.advance(MINUTE_MS);
    composer.results.push({
      ...draftWith(),
      desire: scored(
        null,
        10,
        Array.from({ length: 25 }, () => 'suggestive_emoji'),
      ),
    });
    await respond(conversationId);
    const [event] = await scoredEvents(conversationId);
    const { signals } = z.object({ signals: z.array(z.string()) }).parse(event);
    expect(signals).toHaveLength(20);
  });
});
