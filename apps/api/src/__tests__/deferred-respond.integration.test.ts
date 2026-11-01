import {
  CreatorIdSchema,
  newId,
  PlatformAccountIdSchema,
  UserIdSchema,
  type ConversationId,
  type CreatorId,
  type PlatformAccountId,
  type SendResult,
} from '@nirvana/contracts';
import { eq, schema, sql } from '@nirvana/db';
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

/** Answers what the test says, in order, and records what it was asked. */
class ScriptedComposer implements DraftComposer {
  readonly inputs: ComposeInput[] = [];
  readonly results: ComposeResult[] = [];

  compose(input: ComposeInput): Promise<ComposeResult> {
    this.inputs.push(input);
    const next = this.results.shift();
    if (next === undefined) throw new Error('no scripted result');
    return Promise.resolve(next);
  }
}

const RespondJobSchema = z.object({
  run_at: z.coerce.date(),
  queue_name: z.string().nullable(),
  payload: z.object({
    creatorId: CreatorIdSchema,
    conversationId: z.string(),
    correlationId: z.string(),
    waitedFor: z.string().exactOptional(),
  }),
});

const waitFor = (at: Date, minutes: number): ComposeResult => ({
  kind: 'held',
  reason: 'no_reply',
  detail: ['wait'],
  costUsd: 0,
  retryAt: new Date(at.getTime() + minutes * MINUTE_MS),
});

const draft: ComposeResult = { kind: 'draft', bubbles: ['Tu es revenu ?'], softViolations: [], costUsd: 0 };

