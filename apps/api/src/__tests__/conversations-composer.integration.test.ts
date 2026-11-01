import {
  CreatorIdSchema,
  newId,
  PersonaVersionIdSchema,
  PlatformAccountIdSchema,
  type ConversationId,
  type CreatorId,
  type ExternalMedia,
  type PlatformAccountId,
} from '@nirvana/contracts';
import { eq, schema } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createJobQueue, type JobQueue } from '../jobs';
import {
  createConversationsModule,
  type ConversationsModule,
  type DraftComposer,
} from '../modules/conversations';
import { createFansModule } from '../modules/fans';

/** Lets every bubble through: the guards themselves are tested in `agent` and `approval-guard`. */
const PASS_GUARD = {
  forCreator: () => Promise.resolve({ check: () => ({ isBlocked: false, codes: [] }) }),
};
const NO_LOG = { info: () => undefined, warn: () => undefined };

type ComposeInput = Parameters<DraftComposer['compose']>[0];
type ComposeResult = Awaited<ReturnType<DraftComposer['compose']>>;

/** Answers what the test says, and records what it was asked. A hook runs while it "thinks". */
class ScriptedComposer implements DraftComposer {
  readonly inputs: ComposeInput[] = [];
  next: ComposeResult | Error = { kind: 'draft', bubbles: [], softViolations: [], costUsd: 0 };
  whileThinking: () => Promise<void> = () => Promise.resolve();

  async compose(input: ComposeInput): Promise<ComposeResult> {
    this.inputs.push(input);
    await this.whileThinking();
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

describe('conversation.respond with the engine (DraftComposer)', () => {
  let test: TestDb;
  let queue: JobQueue;
  let creatorId: CreatorId;
  let platformAccountId: PlatformAccountId;
  let conversations: ConversationsModule;
  const composer = new ScriptedComposer();
  let counter = 0;

  async function fanWrites(
    conversation: string,
    text: string,
    media: ExternalMedia[] = [],
  ): Promise<ConversationId> {
    counter += 1;
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
        text,
        media,
        priceMinor: null,
        currency: null,
        isPaid: false,
        createdAt: new Date(Date.UTC(2026, 9, 17, 20, 0, counter)).toISOString(),
      },
      correlationId: 'test',
    });
    return conversationId;
  }

  const respond = (conversationId: ConversationId) =>
    conversations.jobs.respond({ creatorId, conversationId, correlationId: 'test' }, NO_LOG);

