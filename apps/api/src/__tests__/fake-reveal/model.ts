import { z } from 'zod';

/**
 * FakeReveal's state and wire shapes (docs/reference/fake-reveal.md). Everything here is invented: no capture of
 * Reveal exists yet, so every wire shape is `provisional` until `docs/reference/reveal-api-observed.md` fixes it
 * from an anonymised recording. Amounts are in cents, dates are ISO strings, identifiers are opaque.
 */

const iso = z.iso.datetime();
const id = z.string().min(1);

export const FakeFanSchema = z.object({
  id,
  username: z.string().min(1),
  /** « Prénom du membre », the source of `%NAME%` in scripts. */
  firstName: z.string().nullable(),
  subscribedAt: iso,
  ageVerified: z.boolean(),
});
export type FakeFan = z.infer<typeof FakeFanSchema>;

export const FakeMediaSchema = z.object({
  id,
  kind: z.enum(['image', 'video', 'audio']),
  /** Vault folder, e.g. « SCRIPT 1 | ☀️ ». */
  folder: z.string(),
});
export type FakeMedia = z.infer<typeof FakeMediaSchema>;

export const FakeMessageSchema = z.object({
  id,
  conversationId: id,
  direction: z.enum(['in', 'out']),
  kind: z.enum(['text', 'media', 'bundle', 'tip', 'system']),
  text: z.string(),
  /** Sold (locked until bought) for a bundle, plain attachments otherwise. */
  mediaIds: z.array(id),
  /** Free preview of a bundle, 10 at most. */
  teaserMediaIds: z.array(id),
  /** Tax included; `null` outside a bundle, 0 for a free bundle. */
  priceCents: z.number().int().min(0).nullable(),
  unlockedAt: iso.nullable(),
  /** Team member who sent an outbound message, as Reveal shows it. */
  author: z.string().nullable(),
  scriptId: id.nullable(),
  stepIndex: z.number().int().min(0).nullable(),
  /** Client nonce of the send, when the client gave one. */
  nonce: z.string().nullable(),
  createdAt: iso,
  /** Seen by admins only; a chatter never sees it. */
  deletedAt: iso.nullable(),
});
export type FakeMessage = z.infer<typeof FakeMessageSchema>;

export const FakeConversationSchema = z.object({
  id,
  fanId: id,
  unreadCount: z.number().int().min(0),
  /** Removed by `conversation_gone` (fan unsubscribed, blocked or deleted). */
  gone: z.boolean(),
});
export type FakeConversation = z.infer<typeof FakeConversationSchema>;

export const FakeScriptStepSchema = z.object({
  name: z.string(),
  /** May hold `%NAME%`. */
  text: z.string(),
  mediaIds: z.array(id),
  teaserMediaIds: z.array(id),
  /** 0 = free step. */
  priceCents: z.number().int().min(0),
});

export const FakeScriptSchema = z.object({
  id,
  name: z.string(),
  folder: z.string(),
  steps: z.array(FakeScriptStepSchema).min(1),
});
export type FakeScript = z.infer<typeof FakeScriptSchema>;

/** Reveal's own « already sent » mark (Charles, 17/10; ADR 0018 point 5). */
export const FakeScriptUseSchema = z.object({
  fanId: id,
  scriptId: id,
  stepIndex: z.number().int().min(0),
  messageId: id,
  sentAt: iso,
});
export type FakeScriptUse = z.infer<typeof FakeScriptUseSchema>;

export const FakeTransactionSchema = z.object({
  id,
  fanId: id,
  kind: z.enum(['ppv', 'tip', 'subscription']),
  amountCents: z.number().int().min(0),
  messageId: id.nullable(),
  createdAt: iso,
});
export type FakeTransaction = z.infer<typeof FakeTransactionSchema>;

export const FakeNoteSchema = z.object({ fanId: id, text: z.string(), updatedAt: iso });
export type FakeNote = z.infer<typeof FakeNoteSchema>;

export const FakeFixtureSchema = z.object({
  /** FakeReveal's clock starts here; only `POST /__clock` moves it. */
  now: iso,
  creator: z.object({ id, username: z.string(), currency: z.string().length(3) }),
  /** The team member whose session the connector uses (the « bot » chatter). */
  teamMember: z.object({ name: z.string().min(1) }),
  /** The only session FakeReveal accepts (opaque, invented). */
  sessionToken: z.string().min(1),
  fans: z.array(FakeFanSchema),
  conversations: z.array(FakeConversationSchema),
  messages: z.array(FakeMessageSchema),
  media: z.array(FakeMediaSchema),
  scripts: z.array(FakeScriptSchema),
  scriptUses: z.array(FakeScriptUseSchema),
  transactions: z.array(FakeTransactionSchema),
  notes: z.array(FakeNoteSchema),
  creatorNote: z.object({ text: z.string(), updatedAt: iso }),
});
export type FakeFixture = z.infer<typeof FakeFixtureSchema>;

/* ---------------------------------------------------------------------------------------------------------------
 * Wire shapes, as the connector will read them. PROVISIONAL: invented until the capture; each one is replaced by
 * the observed shape (and its `source` set to the capture date) in the PR that reads the recording.
 * ------------------------------------------------------------------------------------------------------------ */

const WireMediaSchema = z.strictObject({
  id,
  kind: z.enum(['image', 'video', 'audio']),
  locked: z.boolean(),
});

