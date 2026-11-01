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
  type PersonaVersionId,
  type PlatformAccountId,
  type SendResult,
} from '@nirvana/contracts';
import { eq, schema, sql } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import type { Brief, HealthReport, LlmGateway } from '@nirvana/llm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import {
  guardContextOf,
  startBubbleGuard,
  startDraftComposer,
  startFollowUpPlan,
  type ActivePersonaSource,
  type AgentDraftComposer,
} from '../modules/agent';
import {
  createConversationsModule,
  type Clock,
  type ConversationsModule,
  type OutboundSender,
} from '../modules/conversations';

import { testConfig } from './support/config';
import { DEMO_PERSONA } from './support/persona';

/** 9 h in Paris: her answers and her follow-ups 12 hours later both fall outside her quiet hours. */
const T0 = new Date('2026-10-29T08:00:00.000Z');
const HOUR_MS = 3_600_000;
const NO_LOG = { info: () => undefined, warn: () => undefined };
const USER = UserIdSchema.parse('0199f2a0-0000-7000-8000-000000000003');

/** Versions of the demo persona (ADR 0010: never a real one in a test), told apart by what the test needs. */
const persona = (
  number: string,
  change: { neverSay?: string[]; delays?: number[]; followUpsOn?: boolean } = {},
) => ({
  ...DEMO_PERSONA,
  meta: { ...DEMO_PERSONA.meta, version: number },
  limits: { ...DEMO_PERSONA.limits, never_say: change.neverSay ?? DEMO_PERSONA.limits.never_say },
  follow_ups: {
    ...DEMO_PERSONA.follow_ups,
    enabled: change.followUpsOn ?? true,
    delays_hours: change.delays ?? DEMO_PERSONA.follow_ups.delays_hours,
  },
});

const BRIEF: Brief = {
  intent: 'small_talk',
  sentiment: 'positive',
  factsProposed: [],
  kycMissing: [],
  risks: [],
  action: 'reply',
  replyBrief: 'Lui demander sa journée.',
  toneHints: [],
};
const META = {
  provider: 'xai',
  model: 'grok-4.7',
  isFallback: false,
  latencyMs: 1,
  promptHash: 'h',
} as const;

function health(): HealthReport {
  const role = (name: 'brain' | 'voice') => ({
    role: name,
    state: 'ok' as const,
    active: { provider: 'xai' as const, model: 'grok-4.7', label: 'Grok 4.7' },
    hasKey: true,
    isOnFallback: false,
    callsLastHour: 0,
    errorRateLastHour: 0,
    costTodayUsd: 0,
  });
  return {
    state: 'ok',
    at: new Date(),
    roles: [role('brain'), role('voice')],
    providers: [],
    costTodayUsd: 0,
    budget: { day: '2026-10-29', spentEur: 0, capEur: 20, alertAtEur: 16, state: 'ok' },
  };
}

/** The brain asks for an answer, the voice writes « Coucou toi »: whatever version, the same words. */
const GATEWAY: LlmGateway = {
  sense: () => Promise.reject(new Error('not used')),
  transcribe: () => Promise.reject(new Error('not used')),
  brain: () => Promise.resolve({ ok: true, value: { output: BRIEF, meta: META } }),
  voice: () => Promise.resolve({ ok: true, value: { output: { bubbles: ['Coucou toi'] }, meta: META } }),
  health,
  judge: () => Promise.reject(new Error('not used')),
  testConnection: () => Promise.reject(new Error('not used')),
};

class TestClock implements Clock {
  current = T0;
  now(): Date {
    return this.current;
  }
}

class FakeSender implements OutboundSender {
  constructor(private readonly clock: Clock) {}
  sendText(_conversation: unknown, _text: string, key: string): Promise<SendResult> {
    return Promise.resolve({
      messageRef: { platform: 'reveal', id: `out-${key}` },
      sentAt: this.clock.now().toISOString(),
    });
  }
  sendMedia(): Promise<SendResult> {
    return Promise.reject(new Error('not used'));
  }
  verifySent(): Promise<{ status: 'not_found' }> {
    return Promise.resolve({ status: 'not_found' });
  }
}

/**
 * The agent's own composer, follow-up plan and approval guard on her active version, as the composition root wires
 * them (recette 28/10, G4): what a draft carries, what an activation changes, what it leaves as it was.
 */
