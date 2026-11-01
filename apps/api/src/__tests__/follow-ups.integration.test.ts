import {
  CreatorIdSchema,
  DraftIdSchema,
  newId,
  PlatformAccountIdSchema,
  UserIdSchema,
  type ConversationId,
  type CreatorId,
  type DraftId,
  type JobPayload,
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
  type FollowUpContext,
  type FollowUpPlan,
  type OutboundSender,
} from '../modules/conversations';
import { createFansModule } from '../modules/fans';

const T0 = new Date('2026-10-17T20:00:00.000Z');
const HOUR_S = 3_600;
const PASS_GUARD = {
  forCreator: () => Promise.resolve({ check: () => ({ isBlocked: false, codes: [] }) }),
};
const NO_LOG = { info: () => undefined, warn: () => undefined };
const USER = UserIdSchema.parse('0199f2a0-0000-7000-8000-000000000002');

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
  verifySent(): Promise<{ status: 'not_found' }> {
    return Promise.resolve({ status: 'not_found' });
  }
}

/** Answers what the test says, and records what it was asked. */
class ScriptedComposer implements DraftComposer {
  readonly inputs: ComposeInput[] = [];
  next: ComposeResult = { kind: 'draft', bubbles: ['Tu m’as oubliée ?'], softViolations: [], costUsd: 0 };

  compose(input: ComposeInput): Promise<ComposeResult> {
    this.inputs.push(input);
    return Promise.resolve(this.next);
  }
}

const JobRowSchema = z.object({
  run_at: z.coerce.date(),
  queue_name: z.string().nullable(),
  payload: z.unknown(),
});