export const WireMessageSchema = z.strictObject({
  id,
  conversationId: id,
  direction: z.enum(['in', 'out']),
  kind: z.enum(['text', 'media', 'bundle', 'tip', 'system']),
  text: z.string(),
  media: z.array(WireMediaSchema),
  priceCents: z.number().int().min(0).nullable(),
  unlocked: z.boolean(),
  author: z.string().nullable(),
  scriptId: id.nullable(),
  stepIndex: z.number().int().min(0).nullable(),
  createdAt: iso,
});

const WireFanSchema = z.strictObject({
  id,
  username: z.string(),
  firstName: z.string().nullable(),
  subscribedAt: iso,
  totalSpentCents: z.number().int().min(0),
  ageVerified: z.boolean(),
});

const WireScriptStepSchema = z.strictObject({
  name: z.string(),
  text: z.string(),
  media: z.array(WireMediaSchema),
  teaserMediaIds: z.array(id),
  priceCents: z.number().int().min(0),
});

/** Every endpoint FakeReveal serves, with the shape of its JSON answer. */
export const ENDPOINTS = {
  'session.me': {
    method: 'GET',
    path: '/api/me',
    shape: z.strictObject({ creatorId: id, username: z.string(), teamMember: z.string() }),
  },
  'conversations.list': {
    method: 'GET',
    path: '/api/conversations',
    shape: z.strictObject({
      items: z.array(
        z.strictObject({
          id,
          fan: z.strictObject({ id, username: z.string() }),
          unreadCount: z.number().int().min(0),
          lastMessageAt: iso.nullable(),
          lastMessagePreview: z.string().nullable(),
        }),
      ),
      nextCursor: z.string().nullable(),
    }),
  },
  'messages.list': {
    method: 'GET',
    path: '/api/conversations/:id/messages',
    shape: z.strictObject({ items: z.array(WireMessageSchema), nextBefore: id.nullable() }),
  },
  'messages.send': {
    method: 'POST',
    path: '/api/conversations/:id/messages',
    shape: z.strictObject({ message: WireMessageSchema }),
  },
  'bundles.send': {
    method: 'POST',
    path: '/api/conversations/:id/bundles',
    shape: z.strictObject({ message: WireMessageSchema }),
  },
  'conversations.read': {
    method: 'POST',
    path: '/api/conversations/:id/read',
    shape: z.strictObject({ unreadCount: z.literal(0) }),
  },
  'fans.get': { method: 'GET', path: '/api/fans/:id', shape: WireFanSchema },
  'fans.note.get': {
    method: 'GET',
    path: '/api/fans/:id/note',
    shape: z.strictObject({ text: z.string(), updatedAt: iso.nullable() }),
  },
  'fans.note.put': {
    method: 'PUT',
    path: '/api/fans/:id/note',
    shape: z.strictObject({ text: z.string(), updatedAt: iso }),
  },
  'fans.ppvStats': {
    method: 'GET',
    path: '/api/fans/:id/ppv-stats',
    shape: z.strictObject({
      sentCount: z.number().int().min(0),
      boughtCount: z.number().int().min(0),
      minPriceCents: z.number().int().nullable(),
      maxPriceCents: z.number().int().nullable(),
      history: z.array(
        z.strictObject({
          messageId: id,
          priceCents: z.number().int(),
          sentAt: iso,
          unlockedAt: iso.nullable(),
        }),
      ),
    }),
  },
  'fans.scriptHistory': {
    method: 'GET',
    path: '/api/fans/:id/script-history',
    shape: z.strictObject({
      items: z.array(z.strictObject({ scriptId: id, stepIndex: z.number().int().min(0), sentAt: iso })),
    }),
  },
  'creatorNote.get': {
    method: 'GET',
    path: '/api/creator-note',
    shape: z.strictObject({ text: z.string(), updatedAt: iso }),
  },
  'scripts.list': {
    method: 'GET',
    path: '/api/scripts',
    shape: z.strictObject({
      items: z.array(
        z.strictObject({ id, name: z.string(), folder: z.string(), steps: z.array(WireScriptStepSchema) }),
      ),
    }),
  },
  'scripts.sendStep': {
    method: 'POST',
    path: '/api/conversations/:id/script-steps',
    shape: z.strictObject({ message: WireMessageSchema }),
  },
  'transactions.list': {
    method: 'GET',
    path: '/api/transactions',
    shape: z.strictObject({
      items: z.array(
        z.strictObject({
          id,
          fanId: id,
          kind: z.enum(['ppv', 'tip', 'subscription']),
          amountCents: z.number().int(),
          messageId: id.nullable(),
          createdAt: iso,
        }),
      ),
    }),
  },
  'vault.list': {
    method: 'GET',
    path: '/api/vault',
    shape: z.strictObject({
      items: z.array(z.strictObject({ id, kind: z.enum(['image', 'video', 'audio']), folder: z.string() })),
      nextCursor: z.string().nullable(),
    }),
  },
  'media.link': {
    method: 'GET',
    path: '/api/media/:id/link',
    shape: z.strictObject({ url: z.string(), expiresAt: iso, mimeType: z.string(), bytes: z.number().int() }),
  },
} as const satisfies Record<string, { method: string; path: string; shape: z.ZodType }>;

export type EndpointName = keyof typeof ENDPOINTS;

export function isEndpointName(value: unknown): value is EndpointName {
  return typeof value === 'string' && Object.hasOwn(ENDPOINTS, value);
}

export const EndpointNameSchema = z.custom<EndpointName>(isEndpointName, {
  message: 'unknown FakeReveal endpoint',
});

/**
 * Capture date of each shape fixed from a recording (reveal-api-observed.md). An endpoint absent here is still
 * provisional: its shape is invented and will change when the capture is read.
 */
export const OBSERVED_ON: Partial<Record<EndpointName, string>> = {};
