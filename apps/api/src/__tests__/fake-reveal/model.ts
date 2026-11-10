import { z } from 'zod';

/**
 * FakeReveal's state and wire shapes (docs/reference/fake-reveal.md). The state is invented; the wire shapes come
 * from the anonymised captures of 2026-11-10 (docs/reference/reveal-api-observed.md, recordings in `recordings/`).
 * Amounts are in cents, dates are ISO strings, identifiers are opaque.
 */

const iso = z.iso.datetime();
const id = z.string().min(1);

/* ---------------------------------------------------------------------------------------------------------------
 * State
 * ------------------------------------------------------------------------------------------------------------ */

export const MediaTypeSchema = z.enum(['photo', 'video', 'audio']);
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
 * Wire shapes, observed on 2026-11-10. Strict: a field Reveal adds or renames fails the parse, and the connector
 * raises a typed error instead of swallowing it (fake-reveal.md, `shape_changed`).
 * ------------------------------------------------------------------------------------------------------------ */

const PageInfoSchema = z.strictObject({ hasNextPage: z.boolean(), endCursor: id.nullable() });

const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({ data: z.array(item), pageInfo: PageInfoSchema, totalCount: z.number().int().min(0) });

export const WireMediaSchema = z.strictObject({
  id,
  blurhash: z.string(),
  isHls: z.boolean().optional(),
  createdAt: iso,
  updatedAt: iso,
  url: z.string(),
  smallUrl: z.string(),
  mediumUrl: z.string(),
  largeUrl: z.string(),
  thumbnailUrl: z.string().optional(),
  type: MediaTypeSchema,
  isArchived: z.boolean(),
  moderationStatus: z.string().optional(),
  modelId: id,
  name: z.string().nullable().optional(),
  durationSeconds: z.number().nullable().optional(),
  /** Set on a file the fan sent. */
  incomingMessageMemberId: id.optional(),
});
export type WireMedia = z.infer<typeof WireMediaSchema>;

const WireVaultMediaSchema = WireMediaSchema.extend({
  /** Relative to the `memberId` asked for, e.g. `paid`. */
  status: z.array(z.string()),
  sentForFree: z.boolean(),
  description: z.string().nullable(),
  suggestedMinPrice: z.number().int().nullable(),
  suggestedMaxPrice: z.number().int().nullable(),
  tags: z.array(z.unknown()),
});

const WireConversationSchema = z.strictObject({
  id,
  modelIsUnread: z.boolean(),
  memberIsUnread: z.boolean(),
  memberLastReadAt: iso.nullable(),
  isBlockedByModel: z.boolean(),
  isPinned: z.boolean(),
  pinnedAt: iso.nullable().optional(),
  isExcludedFromMassDM: z.boolean(),
  isTeamPinned: z.boolean(),
  teamPinnedAt: iso.nullable().optional(),
  assignedInbox: z.number().int(),
  lastMessageAt: iso.nullable(),
  createdAt: iso,
  updatedAt: iso,
  lastMessageId: id.nullable(),
  memberId: id,
  modelId: id,
  /** « Note client ». */
  note: z.string().optional(),
  memberFirstname: z.string().optional(),
  memberNickname: z.string().optional(),
});

const WireMemberSchema = z.strictObject({
  id,
  authorMessageId: z.string(),
  createdAt: iso,
  updatedAt: iso,
  vipUntil: iso.nullable(),
  userName: z.string(),
  avatarUrl: z.string().optional(),
  userId: id,
  cardVerifiedAt: iso.optional(),
});

const WireModelSummarySchema = z.strictObject({
  id,
  avatarUrl: z.string(),
  bannerUrl: z.string(),
  avatarThumbUrl: z.string(),
  bannerPreviewUrl: z.string(),
  displayName: z.string(),
  description: z.string(),
  userName: z.string(),
  incomingMediaPrice: z.number().int(),
  isVisible: z.boolean(),
  engagementPopupMessage: z.string(),
  isAI: z.boolean(),
  requireCardVerificationForFreeSubscription: z.boolean(),
  isOfficialAccount: z.boolean(),
});

const WireMessageCoreSchema = z.strictObject({
  id,
  bundleId: id.optional(),
  createdAt: iso,
  updatedAt: iso,
  isUnread: z.boolean(),
  content: z.string(),
  /** Only `default` seen (380 messages). */
  type: z.string(),
});

const WireConversationItemSchema = z.strictObject({
  conversation: WireConversationSchema,
  /** `{ member }` when the fan wrote last, `{}` otherwise. */
  lastMessageAuthor: z.strictObject({ member: WireMemberSchema.optional() }),
  lastMessage: WireMessageCoreSchema.nullable(),
  lastMessageHasMedia: z.boolean(),
  member: WireMemberSchema,
  model: WireModelSummarySchema,
  memberTotalSpent: z.number().int().min(0),
  memberLastSeenAt: iso.nullable(),
  /** « Note du modèle », one per model, copied into every item. */
  modelCreatorNote: z.string(),
  isExcludedFromMassDM: z.boolean(),
});

