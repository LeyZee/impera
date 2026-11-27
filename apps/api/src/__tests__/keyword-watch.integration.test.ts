import { randomUUID } from 'node:crypto';

import {
  CreatorIdSchema,
  DEFAULT_AGENT_HOURS,
  SUGGESTED_REPLY_SLOTS,
  newId,
  PlatformAccountIdSchema,
  type AgentHours,
  type AlertTrigger,
  type ConversationId,
  type CreatorId,
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
  type KeywordWatch,
  type OutboundSender,
} from '../modules/conversations';
import { createFansModule } from '../modules/fans';

// Sunday 18 October 2026, 3:00 in Paris: out of her 9:00 – 1:00 reply slots.
const NIGHT = new Date('2026-10-18T01:00:00.000Z');
// The same day, 15:00 in Paris: she answers.
const DAY = new Date('2026-10-18T13:00:00.000Z');
const PARIS = 'Europe/Paris';
const SLOTS: AgentHours = {
  ...DEFAULT_AGENT_HOURS,
  reply: { mode: 'slots', slots: [...SUGGESTED_REPLY_SLOTS] },
};
const PASS_GUARD = {
  forCreator: () => Promise.resolve({ check: () => ({ isBlocked: false, codes: [] }) }),
};
const NO_LOG = { info: () => undefined, warn: () => undefined };
// An invented word of hers (ADR 0010).
const WORD = 'brevanne';
const HER_WORD: AlertTrigger = {
  alert: { kind: 'system', code: 'keyword' },
  matchedBy: 'keyword',
  keyword: 'Brévanne',
};

class TestClock implements Clock {
  current = DAY;
  now(): Date {
    return this.current;
  }
}

