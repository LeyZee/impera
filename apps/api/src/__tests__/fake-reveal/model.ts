import { z } from 'zod';

import {
  REVEAL_ENDPOINTS,
  RevealMediaTypeSchema,
  type RevealWireMedia,
  type RevealWireMessageItem,
} from '../../modules/connectors';

/**
 * FakeReveal's state and the wire shapes it serves (docs/reference/fake-reveal.md). The state is invented; the wire
 * shapes are the connector's own (`connectors/infra/reveal/wire.ts`), from the anonymised captures of 2026-11-10
 * (docs/reference/reveal-api-observed.md, recordings in `recordings/`). Amounts are in cents, dates are ISO strings,
 * identifiers are opaque.
 */

const iso = z.iso.datetime();
const id = z.string().min(1);

/* ---------------------------------------------------------------------------------------------------------------
 * State
 * ------------------------------------------------------------------------------------------------------------ */

export const MediaTypeSchema = RevealMediaTypeSchema;
export type MediaType = z.infer<typeof MediaTypeSchema>;

export const FakeFanSchema = z.object({
  id,
  userName: z.string().min(1),
  /** The team's « Prénom » of the member (conversation.memberFirstname), source of `%NAME%`. */
  firstName: z.string().nullable(),
  createdAt: iso,
  /** Reveal's only age-related field: when the fan's card was checked. */
  cardVerifiedAt: iso.nullable(),
});
export type FakeFan = z.infer<typeof FakeFanSchema>;

export const FakeMediaSchema = z.object({
  id,
  type: MediaTypeSchema,
  /** Vault folder id; `null` for a file a fan sent or an upload attached to one message. */
  folderId: id.nullable(),
  /** Set when a fan sent it (`incomingMessageMemberId`). */
  fromFanId: id.nullable(),
  durationSeconds: z.number().int().nullable(),
  createdAt: iso,
});
export type FakeMedia = z.infer<typeof FakeMediaSchema>;

export const FakeFolderSchema = z.object({ id, name: z.string(), createdAt: iso });

export const FakeMessageSchema = z.object({
  id,
  conversationId: id,
  direction: z.enum(['in', 'out']),
  content: z.string(),
  /** Plain attachments (a fan's photo, a voice note). */
  mediaIds: z.array(id),
  /** Set for a bundle: sold media, previews and price (0 = free bundle). */
  bundle: z
    .object({
      id,
      priceCents: z.number().int().min(0),
      mediaIds: z.array(id).min(1),
      teasingMediaIds: z.array(id),
      paidAt: iso.nullable(),
      transactionId: id.nullable(),
    })
    .nullable(),
  /** Team member display name for an outbound message. */
  author: z.string().nullable(),
  /** The Reveal « script » (one step) this message was sent from. */
  scriptId: id.nullable(),
  /** The fan has not read this outbound message yet (`isUnread`). */
  isUnread: z.boolean(),
  createdAt: iso,
});
export type FakeMessage = z.infer<typeof FakeMessageSchema>;

export const FakeConversationSchema = z.object({
  id,
  fanId: id,
  /** The fan wrote and the team has not read it yet (`modelIsUnread`). */
  modelIsUnread: z.boolean(),
  memberLastReadAt: iso.nullable(),
  /** « Note client », one free text per conversation. */
  note: z.string().nullable(),
  isPinned: z.boolean(),
  createdAt: iso,
  /** Removed by `conversation_gone` (fan unsubscribed, blocked or deleted). */
  gone: z.boolean(),
});
export type FakeConversation = z.infer<typeof FakeConversationSchema>;

/** A Reveal « script » is one step: a text, its media and its price. Sequences put steps in order. */
export const FakeScriptSchema = z.object({
  id,
  name: z.string(),
  content: z.string(),
  mediaIds: z.array(id),
  teasingMediaIds: z.array(id),
  /** `null` = no price set on the step (sent as a free message or priced at send time). */
  priceCents: z.number().int().min(0).nullable(),
  createdAt: iso,
});
export type FakeScript = z.infer<typeof FakeScriptSchema>;

