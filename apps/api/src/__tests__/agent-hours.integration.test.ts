import {
  CreatorIdSchema,
  DEFAULT_AGENT_HOURS,
  RESUME_SPACING_SECONDS,
  SUGGESTED_REPLY_SLOTS,
  type AgentHours,
  newId,
  PlatformAccountIdSchema,
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

// Sunday 18 October 2026, 3:00 in Paris (UTC+2): out of her 9:00 – 1:00 slots, which open again at 9:00.
const T0 = new Date('2026-10-18T01:00:00.000Z');
const OPENING = new Date('2026-10-18T07:00:00.000Z');
const MINUTE_MS = 60_000;
const PASS_GUARD = {
  forCreator: () => Promise.resolve({ check: () => ({ isBlocked: false, codes: [] }) }),
};
const NO_LOG = { info: () => undefined, warn: () => undefined };

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

const JobSchema = z.object({
  run_at: z.coerce.date(),
  queue_name: z.string().nullable(),
  payload: z.object({
    creatorId: CreatorIdSchema,
    conversationId: z.string().exactOptional(),
    correlationId: z.string(),
    waitedFor: z.string().exactOptional(),
  }),
});

const PARIS = 'Europe/Paris';
const SLOTS: AgentHours = {
  ...DEFAULT_AGENT_HOURS,
  reply: { mode: 'slots', slots: [...SUGGESTED_REPLY_SLOTS] },
};
const draft: ComposeResult = { kind: 'draft', bubbles: ['Coucou toi'], softViolations: [], costUsd: 0 };

/** P3-14: out of her reply slots she writes nothing, and her next opening answers the fans who wrote. */
describe('conversation.respond and her hours', () => {
  let test: TestDb;
  let queue: JobQueue;
  let clock: TestClock;
  let composer: ScriptedComposer;
  let creatorId: CreatorId;
  let platformAccountId: PlatformAccountId;
  let counter = 0;

  function moduleWith(options: { hours?: AgentHours }): ConversationsModule {
    const { hours } = options;
    return createConversationsModule({
      db: test.app.db,
      fans: createFansModule({ db: test.app.db, adminDb: test.admin.db }),
      sender: new FakeSender(),
      requireRole: () => () => Promise.resolve(),
      recentLogin: () => Promise.resolve(),
      voice: { voicePrompt: 'voice@test', voiceModel: 'model-test' },
      guard: PASS_GUARD,
      composer,
      clock,
      ...(hours !== undefined && {
        replyHours: { of: () => Promise.resolve({ hours, timeZone: PARIS }) },
      }),
    });
  }

  async function fanWrites(
    conversations: ConversationsModule,
    conversation: string,
  ): Promise<ConversationId> {
    counter += 1;
    const { conversationId } = await conversations.ingestMessage({
      creatorId,
      platformAccountId,
      platformConversationId: conversation,
      platformFanId: `fan-${conversation}`,
      fanDisplayName: 'Théo',
      message: {
        ref: { platform: 'reveal', id: `ah-${String(counter)}` },
        conversationRef: { platform: 'reveal', id: conversation },
        direction: 'inbound',
        text: 'Tu dors ?',
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

  async function jobs(key: string) {
    const result = await test.admin.db.execute(
      sql`select j.run_at, q.queue_name, j.payload from graphile_worker._private_jobs j
          left join graphile_worker._private_job_queues q on q.id = j.job_queue_id
          where j.key = ${key}`,
    );
    return z.array(JobSchema).parse(result.rows);
  }

  async function events(conversationId: ConversationId) {
    return test.admin.db
      .select({ type: schema.conversationEvents.type, payload: schema.conversationEvents.payload })
      .from(schema.conversationEvents)
      .where(eq(schema.conversationEvents.conversationId, conversationId))
      .orderBy(schema.conversationEvents.seq);
  }

  async function stateOf(conversationId: ConversationId) {
    const [found] = await test.admin.db
      .select({ state: schema.conversations.state })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId));
    return found?.state;
  }

  async function drafts(conversationId: ConversationId) {
    return test.admin.db
      .select({ id: schema.drafts.id })
      .from(schema.drafts)
      .where(eq(schema.drafts.conversationId, conversationId));
  }

  const respond = (conversations: ConversationsModule, conversationId: ConversationId) =>
    conversations.jobs.respond({ creatorId, conversationId, correlationId: 'test' }, NO_LOG);

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    queue = await createJobQueue(test.admin.pool);
  });

  afterAll(async () => {
    await queue.close();
    await test.close();
  });

  // A creator per test: her pending conversations and her opening job are hers alone.
  beforeEach(async () => {
    clock = new TestClock();
    composer = new ScriptedComposer();
    creatorId = newId(CreatorIdSchema);
    platformAccountId = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: creatorId, displayName: 'Nora Vidal', timezone: PARIS });
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: platformAccountId, creatorId, platform: 'reveal', handle: `hours-${creatorId}` });
  });

  it('writes nothing at 3:00, and answers at 9:00 the fan who waited longest first', async () => {
    const conversations = moduleWith({ hours: SLOTS });
    const first = await fanWrites(conversations, 'ah-first');
    clock.advance(MINUTE_MS);
    const second = await fanWrites(conversations, 'ah-second');
    clock.advance(MINUTE_MS);
    await respond(conversations, second);
    await respond(conversations, first);
    // The worker deletes a job once it ran: their debounce jobs are gone by the opening.
    await test.admin.db.execute(
      sql`delete from graphile_worker._private_jobs where key in (${`conversation.respond:${first}`}, ${`conversation.respond:${second}`})`,
    );

    expect(composer.inputs).toHaveLength(0);
    for (const conversationId of [first, second]) {
      expect(await stateOf(conversationId)).toBe('pending');
      expect(await drafts(conversationId)).toHaveLength(0);
      const deferred = (await events(conversationId)).at(-1);
      expect(deferred).toEqual({
        type: 'reply_deferred',
        payload: { reason: 'outside_hours', until: OPENING.toISOString() },
      });
    }
    // One opening job for her, whatever the number of fans who wrote.
    const [opening, ...more] = await jobs(`conversation.reopen:${creatorId}`);
    expect(more).toHaveLength(0);
    expect(opening?.run_at.toISOString()).toBe(OPENING.toISOString());
    expect(opening?.payload).toEqual({ creatorId, correlationId: 'test' });

    clock.current = OPENING;
    await conversations.jobs.reopen({ creatorId, correlationId: 'test' }, NO_LOG);
    const [firstJob] = await jobs(`conversation.respond:${first}`);
    const [secondJob] = await jobs(`conversation.respond:${second}`);
    expect(firstJob?.run_at.toISOString()).toBe(OPENING.toISOString());
    expect(secondJob?.run_at.getTime()).toBe(OPENING.getTime() + RESUME_SPACING_SECONDS * 1_000);
    expect(firstJob?.queue_name).toBe(`conv:${first}`);

    composer.results.push(draft);
    await respond(conversations, first);
    expect(composer.inputs.map((input) => input.hours)).toEqual([SLOTS]);
    expect(await stateOf(first)).toBe('awaiting_approval');
    expect(await drafts(first)).toHaveLength(1);
  });

  it('keeps the debounce of a fan writing at her opening', async () => {
    clock.current = OPENING;
    const conversations = moduleWith({ hours: SLOTS });
    const conversationId = await fanWrites(conversations, 'ah-typing');
    const [debounce] = await jobs(`conversation.respond:${conversationId}`);
    if (debounce === undefined) throw new Error('no debounce');
    expect(debounce.run_at.getTime()).toBeGreaterThan(OPENING.getTime());
    await conversations.jobs.reopen({ creatorId, correlationId: 'test' }, NO_LOG);
    const [kept, ...more] = await jobs(`conversation.respond:${conversationId}`);
    expect(more).toHaveLength(0);
    expect(kept?.run_at.toISOString()).toBe(debounce.run_at.toISOString());
  });

  it('puts nobody off in her slot, and passes her hours', async () => {
    clock.current = new Date('2026-10-18T08:00:00.000Z');
    const conversations = moduleWith({ hours: SLOTS });
    const conversationId = await fanWrites(conversations, 'ah-open');
    composer.results.push(draft);
    await respond(conversations, conversationId);
    expect(composer.inputs.map((input) => input.hours)).toEqual([SLOTS]);
    expect((await events(conversationId)).map((event) => event.type)).not.toContain('reply_deferred');
  });

  it('answers at 3:00 as before when her hours are not wired', async () => {
    const conversations = moduleWith({});
    const conversationId = await fanWrites(conversations, 'ah-none');
    composer.results.push(draft);
    await respond(conversations, conversationId);
    expect(composer.inputs).toHaveLength(1);
    expect(composer.inputs[0]).not.toHaveProperty('hours');
    expect(await stateOf(conversationId)).toBe('awaiting_approval');
  });

  it('keeps a wait she chose for her opening, on its own job', async () => {
    // 0:50 in Paris: she says « attends » and the engine asks for 20 minutes, past 1:00.
    clock.current = new Date('2026-10-17T22:50:00.000Z');
    const conversations = moduleWith({ hours: SLOTS });
    const conversationId = await fanWrites(conversations, 'ah-wait');
    composer.results.push({
      kind: 'held',
      reason: 'no_reply',
      detail: ['wait'],
      costUsd: 0,
      retryAt: new Date(clock.now().getTime() + 20 * MINUTE_MS),
    });
    await respond(conversations, conversationId);
    const [waiting] = await jobs(`conversation.respond:${conversationId}`);
    if (waiting === undefined) throw new Error('no second pass');
    clock.current = waiting.run_at;
    await conversations.jobs.respond({ ...waiting.payload, conversationId }, NO_LOG);
    expect(composer.inputs).toHaveLength(1);
    const [atOpening] = await jobs(`conversation.respond:${conversationId}`);
    expect(atOpening?.run_at.toISOString()).toBe(OPENING.toISOString());
    expect(atOpening?.payload.waitedFor).toBe(waiting.payload.waitedFor);
    expect(await jobs(`conversation.reopen:${creatorId}`)).toHaveLength(0);

    if (atOpening === undefined) throw new Error('no answer at the opening');
    // Her opening answers the fans still pending; his conversation rests during her wait, so his job keeps `waitedFor`.
    expect(await stateOf(conversationId)).toBe('idle');
    await conversations.jobs.reopen({ creatorId, correlationId: 'test' }, NO_LOG);
    const [stillWaited, ...more] = await jobs(`conversation.respond:${conversationId}`);
    expect(more).toHaveLength(0);
    expect(stillWaited?.payload.waitedFor).toBe(waiting.payload.waitedFor);
    clock.current = OPENING;
    composer.results.push(draft);
    await conversations.jobs.respond({ ...atOpening.payload, conversationId }, NO_LOG);
    expect(composer.inputs.map((input) => input.waited)).toEqual([undefined, 1]);
    expect(await drafts(conversationId)).toHaveLength(1);
  });
});
