import {
  CreatorIdSchema,
  DraftIdSchema,
  FanIdSchema,
  JOB_PAYLOADS,
  newId,
  PlatformAccountIdSchema,
  UserIdSchema,
  type ConversationId,
  type CreatorId,
  type DraftId,
  type PlatformAccountId,
} from '@nirvana/contracts';
import { eq, schema, sql } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createJobQueue, type JobQueue } from '../jobs';
import {
  createConversationsModule,
  type ConversationsModule,
  type DraftComposer,
} from '../modules/conversations';
import { createFansModule, type FansModule } from '../modules/fans';

const PASS_GUARD = {
  forCreator: () => Promise.resolve({ check: () => ({ isBlocked: false, codes: [] }) }),
};
const NO_LOG = { info: () => undefined, warn: () => undefined };
const USER = newId(UserIdSchema);

type ComposeInput = Parameters<DraftComposer['compose']>[0];
type ComposeResult = Awaited<ReturnType<DraftComposer['compose']>>;

class ScriptedComposer implements DraftComposer {
  readonly inputs: ComposeInput[] = [];
  next: ComposeResult = { kind: 'draft', bubbles: ['Coucou'], softViolations: [], costUsd: 0 };

  compose(input: ComposeInput): Promise<ComposeResult> {
    this.inputs.push(input);
    return Promise.resolve(this.next);
  }
}

const RecordFactsJobSchema = z.object({ payload: JOB_PAYLOADS['conversation.record_facts'] });