export const FakeSequenceSchema = z.object({ id, name: z.string(), scriptIds: z.array(id), createdAt: iso });

export const FakeTransactionSchema = z.object({
  id,
  fanId: id,
  /** Masked in the capture; FakeReveal's own names until the real ones are read. */
  type: z.enum(['bundle', 'tip', 'subscription']),
  amountCents: z.number().int().min(0),
  messageId: id.nullable(),
  createdAt: iso,
});
export type FakeTransaction = z.infer<typeof FakeTransactionSchema>;

export const FakeNotificationSchema = z.object({
  id,
  type: z.string(),
  conversationId: id,
  createdAt: iso,
});

export const FakeFixtureSchema = z.object({
  /** FakeReveal's clock starts here; only `POST /__clock` moves it. */
  now: iso,
  model: z.object({ id, userName: z.string(), displayName: z.string(), creatorNote: z.string() }),
  /** The team member whose session the connector uses (the « bot » chatter). */
  teamMember: z.object({ userId: id, name: z.string().min(1) }),
  /** The only bearer token FakeReveal accepts (opaque, invented). */
  sessionToken: z.string().min(1),
  fans: z.array(FakeFanSchema),
  conversations: z.array(FakeConversationSchema),
  messages: z.array(FakeMessageSchema),
  folders: z.array(FakeFolderSchema),
  media: z.array(FakeMediaSchema),
  scripts: z.array(FakeScriptSchema),
  sequences: z.array(FakeSequenceSchema),
  transactions: z.array(FakeTransactionSchema),
  notifications: z.array(FakeNotificationSchema),
});
export type FakeFixture = z.infer<typeof FakeFixtureSchema>;

/* ---------------------------------------------------------------------------------------------------------------
 * Wire shapes, observed on 2026-11-10: the connector's own (`connectors/infra/reveal/wire.ts`), served as they are.
 * ------------------------------------------------------------------------------------------------------------ */

export const ENDPOINTS = REVEAL_ENDPOINTS;
export type WireMedia = RevealWireMedia;
export type WireMessageItem = RevealWireMessageItem;

export type EndpointName = keyof typeof ENDPOINTS;

export function isEndpointName(value: unknown): value is EndpointName {
  return typeof value === 'string' && Object.hasOwn(ENDPOINTS, value);
}

export const EndpointNameSchema = z.custom<EndpointName>(isEndpointName, {
  message: 'unknown FakeReveal endpoint',
});

/** Capture date of each shape (reveal-api-observed.md). Every endpoint above has been observed. */
export const OBSERVED_ON: Record<EndpointName, string> = {
  'conversations.list': '2026-11-10',
  'conversations.count': '2026-11-10',
  'conversations.get': '2026-11-10',
  'messages.list': '2026-11-10',
  'messages.send': '2026-11-10',
  'conversations.read': '2026-11-10',
  'conversations.typing': '2026-11-10',
  'conversations.typing.get': '2026-11-10',
  'conversations.note': '2026-11-10',
  'conversations.ppvHistory': '2026-11-10',
  'conversations.stats': '2026-11-10',
  'models.get': '2026-11-10',
  'scripts.list': '2026-11-10',
  'scriptSequences.list': '2026-11-10',
  'vault.folders': '2026-11-10',
  'vault.medias': '2026-11-10',
  'transactions.list': '2026-11-10',
  'notifications.list': '2026-11-10',
  'media.uploadUrl': '2026-11-10',
};

/** What a connector on this API can declare (docs/reference/reveal-api-observed.md, Résumé). */
export const REVEAL_EXPECTED_CAPABILITIES = {
  unreadWithoutOpen: true,
  sendMedia: true,
  transactions: true,
  markRead: true,
  typing: true,
  /** No WebSocket: the official client polls. */
  realtime: false,
  // The readings of ADR 0018 (reveal-connector-spec.md § 4).
  fanProfile: true,
  fanNoteRead: true,
  creatorNotes: true,
  ppvStats: true,
  scripts: true,
  scriptHistory: true,
  vault: true,
} as const;