const WireBundleSchema = z.strictObject({
  id,
  createdAt: iso,
  updatedAt: iso,
  price: z.number().int().min(0),
  type: z.string(),
  /** Absent while locked. */
  isPaid: z.boolean().optional(),
  /** Present once bought: links the message to `/transactions`. */
  transactionId: id.optional(),
  modelId: id,
  memberId: id,
});

export const WireMessageItemSchema = z.strictObject({
  message: WireMessageCoreSchema,
  medias: z.array(WireMediaSchema),
  bundleWithMedias: z
    .strictObject({
      bundle: WireBundleSchema,
      medias: z.array(WireMediaSchema),
      teasingMedia: WireMediaSchema.optional(),
      teasingMedias: z.array(WireMediaSchema),
    })
    .optional(),
  /** `memberId` is set only when the fan wrote; the team side carries a display name only. */
  authorMessage: z.strictObject({ displayName: z.string(), memberId: id.optional() }),
  reactions: z.array(z.unknown()),
  replyTo: z.unknown().nullable(),
  storyReply: z.unknown().nullable(),
});
export type WireMessageItem = z.infer<typeof WireMessageItemSchema>;

const WireBuyRateSchema = z.strictObject({
  purchased: z.number().int().min(0),
  total: z.number().int().min(0),
  percentage: z.number(),
});

const WireScriptItemSchema = z.strictObject({
  script: z.strictObject({
    id,
    createdAt: iso,
    updatedAt: iso,
    name: z.string(),
    content: z.string(),
    /** Absent on a step without a price. */
    price: z.number().int().min(0).optional(),
  }),
  tags: z.array(z.unknown()),
  medias: z.array(WireMediaSchema),
  teasingMedia: WireMediaSchema.optional(),
  teasingMedias: z.array(WireMediaSchema),
  /** With `conversationId`: one entry when this step was already sent in that conversation (L9). */
  conversations: z.array(z.strictObject({ id, hasBundle: z.boolean(), isPaid: z.boolean() })),
  /** Without `conversationId`. */
  sentCount: z.number().int().min(0).optional(),
  paidBundlesCount: z.number().int().min(0).optional(),
  paidBundlesTotalAmount: z.number().int().min(0).optional(),
});

const WireTransactionSchema = z.strictObject({
  id,
  createdAt: iso,
  updatedAt: iso,
  amount: z.number().int(),
  status: z.string(),
  type: z.string(),
  modelId: id,
  memberId: id,
  agencyMemberId: id.nullable(),
  platformFee: z.number().int(),
  platformPercentage: z.number(),
  platformRevenue: z.number().int(),
  agencyFee: z.number().int(),
  agencyPercentage: z.number(),
  processorFee: z.number().int(),
  vatFee: z.number().int(),
  vatPercentage: z.number(),
  modelRevenue: z.number().int(),
  isProcessedSuccessfully: z.boolean(),
  uid: z.string(),
  providerTransactionId: z.string(),
  countryCode: z.string(),
  member: z.strictObject({ userName: z.string() }),
});

export const WireSentMessageSchema = WireMessageCoreSchema;

