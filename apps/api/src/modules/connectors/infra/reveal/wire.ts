import { z } from 'zod';

/**
 * The shapes of Reveal's private API (`api.reveal.me`), as the anonymised captures of 2026-11-10 show them
 * (docs/reference/reveal-api-observed.md, recordings in `src/__tests__/fake-reveal/recordings/`). One copy, read by
 * the connector and served by FakeReveal: `fidelity.test.ts` holds every recording to them.
 */

const iso = z.iso.datetime();
const id = z.string().min(1);

/** A media's type on Reveal. */
export const RevealMediaTypeSchema = z.enum(['photo', 'video', 'audio']);

/* ---------------------------------------------------------------------------------------------------------------
 * Wire shapes, observed on 2026-11-10. Strict: a field Reveal adds or renames fails the parse, and the connector
 * raises a typed error instead of swallowing it (fake-reveal.md, `shape_changed`).
 * ------------------------------------------------------------------------------------------------------------ */

/** The last page's cursor is `null` or, since 2026-11-15, an empty string: both read as `null`. */
const PageInfoSchema = z.strictObject({
  hasNextPage: z.boolean(),
  endCursor: z
    .string()
    .nullable()
    .transform((cursor) => (cursor === '' ? null : cursor)),
});

const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({ data: z.array(item), pageInfo: PageInfoSchema, totalCount: z.number().int().min(0) });

const WireMediaSchema = z.strictObject({
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
  type: RevealMediaTypeSchema,
  isArchived: z.boolean(),
  moderationStatus: z.string().optional(),
  modelId: id,
  name: z.string().nullable().optional(),
  durationSeconds: z.number().nullable().optional(),
  /** Set on a file the fan sent. */
  incomingMessageMemberId: id.optional(),
});
export type RevealWireMedia = z.infer<typeof WireMediaSchema>;

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
  /** Absent on most conversations since 2026-11-15. */
  memberLastReadAt: iso.nullable().optional(),
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
  /** Absent on a conversation without any message (2026-11-15). */
  lastMessageId: id.nullable().optional(),
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
  /** `default` and `tips` seen. */
  type: z.string(),
  /** Set on a message deleted on Reveal (2026-11-16), absent otherwise: such a message is never read by us. */
  deletedAt: iso.optional(),
  /** Set on a fan's answer to one of her stories (2026-11-16), absent otherwise; the story itself is `storyReply`. */
  replyToStoryId: id.optional(),
  /** A GIF sent instead of a text (2026-11-15). */
  gif: z
    .strictObject({
      id,
      url: z.string(),
      webpUrl: z.string(),
      posterUrl: z.string(),
      width: z.number(),
      height: z.number(),
    })
    .optional(),
});

const WireConversationItemSchema = z.strictObject({
  conversation: WireConversationSchema,
  /**
   * `{ member }` when the fan wrote last, `{ model }` (since 2026-11-15) or `{}` when the team did; absent, like
   * `lastMessage`, on a conversation without any message.
   */
  lastMessageAuthor: z
    .strictObject({ member: WireMemberSchema.optional(), model: WireModelSummarySchema.optional() })
    .optional(),
  lastMessage: WireMessageCoreSchema.nullable().optional(),
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
  /** A time-limited discount on a paid media (2026-11-16), as on a script step: both or neither. Read, never applied by us. */
  discountedPrice: z.number().int().min(0).optional(),
  discountDurationMinutes: z.number().int().min(0).optional(),
  modelId: id,
  memberId: id,
});

const WireMessageItemSchema = z.strictObject({
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
export type RevealWireMessageItem = z.infer<typeof WireMessageItemSchema>;

/**
 * Reveal's own translation settings for a conversation, sent with its messages since 2026-11-27 (capture of the owner's
 * dashboard): the team's language, and the fan's and the reply's when set. Read only so the page still parses; the
 * agent never takes its language from here (the reply language is decided in our code, ADR 0168).
 */
const WireTranslationSchema = z.strictObject({
  teamLanguage: z.string().min(1),
  memberLanguage: z.string().min(1).nullable(),
  replyLanguage: z.string().min(1).nullable(),
});

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
    /** A time-limited discount on a priced step (2026-11-15): both or neither. Read, never applied by us. */
    discountedPrice: z.number().int().min(0).optional(),
    discountDurationMinutes: z.number().int().min(0).optional(),
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

/** Every endpoint observed, with its path on `api.reveal.me` and the shape of its answer. */
export const REVEAL_ENDPOINTS = {
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
    shape: page(WireMessageItemSchema).extend({
      memberLastReadAt: iso.nullable().optional(),
      translation: WireTranslationSchema.optional(),
    }),
  },
  'messages.send': { method: 'POST', path: '/conversations/:id/messages', shape: WireMessageCoreSchema },
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
      /** No longer sent since 2026-11-15. */
      highestPrice: z.number().int().nullable().optional(),
      lowestPrice: z.number().int().nullable().optional(),
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
      /** No longer sent since 2026-11-15. */
      buyingRate: WireBuyRateSchema.optional(),
      paidMediaRates: z
        .strictObject({ imageCount: z.number().int(), videoCount: z.number().int() })
        .optional(),
      /** Since 2026-11-15. */
      refundAskedTotal: z.number().int().optional(),
    }),
  },
  /** Her openers (« Messages d'accroche », ADR 0110 § 1): the texts Reveal offers a new fan, sent under his name. */
  'models.sayHello': {
    method: 'GET',
    path: '/models/:id/say-hello',
    shape: z.strictObject({
      enabled: z.boolean(),
      autoReplyEnabled: z.boolean(),
      autoReplyDelaySeconds: z.number().nullable(),
      openers: z.array(
        z.strictObject({
          /** `flirt`, `friendly`, `personal` seen (2026-11-16). */
          kind: z.string(),
          fanText: z.string(),
          replyText: z.string().nullable(),
        }),
      ),
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
        /**
         * One entry per branch (2026-11-16): the branches of a step share its `stepIndex`, each with its own script; the
         * array's order is not the steps' order.
         */
        steps: z.array(
          z.strictObject({
            step: z.strictObject({
              id,
              stepIndex: z.number().int().min(0),
              /** The branch's condition as the agency wrote it, free text; absent on the default branch. */
              condition: z.string().max(2_000).optional(),
            }),
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
        /** Absent on an empty folder (2026-11-15). */
        mediaUrl: z.string().nullable().optional(),
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

export type RevealEndpointName = keyof typeof REVEAL_ENDPOINTS;

/** What a route answers, once its shape has passed. */
export type RevealAnswer<N extends RevealEndpointName> = z.output<(typeof REVEAL_ENDPOINTS)[N]['shape']>;