class FakeSender implements OutboundSender {
  sendText(): Promise<SendResult> {
    return Promise.reject(new Error('not used'));
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

/** Her word read in code, as the agent's adapter does: the word named, never his text. */
const watch: KeywordWatch = {
  alertsIn: (_creatorId, text) =>
    Promise.resolve(text.toLowerCase().includes(WORD) ? [{ trigger: HER_WORD, notify: true }] : []),
};

const JobSchema = z.object({ run_at: z.coerce.date() });

/** Her alert words read while the agent does not answer him (27/11/2026). */
describe('conversation.watch_keywords', () => {
  let test: TestDb;
  let queue: JobQueue;
  let clock: TestClock;
  let creatorId: CreatorId;
  let platformAccountId: PlatformAccountId;
  let counter = 0;

  function moduleWith(options: { hours?: AgentHours; composer?: DraftComposer } = {}): ConversationsModule {
    return createConversationsModule({
      db: test.app.db,
      adminDb: test.service.db,
      fans: createFansModule({ db: test.app.db, adminDb: test.service.db }),
      sender: new FakeSender(),
      requireRole: () => () => Promise.resolve(),
      recentLogin: () => Promise.resolve(),
      voice: { voicePrompt: 'voice@test', voiceModel: 'model-test' },
      guard: PASS_GUARD,
      keywordWatch: watch,
      ...(options.composer !== undefined && { composer: options.composer }),
      clock,
      ...(options.hours !== undefined && {
        replyHours: {
          of: () => Promise.resolve({ hours: options.hours ?? SLOTS, timeZone: PARIS, exceptions: [] }),
        },
      }),
    });
  }

  async function fanWrites(
    conversations: ConversationsModule,
    conversation: string,
    text: string,
  ): Promise<ConversationId> {
    counter += 1;
    const { conversationId } = await conversations.ingestMessage({
      creatorId,
      platformAccountId,
      platformConversationId: conversation,
      platformFanId: `fan-${conversation}`,
      fanDisplayName: 'Théo',
      message: {
        ref: { platform: 'reveal', id: `kw-${String(counter)}` },
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

  async function watchJob(conversationId: ConversationId) {
    const result = await test.admin.db.execute(
      sql`select run_at from graphile_worker._private_jobs where key = ${`conversation.watch_keywords:${conversationId}`}`,
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

  async function alerts(conversationId: ConversationId) {
    return (await events(conversationId)).filter((event) => event.type === 'alert_triggered');
  }

  async function stateOf(conversationId: ConversationId) {
    const [found] = await test.admin.db
      .select({ state: schema.conversations.state })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId));
    return found?.state;
  }

  const run = (conversations: ConversationsModule, conversationId: ConversationId) =>
    conversations.jobs.watchKeywords({ creatorId, conversationId, correlationId: 'test' }, NO_LOG);

  async function killSwitch() {
    await test.admin.db.insert(schema.killSwitches).values({
      id: randomUUID(),
      scope: 'creator',
      scopeId: creatorId,
      creatorId,
      active: true,
      reason: 'test',
      setBy: 'system',
    });
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    queue = await createJobQueue(test.admin.pool);
  });

  afterAll(async () => {
    await queue.close();
    await test.close();
  });

  beforeEach(async () => {
    clock = new TestClock();
    creatorId = newId(CreatorIdSchema);
    platformAccountId = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: creatorId, displayName: 'Nora Vidal', timezone: PARIS });
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: platformAccountId, creatorId, platform: 'reveal', handle: `kw-${creatorId}` });
  });

  it('reads at once while her agent is off, tells once, and pauses nor sends anything', async () => {
    await killSwitch();
    const conversations = moduleWith();
    const conversationId = await fanWrites(conversations, 'kw-off', `tu viens de ${WORD} toi ?`);
    expect((await watchJob(conversationId)).map((job) => job.run_at.toISOString())).toEqual([
      DAY.toISOString(),
    ]);

    await run(conversations, conversationId);
    await run(conversations, conversationId);

    expect(await alerts(conversationId)).toEqual([
      {
        type: 'alert_triggered',
        payload: { conversationId, trigger: HER_WORD, notify: true },
      },
    ]);
    expect(await stateOf(conversationId)).toBe('pending');
  });

  it('waits a while when the agent is expected, and tells of the word it did not get to out of her hours', async () => {
    clock.current = NIGHT;
    const conversations = moduleWith({ hours: SLOTS });
    const conversationId = await fanWrites(conversations, 'kw-night', `${WORD} ça te dit quelque chose ?`);
    expect((await watchJob(conversationId)).map((job) => job.run_at.getTime())).toEqual([
      NIGHT.getTime() + 5 * 60_000,
    ]);
    // Another message of his keeps the first watch's time.
    clock.current = new Date(NIGHT.getTime() + 60_000);
    await fanWrites(conversations, 'kw-night', 'alors ?');
    expect((await watchJob(conversationId)).map((job) => job.run_at.getTime())).toEqual([
      NIGHT.getTime() + 5 * 60_000,
    ]);

    await run(conversations, conversationId);
    expect(await alerts(conversationId)).toHaveLength(1);
  });

  it('does not tell again of a word the agent already paused for', async () => {
    // The agent's own turn read her word first and paused for him.
    const composer: DraftComposer = {
      compose: () =>
        Promise.resolve({
          kind: 'held',
          reason: 'handoff',
          cause: 'keyword',
          trigger: HER_WORD,
          detail: ['alert_keyword'],
          costUsd: 0,
        }),
    };
    const conversations = moduleWith({ composer });
    const conversationId = await fanWrites(conversations, 'kw-paused', `je connais ${WORD}`);
    await conversations.jobs.respond({ creatorId, conversationId, correlationId: 'test' }, NO_LOG);
    expect(await stateOf(conversationId)).toBe('human');
    await run(conversations, conversationId);
    expect(await alerts(conversationId)).toEqual([]);
  });

  it('tells nothing of a message without her words', async () => {
    await killSwitch();
    const conversations = moduleWith();
    const conversationId = await fanWrites(conversations, 'kw-none', 'tu fais quoi ce soir ?');
    await run(conversations, conversationId);
    expect(await alerts(conversationId)).toEqual([]);
  });

  it('never watches an archived creator', async () => {
    const conversations = moduleWith();
    const conversationId = await fanWrites(conversations, 'kw-archived', 'coucou');
    await test.admin.db.execute(
      sql`delete from graphile_worker._private_jobs where key = ${`conversation.watch_keywords:${conversationId}`}`,
    );
    await test.admin.db
      .update(schema.creators)
      .set({ archivedAt: new Date() })
      .where(eq(schema.creators.id, creatorId));
    await fanWrites(conversations, 'kw-archived', `${WORD} ?`);
    expect(await watchJob(conversationId)).toEqual([]);
    await run(conversations, conversationId);
    expect(await alerts(conversationId)).toEqual([]);
  });
});