/** Every endpoint FakeReveal serves, with its path on `api.reveal.me` and the shape of its answer. */
export const ENDPOINTS = {
  'conversations.list': {
    method: 'GET',
    path: '/conversations/model',
    shape: z.strictObject({ data: z.array(WireConversationItemSchema), pageInfo: PageInfoSchema }),
  },
  'conversations.count': {
    method: 'GET',
    path: '/conversations/model/count',
    shape: z.strictObject({ count: z.number().int().min(0) }),
  },
  'conversations.get': { method: 'GET', path: '/conversations/:id', shape: WireConversationItemSchema },
  'messages.list': {
    method: 'GET',
    path: '/conversations/:id/messages',
    shape: page(WireMessageItemSchema).extend({ memberLastReadAt: iso.nullable() }),
  },
  'messages.send': { method: 'POST', path: '/conversations/:id/messages', shape: WireSentMessageSchema },
  'conversations.read': { method: 'PATCH', path: '/conversations/:id/read', shape: WireConversationSchema },
  'conversations.typing': {
    method: 'POST',
    path: '/conversations/:id/typing',
    shape: z.strictObject({ success: z.boolean() }),
  },
  'conversations.typing.get': {
    method: 'GET',
    path: '/conversations/:id/typing',
    shape: z.strictObject({ isTyping: z.boolean() }),
  },
  'conversations.note': { method: 'PATCH', path: '/conversations/:id/note', shape: WireConversationSchema },
  'conversations.ppvHistory': {
    method: 'GET',
    path: '/conversations/:id/ppv-history',
    shape: z.strictObject({
      buyRate: WireBuyRateSchema,
      highestPrice: z.number().int().nullable(),
      lowestPrice: z.number().int().nullable(),
      bundles: z.array(
        z.strictObject({
          id,
          price: z.number().int().min(0),
          isPaid: z.boolean(),
          createdAt: iso,
          massDMId: id.nullable(),
          medias: z.array(WireMediaSchema),
        }),
      ),
      pageInfo: PageInfoSchema,
    }),
  },
  'conversations.stats': {
    method: 'GET',
    path: '/conversations/:id/stats',
    shape: z.strictObject({
      memberCreatedAt: iso,
      firstSubscriptionAt: iso.nullable(),
      tipsTotal: z.number().int(),
      messagesTotal: z.number().int(),
      totalSpent: z.number().int(),
      boudoirItemTotal: z.number().int(),
      incomingMessageTotal: z.number().int(),
      lastPaidAt: iso.nullable(),
      highestPurchase: z.number().int(),
      subscriptionPeriodicity: z.string().nullable(),
      subscriptionExpireAt: iso.nullable(),
      autoRenew: z.boolean(),
      buyingRate: WireBuyRateSchema,
      paidMediaRates: z.strictObject({ imageCount: z.number().int(), videoCount: z.number().int() }),
    }),
  },
  'models.get': {
    method: 'GET',
    path: '/models/:id',
    shape: z.strictObject({
      id,
      authorMessageId: z.string(),
      createdAt: iso,
      updatedAt: iso,
      avatarUrl: z.string(),
      bannerUrl: z.string(),
      displayName: z.string(),
      description: z.string(),
      commission: z.number(),
      welcomeMessage: z.string(),
      welcomeMessageDelaySeconds: z.number().int(),
      welcomeSkipIfFanWritesFirst: z.boolean(),
      agencyId: id,
      userId: id,
      userName: z.string(),
      status: z.string(),
      incomingMediaPrice: z.number().int(),
      isVisible: z.boolean(),
      affiliationCode: z.string(),
      age: z.number().int(),
      mym: z.string().nullable(),
      currentRevenue: z.number().int(),
      engagementPopupMessage: z.string(),
      termsSignatureLink: z.string().nullable(),
      termsAcceptedAt: iso.nullable(),
      isAI: z.boolean(),
      isWhitelistedForMediaVerification: z.boolean(),
      isSuggested: z.boolean(),
      payoutOnHold: z.boolean(),
      requireCardVerificationForFreeSubscription: z.boolean(),
      inboxCount: z.number().int(),
      selectedInboxes: z.array(z.unknown()),
      /** « Note du modèle » (L11). */
      creatorNote: z.string(),
      expirationReminderMessage: z.string(),
      expirationReminderDaysBefore: z.number().int(),
    }),
  },
  'scripts.list': { method: 'GET', path: '/scripts/model/:id', shape: page(WireScriptItemSchema) },
  'scriptSequences.list': {
    method: 'GET',
    path: '/script-sequences/model/:id',
    shape: z.array(
      z.strictObject({
        sequence: z.strictObject({ id, name: z.string(), createdAt: iso, updatedAt: iso }),
        /** Empty in the capture: the step shape follows the analysis report, to confirm on a recording. */
        steps: z.array(
          z.strictObject({
            step: z.strictObject({ id, stepIndex: z.number().int().min(0) }),
            script: WireScriptItemSchema.shape.script,
            medias: z.array(WireMediaSchema),
            teasingMedias: z.array(WireMediaSchema),
            tags: z.array(z.unknown()),
          }),
        ),
      }),
    ),
  },
  'vault.folders': {
    method: 'GET',
    path: '/models/:id/vault-folders',
    shape: z.array(
      z.strictObject({
        id,
        imageCount: z.number().int().min(0),
        videoCount: z.number().int().min(0),
        mediaUrl: z.string().nullable(),
        isSharedForSfs: z.boolean(),
        createdAt: iso,
        updatedAt: iso,
        name: z.string(),
        modelId: id,
      }),
    ),
  },
  'vault.medias': {
    method: 'GET',
    path: '/models/:id/medias',
    shape: page(WireVaultMediaSchema).extend({
      totalImage: z.number().int().min(0),
      totalVideo: z.number().int().min(0),
    }),
  },
  'transactions.list': { method: 'GET', path: '/transactions/model/:id', shape: page(WireTransactionSchema) },
  'notifications.list': {
    method: 'GET',
    path: '/users/:id/notifications',
    shape: page(
      z.strictObject({
        id,
        createdAt: iso,
        updatedAt: iso,
        content: z.string(),
        isRead: z.boolean(),
        title: z.string(),
        /** Masked in the capture: the values are still unknown. */
        type: z.string(),
        userId: id,
        modelId: id,
        conversationId: id.nullable(),
      }),
    ),
  },
  /** Answers the presigned upload URL as plain text (`text/html` on Reveal). */
  'media.uploadUrl': { method: 'GET', path: '/medias/get-upload-url', shape: z.string().min(1) },
} as const satisfies Record<string, { method: string; path: string; shape: z.ZodType }>;

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
} as const;
