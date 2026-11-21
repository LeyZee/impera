import {
  CreatorIdSchema,
  DraftIdSchema,
  FanFlagsSchema,
  FanIdSchema,
  newId,
  PlatformAccountIdSchema,
  UserIdSchema,
  type ConversationId,
  type CreatorId,
  type DraftId,
  type FanFlags,
  type FanId,
  type Persona,
  type PlatformAccountId,
  type SendResult,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import type { LlmGateway } from '@impera/llm';
import { inject } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../../auth';
import { createApp, type App, type AppOptions } from '../../composition-root';
import { createLogger } from '../../logger';
import {
  guardContextOf,
  startBubbleGuard,
  startDraftComposer,
  type ActivePersonaSource,
  type DraftComposerStartOptions,
} from '../../modules/agent';
import {
  createConversationsModule,
  type Clock,
  type ConversationsModule,
  type OutboundSender,
} from '../../modules/conversations';
import { buildServer, type Server } from '../../server';

import { testConfig } from './config';
import { fakeGateway, type GatewayScript, type GatewaySeen } from './llm';
import { DEMO_PERSONA } from './persona';
import { DASHBOARD_ORIGIN, signIn } from './sign-in';

/** 9 h in Paris on a Thursday: inside her hours, far from midnight. */
export const T0 = new Date('2026-10-29T08:00:00.000Z');
const NO_LOG = { info: (): undefined => undefined, warn: (): undefined => undefined };
const APPROVER = UserIdSchema.parse('0199f2a0-0000-7000-8000-000000000003');
const OWNER = { email: 'owner@recette.test', name: 'Owner', password: 'correct horse battery staple' };

export class TestClock implements Clock {
  constructor(public current: Date = T0) {}
  now(): Date {
    return this.current;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** What left towards the platform, in order: the side a fan would see. */
export interface RecordedSend {
  readonly kind: 'text' | 'step';
  readonly text: string;
  readonly idempotencyKey: string;
}

/** A sender that answers like the platform and keeps every send: nothing leaves this machine. */
export class RecordingSender implements OutboundSender {
  readonly sent: RecordedSend[] = [];
  constructor(private readonly clock: Clock) {}
  sendText(_conversation: unknown, text: string, key: string): Promise<SendResult> {
    this.sent.push({ kind: 'text', text, idempotencyKey: key });
    return Promise.resolve({
      messageRef: { platform: 'reveal', id: `out-${key}` },
      sentAt: this.clock.now().toISOString(),
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

export interface JourneyOptions {
  /** Her active version; the demo persona otherwise. */
  readonly persona?: Persona;
  /** The journey's first instant; `T0` otherwise. */
  readonly start?: Date;
  /** What the configuration adds (the session keys FakeReveal's connector needs). */
  readonly config?: NodeJS.ProcessEnv;
  /** What the app is built with (FakeReveal's connectors, their clock). */
  readonly appOptions?: AppOptions;
  /** The platform account's handle, as FakeReveal's session names it. */
  readonly handle?: string;
  /** Where her messages go; a `RecordingSender` otherwise. */
  readonly sender?: (app: App) => OutboundSender;
  /** The models the composer calls; the scripted fake gateway (`journey.models`) otherwise. */
  readonly gateway?: (app: App, clock: TestClock) => Promise<LlmGateway>;
  /** Her scripts and his last offer (ADR 0098); without them she sells nothing. */
  readonly sales?: (
    app: App,
    accountId: PlatformAccountId,
  ) => Pick<DraftComposerStartOptions, 'scripts' | 'lastOfferAt'>;
}

/**
 * One creator, her active persona, and the agent's own composer (`startDraftComposer`: brain, policy, voice, hard
 * guards, `composeTurn`) on a real database, with fake models: the path a fan's message takes, the LLM aside.
 */
export interface Journey {
  readonly test: TestDb;
  readonly app: App;
  readonly clock: TestClock;
  readonly creatorId: CreatorId;
  readonly accountId: PlatformAccountId;
  readonly conversations: ConversationsModule;
  /** What the fake models were asked. */
  readonly seen: GatewaySeen;
  /** The sender when none was given: what left. */
  readonly sender: RecordingSender;
  /** What the fake models answer from now on. */
  models(script: GatewayScript): void;
  /** He writes in this thread of the platform (as this fan of the platform when given); his conversation. */
  fanWrites(thread: string, text: string, platformFanId?: string): Promise<ConversationId>;
  /** `conversation.respond` a minute later, as the worker runs it. */
  respond(conversationId: ConversationId): Promise<void>;
  /** `conversation.send` of this draft, at this attempt. */
  send(conversationId: ConversationId, draftId: string, attempt?: number): Promise<void>;
  /** A human approves it, with the bubbles a chatter edited when given. */
  approve(conversationId: ConversationId, draftId: string, bubbles?: readonly string[]): Promise<void>;
  state(conversationId: ConversationId): Promise<ConversationRow>;
  flags(fanId: FanId): Promise<FanFlags>;
  drafts(conversationId: ConversationId): Promise<DraftRow[]>;
  journal(conversationId: ConversationId): Promise<{ type: string; payload: unknown }[]>;
  /** The handoffs to a human the journal holds: their cause and codes. */
  handoffs(conversationId: ConversationId): Promise<{ cause: string; detail: readonly string[] }[]>;
  /** A dashboard request by the owner, signed in once. */
  asOwner(method: 'GET' | 'POST' | 'PUT', url: string, payload?: object): Promise<OwnerResponse>;
  close(): Promise<void>;
}

/** What the dashboard answered. */
export interface OwnerResponse {
  readonly statusCode: number;
  readonly body: string;
  json(): unknown;
}

export interface ConversationRow {
  readonly state: string;
  readonly fanId: FanId;
  readonly careSince: Date | null;
}

export interface DraftRow {
  readonly id: string;
  readonly status: string;
  readonly bubbles: readonly string[];
  /** The step of her script it carries, as stored (`policy_trace`). */
  readonly policyTrace: unknown;
}

export async function startJourney(options: JourneyOptions = {}): Promise<Journey> {
  const test = await createTestDb(inject('pgSuperuserUrl'));
  const config = testConfig({
    DATABASE_URL: test.appUrl,
    DATABASE_SERVICE_URL: test.serviceUrl,
    ...options.config,
  });
  const app = await createApp(config, createLogger(config), options.appOptions);
  const clock = new TestClock(options.start);
  const creatorId = (await app.modules.persona.creators.create({ displayName: 'Créatrice de test' })).id;
  const accountId = newId(PlatformAccountIdSchema);
  await test.admin.db.insert(schema.platformAccounts).values({
    id: accountId,
    creatorId,
    platform: 'reveal',
    handle: options.handle ?? 'journey',
    sessionState: 'valid',
  });
  await app.modules.persona.versions.load(creatorId, options.persona ?? DEMO_PERSONA, {
    sourcePath: 'test',
    activate: true,
  });

  let script: GatewayScript = {};
  const seen: GatewaySeen = { voiceCalls: 0, traces: [], brainInputs: [], voiceInputs: [] };
  const gateway =
    options.gateway === undefined ? fakeGateway(() => script, seen) : await options.gateway(app, clock);
  // Read from the base at each call, as the composition root wires it (ADR 0022).
  const activePersona: ActivePersonaSource = (creator) =>
    app.modules.persona.versions.active(CreatorIdSchema.parse(creator));
  const composer = startDraftComposer({
    gateway,
    activePersona,
    fans: app.modules.fans,
    timeZoneOf: () => Promise.resolve('Europe/Paris'),
    ...options.sales?.(app, accountId),
  });
  const guard = startBubbleGuard({ activePersona });
  const recording = new RecordingSender(clock);
  const conversations = createConversationsModule({
    db: test.app.db,
    adminDb: test.service.db,
    fans: app.modules.fans,
    sender: options.sender?.(app) ?? recording,
    requireRole: () => () => Promise.resolve(),
    recentLogin: () => Promise.resolve(),
    voice: { voicePrompt: 'voice@test', voiceModel: 'grok-4.7' },
    guard: {
      forCreator: async (creator) => {
        const hers = await guard.forCreator(creator);
        return hers === null
          ? null
          : {
              check: (bubbles, { history, care, hasMedia }) =>
                hers.check(bubbles, guardContextOf(history, hasMedia === true), care === true),
            };
      },
    },
    composer,
    clock,
  });

  let server: Server | null = null;
  let cookie: string | null = null;
  const ownerCookie = async (): Promise<{ server: Server; cookie: string }> => {
    if (server === null || cookie === null) {
      server = await buildServer({
        config,
        logger: createLogger(config),
        routes: app.routes,
        readiness: app.readiness,
      });
      await createOwner(app.auth, app.db.db, OWNER);
      cookie = await signIn(server, OWNER.email, OWNER.password);
    }
    return { server, cookie };
  };

  const journal = (conversationId: ConversationId) =>
    test.admin.db
      .select({ type: schema.conversationEvents.type, payload: schema.conversationEvents.payload })
      .from(schema.conversationEvents)
      .where(eq(schema.conversationEvents.conversationId, conversationId))
      .orderBy(schema.conversationEvents.seq);

  let counter = 0;
  return {
    test,
    app,
    clock,
    creatorId,
    accountId,
    conversations,
    seen,
    sender: recording,
    models(next) {
      script = next;
      seen.voiceCalls = 0;
    },
    async fanWrites(thread, text, platformFanId) {
      counter += 1;
      const { conversationId } = await conversations.ingestMessage({
        creatorId,
        platformAccountId: accountId,
        platformConversationId: thread,
        platformFanId: platformFanId ?? `fan-${thread}`,
        fanDisplayName: 'Fan de test',
        message: {
          ref: { platform: 'reveal', id: `journey-${String(counter)}` },
          conversationRef: { platform: 'reveal', id: thread },
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
    },
    async respond(conversationId) {
      clock.advance(60_000);
      await conversations.jobs.respond({ creatorId, conversationId, correlationId: 'test' }, NO_LOG);
    },
    async send(conversationId, draftId, attempt = 1) {
      await conversations.jobs.send(
        { creatorId, conversationId, draftId: draftIdOf(draftId), correlationId: 'test' },
        NO_LOG,
        attempt,
      );
    },
    approve: (conversationId, draftId, bubbles) =>
      conversations.approveDraft({
        creatorId,
        conversationId,
        draftId: draftIdOf(draftId),
        ...(bubbles !== undefined && { bubbles }),
        userId: APPROVER,
        correlationId: 'test',
      }),
    async state(conversationId) {
      const [row] = await test.admin.db
        .select({
          state: schema.conversations.state,
          fanId: schema.conversations.fanId,
          careSince: schema.conversations.careSince,
        })
        .from(schema.conversations)
        .where(eq(schema.conversations.id, conversationId));
      if (row === undefined) throw new Error('no conversation');
      return { state: row.state, fanId: FanIdSchema.parse(row.fanId), careSince: row.careSince };
    },
    async flags(fanId) {
      const [row] = await test.admin.db
        .select({ flags: schema.fans.flags })
        .from(schema.fans)
        .where(eq(schema.fans.id, fanId));
      return FanFlagsSchema.parse(row?.flags ?? {});
    },
    async drafts(conversationId) {
      const rows = await test.admin.db
        .select({
          id: schema.drafts.id,
          status: schema.drafts.status,
          bubbles: schema.drafts.bubbles,
          policyTrace: schema.drafts.policyTrace,
        })
        .from(schema.drafts)
        .where(eq(schema.drafts.conversationId, conversationId))
        .orderBy(schema.drafts.createdAt);
      return rows.map((row) => ({ ...row, bubbles: row.bubbles }));
    },
    journal,
    async handoffs(conversationId) {
      const events = await journal(conversationId);
      return events
        .filter((event) => event.type === 'handoff_requested')
        .map((event) => HandoffSchema.parse(event.payload));
    },
    async asOwner(method, url, payload) {
      const { server: open, cookie: session } = await ownerCookie();
      return open.inject({
        method,
        url,
        headers: { cookie: session, origin: DASHBOARD_ORIGIN },
        ...(payload !== undefined && { payload }),
      });
    },
    async close() {
      if (server !== null) await server.close();
      await app.shutdown();
      await test.close();
    },
  };
}

const draftIdOf = (id: string): DraftId => DraftIdSchema.parse(id);

const HandoffSchema = z.object({ cause: z.string(), detail: z.array(z.string()) });
