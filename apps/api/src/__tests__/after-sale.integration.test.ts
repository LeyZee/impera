import {
  CreatorIdSchema,
  DraftIdSchema,
  newId,
  PlatformAccountIdSchema,
  SalesLineIdSchema,
  UserIdSchema,
  type ConversationId,
  type CreatorId,
  type DraftId,
  type JobPayload,
  type PlatformAccountId,
  type SendResult,
} from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
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

const T0 = new Date('2026-10-17T12:00:00.000Z');
const PASS_GUARD = {
  forCreator: () => Promise.resolve({ check: () => ({ isBlocked: false, codes: [] }) }),
};
const NO_LOG = { info: () => undefined, warn: () => undefined };
const USER = UserIdSchema.parse('0199f2a0-0000-7000-8000-000000000003');
// FakeReveal's CRM names its fan by this member id (`fake-reveal/crm.ts`): the same id his messages carry.
const MEMBER_ID = 'member_test_01';

type ComposeInput = Parameters<DraftComposer['compose']>[0];
type ComposeResult = Awaited<ReturnType<DraftComposer['compose']>>;

class TestClock implements Clock {
  current = T0;
  now(): Date {
    return this.current;
  }
  advance(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1_000);
  }
}

class FakeSender implements OutboundSender {
  sendText(_conversation: unknown, _text: string, key: string): Promise<SendResult> {
    return Promise.resolve({
      messageRef: { platform: 'reveal', id: `out-${key}` },
      sentAt: T0.toISOString(),
    });
  }
  sendMedia(): Promise<SendResult> {
    return Promise.reject(new Error('not used'));
  }
  sendStep(): Promise<SendResult> {
    return Promise.reject(new Error('not used'));
  }
  verifySent(): Promise<{ status: 'not_found' }> {
    return Promise.resolve({ status: 'not_found' });
  }
}

class ScriptedComposer implements DraftComposer {
  readonly inputs: ComposeInput[] = [];
  next: ComposeResult = { kind: 'draft', bubbles: ['Merci toi 🥰'], softViolations: [], costUsd: 0 };

  compose(input: ComposeInput): Promise<ComposeResult> {
    this.inputs.push(input);
    return Promise.resolve(this.next);
  }
}

const JobRowSchema = z.object({ run_at: z.coerce.date(), payload: z.unknown() });

