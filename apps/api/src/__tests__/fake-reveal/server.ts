import { createHmac } from 'node:crypto';

import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';

import { FIXTURES, type FixtureName } from './fixtures';
import {
  ENDPOINTS,
  EndpointNameSchema,
  FakeFixtureSchema,
  type EndpointName,
  type FakeFixture,
  type FakeMessage,
} from './model';

/**
 * FakeReveal (docs/reference/fake-reveal.md): an HTTP server that imitates Reveal's private API, for the
 * connector's contract test and for local development without a Reveal account. Test-only: nothing in `src`
 * outside `__tests__` imports it.
 *
 * Every route under `/api` is PROVISIONAL (model.ts): invented until the capture, then rewritten to the observed
 * paths and shapes. The control routes under `/__` do not exist on Reveal; they drive the scenarios. FakeReveal
 * has its own clock, moved only by `POST /__clock`, so a test decides when time passes.
 */

const LINK_TTL_MS = 10 * 60_000;
const LINK_SECRET = 'fake-reveal-link-secret';
const SESSION_COOKIE = 'reveal_session';
/** Tiny but real files, so a test can check magic bytes: a 1×1 PNG and the head of an MP4. */
const FILES = {
  image: {
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
    mediaIds: z.array(z.string()).default([]),
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
  z.object({ type: z.literal('challenge'), times: z.number().int().min(1) }),
  z.object({ type: z.literal('conversation_gone'), atMs: AtSchema, conversationId: z.string() }),
  z.object({
    type: z.literal('script_changed'),
    atMs: AtSchema,
    scriptId: z.string(),
    stepIndex: z.number().int().min(0),
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

class HttpFault extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/** The platform's state and its rules, apart from HTTP. */
class FakeRevealWorld {
  state: FakeFixture;
  private clockMs: number;
  private counter = 0;
  private pending: { dueMs: number; event: TimedEvent }[] = [];
  faults = {
    rateLimited: 0,
    retryAfterSeconds: 0,
    serverErrors: 0,
    serverStatus: 500,
    challenges: 0,
    latencyMs: 0,
  };
  renames = new Map<EndpointName, { from: string; to: string }>();
  sessionValid = true;

  constructor(fixture: FakeFixture) {
    this.state = structuredClone(fixture);
    this.clockMs = Date.parse(fixture.now);
  }

  now(): string {
    return new Date(this.clockMs).toISOString();
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
        conversation.unreadCount += 1;
        this.state.messages.push(
          this.newMessage({
            conversationId: conversation.id,
            direction: 'in',
            kind: event.mediaIds.length > 0 ? 'media' : 'text',
            text: event.text,
            mediaIds: event.mediaIds,
          }),
        );
        return;
      }
      case 'purchase': {
        const bought = this.state.messages.find((m) => m.id === event.messageId);
        if (bought?.kind !== 'bundle' || bought.unlockedAt !== null) return;
        bought.unlockedAt = this.now();
        this.state.transactions.push({
          id: this.nextId('tx'),
          fanId: this.conversation(bought.conversationId).fanId,
          kind: 'ppv',
          amountCents: bought.priceCents ?? 0,
          messageId: bought.id,
          createdAt: this.now(),
        });
        return;
      }
      case 'session_expired':
        this.sessionValid = false;
        return;
      case 'conversation_gone':
        this.conversation(event.conversationId).gone = true;
        return;
      case 'script_changed': {
        const step = this.state.scripts.find((s) => s.id === event.scriptId)?.steps[event.stepIndex];
        if (step !== undefined) step.priceCents = event.priceCents;
        return;
      }
    }
  }

  nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_new_${String(this.counter).padStart(4, '0')}`;
  }

  newMessage(
    input: Pick<FakeMessage, 'conversationId' | 'direction' | 'kind' | 'text'> & Partial<FakeMessage>,
  ): FakeMessage {
    return {
      id: this.nextId('msg'),
      mediaIds: [],
      teaserMediaIds: [],
      priceCents: null,
      unlockedAt: null,
      author: null,
      scriptId: null,
      stepIndex: null,
      nonce: null,
      createdAt: this.now(),
      deletedAt: null,
      ...input,
    };
  }

  conversation(id: string): FakeFixture['conversations'][number] {
    const found = this.state.conversations.find((c) => c.id === id && !c.gone);
    if (found === undefined) throw new HttpFault(404, 'conversation_not_found');
    return found;
  }

  fan(id: string): FakeFixture['fans'][number] {
    const found = this.state.fans.find((f) => f.id === id);
    if (found === undefined) throw new HttpFault(404, 'fan_not_found');
    return found;
  }

  visibleMessages(conversationId: string): FakeMessage[] {
    return this.state.messages
      .filter((m) => m.conversationId === conversationId && m.deletedAt === null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  wireMessage(m: FakeMessage): z.infer<(typeof ENDPOINTS)['messages.send']['shape']>['message'] {
    const locked = m.kind === 'bundle' && m.unlockedAt === null && (m.priceCents ?? 0) > 0;
    const kindOf = (mediaId: string): 'image' | 'video' | 'audio' =>
      this.state.media.find((x) => x.id === mediaId)?.kind ?? 'image';
    return {
      id: m.id,
      conversationId: m.conversationId,
      direction: m.direction,
      kind: m.kind,
      text: m.text,
      media: [
        ...m.teaserMediaIds.map((id) => ({ id, kind: kindOf(id), locked: false })),
        ...m.mediaIds.map((id) => ({ id, kind: kindOf(id), locked })),
      ],
      priceCents: m.priceCents,
      unlocked: m.kind !== 'bundle' || !locked,
      author: m.author,
      scriptId: m.scriptId,
      stepIndex: m.stepIndex,
      createdAt: m.createdAt,
    };
  }

  /** An outbound send, idempotent on the client nonce (assumed until the capture says otherwise). */
  send(conversationId: string, nonce: string, build: () => FakeMessage): FakeMessage {
    this.conversation(conversationId);
    const previous = this.state.messages.find(
      (m) => m.conversationId === conversationId && m.nonce === nonce,
    );
    if (previous !== undefined) return previous;
    const created = { ...build(), nonce, author: this.state.teamMember.name };
    this.state.messages.push(created);
    return created;
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

  nowMs(): number {
    return this.clockMs;
  }
}

const IdParams = z.object({ id: z.string().min(1) });
const SendTextBody = z.object({ text: z.string().min(1), nonce: z.string().min(1) });
const SendBundleBody = z.object({
  text: z.string(),
  mediaIds: z.array(z.string()).min(1),
  teaserMediaIds: z.array(z.string()).max(10).default([]),
  priceCents: z.number().int().min(0).max(100_000),
  nonce: z.string().min(1),
});
const SendStepBody = z.object({
  scriptId: z.string(),
  stepIndex: z.number().int().min(0),
  nonce: z.string().min(1),
});
const NoteBody = z.object({ text: z.string().max(5_000) });
const PageQuery = z.object({
  cursor: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export interface FakeReveal {
  readonly app: FastifyInstance;
  /** The live state, for assertions without HTTP (same as `GET /__state`). */
  state(): FakeFixture;
  /** The cookie header a client must send. */
  readonly sessionCookie: string;
}

export function createFakeReveal(options: { fixture?: FixtureName } = {}): FakeReveal {
  let world = new FakeRevealWorld(FIXTURES[options.fixture ?? 'default']());
  const app = Fastify({ logger: false });

  /** Answers one endpoint: checks the body against its shape, then applies a `shape_changed` rename if any. */
  const out = (name: EndpointName, body: unknown): unknown => {
    const parsed: unknown = ENDPOINTS[name].shape.parse(body);
    const rename = world.renames.get(name);
    if (rename === undefined || typeof parsed !== 'object' || parsed === null) return parsed;
    return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k === rename.from ? rename.to : k, v]));
  };

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpFault) return reply.status(error.status).send({ error: error.code });
    if (error instanceof ZodError) return reply.status(400).send({ error: 'bad_request' });
    return reply.status(500).send({ error: 'internal' });
  });

  // Faults and the session apply to Reveal's routes only, never to the control routes.
  app.addHook('onRequest', async (request, reply: FastifyReply) => {
    if (!request.url.startsWith('/api/') && !request.url.startsWith('/files/')) return;
    world.advance(0);
    if (world.faults.latencyMs > 0)
      await new Promise((resolve) => setTimeout(resolve, world.faults.latencyMs));
    if (world.faults.challenges > 0) {
      world.faults.challenges -= 1;
      return reply.status(403).type('text/html').send('<!doctype html><title>Just a moment...</title>');
    }
    if (request.url.startsWith('/api/')) {
      const cookie = request.headers.cookie ?? '';
      if (
        !world.sessionValid ||
        !cookie.split(/;\s*/).includes(`${SESSION_COOKIE}=${world.state.sessionToken}`)
      ) {
        return reply.status(401).send({ error: 'unauthorized' });
      }
    }
    if (world.faults.rateLimited > 0) {
      world.faults.rateLimited -= 1;
      return reply
        .status(429)
        .header('retry-after', String(world.faults.retryAfterSeconds))
        .send({ error: 'too_many_requests' });
    }
    if (world.faults.serverErrors > 0) {
      world.faults.serverErrors -= 1;
      return reply.status(world.faults.serverStatus).send({ error: 'upstream' });
    }
    return undefined;
  });

  /* ------------------------------------------------ Reveal (provisional) ------------------------------------------ */

  app.get('/api/me', () =>
    out('session.me', {
      creatorId: world.state.creator.id,
      username: world.state.creator.username,
      teamMember: world.state.teamMember.name,
    }),
  );

  app.get('/api/conversations', (request) => {
    const query = PageQuery.extend({ unread: z.enum(['0', '1']).optional() }).parse(request.query);
    const rows = world.state.conversations
      .filter((c) => !c.gone && (query.unread !== '1' || c.unreadCount > 0))
      .map((c) => {
        const last = world.visibleMessages(c.id).at(-1);
        const fan = world.fan(c.fanId);
        return {
          id: c.id,
          fan: { id: fan.id, username: fan.username },
          unreadCount: c.unreadCount,
          lastMessageAt: last?.createdAt ?? null,
          lastMessagePreview: last === undefined ? null : last.text.slice(0, 80),
        };
      })
      .sort(
        (a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '') || a.id.localeCompare(b.id),
      );
    const page = rows.slice(query.cursor, query.cursor + query.limit);
    const next = query.cursor + query.limit;
    return out('conversations.list', { items: page, nextCursor: next < rows.length ? String(next) : null });
  });

  app.get('/api/conversations/:id/messages', (request) => {
    const { id } = IdParams.parse(request.params);
    const query = z
      .object({ before: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) })
      .parse(request.query);
    world.conversation(id);
    const all = world.visibleMessages(id);
    const end = query.before === undefined ? all.length : all.findIndex((m) => m.id === query.before);
    if (end < 0) throw new HttpFault(404, 'message_not_found');
    const start = Math.max(0, end - query.limit);
    const page = all.slice(start, end);
    return out('messages.list', {
      items: page.map((m) => world.wireMessage(m)),
      nextBefore: start > 0 ? (page[0]?.id ?? null) : null,
    });
  });

  app.post('/api/conversations/:id/messages', (request) => {
    const { id } = IdParams.parse(request.params);
    const body = SendTextBody.parse(request.body);
    const sent = world.send(id, body.nonce, () =>
      world.newMessage({ conversationId: id, direction: 'out', kind: 'text', text: body.text }),
    );
    return out('messages.send', { message: world.wireMessage(sent) });
  });

  app.post('/api/conversations/:id/bundles', (request) => {
    const { id } = IdParams.parse(request.params);
    const body = SendBundleBody.parse(request.body);
    const known = new Set(world.state.media.map((m) => m.id));
    if (![...body.mediaIds, ...body.teaserMediaIds].every((m) => known.has(m))) {
      throw new HttpFault(400, 'unknown_media');
    }
    const sent = world.send(id, body.nonce, () =>
      world.newMessage({
        conversationId: id,
        direction: 'out',
        kind: 'bundle',
        text: body.text,
        mediaIds: body.mediaIds,
        teaserMediaIds: body.teaserMediaIds,
        priceCents: body.priceCents,
      }),
    );
    return out('bundles.send', { message: world.wireMessage(sent) });
  });

  app.post('/api/conversations/:id/read', (request) => {
    const { id } = IdParams.parse(request.params);
    world.conversation(id).unreadCount = 0;
    return out('conversations.read', { unreadCount: 0 });
  });

  app.get('/api/fans/:id', (request) => {
    const fan = world.fan(IdParams.parse(request.params).id);
    return out('fans.get', { ...fan, totalSpentCents: world.totalSpent(fan.id) });
  });

  app.get('/api/fans/:id/note', (request) => {
    const fan = world.fan(IdParams.parse(request.params).id);
    const note = world.state.notes.find((n) => n.fanId === fan.id);
    return out('fans.note.get', { text: note?.text ?? '', updatedAt: note?.updatedAt ?? null });
  });

  // Last write wins until the capture shows Reveal's concurrency semantics (fake-reveal.md, L7/E4).
  app.put('/api/fans/:id/note', (request) => {
    const fan = world.fan(IdParams.parse(request.params).id);
    const { text } = NoteBody.parse(request.body);
    const note = { fanId: fan.id, text, updatedAt: world.now() };
    world.state.notes = [...world.state.notes.filter((n) => n.fanId !== fan.id), note];
    return out('fans.note.put', { text, updatedAt: note.updatedAt });
  });

  // Derived from messages and transactions, never stored apart, so it cannot drift (fake-reveal.md, L13).
  app.get('/api/fans/:id/ppv-stats', (request) => {
    const fan = world.fan(IdParams.parse(request.params).id);
    const conversationIds = new Set(
      world.state.conversations.filter((c) => c.fanId === fan.id).map((c) => c.id),
    );
    const bundles = world.state.messages.filter(
      (m) => conversationIds.has(m.conversationId) && m.kind === 'bundle' && (m.priceCents ?? 0) > 0,
    );
    const prices = bundles.map((m) => m.priceCents ?? 0);
    return out('fans.ppvStats', {
      sentCount: bundles.length,
      boughtCount: bundles.filter((m) => m.unlockedAt !== null).length,
      minPriceCents: prices.length === 0 ? null : Math.min(...prices),
      maxPriceCents: prices.length === 0 ? null : Math.max(...prices),
      history: bundles.map((m) => ({
        messageId: m.id,
        priceCents: m.priceCents ?? 0,
        sentAt: m.createdAt,
        unlockedAt: m.unlockedAt,
      })),
    });
  });

  app.get('/api/fans/:id/script-history', (request) => {
    const fan = world.fan(IdParams.parse(request.params).id);
    return out('fans.scriptHistory', {
      items: world.state.scriptUses
        .filter((u) => u.fanId === fan.id)
        .map((u) => ({ scriptId: u.scriptId, stepIndex: u.stepIndex, sentAt: u.sentAt })),
    });
  });

  app.get('/api/creator-note', () => out('creatorNote.get', world.state.creatorNote));

  app.get('/api/scripts', () =>
    out('scripts.list', {
      items: world.state.scripts.map((s) => ({
        id: s.id,
        name: s.name,
        folder: s.folder,
        steps: s.steps.map((step) => ({
          name: step.name,
          text: step.text,
          media: step.mediaIds.map((id) => ({
            id,
            kind: world.state.media.find((m) => m.id === id)?.kind ?? 'image',
            locked: step.priceCents > 0,
          })),
          teaserMediaIds: step.teaserMediaIds,
          priceCents: step.priceCents,
        })),
      })),
    }),
  );

  // A script step goes out as a bundle; `%NAME%` becomes the member's first name; Reveal marks it as used.
  app.post('/api/conversations/:id/script-steps', (request) => {
    const { id } = IdParams.parse(request.params);
    const body = SendStepBody.parse(request.body);
    const conversation = world.conversation(id);
    const script = world.state.scripts.find((s) => s.id === body.scriptId);
    const step = script?.steps[body.stepIndex];
    if (script === undefined || step === undefined) throw new HttpFault(404, 'script_step_not_found');
    const fan = world.fan(conversation.fanId);
    const sent = world.send(id, body.nonce, () =>
      world.newMessage({
        conversationId: id,
        direction: 'out',
        kind: 'bundle',
        text: step.text.replaceAll('%NAME%', fan.firstName ?? ''),
        mediaIds: step.mediaIds,
        teaserMediaIds: step.teaserMediaIds,
        priceCents: step.priceCents,
        scriptId: script.id,
        stepIndex: body.stepIndex,
      }),
    );
    if (!world.state.scriptUses.some((u) => u.messageId === sent.id)) {
      world.state.scriptUses.push({
        fanId: fan.id,
        scriptId: script.id,
        stepIndex: body.stepIndex,
        messageId: sent.id,
        sentAt: sent.createdAt,
      });
    }
    return out('scripts.sendStep', { message: world.wireMessage(sent) });
  });

  app.get('/api/transactions', (request) => {
    const { since } = z.object({ since: z.iso.datetime().optional() }).parse(request.query);
    return out('transactions.list', {
      items: world.state.transactions.filter((t) => since === undefined || t.createdAt > since),
    });
  });

  app.get('/api/vault', (request) => {
    const query = PageQuery.extend({ folder: z.string().optional() }).parse(request.query);
    const rows = world.state.media.filter((m) => query.folder === undefined || m.folder === query.folder);
    const next = query.cursor + query.limit;
    return out('vault.list', {
      items: rows.slice(query.cursor, next),
      nextCursor: next < rows.length ? String(next) : null,
    });
  });

  // L14: a signed link that expires, like a CDN would serve (shape and lifetime to confirm, runbook 11d).
  app.get('/api/media/:id/link', (request) => {
    const media = world.state.media.find((m) => m.id === IdParams.parse(request.params).id);
    if (media === undefined) throw new HttpFault(404, 'media_not_found');
    const expiresMs = world.nowMs() + LINK_TTL_MS;
    const file = FILES[media.kind];
    return out('media.link', {
      url: `/files/${media.id}?exp=${String(expiresMs)}&sig=${world.linkSignature(media.id, expiresMs)}`,
      expiresAt: new Date(expiresMs).toISOString(),
      mimeType: file.mimeType,
      bytes: file.data.length,
    });
  });

  app.get('/files/:id', (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const { exp, sig } = z.object({ exp: z.coerce.number().int(), sig: z.string() }).parse(request.query);
    const media = world.state.media.find((m) => m.id === id);
    if (media === undefined || sig !== world.linkSignature(id, exp))
      throw new HttpFault(403, 'bad_signature');
    if (exp <= world.nowMs()) throw new HttpFault(403, 'link_expired');
    const file = FILES[media.kind];
    return reply.type(file.mimeType).send(file.data);
  });

  /* ------------------------------------------------ Control (/__) ------------------------------------------------ */

  app.post('/__reset', (request) => {
    const { fixture } = z
      .object({ fixture: z.enum(['default', 'empty']).default('default') })
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

  return {
    app,
    state: () => world.state,
    get sessionCookie() {
      return `${SESSION_COOKIE}=${world.state.sessionToken}`;
    },
  };
}