describe('drafts written with her active persona version, and what an activation changes', () => {
  let test: TestDb;
  let app: App;
  let cleo: CreatorId;
  let account: PlatformAccountId;
  let conversations: ConversationsModule;
  let real: AgentDraftComposer;
  /** Runs while a draft is being written, after her persona was read: an activation made meanwhile. */
  let meanwhile: (() => Promise<void>) | null = null;
  const clock = new TestClock();
  let counter = 0;

  const activate = async (
    number: string,
    change?: Parameters<typeof persona>[1],
  ): Promise<PersonaVersionId> =>
    (
      await app.modules.persona.versions.load(cleo, persona(number, change), {
        sourcePath: 'test',
        activate: true,
      })
    ).version.id;

  async function fanWrites(conversation: string): Promise<ConversationId> {
    counter += 1;
    const { conversationId } = await conversations.ingestMessage({
      creatorId: cleo,
      platformAccountId: account,
      platformConversationId: conversation,
      platformFanId: `fan-${conversation}`,
      fanDisplayName: 'Jules',
      message: {
        ref: { platform: 'reveal', id: `ap-${String(counter)}` },
        conversationRef: { platform: 'reveal', id: conversation },
        direction: 'inbound',
        text: 'Salut',
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

  async function latestDraft(conversationId: ConversationId) {
    const [draft] = await test.admin.db
      .select({ id: schema.drafts.id, personaVersionId: schema.drafts.personaVersionId })
      .from(schema.drafts)
      .where(eq(schema.drafts.conversationId, conversationId))
      .orderBy(sql`${schema.drafts.createdAt} desc`)
      .limit(1);
    if (draft === undefined) throw new Error('no draft');
    return { id: DraftIdSchema.parse(draft.id), personaVersionId: draft.personaVersionId };
  }

  /** He writes, the agent answers: the draft it wrote. */
  async function drafted(conversation: string) {
    const conversationId = await fanWrites(conversation);
    clock.current = new Date(clock.current.getTime() + 60_000);
    await conversations.jobs.respond({ creatorId: cleo, conversationId, correlationId: 'test' }, NO_LOG);
    return { conversationId, draft: await latestDraft(conversationId) };
  }

  const approve = (conversationId: ConversationId, draftId: DraftId) =>
    conversations.approveDraft({
      creatorId: cleo,
      conversationId,
      draftId,
      userId: USER,
      correlationId: 'test',
    });

  async function followUpPayload(conversationId: ConversationId) {
    const result = await test.admin.db.execute(
      sql`select run_at, payload from graphile_worker._private_jobs where key = ${`conversation.follow_up:${conversationId}`}`,
    );
    const [job] = z.array(z.object({ run_at: z.coerce.date(), payload: z.unknown() })).parse(result.rows);
    if (job === undefined) throw new Error('no follow-up');
    const payload: JobPayload<'conversation.follow_up'> = z
      .object({
        creatorId: CreatorIdSchema,
        conversationId: z.string(),
        correlationId: z.string(),
        anchorAt: z.string(),
        step: z.number(),
      })
      .transform((p) => ({ ...p, conversationId }))
      .parse(job.payload);
    return { runAt: job.run_at, payload };
  }

  async function journal(conversationId: ConversationId): Promise<string[]> {
    const rows = await test.admin.db
      .select({ type: schema.conversationEvents.type })
      .from(schema.conversationEvents)
      .where(eq(schema.conversationEvents.conversationId, conversationId))
      .orderBy(schema.conversationEvents.seq);
    return rows.map((row) => row.type);
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
    app = await createApp(config, createLogger(config));
    cleo = (await app.modules.persona.creators.create({ displayName: 'Cleo' })).id;
    account = newId(PlatformAccountIdSchema);
    await test.admin.db.insert(schema.platformAccounts).values({
      id: account,
      creatorId: cleo,
      platform: 'reveal',
      handle: 'active-persona-drafts',
      sessionState: 'valid',
    });
    // Read from the base at each call, as the composition root wires it: nothing kept in memory (ADR 0022).
    const activePersona: ActivePersonaSource = (creatorId) =>
      app.modules.persona.versions.active(CreatorIdSchema.parse(creatorId));
    real = startDraftComposer({
      gateway: GATEWAY,
      activePersona,
      fans: app.modules.fans,
      timeZoneOf: () => Promise.resolve('Europe/Paris'),
    });
    const guard = startBubbleGuard({ activePersona });
    conversations = createConversationsModule({
      db: test.app.db,
      fans: app.modules.fans,
      sender: new FakeSender(clock),
      requireRole: () => () => Promise.resolve(),
      recentLogin: () => Promise.resolve(),
      voice: { voicePrompt: 'voice@test', voiceModel: 'grok-4.7' },
      guard: {
        forCreator: async (creatorId) => {
          const hers = await guard.forCreator(creatorId);
          return hers === null
            ? null
            : { check: (bubbles, { history }) => hers.check(bubbles, guardContextOf(history)) };
        },
      },
      composer: {
        compose: async (input) => {
          const result = await real.compose(input);
          await meanwhile?.();
          return result;
        },
      },
      followUps: startFollowUpPlan({ activePersona, now: () => clock.now() }),
      clock,
    });
  });

  afterAll(async () => {
    await app.shutdown();
    await test.close();
  });

  it('marks each draft with the version that wrote it, and the next one after an activation with the new one', async () => {
    const first = await activate('1.0.0');
    expect((await drafted('ap-before')).draft.personaVersionId).toBe(first);
    // No cache survives an activation: the very next draft is written with, and carries, the new version.
    const second = await activate('1.1.0');
    expect((await drafted('ap-after')).draft.personaVersionId).toBe(second);
  });

  it('keeps on a draft the version it was written with, even when another is activated before it is saved', async () => {
    const reading = await activate('1.2.0');
    let activatedMeanwhile: PersonaVersionId | null = null;
    meanwhile = async () => {
      activatedMeanwhile = await activate('1.3.0');
    };
    try {
      const { draft } = await drafted('ap-race');
      expect(activatedMeanwhile).not.toBeNull();
      expect(draft.personaVersionId).toBe(reading);
    } finally {
      meanwhile = null;
    }
  });

  it('reads the guards of the version active at approval, not of the one that wrote the draft', async () => {
    await activate('2.0.0');
    const { conversationId, draft } = await drafted('ap-guard');
    // Written as « Coucou toi » under 2.0.0; 2.1.0 says she never writes « coucou ».
    await activate('2.1.0', { neverSay: ['coucou'] });
    await expect(approve(conversationId, draft.id)).rejects.toMatchObject({ code: 'draft_unprocessable' });
    // Back on a version without that word, the same draft goes.
    await activate('2.0.0');
    await approve(conversationId, draft.id);
    const [approved] = await test.admin.db
      .select({ status: schema.drafts.status })
      .from(schema.drafts)
      .where(eq(schema.drafts.id, draft.id));
    expect(approved?.status).toBe('approved');
  });

  it('keeps the follow-ups already planned at their hour: written with the version active when they go, cut when it has no such step', async () => {
    await activate('3.0.0', { delays: [12, 24] });
    const { conversationId, draft } = await drafted('ap-follow-up');
    await approve(conversationId, draft.id);
    await conversations.jobs.send(
      { creatorId: cleo, conversationId, draftId: draft.id, correlationId: 'test' },
      NO_LOG,
      1,
    );
    const planned = await followUpPayload(conversationId);

    // A new version with other delays: the planned follow-up keeps its hour, nothing is computed again.
    const later = await activate('3.1.0', { delays: [6, 48] });
    expect((await followUpPayload(conversationId)).runAt).toEqual(planned.runAt);
    clock.current = new Date(new Date(planned.payload.anchorAt).getTime() + 12 * HOUR_MS);
    await conversations.jobs.followUp(planned.payload, NO_LOG);
    const followUp = await latestDraft(conversationId);
    expect(followUp.id).not.toBe(draft.id);
    expect(followUp.personaVersionId).toBe(later);

    // Her version without follow-ups: the next step planned no longer exists, it is cancelled, never written.
    await approve(conversationId, followUp.id);
    await conversations.jobs.send(
      { creatorId: cleo, conversationId, draftId: followUp.id, correlationId: 'test' },
      NO_LOG,
      1,
    );
    const next = await followUpPayload(conversationId);
    await activate('3.2.0', { followUpsOn: false });
    clock.current = new Date(new Date(next.payload.anchorAt).getTime() + 48 * HOUR_MS);
    await conversations.jobs.followUp(next.payload, NO_LOG);
    expect((await latestDraft(conversationId)).id).toBe(followUp.id);
    expect((await journal(conversationId)).at(-1)).toBe('follow_up_cancelled');
  });
});
