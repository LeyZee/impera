import { createHmac } from 'node:crypto';

import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';

import type { RevealFetch } from '../../modules/connectors';

import { FIXTURES, type FixtureName } from './fixtures';
import {
  ENDPOINTS,
  EndpointNameSchema,
  FakeFixtureSchema,
  MediaTypeSchema,
  type EndpointName,
  type FakeConversation,
  type FakeFixture,
  type FakeMedia,
  type FakeMessage,
  type FakeScript,
  type FakeTransaction,
  type WireMedia,
  type WireMessageItem,
} from './model';

/**
 * FakeReveal (docs/reference/fake-reveal.md): an HTTP server that imitates Reveal's private API
 * (`api.reveal.me`), for the connector's contract test and for local development without a Reveal account.
 * Test-only: nothing in `src` outside `__tests__` imports it.
 *
 * Paths, parameters, orders and shapes follow the captures of 2026-11-10 (reveal-api-observed.md). What the
 * captures did not show is marked PROVISIONAL where it is coded: error bodies, the invalid-session answer, media
 * file links, upload keys, notification types. The control routes under `/__` do not exist on Reveal; they drive
 * the scenarios. FakeReveal has its own clock, moved only by `POST /__clock`, so a test decides when time passes.
 */

const LINK_TTL_MS = 10 * 60_000;
const LINK_SECRET = 'fake-reveal-link-secret';
const PUBLIC_URL = 'http://fake-reveal.test';
/** Invented: the real agency share never enters the repository. Reveal's own 18 % and VAT 20 % are public. */
const AGENCY_PERCENTAGE = 30;
/** Seen on every API answer (headers.md); FakeReveal sends them without counting. */
const RATE_LIMIT_HEADERS = {
  'x-ratelimit-limit-short': '50',
  'x-ratelimit-remaining-short': '49',
  'x-ratelimit-reset-short': '1',
  'x-ratelimit-limit-medium': '100',
  'x-ratelimit-remaining-medium': '99',
  'x-ratelimit-reset-medium': '10',
  'x-ratelimit-limit-long': '200',
  'x-ratelimit-remaining-long': '199',
  'x-ratelimit-reset-long': '60',
} as const;
/** `POST /conversations/:id/messages` only (headers.md): 60 sends a minute per token, `x-ratelimit-reset` in epoch seconds. */
const SEND_LIMIT = 60;
const SEND_WINDOW_MS = 60_000;
/** Tiny but real files, so a test can check magic bytes: a 1×1 PNG, the head of an MP4 and of an MP3. */
const FILES = {
  photo: {
    mimeType: 'image/png',
    data: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  },
  video: {
    mimeType: 'video/mp4',
    data: Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex'),
  },
  audio: { mimeType: 'audio/mpeg', data: Buffer.from('4944330300000000000f', 'hex') },
} as const;

const AtSchema = z.number().int().min(0).default(0);

/** `POST /__scenario`: what the platform does next (fake-reveal.md § Scénarios pilotables). */
export const ScenarioEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('fan_message'),
    atMs: AtSchema,
    conversationId: z.string(),
    text: z.string(),
    mediaType: MediaTypeSchema.optional(),
  }),
  z.object({ type: z.literal('purchase'), atMs: AtSchema, messageId: z.string() }),
  z.object({ type: z.literal('session_expired'), atMs: AtSchema }),
  z.object({
    type: z.literal('rate_limited'),
    requests: z.number().int().min(1),
    retryAfterSeconds: z.number().int(),
  }),
  z.object({
    type: z.literal('server_error'),
    times: z.number().int().min(1),
    status: z.union([z.literal(500), z.literal(502), z.literal(503)]),
  }),
  z.object({ type: z.literal('latency'), ms: z.number().int().min(0).max(10_000) }),
  /**
   * « Envoi accepté puis coupure » (P2-03): the next `times` sends are taken, the message is in the thread, but the
   * answer never comes back (504 from the gateway, as a cut connection would leave the client): the outcome is unknown.
   */
  z.object({ type: z.literal('send_answer_lost'), times: z.number().int().min(1) }),
  /**
   * « Message listé en retard » (P2-03): from now on, `messages.list` leaves out a message sent from the creator's side
   * until it is `ms` old by FakeReveal's clock (0 lists it at once again), as Reveal may list a message just taken late.
   */
  z.object({ type: z.literal('send_listed_late'), ms: z.number().int().min(0).max(600_000) }),
  z.object({ type: z.literal('challenge'), times: z.number().int().min(1) }),
  z.object({ type: z.literal('conversation_gone'), atMs: AtSchema, conversationId: z.string() }),
  z.object({
    type: z.literal('script_changed'),
    atMs: AtSchema,
    scriptId: z.string(),
    priceCents: z.number().int().min(0),
  }),
  z.object({
    type: z.literal('shape_changed'),
    endpoint: EndpointNameSchema,
    rename: z.object({ from: z.string(), to: z.string() }),
  }),
]);
export type ScenarioEvent = z.infer<typeof ScenarioEventSchema>;
type TimedEvent = Extract<ScenarioEvent, { atMs: number }>;

/** PROVISIONAL: no 4xx was seen on api.reveal.me; the body follows the usual `{ statusCode, message }`. */
class HttpFault extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function notFound(): HttpFault {
  return new HttpFault(404, 'Not Found');
}

/** The platform's state and its rules, apart from HTTP. */
class FakeRevealWorld {
  state: FakeFixture;
  private clockMs: number;
  private counter = 0;
  private pending: { dueMs: number; event: TimedEvent }[] = [];
  /** Presigned uploads waiting for their PUT, then usable as `files[].key`. */
  uploads = new Map<string, { type: FakeMedia['type']; done: boolean }>();
  faults = {
    rateLimited: 0,
    retryAfterSeconds: 0,
    serverErrors: 0,
    serverStatus: 500,
    challenges: 0,
    latencyMs: 0,
    lostSendAnswers: 0,
    listedLateMs: 0,
  };
  /** The send window (60 a minute): when it opened, by FakeReveal's clock, and how many sends it took. */
  sendWindow = { startMs: 0, count: 0 };
  renames = new Map<EndpointName, { from: string; to: string }>();
  sessionValid = true;