/** ADR 0156 § 2: a sale of his wakes his conversation for her word after it; the engine is scripted here. */
describe('conversation.after_sale', () => {
  let test: TestDb;
  let queue: JobQueue;
  let clock: TestClock;
  let composer: ScriptedComposer;
  let conversations: ConversationsModule;
  let creatorId: CreatorId;
  let platformAccountId: PlatformAccountId;
  let counter = 0;

  async function fanWrites(conversation: string, platformFanId: string): Promise<ConversationId> {
    counter += 1;
    const { conversationId } = await conversations.ingestMessage({
      creatorId,
      platformAccountId,
      platformConversationId: conversation,
      platformFanId,
      fanDisplayName: 'Théo',
      message: {
        ref: { platform: 'reveal', id: `as-${String(counter)}` },
        conversationRef: { platform: 'reveal', id: conversation },
        direction: 'inbound',
        text: 'Coucou',
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

  async function drafts(conversationId: ConversationId) {
    return test.admin.db
      .select({ id: schema.drafts.id, key: schema.drafts.idempotencyKey })
      .from(schema.drafts)
      .where(eq(schema.drafts.conversationId, conversationId))
      .orderBy(schema.drafts.createdAt);
  }

  /** The fan writes, she answers, the answer goes out: his conversation rests. */
  async function answered(conversation: string, platformFanId: string): Promise<ConversationId> {
    const conversationId = await fanWrites(conversation, platformFanId);
    clock.advance(60);
    await conversations.jobs.respond({ creatorId, conversationId, correlationId: 'test' }, NO_LOG);
    const [draft] = await drafts(conversationId);
    if (draft === undefined) throw new Error('no draft');
    const draftId: DraftId = DraftIdSchema.parse(draft.id);
    await conversations.approveDraft({
      creatorId,
      conversationId,
      userId: USER,
      correlationId: 'test',
      draftId,
    });
    await conversations.jobs.send({ creatorId, conversationId, draftId, correlationId: 'test' }, NO_LOG, 1);
    composer.inputs.length = 0;
    return conversationId;
  }

  function sale(
    platformFanId: string,
    saleType: 'ppv' | 'tip' = 'ppv',
  ): JobPayload<'conversation.after_sale'> {
    return {
      creatorId,
      platformAccountId,
      platformFanId,
      saleId: newId(SalesLineIdSchema),
      saleType,
      occurredAt: clock.now().toISOString(),
      correlationId: 'test',
    };
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
      .values({ id: platformAccountId, creatorId, platform: 'reveal', handle: 'after-sale' });
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
      adminDb: test.service.db,
      fans: createFansModule({ db: test.app.db, adminDb: test.service.db }),
      sender: new FakeSender(),
      requireRole: () => () => Promise.resolve(),
      recentLogin: () => Promise.resolve(),
      voice: { voicePrompt: 'voice@test', voiceModel: 'model-test' },
      guard: PASS_GUARD,
      composer,
      clock,
    });
  });

  it('finds his conversation by the member id the sale names and writes one word after it, never twice', async () => {
    const conversationId = await answered('as-bought', MEMBER_ID);
    clock.advance(600);
    const bought = sale(MEMBER_ID);
    await conversations.jobs.afterSale(bought, NO_LOG);
    expect(composer.inputs).toHaveLength(1);
    expect(composer.inputs[0]?.aftercare).toEqual({
      saleType: 'ppv',
      occurredAt: new Date(bought.occurredAt),
    });
    expect(composer.inputs[0]?.conversationId).toBe(conversationId);
    const written = await drafts(conversationId);
    expect(written.map((d) => d.key).at(-1)).toBe(`aftercare:${bought.saleId}`);

    // A replay of the same sale writes nothing more.
    await conversations.jobs.afterSale(bought, NO_LOG);
    expect(await drafts(conversationId)).toHaveLength(written.length);
  });

  it('wakes nothing for a fan nobody knows, and does not fail', async () => {
    await expect(conversations.jobs.afterSale(sale('member_nobody'), NO_LOG)).resolves.toBeUndefined();
    expect(composer.inputs).toHaveLength(0);
  });

  it('leaves him to her answer when he wrote since he paid', async () => {
    const conversationId = await answered('as-wrote', 'member_wrote');
    const paid = sale('member_wrote', 'tip');
    clock.advance(60);
    await fanWrites('as-wrote', 'member_wrote');
    const before = await drafts(conversationId);
    await conversations.jobs.afterSale(paid, NO_LOG);
    expect(composer.inputs).toHaveLength(0);
    expect(await drafts(conversationId)).toEqual(before);
  });

  it('puts her word off to the time the engine gives, in her night', async () => {
    const conversationId = await answered('as-night', 'member_night');
    const paid = sale('member_night');
    const retryAt = new Date(clock.now().getTime() + 8 * 3_600_000);
    composer.next = {
      kind: 'held',
      reason: 'no_reply',
      detail: ['follow_up_quiet_hours'],
      costUsd: 0,
      retryAt,
    };
    const before = await drafts(conversationId);
    await conversations.jobs.afterSale(paid, NO_LOG);
    expect(await drafts(conversationId)).toEqual(before);
    const jobs = await test.admin.db.execute(
      sql`select j.run_at, j.payload from graphile_worker._private_jobs j
          where j.key = ${`conversation.after_sale:${paid.saleId}`}`,
    );
    const [job] = z.array(JobRowSchema).parse(jobs.rows);
    expect(job?.run_at.toISOString()).toBe(retryAt.toISOString());
    expect(job?.payload).toEqual(paid);
  });
});