/** P3-02, the conversations side: brief → draft → approval → facts, and the chatter's note. Invented data (ADR 0010). */
describe('fan facts from the conversations', () => {
  let test: TestDb;
  let queue: JobQueue;
  let creatorId: CreatorId;
  let platformAccountId: PlatformAccountId;
  let fans: FansModule;
  let conversations: ConversationsModule;
  const composer = new ScriptedComposer();
  let counter = 0;

  async function fanWrites(conversation: string, text: string): Promise<ConversationId> {
    counter += 1;
    const { conversationId } = await conversations.ingestMessage({
      creatorId,
      platformAccountId,
      platformConversationId: conversation,
      platformFanId: `fan-${conversation}`,
      fanDisplayName: 'Fan inventé',
      message: {
        ref: { platform: 'reveal', id: `f-${String(counter)}` },
        conversationRef: { platform: 'reveal', id: conversation },
        direction: 'inbound',
        text,
        media: [],
        priceMinor: null,
        currency: null,
        isPaid: false,
        createdAt: new Date(Date.UTC(2026, 9, 20, 18, 0, counter)).toISOString(),
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

  async function respond(conversationId: ConversationId): Promise<DraftId> {
    await conversations.jobs.respond({ creatorId, conversationId, correlationId: 'test' }, NO_LOG);
    const [draft] = await test.admin.db
      .select({ id: schema.drafts.id })
      .from(schema.drafts)
      .where(eq(schema.drafts.conversationId, conversationId))
      .orderBy(sql`${schema.drafts.createdAt} desc`)
      .limit(1);
    if (draft === undefined) throw new Error('no draft');
    return DraftIdSchema.parse(draft.id);
  }

  /** The `record_facts` jobs waiting for this conversation, removed from the queue as a worker would. */
  async function takeRecordJobs(conversationId: ConversationId) {
    const result = await test.admin.db.execute(
      sql`delete from graphile_worker._private_jobs j
          using graphile_worker._private_tasks t
          where t.id = j.task_id and t.identifier = 'conversation.record_facts'
            and j.payload->>'conversationId' = ${conversationId}
          returning j.payload`,
    );
    return result.rows.map((row) => RecordFactsJobSchema.parse(row).payload);
  }

  async function factEvents(conversationId: ConversationId) {
    return test.admin.db
      .select({ payload: schema.conversationEvents.payload })
      .from(schema.conversationEvents)
      .where(
        sql`${schema.conversationEvents.conversationId} = ${conversationId} and ${schema.conversationEvents.type} = 'fact_confirmed'`,
      );
  }

  async function fanOf(conversationId: ConversationId) {
    const [row] = await test.admin.db
      .select({ fanId: schema.conversations.fanId })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId));
    if (row === undefined) throw new Error('no conversation');
    return FanIdSchema.parse(row.fanId);
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    queue = await createJobQueue(test.admin.pool);
    creatorId = newId(CreatorIdSchema);
    platformAccountId = newId(PlatformAccountIdSchema);
    await test.admin.db.insert(schema.creators).values({
      id: creatorId,
      nameKey: creatorId,
      displayName: 'Créatrice inventée',
      timezone: 'Europe/Paris',
    });
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: platformAccountId, creatorId, platform: 'reveal', handle: 'facts' });
    fans = createFansModule({ db: test.app.db, adminDb: test.admin.db });
    conversations = createConversationsModule({
      db: test.app.db,
      fans,
      sender: {
        sendText: () => Promise.reject(new Error('not used')),
        sendMedia: () => Promise.reject(new Error('not used')),
        verifySent: () => Promise.resolve({ status: 'not_found' }),
      },
      requireRole: () => () => Promise.resolve(),
      recentLogin: () => Promise.resolve(),
      voice: { voicePrompt: 'voice@test', voiceModel: 'model-test' },
      guard: PASS_GUARD,
      composer,
    });
  });

  afterAll(async () => {
    await queue.close();
    await test.close();
  });

  it('keeps the brief’s facts on the draft, and writes them once a human approves it', async () => {
    await fanWrites('c-facts', 'Salut');
    const id = await fanWrites('c-facts', 'Je suis à Nantes, je bosse dans le bâtiment');
    composer.next = {
      kind: 'draft',
      bubbles: ['Coucou'],
      softViolations: [],
      costUsd: 0,
      factsProposed: [
        { category: 'identity', key: 'location', value: 'Nantes', kind: 'declared', confidence: 0.9 },
        { category: 'identity', key: 'job', value: 'bâtiment', kind: 'declared', confidence: 0.8 },
        // Not a category the contract knows, and a category no model may write: both dropped.
        { category: 'mood', key: 'today', value: 'joyeux', kind: 'inferred', confidence: 0.5 },
        { category: 'operator_note', key: 'note', value: 'à suivre', kind: 'declared', confidence: 1 },
      ],
    };
    const draftId = await respond(id);
    const lastFanMessage = composer.inputs.at(-1)?.history.at(-1);

    // Nothing is a fact before a human approves.
    const fanId = await fanOf(id);
    expect(await fans.activeFacts(creatorId, fanId)).toEqual([]);
    const [draft] = await test.admin.db.select().from(schema.drafts).where(eq(schema.drafts.id, draftId));
    expect(draft?.brief).toEqual({
      factsProposed: [
        expect.objectContaining({ category: 'identity', key: 'location', value: 'Nantes' }),
        expect.objectContaining({ category: 'identity', key: 'job', value: 'bâtiment' }),
      ],
    });

    await conversations.approveDraft({ ...command(id), draftId });
    const [job, ...others] = await takeRecordJobs(id);
    expect(others).toEqual([]);
    expect(job?.source).toEqual({ kind: 'draft', draftId });
    if (job === undefined) throw new Error('no job');
    await conversations.jobs.recordFacts(job, NO_LOG);

    const facts = await fans.activeFacts(creatorId, fanId);
    expect(facts.map((fact) => [fact.key, fact.value])).toEqual([
      ['location', 'Nantes'],
      ['job', 'bâtiment'],
    ]);
    // Dated by the fan's message they were read in.
    expect(facts.map((fact) => fact.sourceMessageId)).toEqual([lastFanMessage?.id, lastFanMessage?.id]);
    expect(facts[0]?.observedAt).toEqual(lastFanMessage?.at);
    expect((await factEvents(id)).map((event) => event.payload)).toEqual(
      facts.map((fact) => ({ fanId, factId: fact.id, category: 'identity' })),
    );

    // A replayed job writes nothing, and no event twice.
    await conversations.jobs.recordFacts(job, NO_LOG);
    expect(await fans.activeFacts(creatorId, fanId)).toHaveLength(2);
    expect(await factEvents(id)).toHaveLength(2);
  });

  it('gives the engine her facts about the fan on the next answer', async () => {
    const id = await fanWrites('c-facts', 'Et toi ?');
    composer.next = { kind: 'draft', bubbles: ['Moi ça va'], softViolations: [], costUsd: 0 };
    await respond(id);
    expect(composer.inputs.at(-1)?.fan.notes).toEqual(['location : Nantes', 'job : bâtiment']);
  });

  it('writes nothing for a rejected draft', async () => {
    const id = await fanWrites('c-rejected', 'J’ai 34 ans');
    composer.next = {
      kind: 'draft',
      bubbles: ['Coucou'],
      softViolations: [],
      costUsd: 0,
      factsProposed: [{ category: 'identity', key: 'age', value: '34', kind: 'declared', confidence: 0.9 }],
    };
    const draftId = await respond(id);
    await conversations.rejectDraft({ ...command(id), draftId });
    expect(await takeRecordJobs(id)).toEqual([]);
    expect(await fans.activeFacts(creatorId, await fanOf(id))).toEqual([]);
  });

  it('keeps the note a chatter leaves on giving the conversation back', async () => {
    const id = await fanWrites('c-note', 'Tu es là ?');
    await conversations.takeover(command(id));
    await conversations.release({ ...command(id), note: 'Aime qu’on lui parle de foot' });
    const [job] = await takeRecordJobs(id);
    if (job === undefined) throw new Error('no job');
    await conversations.jobs.recordFacts(job, NO_LOG);
    await conversations.jobs.recordFacts(job, NO_LOG);

    const facts = await fans.activeFacts(creatorId, await fanOf(id));
    expect(facts).toMatchObject([
      { category: 'operator_note', value: 'Aime qu’on lui parle de foot', kind: 'declared', confidence: 1 },
    ]);
    expect(await factEvents(id)).toHaveLength(1);

    // The engine reads it as a note, not by its dated slot.
    await fanWrites('c-note', 'Alors ?');
    await respond(id);
    expect(composer.inputs.at(-1)?.fan.notes).toEqual(['Note : Aime qu’on lui parle de foot']);

    // Without a note, giving back enqueues nothing.
    await conversations.takeover(command(id));
    await conversations.release(command(id));
    expect(await takeRecordJobs(id)).toEqual([]);
  });
});