  constructor(fixture: FakeFixture) {
    this.state = structuredClone(fixture);
    this.clockMs = Date.parse(fixture.now);
  }

  now(): string {
    return new Date(this.clockMs).toISOString();
  }

  nowMs(): number {
    return this.clockMs;
  }

  advance(ms: number): void {
    this.clockMs += ms;
    this.fireDue();
  }

  schedule(event: ScenarioEvent): void {
    switch (event.type) {
      case 'rate_limited':
        this.faults.rateLimited += event.requests;
        this.faults.retryAfterSeconds = event.retryAfterSeconds;
        return;
      case 'server_error':
        this.faults.serverErrors += event.times;
        this.faults.serverStatus = event.status;
        return;
      case 'challenge':
        this.faults.challenges += event.times;
        return;
      case 'latency':
        this.faults.latencyMs = event.ms;
        return;
      case 'send_answer_lost':
        this.faults.lostSendAnswers += event.times;
        return;
      case 'send_listed_late':
        this.faults.listedLateMs = event.ms;
        return;
      case 'shape_changed':
        this.renames.set(event.endpoint, event.rename);
        return;
      case 'fan_message':
      case 'purchase':
      case 'session_expired':
      case 'conversation_gone':
      case 'script_changed':
        this.pending.push({ dueMs: this.clockMs + event.atMs, event });
        this.fireDue();
        return;
    }
  }

  private fireDue(): void {
    const due = this.pending.filter((p) => p.dueMs <= this.clockMs).sort((a, b) => a.dueMs - b.dueMs);
    this.pending = this.pending.filter((p) => p.dueMs > this.clockMs);
    for (const { event } of due) this.apply(event);
  }

  private apply(event: TimedEvent): void {
    switch (event.type) {
      case 'fan_message': {
        const conversation = this.conversation(event.conversationId);
        const mediaIds: string[] = [];
        if (event.mediaType !== undefined) {
          const media: FakeMedia = {
            id: this.nextId('media'),
            type: event.mediaType,
            folderId: null,
            fromFanId: conversation.fanId,
            durationSeconds: event.mediaType === 'photo' ? null : 12,
            createdAt: this.now(),
          };
          this.state.media.push(media);
          mediaIds.push(media.id);
        }
        conversation.modelIsUnread = true;
        conversation.memberLastReadAt = this.now();
        const created = this.newMessage({
          conversationId: conversation.id,
          direction: 'in',
          content: event.text,
          mediaIds,
        });
        this.state.messages.push(created);
        this.notify('new_message', conversation.id);
        return;
      }
      case 'purchase': {
        const bought = this.state.messages.find((m) => m.id === event.messageId);
        const bundle = bought?.bundle;
        if (bought === undefined || bundle == null) return;
        if (bundle.paidAt !== null) return;
        const transaction: FakeTransaction = {
          id: this.nextId('tx'),
          fanId: this.conversation(bought.conversationId).fanId,
          type: 'bundle',
          amountCents: bundle.priceCents,
          messageId: bought.id,
          createdAt: this.now(),
        };
        bundle.paidAt = transaction.createdAt;
        bundle.transactionId = transaction.id;
        this.state.transactions.push(transaction);
        this.notify('new_purchase', bought.conversationId);
        return;
      }
      case 'session_expired':
        this.sessionValid = false;
        return;
      case 'conversation_gone':
        this.conversation(event.conversationId).gone = true;
        return;
      case 'script_changed': {
        const script = this.state.scripts.find((s) => s.id === event.scriptId);
        if (script !== undefined) script.priceCents = event.priceCents;
        return;
      }
    }
  }

  /** PROVISIONAL: the types are masked in the capture; these names are FakeReveal's. */
  private notify(type: string, conversationId: string): void {
    this.state.notifications.push({ id: this.nextId('notif'), type, conversationId, createdAt: this.now() });
  }

  nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_new_${String(this.counter).padStart(4, '0')}`;
  }

  newMessage(
    input: Pick<FakeMessage, 'conversationId' | 'direction' | 'content'> & Partial<FakeMessage>,
  ): FakeMessage {
    return {
      id: this.nextId('msg'),
      mediaIds: [],
      bundle: null,
      author: null,
      scriptId: null,
      isUnread: false,
      createdAt: this.now(),
      ...input,
    };
  }

  conversation(id: string): FakeConversation {
    const found = this.state.conversations.find((c) => c.id === id && !c.gone);
    if (found === undefined) throw notFound();
    return found;
  }

  fan(id: string): FakeFixture['fans'][number] {
    const found = this.state.fans.find((f) => f.id === id);
    if (found === undefined) throw notFound();
    return found;
  }

  media(id: string): FakeMedia {
    const found = this.state.media.find((m) => m.id === id);
    if (found === undefined) throw new HttpFault(400, `Media ${id} not found`);
    return found;
  }

  checkModel(modelId: string): void {
    if (modelId !== this.state.model.id) throw notFound();
  }

  /** Newest first, as Reveal pages a conversation. */
  /** Whether `messages.list` shows this message yet (`send_listed_late`): a sent one only once old enough. */
  listed(message: FakeMessage): boolean {
    return (
      message.direction === 'in' || this.clockMs - Date.parse(message.createdAt) >= this.faults.listedLateMs
    );
  }

  messagesOf(conversationId: string): FakeMessage[] {
    return this.state.messages
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }

  totalSpent(fanId: string): number {
    return this.state.transactions
      .filter((t) => t.fanId === fanId)
      .reduce((sum, t) => sum + t.amountCents, 0);
  }

  linkSignature(mediaId: string, expiresMs: number): string {
    return createHmac('sha256', LINK_SECRET)
      .update(`${mediaId}:${String(expiresMs)}`)
      .digest('hex')
      .slice(0, 32);
  }

  /* ----------------------------------------------- Wire builders ------------------------------------------------ */

  /** PROVISIONAL (L14): every URL is a FakeReveal link signed for 10 minutes; Reveal serves CDN and HLS links. */
  wireMedia(media: FakeMedia): WireMedia {
    const expiresMs = this.clockMs + LINK_TTL_MS;
    const url = `${PUBLIC_URL}/files/${media.id}?exp=${String(expiresMs)}&sig=${this.linkSignature(media.id, expiresMs)}`;
    const base = {
      id: media.id,
      blurhash: 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH',
      createdAt: media.createdAt,
      updatedAt: media.createdAt,
      url,
      smallUrl: url,
      mediumUrl: url,
      largeUrl: url,
      type: media.type,
      isArchived: false,
      modelId: this.state.model.id,
      name: null,
      durationSeconds: media.durationSeconds,
    };
    // A fan's file carries its sender and none of the vault fields (capture, question 7).
    if (media.fromFanId !== null) return { ...base, incomingMessageMemberId: media.fromFanId };
    return { ...base, isHls: media.type === 'video', thumbnailUrl: url, moderationStatus: 'approved' };
  }

  wireConversation(c: FakeConversation): z.infer<(typeof ENDPOINTS)['conversations.read']['shape']> {
    const fan = this.fan(c.fanId);
    const last = this.messagesOf(c.id)[0];
    return {
      id: c.id,
      modelIsUnread: c.modelIsUnread,
      memberIsUnread: this.state.messages.some((m) => m.conversationId === c.id && m.isUnread),
      memberLastReadAt: c.memberLastReadAt,
      isBlockedByModel: false,
      isPinned: c.isPinned,
      isExcludedFromMassDM: false,
      isTeamPinned: false,
      assignedInbox: 1,
      lastMessageAt: last?.createdAt ?? null,
      createdAt: c.createdAt,
      updatedAt: last?.createdAt ?? c.createdAt,
      lastMessageId: last?.id ?? null,
      memberId: c.fanId,
      modelId: this.state.model.id,
      ...(c.note === null ? {} : { note: c.note }),
      ...(fan.firstName === null ? {} : { memberFirstname: fan.firstName }),
    };
  }

  wireMember(fanId: string): z.infer<(typeof ENDPOINTS)['conversations.get']['shape']>['member'] {
    const fan = this.fan(fanId);
    return {
      id: fan.id,
      authorMessageId: `author_${fan.id}`,
      createdAt: fan.createdAt,
      updatedAt: fan.createdAt,
      vipUntil: null,
      userName: fan.userName,
      userId: `user_${fan.id}`,
      ...(fan.cardVerifiedAt === null ? {} : { cardVerifiedAt: fan.cardVerifiedAt }),
    };
  }

  wireMessageCore(m: FakeMessage): z.infer<(typeof ENDPOINTS)['messages.send']['shape']> {
    return {
      id: m.id,
      ...(m.bundle === null ? {} : { bundleId: m.bundle.id }),
      createdAt: m.createdAt,
      updatedAt: m.bundle?.paidAt ?? m.createdAt,
      isUnread: m.isUnread,
      content: m.content,
      type: 'default',
    };
  }

  wireConversationItem(c: FakeConversation): z.infer<(typeof ENDPOINTS)['conversations.get']['shape']> {
    const last = this.messagesOf(c.id)[0];
    return {
      conversation: this.wireConversation(c),
      lastMessageAuthor: last?.direction === 'in' ? { member: this.wireMember(c.fanId) } : {},
      lastMessage: last === undefined ? null : this.wireMessageCore(last),
      lastMessageHasMedia: last !== undefined && (last.mediaIds.length > 0 || last.bundle !== null),
      member: this.wireMember(c.fanId),
      model: {
        id: this.state.model.id,
        avatarUrl: `${PUBLIC_URL}/avatar`,
        bannerUrl: `${PUBLIC_URL}/banner`,
        avatarThumbUrl: `${PUBLIC_URL}/avatar-thumb`,
        bannerPreviewUrl: `${PUBLIC_URL}/banner-preview`,
        displayName: this.state.model.displayName,
        description: 'Description de test',
        userName: this.state.model.userName,
        incomingMediaPrice: 0,
        isVisible: true,
        engagementPopupMessage: '',
        isAI: false,
        requireCardVerificationForFreeSubscription: false,
        isOfficialAccount: false,
      },
      memberTotalSpent: this.totalSpent(c.fanId),
      memberLastSeenAt: c.memberLastReadAt,
      modelCreatorNote: this.state.model.creatorNote,
      isExcludedFromMassDM: false,
    };
  }

  wireMessageItem(m: FakeMessage): WireMessageItem {
    const fan = this.fan(this.conversation(m.conversationId).fanId);
    const bundle = m.bundle;
    const teasing = bundle?.teasingMediaIds.map((id) => this.wireMedia(this.media(id))) ?? [];
    return {
      message: this.wireMessageCore(m),
      medias: m.mediaIds.map((id) => this.wireMedia(this.media(id))),
      ...(bundle === null
        ? {}
        : {
            bundleWithMedias: {
              bundle: {
                id: bundle.id,
                createdAt: m.createdAt,
                updatedAt: bundle.paidAt ?? m.createdAt,
                price: bundle.priceCents,
                type: 'media',
                ...(bundle.paidAt === null ? {} : { isPaid: true }),
                ...(bundle.transactionId === null ? {} : { transactionId: bundle.transactionId }),
                modelId: this.state.model.id,
                memberId: fan.id,
              },
              medias: bundle.mediaIds.map((id) => this.wireMedia(this.media(id))),
              ...(teasing[0] === undefined ? {} : { teasingMedia: teasing[0] }),
              teasingMedias: teasing,
            },
          }),
      authorMessage:
        m.direction === 'in'
          ? { displayName: fan.userName, memberId: fan.id }
          : { displayName: m.author ?? this.state.model.displayName },
      reactions: [],
      replyTo: null,
      storyReply: null,
    };
  }

  wireScriptCore(
    s: FakeScript,
  ): z.infer<(typeof ENDPOINTS)['scripts.list']['shape']>['data'][number]['script'] {
    return {
      id: s.id,
      createdAt: s.createdAt,
      updatedAt: s.createdAt,
      name: s.name,
      content: s.content,
      ...(s.priceCents === null ? {} : { price: s.priceCents }),
    };
  }

  /** Messages sent from a step, across conversations or in one. */
  usesOf(scriptId: string, conversationId?: string): FakeMessage[] {
    return this.state.messages.filter(
      (m) => m.scriptId === scriptId && (conversationId === undefined || m.conversationId === conversationId),
    );
  }

  /** Reveal's split of a sale (capture): VAT 20 % inside, then Reveal 18 %, then the agency, the rest to the model. */
  wireTransaction(
    t: FakeTransaction,
  ): z.infer<(typeof ENDPOINTS)['transactions.list']['shape']>['data'][number] {
    const amount = t.amountCents;
    const vatFee = Math.round((amount * 20) / 120);
    const platformFee = Math.round((amount - vatFee) * 0.18);
    const processorFee = Math.round(amount * 0.097);
    const agencyFee = Math.round(((amount - vatFee - platformFee) * AGENCY_PERCENTAGE) / 100);
    return {
      id: t.id,
      createdAt: t.createdAt,
      updatedAt: t.createdAt,
      amount,
      status: 'paid',
      type: t.type,
      modelId: this.state.model.id,
      memberId: t.fanId,
      agencyMemberId: null,
      platformFee,
      platformPercentage: 18,
      platformRevenue: platformFee - processorFee,
      agencyFee,
      agencyPercentage: AGENCY_PERCENTAGE,
      processorFee,
      vatFee,
      vatPercentage: 20,
      modelRevenue: amount - vatFee - platformFee - agencyFee,
      isProcessedSuccessfully: true,
      uid: `uid_${t.id}`,
      providerTransactionId: `provider_${t.id}`,
      countryCode: 'FR',
      member: { userName: this.fan(t.fanId).userName },
    };
  }
}

/** Reveal's cursor: the id of the last item of the previous page; the next page starts right after it. */
function pageAfter<T>(
  rows: readonly T[],
  idOf: (row: T) => string,
  cursor: string | undefined,
  take: number,
): { rows: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } {
  const start = cursor === undefined ? 0 : rows.findIndex((r) => idOf(r) === cursor) + 1;
  if (cursor !== undefined && start === 0) throw new HttpFault(400, 'Invalid cursor');
  const slice = rows.slice(start, start + take);
  const last = slice.at(-1);
  return {
    rows: slice,
    pageInfo: { hasNextPage: start + take < rows.length, endCursor: last === undefined ? null : idOf(last) },
  };
}

function buyRate(bundles: readonly NonNullable<FakeMessage['bundle']>[]): {
  purchased: number;
  total: number;
  percentage: number;
} {
  const priced = bundles.filter((b) => b.priceCents > 0);
  const purchased = priced.filter((b) => b.paidAt !== null).length;
  const total = priced.length;
  // Math.round of the ratio, 0 for none (capture: 3/24 → 13).
  return { purchased, total, percentage: total === 0 ? 0 : Math.round((purchased / total) * 100) };
}

const IdParams = z.object({ id: z.string().min(1) });
const Take = (byDefault: number) => z.coerce.number().int().min(1).max(100).default(byDefault);
const Flag = z.enum(['true', 'false']).transform((v) => v === 'true');

const FileRef = z.object({ type: MediaTypeSchema, key: z.string().min(1) });
/** `POST /conversations/:id/messages` (capture: text, bundle, script step, voice note). */
const SendBody = z.object({
  scriptId: z.string().optional(),
  message: z.object({ content: z.string(), isUnread: z.boolean() }),
  mediaIds: z.array(z.string()).default([]),
  files: z.array(FileRef).default([]),
  bundle: z
    .object({
      type: z.literal('media'),
      price: z.number().int().min(0),
      mediaIds: z.array(z.string()).default([]),
      files: z.array(FileRef).default([]),
      teasingMediaIds: z.array(z.string()).default([]),
      teasingFiles: z.array(FileRef).default([]),
    })
    .optional(),
});

export interface FakeReveal {
  readonly app: FastifyInstance;
  /** The live state, for assertions without HTTP (same as `GET /__state`). */
  state(): FakeFixture;
  /** The `authorization` header a client must send. */
  readonly authorization: string;
  /** The model and the team member of the session, as the connector would know them. */
  readonly modelId: string;
  readonly userId: string;
  /** `fetch` for the connector, served by `app.inject` (no port opened); any host reaches FakeReveal. */
  readonly fetch: RevealFetch;
  /** FakeReveal's clock, moved only by `POST /__clock`: a connector under test reads the same time. */
  now(): Date;
}

export function createFakeReveal(options: { fixture?: FixtureName } = {}): FakeReveal {
  let world = new FakeRevealWorld(FIXTURES[options.fixture ?? 'default']());
  const app = Fastify({ logger: false });

  /** Answers one endpoint: checks the body against its shape, then applies a `shape_changed` rename if any. */
  const out = (name: EndpointName, body: unknown): unknown => {
    const parsed: unknown = ENDPOINTS[name].shape.parse(body);
    const rename = world.renames.get(name);
    if (rename === undefined || typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      return parsed;
    return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k === rename.from ? rename.to : k, v]));
  };

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpFault)
      return reply.status(error.status).send({ statusCode: error.status, message: error.message });
    if (error instanceof ZodError) return reply.status(400).send({ statusCode: 400, message: 'Bad Request' });
    return reply.status(500).send({ statusCode: 500, message: 'Internal server error' });
  });

  const isControl = (url: string): boolean => url.startsWith('/__');
  const isFile = (url: string): boolean => url.startsWith('/files/') || url.startsWith('/upload/');

  // Faults and the session apply to Reveal's routes only, never to the control routes.
  app.addHook('onRequest', async (request, reply: FastifyReply) => {
    if (isControl(request.url)) return undefined;
    world.advance(0);
    if (world.faults.latencyMs > 0)
      await new Promise((resolve) => setTimeout(resolve, world.faults.latencyMs));
    if (world.faults.challenges > 0) {
      world.faults.challenges -= 1;
      return reply.status(403).type('text/html').send('<!doctype html><title>Just a moment...</title>');
    }
    if (isFile(request.url)) return undefined;
    void reply.headers(RATE_LIMIT_HEADERS);
    // PROVISIONAL: an invalid session was not captured (L1 still open).
    if (!world.sessionValid || request.headers.authorization !== `Bearer ${world.state.sessionToken}`) {
      return reply.status(401).send({ statusCode: 401, message: 'Unauthorized' });
    }
    if (world.faults.rateLimited > 0) {
      world.faults.rateLimited -= 1;
      return reply
        .status(429)
        .header('retry-after', String(world.faults.retryAfterSeconds))
        .send({ statusCode: 429, message: 'ThrottlerException: Too Many Requests' });
    }
    if (request.method === 'POST' && /^\/conversations\/[^/]+\/messages(\?|$)/u.test(request.url)) {
      const window = world.sendWindow;
      if (world.nowMs() - window.startMs >= SEND_WINDOW_MS) {
        window.startMs = world.nowMs();
        window.count = 0;
      }
      const resetMs = window.startMs + SEND_WINDOW_MS;
      const full = window.count >= SEND_LIMIT;
      if (!full) window.count += 1;
      void reply.headers({
        'x-ratelimit-limit': String(SEND_LIMIT),
        'x-ratelimit-remaining': String(SEND_LIMIT - window.count),
        'x-ratelimit-reset': String(Math.ceil(resetMs / 1_000)),
      });
      if (full) {
        return reply
          .status(429)
          .header('retry-after', String(Math.max(1, Math.ceil((resetMs - world.nowMs()) / 1_000))))
          .send({ statusCode: 429, message: 'ThrottlerException: Too Many Requests' });
      }
    }
    if (world.faults.serverErrors > 0) {
      world.faults.serverErrors -= 1;
      return reply
        .status(world.faults.serverStatus)
        .send({ statusCode: world.faults.serverStatus, message: 'Error' });
    }
    return undefined;
  });

  /* ------------------------------------------------ Conversations ------------------------------------------------ */

  const ListQuery = z.object({
    take: Take(20),
    cursor: z.string().optional(),
    modelId: z.string(),
    filter: z.enum(['all', 'pinned', 'priority', 'unread', 'online']).default('all'),
    searchParticipants: z.string().optional(),
    listId: z.string().optional(),
  });

  app.get('/conversations/model', (request) => {
    const query = ListQuery.parse(request.query);
    world.checkModel(query.modelId);
    const search = query.searchParticipants?.toLowerCase() ?? '';
    const rows = world.state.conversations
      .filter((c) => !c.gone)
      .filter((c) => search === '' || world.fan(c.fanId).userName.toLowerCase().includes(search))
      .filter((c) => {
        switch (query.filter) {
          case 'all':
            return true;
          case 'pinned':
            return c.isPinned;
          case 'unread':
            return c.modelIsUnread;
          // PROVISIONAL: « priority » and « online » are not modelled; nobody is online in FakeReveal.
          case 'priority':
          case 'online':
            return false;
        }
      })
      .map((c) => ({ c, last: world.messagesOf(c.id)[0]?.createdAt ?? '' }))
      .sort((a, b) => b.last.localeCompare(a.last) || a.c.id.localeCompare(b.c.id))
      .map(({ c }) => c);
    const page = pageAfter(rows, (c) => c.id, query.cursor, query.take);
    return out('conversations.list', {
      data: page.rows.map((c) => world.wireConversationItem(c)),
      pageInfo: page.pageInfo,
    });
  });

  app.get('/conversations/model/count', (request) => {
    const query = z
      .object({
        modelId: z.string(),
        isUnread: Flag.optional(),
        filter: z.enum(['priority', 'pinned', 'online']).optional(),
      })
      .parse(request.query);
    world.checkModel(query.modelId);
    // PROVISIONAL: « priority » and « online » are not modelled, so they always count 0.
    const count = world.state.conversations.filter(
      (c) =>
        !c.gone &&
        (query.isUnread !== true || c.modelIsUnread) &&
        (query.filter === undefined || (query.filter === 'pinned' && c.isPinned)),
    ).length;
    return out('conversations.count', { count });
  });

  app.get('/conversations/:id', (request) =>
    out(
      'conversations.get',
      world.wireConversationItem(world.conversation(IdParams.parse(request.params).id)),
    ),
  );

  app.get('/conversations/:id/messages', (request) => {
    const { id } = IdParams.parse(request.params);
    const query = z.object({ take: Take(10), cursor: z.string().optional() }).parse(request.query);
    const conversation = world.conversation(id);
    const all = world.messagesOf(id).filter((m) => world.listed(m));
    const page = pageAfter(all, (m) => m.id, query.cursor, query.take);
    return out('messages.list', {
      data: page.rows.map((m) => world.wireMessageItem(m)),
      pageInfo: page.pageInfo,
      totalCount: all.length,
      memberLastReadAt: conversation.memberLastReadAt,
    });
  });

  /**
   * One route for every send (capture): text, plain media, bundle, script step (`scriptId`), voice note (`files`).
   * Reveal takes no client nonce: sending twice makes two messages, so the connector checks before resending.
   */
  app.post('/conversations/:id/messages', (request) => {
    const { id } = IdParams.parse(request.params);
    const body = SendBody.parse(request.body);
    const conversation = world.conversation(id);
    const fan = world.fan(conversation.fanId);
    const fromFiles = (files: readonly z.infer<typeof FileRef>[]): string[] =>
      files.map((file) => {
        const upload = world.uploads.get(file.key);
        if (upload?.done !== true || upload.type !== file.type)
          throw new HttpFault(400, `File ${file.key} not uploaded`);
        const media: FakeMedia = {
          id: world.nextId('media'),
          type: file.type,
          folderId: null,
          fromFanId: null,
          durationSeconds: file.type === 'photo' ? null : 10,
          createdAt: world.now(),
        };
        world.state.media.push(media);
        world.uploads.delete(file.key);
        return media.id;
      });
    const known = (ids: readonly string[]): string[] => ids.map((mediaId) => world.media(mediaId).id);
    if (body.scriptId !== undefined && !world.state.scripts.some((s) => s.id === body.scriptId)) {
      throw new HttpFault(400, 'Script not found');
    }
    let bundle: FakeMessage['bundle'] = null;
    if (body.bundle !== undefined) {
      const sold = [...known(body.bundle.mediaIds), ...fromFiles(body.bundle.files)];
      const teasing = [...known(body.bundle.teasingMediaIds), ...fromFiles(body.bundle.teasingFiles)];
      // PROVISIONAL: limits not captured; FakeReveal refuses an empty bundle and more than 10 previews.
      if (sold.length === 0) throw new HttpFault(400, 'A bundle needs at least one media');
      if (teasing.length > 10) throw new HttpFault(400, 'Too many teasing medias');
      bundle = {
        id: world.nextId('bundle'),
        priceCents: body.bundle.price,
        mediaIds: sold,
        teasingMediaIds: teasing,
        paidAt: null,
        transactionId: null,
      };
    }
    const created = world.newMessage({
      conversationId: id,
      direction: 'out',
      // PROVISIONAL: whether Reveal or the dashboard fills `%NAME%` is not known (masked in the capture).
      content: body.message.content.replaceAll('%NAME%', fan.firstName ?? ''),
      mediaIds: [...known(body.mediaIds), ...fromFiles(body.files)],
      bundle,
      author: world.state.teamMember.name,
      scriptId: body.scriptId ?? null,
      isUnread: body.message.isUnread,
    });
    world.state.messages.push(created);
    if (world.faults.lostSendAnswers > 0) {
      world.faults.lostSendAnswers -= 1;
      throw new HttpFault(504, 'Gateway Timeout');
    }
    return out('messages.send', world.wireMessageCore(created));
  });

  app.patch('/conversations/:id/read', (request) => {
    const conversation = world.conversation(IdParams.parse(request.params).id);
    conversation.modelIsUnread = false;
    return out('conversations.read', world.wireConversation(conversation));
  });

  app.post('/conversations/:id/typing', (request) => {
    world.conversation(IdParams.parse(request.params).id);
    return out('conversations.typing', { success: true });
  });

  app.get('/conversations/:id/typing', (request) => {
    world.conversation(IdParams.parse(request.params).id);
    return out('conversations.typing.get', { isTyping: false });
  });

  // One free text per conversation, replaced whole; last write wins (no version seen in the capture).
  app.patch('/conversations/:id/note', (request) => {
    const conversation = world.conversation(IdParams.parse(request.params).id);
    conversation.note = z.object({ note: z.string() }).parse(request.body).note;
    return out('conversations.note', world.wireConversation(conversation));
  });

  // Derived from the messages, never stored apart, so it cannot drift (fake-reveal.md, L13).
  app.get('/conversations/:id/ppv-history', (request) => {
    const { id } = IdParams.parse(request.params);
    const query = z
      .object({
        take: Take(10),
        cursor: z.string().optional(),
        kind: z.enum(['paid', 'free']).default('paid'),
      })
      .parse(request.query);
    world.conversation(id);
    const sent = world
      .messagesOf(id)
      .flatMap((m) => (m.bundle === null ? [] : [{ m, bundle: m.bundle }]))
      .filter(({ bundle }) => (query.kind === 'paid' ? bundle.priceCents > 0 : bundle.priceCents === 0));
    const prices = sent.map(({ bundle }) => bundle.priceCents);
    const page = pageAfter(sent, ({ bundle }) => bundle.id, query.cursor, query.take);
    return out('conversations.ppvHistory', {
      buyRate: buyRate(sent.map(({ bundle }) => bundle)),
      highestPrice: prices.length === 0 ? null : Math.max(...prices),
      lowestPrice: prices.length === 0 ? null : Math.min(...prices),
      bundles: page.rows.map(({ m, bundle }) => ({
        id: bundle.id,
        price: bundle.priceCents,
        isPaid: bundle.paidAt !== null,
        createdAt: m.createdAt,
        massDMId: null,
        medias: bundle.mediaIds.map((mediaId) => world.wireMedia(world.media(mediaId))),
      })),
      pageInfo: page.pageInfo,
    });
  });

  app.get('/conversations/:id/stats', (request) => {
    const conversation = world.conversation(IdParams.parse(request.params).id);
    const fan = world.fan(conversation.fanId);
    const messages = world.messagesOf(conversation.id);
    const bundles = messages.flatMap((m) => (m.bundle === null ? [] : [m.bundle]));
    const transactions = world.state.transactions.filter((t) => t.fanId === fan.id);
    const paidMedia = bundles
      .filter((b) => b.paidAt !== null)
      .flatMap((b) => b.mediaIds.map((mediaId) => world.media(mediaId).type));
    return out('conversations.stats', {
      memberCreatedAt: fan.createdAt,
      firstSubscriptionAt: fan.createdAt,
      tipsTotal: transactions.filter((t) => t.type === 'tip').reduce((s, t) => s + t.amountCents, 0),
      messagesTotal: messages.length,
      totalSpent: world.totalSpent(fan.id),
      boudoirItemTotal: 0,
      incomingMessageTotal: 0,
      lastPaidAt:
        transactions
          .map((t) => t.createdAt)
          .sort()
          .at(-1) ?? null,
      highestPurchase: Math.max(0, ...transactions.map((t) => t.amountCents)),
      subscriptionPeriodicity: 'monthly',
      subscriptionExpireAt: null,
      autoRenew: true,
      buyingRate: buyRate(bundles),
      paidMediaRates: {
        imageCount: paidMedia.filter((t) => t === 'photo').length,
        videoCount: paidMedia.filter((t) => t === 'video').length,
      },
    });
  });

  /* ------------------------------------------------ Model and scripts ------------------------------------------- */

  app.get('/models/:id', (request) => {
    world.checkModel(IdParams.parse(request.params).id);
    const model = world.state.model;
    return out('models.get', {
      id: model.id,
      authorMessageId: `author_${model.id}`,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      avatarUrl: `${PUBLIC_URL}/avatar`,
      bannerUrl: `${PUBLIC_URL}/banner`,
      displayName: model.displayName,
      description: 'Description de test',
      commission: AGENCY_PERCENTAGE,
      welcomeMessage: 'Bienvenue de test',
      welcomeMessageDelaySeconds: 0,
      welcomeSkipIfFanWritesFirst: true,
      agencyId: 'agency_test',
      userId: `user_${model.id}`,
      userName: model.userName,
      status: 'validated',
      incomingMediaPrice: 0,
      isVisible: true,
      affiliationCode: 'CODE_TEST',
      age: 0,
      mym: null,
      currentRevenue: 0,
      engagementPopupMessage: '',
      termsSignatureLink: null,
      termsAcceptedAt: null,
      isAI: false,
      isWhitelistedForMediaVerification: false,
      isSuggested: false,
      payoutOnHold: false,
      requireCardVerificationForFreeSubscription: false,
      inboxCount: 1,
      selectedInboxes: [],
      creatorNote: model.creatorNote,
      expirationReminderMessage: 'Rappel de test',
      expirationReminderDaysBefore: 2,
    });
  });

  // Ordered by update, oldest first (capture). With `conversationId`, each step says if it went to that fan (L9).
  app.get('/scripts/model/:id', (request) => {
    world.checkModel(IdParams.parse(request.params).id);
    const query = z
      .object({
        take: Take(20),
        cursor: z.string().optional(),
        search: z.string().optional(),
        conversationId: z.string().optional(),
        withConversations: Flag.optional(),
      })
      .parse(request.query);
    const search = query.search?.toLowerCase() ?? '';
    const rows = world.state.scripts
      .filter((s) => search === '' || `${s.name} ${s.content}`.toLowerCase().includes(search))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const page = pageAfter(rows, (s) => s.id, query.cursor, query.take);
    const conversationId = query.conversationId;
    return out('scripts.list', {
      data: page.rows.map((s) => {
        const teasing = s.teasingMediaIds.map((mediaId) => world.wireMedia(world.media(mediaId)));
        const base = {
          script: world.wireScriptCore(s),
          tags: [],
          medias: s.mediaIds.map((mediaId) => world.wireMedia(world.media(mediaId))),
          teasingMedias: teasing,
        };
        if (conversationId !== undefined) {
          return {
            ...base,
            conversations: world.usesOf(s.id, conversationId).map((m) => ({
              id: conversationId,
              hasBundle: m.bundle !== null,
              isPaid: m.bundle?.paidAt != null,
            })),
          };
        }
        const paid = world
          .usesOf(s.id)
          .flatMap((m) => (m.bundle?.paidAt == null ? [] : [m.bundle.priceCents]));
        return {
          ...base,
          conversations: [],
          sentCount: world.usesOf(s.id).length,
          paidBundlesCount: paid.length,
          paidBundlesTotalAmount: paid.reduce((sum, p) => sum + p, 0),
        };
      }),
      pageInfo: page.pageInfo,
      totalCount: rows.length,
    });
  });

  app.get('/script-sequences/model/:id', (request) => {
    world.checkModel(IdParams.parse(request.params).id);
    return out(
      'scriptSequences.list',
      world.state.sequences.map((sequence) => ({
        sequence: {
          id: sequence.id,
          name: sequence.name,
          createdAt: sequence.createdAt,
          updatedAt: sequence.createdAt,
        },
        steps: sequence.scriptIds.flatMap((scriptId, stepIndex) => {
          const script = world.state.scripts.find((s) => s.id === scriptId);
          if (script === undefined) return [];
          return [
            {
              step: { id: `${sequence.id}_step_${String(stepIndex)}`, stepIndex },
              script: world.wireScriptCore(script),
              medias: script.mediaIds.map((mediaId) => world.wireMedia(world.media(mediaId))),
              teasingMedias: script.teasingMediaIds.map((mediaId) => world.wireMedia(world.media(mediaId))),
              tags: [],
            },
          ];
        }),
      })),
    );
  });

  /* ------------------------------------------------ Vault and media --------------------------------------------- */

  app.get('/models/:id/vault-folders', (request) => {
    world.checkModel(IdParams.parse(request.params).id);
    return out(
      'vault.folders',
      world.state.folders.map((folder) => {
        const inside = world.state.media.filter((m) => m.folderId === folder.id);
        const first = inside[0];
        return {
          id: folder.id,
          imageCount: inside.filter((m) => m.type === 'photo').length,
          videoCount: inside.filter((m) => m.type === 'video').length,
          mediaUrl: first === undefined ? null : world.wireMedia(first).url,
          isSharedForSfs: false,
          createdAt: folder.createdAt,
          updatedAt: folder.createdAt,
          name: folder.name,
          modelId: world.state.model.id,
        };
      }),
    );
  });

  app.get('/models/:id/medias', (request) => {
    world.checkModel(IdParams.parse(request.params).id);
    const query = z
      .object({
        take: Take(10),
        cursor: z.string().optional(),
        vaultFolderId: z.string().optional(),
        mediaType: MediaTypeSchema.optional(),
        memberId: z.string().optional(),
      })
      .parse(request.query);
    const rows = world.state.media
      .filter((m) => m.fromFanId === null && m.folderId !== null)
      .filter((m) => query.vaultFolderId === undefined || m.folderId === query.vaultFolderId)
      .filter((m) => query.mediaType === undefined || m.type === query.mediaType)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    const page = pageAfter(rows, (m) => m.id, query.cursor, query.take);
    const memberId = query.memberId;
    const boughtBy = new Set(
      world.state.messages
        .filter(
          (m) =>
            m.bundle?.paidAt != null &&
            memberId !== undefined &&
            world.state.conversations.some((c) => c.id === m.conversationId && c.fanId === memberId),
        )
        .flatMap((m) => m.bundle?.mediaIds ?? []),
    );
    return out('vault.medias', {
      data: page.rows.map((m) => ({
        ...world.wireMedia(m),
        status: boughtBy.has(m.id) ? ['paid'] : [],
        sentForFree: false,
        description: m.description ?? null,
        suggestedMinPrice: m.suggestedMinPrice ?? null,
        suggestedMaxPrice: m.suggestedMaxPrice ?? null,
        tags: [],
      })),
      pageInfo: page.pageInfo,
      totalCount: rows.length,
      totalImage: rows.filter((m) => m.type === 'photo').length,
      totalVideo: rows.filter((m) => m.type === 'video').length,
    });
  });

  // PROVISIONAL key format: Reveal answers a presigned URL on its storage, the client PUTs the file there, then sends
  // `files: [{ type, key }]`. FakeReveal's key is `pending/<id>`.
  app.get('/medias/get-upload-url', (request, reply) => {
    const query = z
      .object({ name: z.string(), type: MediaTypeSchema, size: z.coerce.number().int().min(1) })
      .parse(request.query);
    const key = `pending/${world.nextId('upload')}`;
    world.uploads.set(key, { type: query.type, done: false });
    void reply.type('text/html; charset=utf-8');
    return out('media.uploadUrl', `${PUBLIC_URL}/upload/${key}`);
  });

  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  app.put('/upload/pending/:id', (request, reply) => {
    const key = `pending/${IdParams.parse(request.params).id}`;
    const upload = world.uploads.get(key);
    if (upload === undefined) throw new HttpFault(403, 'Forbidden');
    upload.done = true;
    return reply.status(200).send();
  });

  app.get('/files/:id', (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const { exp, sig } = z.object({ exp: z.coerce.number().int(), sig: z.string() }).parse(request.query);
    const media = world.state.media.find((m) => m.id === id);
    if (media === undefined || sig !== world.linkSignature(id, exp)) throw new HttpFault(403, 'Forbidden');
    if (exp <= world.nowMs()) throw new HttpFault(403, 'Request has expired');
    const file = FILES[media.type];
    return reply.type(file.mimeType).send(file.data);
  });

  /* ------------------------------------------------ Sales and notifications ------------------------------------- */

  app.get('/transactions/model/:id', (request) => {
    world.checkModel(IdParams.parse(request.params).id);
    const query = z.object({ take: Take(10), cursor: z.string().optional() }).parse(request.query);
    const rows = [...world.state.transactions].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
    );
    const page = pageAfter(rows, (t) => t.id, query.cursor, query.take);
    return out('transactions.list', {
      data: page.rows.map((t) => world.wireTransaction(t)),
      pageInfo: page.pageInfo,
      totalCount: rows.length,
    });
  });

  app.get('/users/:id/notifications', (request) => {
    if (IdParams.parse(request.params).id !== world.state.teamMember.userId) throw notFound();
    const query = z
      .object({ take: Take(5), cursor: z.string().optional(), since: z.iso.datetime().optional() })
      .parse(request.query);
    const rows = world.state.notifications
      .filter((n) => query.since === undefined || n.createdAt > query.since)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    const page = pageAfter(rows, (n) => n.id, query.cursor, query.take);
    return out('notifications.list', {
      data: page.rows.map((n) => ({
        id: n.id,
        createdAt: n.createdAt,
        updatedAt: n.createdAt,
        content: 'Notification de test',
        isRead: false,
        title: 'Notification',
        type: n.type,
        userId: world.state.teamMember.userId,
        modelId: world.state.model.id,
        conversationId: n.conversationId,
      })),
      pageInfo: page.pageInfo,
      totalCount: rows.length,
    });
  });

  /* ------------------------------------------------ Control (/__) ------------------------------------------------ */

  app.post('/__reset', (request) => {
    const { fixture } = z
      .object({ fixture: z.enum(['default', 'empty', 'quiet']).default('default') })
      .parse(request.body ?? {});
    world = new FakeRevealWorld(FIXTURES[fixture]());
    return { ok: true };
  });

  app.get('/__state', () => FakeFixtureSchema.parse({ ...world.state, now: world.now() }));

  app.post('/__scenario', (request) => {
    const { events } = z.object({ events: z.array(ScenarioEventSchema).min(1) }).parse(request.body);
    for (const event of events) world.schedule(event);
    return { ok: true, now: world.now() };
  });

  app.post('/__clock', (request) => {
    const { advanceMs } = z.object({ advanceMs: z.number().int().min(0) }).parse(request.body);
    world.advance(advanceMs);
    return { now: world.now() };
  });

  const fetch: RevealFetch = async (url, init) => {
    const target = new URL(url);
    const response = await app.inject({
      method: init.method,
      url: `${target.pathname}${target.search}`,
      headers: init.headers,
      ...(init.body === undefined ? {} : { payload: init.body }),
    });
    return {
      status: response.statusCode,
      headers: {
        get: (name) => {
          const value = response.headers[name.toLowerCase()];
          return value === undefined ? null : String(value);
        },
      },
      text: () => Promise.resolve(response.body),
    };
  };

  return {
    app,
    fetch,
    state: () => world.state,
    get authorization() {
      return `Bearer ${world.state.sessionToken}`;
    },
    get modelId() {
      return world.state.model.id;
    },
    get userId() {
      return world.state.teamMember.userId;
    },
    now: () => new Date(world.nowMs()),
  };
}