/** P3-10: the follow-ups' plumbing, from a sent answer to the follow-up draft; the engine is scripted here. */
describe('conversation.follow_up', () => {
  let test: TestDb;
  let queue: JobQueue;
  let clock: TestClock;
  let composer: ScriptedComposer;
  let conversations: ConversationsModule;
  let creatorId: CreatorId;
  let platformAccountId: PlatformAccountId;
  let counter = 0;
  const plan: FollowUpPlan = { delaysHours: () => Promise.resolve([12, 23]) };

  function build(followUps: FollowUpPlan | undefined): ConversationsModule {
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
      ...(followUps !== undefined && { followUps }),
    });
  }

  async function fanWrites(conversation: string): Promise<ConversationId> {
    counter += 1;
    const { conversationId } = await conversations.ingestMessage({
      creatorId,
      platformAccountId,
      platformConversationId: conversation,
      platformFanId: `fan-${conversation}`,
      fanDisplayName: 'Théo',
      message: {
        ref: { platform: 'reveal', id: `fu-${String(counter)}` },
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

  const command = (conversationId: ConversationId) => ({
    creatorId,
    conversationId,
    userId: USER,
    correlationId: 'test',
  });

  async function latestDraft(conversationId: ConversationId): Promise<DraftId> {
    const [draft] = await test.admin.db
      .select({ id: schema.drafts.id })
      .from(schema.drafts)
      .where(eq(schema.drafts.conversationId, conversationId))
      .orderBy(sql`${schema.drafts.createdAt} desc`)
      .limit(1);
    if (draft === undefined) throw new Error('no draft');
    return DraftIdSchema.parse(draft.id);
  }

  /** Approves the open draft and sends it. */
  async function approveAndSend(conversationId: ConversationId): Promise<void> {
    const draftId = await latestDraft(conversationId);
    await conversations.approveDraft({ ...command(conversationId), draftId });
    await conversations.jobs.send({ creatorId, conversationId, draftId, correlationId: 'test' }, NO_LOG, 1);
  }

  /** The fan writes, she answers, the answer goes out. */
  async function answered(conversation: string): Promise<ConversationId> {
    const conversationId = await fanWrites(conversation);
    composer.next = { kind: 'draft', bubbles: ['Coucou toi'], softViolations: [], costUsd: 0 };
    clock.advance(60);
    await conversations.jobs.respond({ creatorId, conversationId, correlationId: 'test' }, NO_LOG);
    await approveAndSend(conversationId);
    return conversationId;
  }

  async function followUpJob(conversationId: ConversationId) {
    const result = await test.admin.db.execute(
      sql`select j.run_at, q.queue_name, j.payload from graphile_worker._private_jobs j
          left join graphile_worker._private_job_queues q on q.id = j.job_queue_id
          where j.key = ${`conversation.follow_up:${conversationId}`}`,
    );
    return z.array(JobRowSchema).parse(result.rows);
  }

  async function events(conversationId: ConversationId): Promise<string[]> {
    const rows = await test.admin.db
      .select({ type: schema.conversationEvents.type })
      .from(schema.conversationEvents)
      .where(eq(schema.conversationEvents.conversationId, conversationId))
      .orderBy(schema.conversationEvents.seq);
    return rows.map((row) => row.type);
  }

  async function row(conversationId: ConversationId) {
    const [found] = await test.admin.db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId));
    if (found === undefined) throw new Error('no conversation');
    return found;
  }

  async function payloadOf(conversationId: ConversationId): Promise<JobPayload<'conversation.follow_up'>> {
    const [job] = await followUpJob(conversationId);
    if (job === undefined) throw new Error('no follow-up');
    return z
      .object({
        creatorId: CreatorIdSchema,
        conversationId: z.string(),
        correlationId: z.string(),
        anchorAt: z.string(),
        step: z.number(),
      })
      .transform((p) => ({ ...p, conversationId }))
      .parse(job.payload);
  }

  const runFollowUp = (payload: JobPayload<'conversation.follow_up'>) =>
    conversations.jobs.followUp(payload, NO_LOG);

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
      .values({ id: platformAccountId, creatorId, platform: 'reveal', handle: 'follow-ups' });
  });

  afterAll(async () => {
    await queue.close();
    await test.close();
  });

  beforeEach(() => {
    clock = new TestClock();
    composer = new ScriptedComposer();
    conversations = build(plan);
  });

  it('schedules the first follow-up from his last message once her answer reached him', async () => {
    const conversationId = await answered('fu-schedule');
    const anchor = (await row(conversationId)).lastInboundAt;
    expect(anchor).not.toBeNull();
    const jobs = await followUpJob(conversationId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.queue_name).toBe(`conv:${conversationId}`);
    expect(jobs[0]?.run_at.toISOString()).toBe(
      new Date(anchor!.getTime() + 12 * HOUR_S * 1_000).toISOString(),
    );
    expect(await payloadOf(conversationId)).toMatchObject({ anchorAt: anchor!.toISOString(), step: 0 });
    expect((await events(conversationId)).slice(-2)).toEqual(['send_verified', 'follow_up_scheduled']);
  });

  it('writes each follow-up as a draft to approve, then schedules the next, and stops after the last', async () => {
    const conversationId = await answered('fu-chain');
    const first = await payloadOf(conversationId);
    clock.advance(12 * HOUR_S);
    composer.inputs.length = 0;
    await runFollowUp(first);
    expect(composer.inputs).toHaveLength(1);
    const expected: FollowUpContext = { step: 0, steps: 2, silentSince: new Date(first.anchorAt) };
    expect(composer.inputs[0]?.followUp).toEqual(expected);
    expect(await row(conversationId)).toMatchObject({ state: 'awaiting_approval' });

    await approveAndSend(conversationId);
    const second = await payloadOf(conversationId);
    expect(second).toMatchObject({ anchorAt: first.anchorAt, step: 1 });

    clock.advance(11 * HOUR_S);
    await runFollowUp(second);
    await approveAndSend(conversationId);
    // Past the last delay: the job left behind is the one just run, nothing new was scheduled.
    expect((await events(conversationId)).filter((type) => type === 'follow_up_scheduled')).toHaveLength(2);
    expect((await events(conversationId)).at(-1)).toBe('send_verified');
  });

  it('does nothing once he wrote again, and says so in the journal', async () => {
    const conversationId = await answered('fu-fan-wrote');
    const payload = await payloadOf(conversationId);
    clock.advance(HOUR_S);
    await fanWrites('fu-fan-wrote');
    composer.inputs.length = 0;
    await runFollowUp(payload);
    expect(composer.inputs).toHaveLength(0);
    expect((await events(conversationId)).at(-1)).toBe('follow_up_cancelled');
    expect(await row(conversationId)).toMatchObject({ state: 'pending' });
  });

  it('never follows up a conversation a human holds', async () => {
    const conversationId = await answered('fu-human');
    const payload = await payloadOf(conversationId);
    await conversations.takeover({ ...command(conversationId), reason: 'Je prends' });
    await runFollowUp(payload);
    expect((await events(conversationId)).at(-1)).toBe('follow_up_cancelled');
    expect(await row(conversationId)).toMatchObject({ state: 'human' });
  });

  it('writes nothing when the engine decides against it, and hands over what it hands over', async () => {
    const quiet = await answered('fu-no-reply');
    composer.next = { kind: 'held', reason: 'no_reply', detail: ['sales_frozen'], costUsd: 0 };
    await runFollowUp(await payloadOf(quiet));
    expect(await row(quiet)).toMatchObject({ state: 'idle' });
    expect((await events(quiet)).at(-1)).toBe('follow_up_cancelled');

    // No model for a silent fan is no emergency.
    const down = await answered('fu-down');
    composer.next = { kind: 'held', reason: 'llm_unavailable', detail: [], costUsd: 0 };
    await runFollowUp(await payloadOf(down));
    expect(await row(down)).toMatchObject({ state: 'idle' });

    const blocked = await answered('fu-guard');
    composer.next = { kind: 'held', reason: 'guard_blocked', detail: ['ai_disclosure'], costUsd: 0 };
    await runFollowUp(await payloadOf(blocked));
    expect(await row(blocked)).toMatchObject({ state: 'human' });
    expect((await events(blocked)).at(-1)).toBe('handoff_requested');
  });

  it('writes one draft however often the job runs', async () => {
    const conversationId = await answered('fu-replay');
    const payload = await payloadOf(conversationId);
    await runFollowUp(payload);
    await runFollowUp(payload);
    const drafts = await test.admin.db
      .select({ id: schema.drafts.id })
      .from(schema.drafts)
      .where(eq(schema.drafts.conversationId, conversationId));
    // Her answer, then one follow-up.
    expect(drafts).toHaveLength(2);
  });

  it('schedules nothing without the persona’s plan, or when her follow-ups are off', async () => {
    conversations = build(undefined);
    const withoutPlan = await answered('fu-no-plan');
    expect(await followUpJob(withoutPlan)).toEqual([]);

    conversations = build({ delaysHours: () => Promise.resolve([]) });
    const off = await answered('fu-off');
    expect(await followUpJob(off)).toEqual([]);
    expect(await events(off)).not.toContain('follow_up_scheduled');
  });

  it('puts a follow-up off to the time the engine gives, within eight days, and cancels it beyond', async () => {
    const night = await answered('fu-night');
    const payload = await payloadOf(night);
    const morning = new Date(clock.now().getTime() + 9 * HOUR_S * 1_000);
    composer.next = {
      kind: 'held',
      reason: 'no_reply',
      detail: ['follow_up_quiet_hours'],
      costUsd: 0,
      retryAt: morning,
    };
    await runFollowUp(payload);
    const [job] = await followUpJob(night);
    expect(job?.run_at.toISOString()).toBe(morning.toISOString());
    expect(await payloadOf(night)).toMatchObject({ anchorAt: payload.anchorAt, step: payload.step });
    expect((await events(night)).at(-1)).toBe('follow_up_scheduled');

    const far = await answered('fu-far');
    composer.next = {
      kind: 'held',
      reason: 'no_reply',
      detail: ['follow_up_quiet_hours'],
      costUsd: 0,
      // Her next reply slot is at most a week away (P3-14): beyond eight days, the engine asked for too much.
      retryAt: new Date(clock.now().getTime() + 9 * 24 * HOUR_S * 1_000),
    };
    await runFollowUp(await payloadOf(far));
    expect((await events(far)).at(-1)).toBe('follow_up_cancelled');
  });

  it('cancels a follow-up whose step the persona no longer has', async () => {
    const conversationId = await answered('fu-plan-changed');
    const payload = await payloadOf(conversationId);
    conversations = build({ delaysHours: () => Promise.resolve([]) });
    await runFollowUp(payload);
    expect(composer.inputs.filter((input) => input.followUp !== undefined)).toHaveLength(0);
    expect((await events(conversationId)).at(-1)).toBe('follow_up_cancelled');
  });
});