  async function state(conversationId: ConversationId) {
    const [row] = await test.admin.db
      .select({ state: schema.conversations.state })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId));
    return row?.state;
  }

  async function events(conversationId: ConversationId) {
    const rows = await test.admin.db
      .select({ type: schema.conversationEvents.type, payload: schema.conversationEvents.payload })
      .from(schema.conversationEvents)
      .where(eq(schema.conversationEvents.conversationId, conversationId))
      .orderBy(schema.conversationEvents.seq);
    return rows;
  }

  const drafts = (conversationId: ConversationId) =>
    test.admin.db.select().from(schema.drafts).where(eq(schema.drafts.conversationId, conversationId));

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    queue = await createJobQueue(test.admin.pool);
    creatorId = newId(CreatorIdSchema);
    platformAccountId = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: creatorId, displayName: 'Test', timezone: 'Europe/Paris' });
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: platformAccountId, creatorId, platform: 'reveal', handle: 'composer' });
    conversations = createConversationsModule({
      db: test.app.db,
      fans: createFansModule({ db: test.app.db, adminDb: test.admin.db }),
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

  it('writes the engine’s bubbles as a draft, from the history oldest first', async () => {
    await fanWrites('c-draft', 'Salut');
    const id = await fanWrites('c-draft', 'Tu fais quoi ?');
    composer.next = {
      kind: 'draft',
      bubbles: ['Coucou toi', 'Je me pose'],
      softViolations: ['emoji'],
      costUsd: 0.002,
      voice: { voicePrompt: '1.2.0', voiceModel: 'grok-4.7' },
    };
    await respond(id);

    const input = composer.inputs.at(-1);
    expect(input?.history.map((message) => message.text)).toEqual(['Salut', 'Tu fais quoi ?']);
    expect(input?.fan).toMatchObject({ notes: [], spentMinor: 0 });
    expect(input?.fan.firstMessageAt).toBeInstanceOf(Date);
    const [draft] = await drafts(id);
    expect(draft).toMatchObject({
      id: input?.draftId,
      status: 'pending',
      bubbles: ['Coucou toi', 'Je me pose'],
      guardTrace: { softViolations: ['emoji'] },
      promptHashes: { voicePrompt: '1.2.0', voiceModel: 'grok-4.7' },
      personaVersionId: null,
    });
    expect(await state(id)).toBe('awaiting_approval');
  });

  it('hands the conversation to the chatters when a guard blocks, and tells the outbox', async () => {
    const id = await fanWrites('c-guard', 'On se voit quand ?');
    composer.next = { kind: 'held', reason: 'guard_blocked', detail: ['meeting_promise'], costUsd: 0.001 };
    await respond(id);
    expect(await drafts(id)).toHaveLength(0);
    expect(await state(id)).toBe('human');
    expect((await events(id)).at(-1)).toEqual({
      type: 'handoff_requested',
      payload: { conversationId: id, cause: 'guard', detail: ['guard_blocked', 'meeting_promise'] },
    });
    const outbox = await test.admin.db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.type, 'handoff_requested'));
    expect(outbox).toHaveLength(1);
  });

  it('gives the engine every media of the fan, captioned or not, even before the media module stores it', async () => {
    const photo: ExternalMedia = {
      ref: { platform: 'reveal', id: 'media-1' },
      kind: 'image',
      isLocked: false,
    };
    const id = await fanWrites('c-photo', 'regarde', [photo]);
    composer.next = { kind: 'held', reason: 'handoff', detail: ['media_unscreened'], costUsd: 0 };
    await respond(id);
    // Everything the vision needs to fetch it again on the platform: account, conversation, message, media.
    const input = composer.inputs.at(-1);
    expect(input).toMatchObject({ platformAccountId, platformConversationId: 'c-photo' });
    expect(input?.history.at(-1)?.platformMessageId).toMatch(/^m-\d+$/);
    expect(input?.history.at(-1)).toMatchObject({
      text: 'regarde',
      media: [{ kind: 'image', platformMediaId: 'media-1', isLocked: false }],
    });
    expect(await state(id)).toBe('human');
  });

  it('keeps the cause the engine gives, so alerts rank on it', async () => {
    const id = await fanWrites('c-distress', 'Je vais pas bien');
    composer.next = { kind: 'held', reason: 'handoff', cause: 'distress', detail: ['distress'], costUsd: 0 };
    await respond(id);
    expect((await events(id)).at(-1)).toMatchObject({
      type: 'handoff_requested',
      payload: { conversationId: id, cause: 'distress' },
    });
  });

  it('journals her alerts: the one that paused on the handoff, each other as its own notice (P4-01)', async () => {
    const id = await fanWrites('c-alerts', 'Tu me fais une vidéo perso ?');
    const word = {
      alert: { kind: 'system', code: 'keyword' },
      matchedBy: 'keyword',
      keyword: 'Vidéo perso',
    } as const;
    const service = { alert: { kind: 'system', code: 'service_request' }, matchedBy: 'model' } as const;
    composer.next = {
      kind: 'held',
      reason: 'handoff',
      cause: 'keyword',
      trigger: word,
      detail: ['alert_keyword'],
      costUsd: 0,
      alerts: [{ trigger: service, notify: true }],
    };
    await respond(id);
    expect(await state(id)).toBe('human');
    expect((await events(id)).slice(-2)).toEqual([
      { type: 'alert_triggered', payload: { conversationId: id, trigger: service, notify: true } },
      {
        type: 'handoff_requested',
        payload: {
          conversationId: id,
          cause: 'keyword',
          detail: ['handoff', 'alert_keyword'],
          trigger: word,
        },
      },
    ]);
  });

  it('journals an alert that only lets a human know beside her draft', async () => {
    const id = await fanWrites('c-notice', 'Tu fais des appels ?');
    const service = { alert: { kind: 'system', code: 'service_request' }, matchedBy: 'model' } as const;
    composer.next = {
      kind: 'draft',
      bubbles: ['On en reparle 😏'],
      softViolations: [],
      costUsd: 0,
      alerts: [{ trigger: service, notify: false }],
    };
    await respond(id);
    expect(await drafts(id)).toHaveLength(1);
    expect((await events(id)).map((event) => event.type).slice(-2)).toEqual([
      'alert_triggered',
      'draft_created',
    ]);
  });

  it('sounds each alert once until she answers, even when he writes again (P4-01)', async () => {
    const id = await fanWrites('c-twice', 'Tu fais des appels ?');
    const service = { alert: { kind: 'system', code: 'service_request' }, matchedBy: 'model' } as const;
    const doubt = { alert: { kind: 'system', code: 'identity_doubt' }, matchedBy: 'model' } as const;
    composer.next = {
      kind: 'held',
      reason: 'no_reply',
      detail: [],
      costUsd: 0,
      alerts: [{ trigger: service, notify: true }],
    };
    await respond(id);

    await fanWrites('c-twice', 'T’es une vraie au moins ?');
    composer.next = {
      kind: 'draft',
      bubbles: ['Bien sûr 😏'],
      softViolations: [],
      costUsd: 0,
      alerts: [
        { trigger: service, notify: true },
        { trigger: doubt, notify: true },
      ],
    };
    await respond(id);
    const sounded = (await events(id)).filter((event) => event.type === 'alert_triggered');
    expect(sounded.map((event) => event.payload)).toEqual([
      { conversationId: id, trigger: service, notify: true },
      { conversationId: id, trigger: doubt, notify: true },
    ]);
  });

  it('writes nothing more to the fan while a human is awaited, whatever the fan sends', async () => {
    const id = await fanWrites('c-awaited', 'Je vais pas bien');
    composer.next = { kind: 'held', reason: 'handoff', cause: 'distress', detail: ['distress'], costUsd: 0 };
    await respond(id);
    const asked = composer.inputs.length;

    await fanWrites('c-awaited', 'Tu es là ?');
    await fanWrites('c-awaited', 'Réponds stp');
    composer.next = { kind: 'draft', bubbles: ['Coucou'], softViolations: [], costUsd: 0 };
    // A respond job queued before the handoff, replayed now: it must find nobody to answer.
    await respond(id);

    expect(composer.inputs).toHaveLength(asked);
    expect(await drafts(id)).toHaveLength(0);
    expect(await state(id)).toBe('human');
    expect((await events(id)).map((event) => event.type)).toEqual([
      'message_received',
      'handoff_requested',
      'message_received',
      'message_received',
    ]);
  });

  it('goes back to idle when there is nothing to say', async () => {
    const quiet = await fanWrites('c-quiet', 'Ok bonne nuit');
    composer.next = { kind: 'held', reason: 'no_reply', detail: [], costUsd: 0 };
    await respond(quiet);
    expect(await state(quiet)).toBe('idle');
    expect((await events(quiet)).at(-1)).toEqual({
      type: 'reply_skipped',
      payload: { reason: 'no_reply', detail: [] },
    });
  });

  it('hands the conversation to a human when no model answers, thrown or held', async () => {
    const broken = await fanWrites('c-broken', 'Hello');
    composer.next = new Error('provider down');
    await respond(broken);
    expect(await state(broken)).toBe('human');
    expect((await events(broken)).at(-1)).toEqual({
      type: 'handoff_requested',
      payload: { conversationId: broken, cause: 'llm_unavailable', detail: ['llm_unavailable'] },
    });

    const keyless = await fanWrites('c-keyless', 'Hello');
    composer.next = { kind: 'held', reason: 'llm_unavailable', detail: ['no voice key'], costUsd: 0 };
    await respond(keyless);
    expect(await state(keyless)).toBe('human');
    expect((await events(keyless)).at(-1)).toEqual({
      type: 'handoff_requested',
      payload: {
        conversationId: keyless,
        cause: 'llm_unavailable',
        // A chatter reads the cause in words; the codes stay in the journal, never as a reason.
        detail: ['llm_unavailable', 'no voice key'],
      },
    });
  });

  it('drops the result when the fan writes again while the engine thinks', async () => {
    const id = await fanWrites('c-race', 'Salut');
    composer.next = { kind: 'draft', bubbles: ['Coucou'], softViolations: [], costUsd: 0 };
    composer.whileThinking = async () => {
      await fanWrites('c-race', 'Tu es là ?');
    };
    await respond(id);
    composer.whileThinking = () => Promise.resolve();
    expect(await drafts(id)).toHaveLength(0);
    expect(await state(id)).toBe('pending');
  });

  it('stamps the draft with the persona active for her, the version Automatique is proved on (ADR 0022)', async () => {
    const personaVersionId = newId(PersonaVersionIdSchema);
    await test.admin.db.insert(schema.personaVersions).values({
      id: personaVersionId,
      creatorId,
      version: 'test-1',
      sourcePath: 'personas/example.yaml',
      content: {},
      contentHash: 'test',
      isActive: true,
      activatedAt: new Date(),
    });
    const id = await fanWrites('c-persona', 'Salut');
    composer.next = {
      kind: 'draft',
      bubbles: ['Coucou'],
      softViolations: [],
      costUsd: 0,
      voice: { voicePrompt: '1.2.0', voiceModel: 'grok-4.7' },
    };
    await respond(id);
    const [draft] = await drafts(id);
    expect(draft?.personaVersionId).toBe(personaVersionId);
  });
});