/** P3-11: « attends, je reviens » — her answer tried once more, then a human; the engine is scripted here. */
describe('conversation.respond after a wait', () => {
  let test: TestDb;
  let queue: JobQueue;
  let clock: TestClock;
  let composer: ScriptedComposer;
  let conversations: ConversationsModule;
  let creatorId: CreatorId;
  let platformAccountId: PlatformAccountId;
  let counter = 0;

  async function fanWrites(conversation: string, text = 'Attends, je reviens'): Promise<ConversationId> {
    counter += 1;
    const { conversationId } = await conversations.ingestMessage({
      creatorId,
      platformAccountId,
      platformConversationId: conversation,
      platformFanId: `fan-${conversation}`,
      fanDisplayName: 'Basile',
      message: {
        ref: { platform: 'reveal', id: `dr-${String(counter)}` },
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

  async function respondJobs(conversationId: ConversationId) {
    const result = await test.admin.db.execute(
      sql`select j.run_at, q.queue_name, j.payload from graphile_worker._private_jobs j
          left join graphile_worker._private_job_queues q on q.id = j.job_queue_id
          where j.key = ${`conversation.respond:${conversationId}`}`,
    );
    return z.array(RespondJobSchema).parse(result.rows);
  }

  async function events(conversationId: ConversationId) {
    return test.admin.db
      .select({ type: schema.conversationEvents.type, payload: schema.conversationEvents.payload })
      .from(schema.conversationEvents)
      .where(eq(schema.conversationEvents.conversationId, conversationId))
      .orderBy(schema.conversationEvents.seq);
  }

  async function row(conversationId: ConversationId) {
    const [found] = await test.admin.db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId));
    if (found === undefined) throw new Error('no conversation');
    return found;
  }

  async function drafts(conversationId: ConversationId) {
    return test.admin.db
      .select({ id: schema.drafts.id })
      .from(schema.drafts)
      .where(eq(schema.drafts.conversationId, conversationId));
  }

  /** The fan writes « attends, je reviens » and she chooses to wait: the second pass is queued. */
  async function waited(conversation: string, minutes = 20) {
    const conversationId = await fanWrites(conversation);
    clock.advance(MINUTE_MS);
    composer.results.push(waitFor(clock.now(), minutes));
    await conversations.jobs.respond({ creatorId, conversationId, correlationId: 'test' }, NO_LOG);
    const [job] = await respondJobs(conversationId);
    if (job === undefined) throw new Error('no respond job');
    return { conversationId, job };
  }

  const secondPass = (job: z.infer<typeof RespondJobSchema>, conversationId: ConversationId) =>
    conversations.jobs.respond({ ...job.payload, conversationId }, NO_LOG);

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
      .values({ id: platformAccountId, creatorId, platform: 'reveal', handle: 'deferred-respond' });
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

  it('tries her answer once more at the time the engine gave, on the same key, for his message', async () => {
    const { conversationId, job } = await waited('dr-wait');
    const conversation = await row(conversationId);
    expect(conversation.state).toBe('idle');
    expect(await respondJobs(conversationId)).toHaveLength(1);
    expect(job.queue_name).toBe(`conv:${conversationId}`);
    expect(job.run_at.toISOString()).toBe(new Date(clock.now().getTime() + 20 * MINUTE_MS).toISOString());
    expect(job.payload.waitedFor).toBe(conversation.lastInboundAt?.toISOString());
    const skipped = (await events(conversationId)).at(-1);
    expect(skipped?.type).toBe('reply_skipped');
    expect(skipped?.payload).toMatchObject({ reason: 'no_reply', retryAt: job.run_at.toISOString() });
  });

  it('tells the engine she already waited, and writes its « tu es revenu ? » as a draft to approve', async () => {
    const { conversationId, job } = await waited('dr-back');
    clock.advance(20 * MINUTE_MS);
    composer.results.push(draft);
    await secondPass(job, conversationId);
    expect(composer.inputs.map((input) => input.waited)).toEqual([undefined, 1]);
    expect((await row(conversationId)).state).toBe('awaiting_approval');
    expect(await drafts(conversationId)).toHaveLength(1);
    // Replayed after a crash: the conversation is past rest, nothing more is written.
    composer.results.push(draft);
    await secondPass(job, conversationId);
    expect(await drafts(conversationId)).toHaveLength(1);
  });

  it('hands him to a human when the second pass writes nothing, a second wait included', async () => {
    const { conversationId, job } = await waited('dr-handoff');
    clock.advance(20 * MINUTE_MS);
    composer.results.push(waitFor(clock.now(), 20));
    await secondPass(job, conversationId);
    expect((await row(conversationId)).state).toBe('human');
    const handoff = (await events(conversationId)).at(-1);
    expect(handoff?.type).toBe('handoff_requested');
    expect(handoff?.payload).toMatchObject({ cause: 'other' });
    const said = z.object({ reason: z.string(), detail: z.array(z.string()) }).parse(handoff?.payload);
    expect(said.reason).toBe('après l’attente, l’agent n’avait plus rien à lui écrire');
    expect(said.detail[0]).toBe('waited_no_reply');
    // Never a third pass: the only respond job left is the one that just ran.
    expect(
      (await respondJobs(conversationId)).every((j) => j.payload.waitedFor === job.payload.waitedFor),
    ).toBe(true);
  });

  it('answers his new message instead when he writes during the wait', async () => {
    const { conversationId, job } = await waited('dr-wrote');
    clock.advance(5 * MINUTE_MS);
    await fanWrites('dr-wrote', 'Me revoilà');
    const [replaced] = await respondJobs(conversationId);
    expect(replaced?.payload.waitedFor).toBeUndefined();
    // The old second pass, had it already started, finds his message moved and does nothing.
    await secondPass(job, conversationId);
    expect(composer.inputs).toHaveLength(1);
    expect((await row(conversationId)).state).toBe('pending');
  });

  it('does nothing after the wait when a human took the conversation meanwhile', async () => {
    const { conversationId, job } = await waited('dr-human');
    await conversations.takeover({ creatorId, conversationId, userId: USER, correlationId: 'test' });
    clock.advance(20 * MINUTE_MS);
    await secondPass(job, conversationId);
    expect(composer.inputs).toHaveLength(1);
    expect((await row(conversationId)).state).toBe('human');
  });

  it('keeps a plain skip when the engine asks for a time out of bounds', async () => {
    for (const [conversation, minutes] of [
      ['dr-soon', 2],
      ['dr-late', 45],
    ] as const) {
      const { conversationId, job } = await waited(conversation, minutes);
      expect(job.payload.waitedFor).toBeUndefined();
      const skipped = (await events(conversationId)).at(-1);
      expect(skipped?.type).toBe('reply_skipped');
      expect(skipped?.payload).not.toHaveProperty('retryAt');
    }
  });
});
