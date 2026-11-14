import { z } from 'zod';

import { MessageAuthorSchema, MessageDirectionSchema, PlatformSchema, SessionStateSchema } from './enums';
import { PlatformAccountIdSchema } from './ids';
import { CurrencySchema } from './money';

/**
 * Data crossing the `PlatformConnector` port (docs/architecture/connectors.md). Platform identifiers are opaque
 * strings; the core never interprets them.
 */

/** A platform object as the platform names it. */
export const ExternalRefSchema = z.object({
  platform: PlatformSchema,
  id: z.string().min(1),
});
export type ExternalRef = z.infer<typeof ExternalRefSchema>;

export const ConversationSnapshotSchema = z.object({
  ref: ExternalRefSchema,
  fanRef: ExternalRefSchema,
  fanDisplayName: z.string(),
  /** `null` when the platform cannot tell without opening the conversation (`capabilities.unreadWithoutOpen`). */
  unreadCount: z.number().int().min(0).nullable(),
  lastMessageAt: z.iso.datetime().nullable(),
  lastMessagePreview: z.string().optional(),
});
export type ConversationSnapshot = z.infer<typeof ConversationSnapshotSchema>;

export const ExternalMediaSchema = z.object({
  ref: ExternalRefSchema,
  kind: z.enum(['image', 'video', 'audio']),
  /** Locked behind a price (PPV bundle) until bought. */
  isLocked: z.boolean(),
});
export type ExternalMedia = z.infer<typeof ExternalMediaSchema>;

export const ExternalMessageSchema = z.object({
  ref: ExternalRefSchema,
  conversationRef: ExternalRefSchema,
  direction: MessageDirectionSchema,
  text: z.string(),
  media: z.array(ExternalMediaSchema),
  priceMinor: z.number().int().min(0).nullable(),
  currency: CurrencySchema.nullable(),
  isPaid: z.boolean(),
  /** Name of the team member who sent an outbound message, when the platform shows it. */
  senderLabel: z.string().optional(),
  /**
   * Who wrote it, when the adapter can tell: the fan, the account's own « bot » member (`ai`), or someone else on the
   * creator's side (`human`: the creator herself or a chatter). Absent when the platform does not say.
   */
  author: MessageAuthorSchema.optional(),
  createdAt: z.iso.datetime(),
});
export type ExternalMessage = z.infer<typeof ExternalMessageSchema>;

export const ExternalTransactionSchema = z.object({
  ref: ExternalRefSchema,
  fanRef: ExternalRefSchema,
  conversationRef: ExternalRefSchema.optional(),
  messageRef: ExternalRefSchema.optional(),
  kind: z.enum(['ppv', 'tip', 'subscription', 'other']),
  amountMinor: z.number().int(),
  currency: CurrencySchema,
  createdAt: z.iso.datetime(),
});
export type ExternalTransaction = z.infer<typeof ExternalTransactionSchema>;

/** A media the core asks the platform to send: one of the creator's already-uploaded items, maybe priced. */
export const OutboundMediaSchema = z.object({
  mediaRefs: z.array(ExternalRefSchema).min(1),
  text: z.string(),
  priceMinor: z.number().int().min(0).nullable(),
  currency: CurrencySchema.nullable(),
});
export type OutboundMedia = z.infer<typeof OutboundMediaSchema>;

export const SendResultSchema = z.object({
  messageRef: ExternalRefSchema,
  sentAt: z.iso.datetime(),
});
export type SendResult = z.infer<typeof SendResultSchema>;

/** After a send whose outcome is unknown (timeout), whether the message really reached the platform. */
export const VerifyResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('sent'), messageRef: ExternalRefSchema }),
  z.object({ status: z.literal('not_found') }),
]);
export type VerifyResult = z.infer<typeof VerifyResultSchema>;

/* ---------------------------------------------------------------------------------------------------------------
 * The readings of ADR 0018: what a chatter sees beside a conversation, the platform's scripts and its vault. In the
 * glossary's words, with no platform's own field: each adapter translates in its infra.
 * ------------------------------------------------------------------------------------------------------------ */

/** A media as the platform lists it, without its file. */
const PlatformMediaSchema = ExternalMediaSchema.pick({ ref: true, kind: true });
export type PlatformMedia = z.infer<typeof PlatformMediaSchema>;

/** The fan as the platform shows him beside the conversation (`getFanProfile`). Amounts in minor units. */
export const FanProfileSchema = z.object({
  fanRef: ExternalRefSchema,
  /** When he joined the platform. */
  joinedAt: z.iso.datetime(),
  /** His first subscription to the creator, `null` when the platform does not know one. */
  subscribedAt: z.iso.datetime().nullable(),
  /** When the current subscription ends, and whether it renews by itself. */
  subscriptionEndsAt: z.iso.datetime().nullable(),
  autoRenew: z.boolean(),
  totalSpentMinor: z.number().int().min(0),
  currency: CurrencySchema,
  lastPaidAt: z.iso.datetime().nullable(),
  /** When his card was checked: the only age-related fact a platform may give; `null` when never. */
  cardVerifiedAt: z.iso.datetime().nullable(),
});
export type FanProfile = z.infer<typeof FanProfileSchema>;

/** « Note client » (`getFanNote`): read live, never stored nor logged by Impera (ADR 0018 § 1). Empty when none. */
export const FanNoteSchema = z.object({ text: z.string() });
export type FanNote = z.infer<typeof FanNoteSchema>;

/** « Notes du modèle » (`getCreatorNotes`): what the platform shows about the creator beside a conversation. */
export const CreatorNoteSchema = z.object({ text: z.string().min(1) });
export type CreatorNote = z.infer<typeof CreatorNoteSchema>;

/** One bundle the fan was offered in the conversation, bought or not. */
const PpvOfferSchema = z.object({
  ref: ExternalRefSchema,
  /** 0 for a free bundle. */
  priceMinor: z.number().int().min(0),
  isPaid: z.boolean(),
  sentAt: z.iso.datetime(),
  media: z.array(PlatformMediaSchema),
});

/** The PPV tab of a fan (`getFanPpvStats`): how many priced bundles he bought, the price range, every bundle. */
export const FanPpvStatsSchema = z.object({
  purchased: z.number().int().min(0),
  offered: z.number().int().min(0),
  highestPriceMinor: z.number().int().min(0).nullable(),
  lowestPriceMinor: z.number().int().min(0).nullable(),
  currency: CurrencySchema,
  /** When the last priced bundle was sent to him, bought or not; `null` when none was. */
  lastOfferAt: z.iso.datetime().nullable(),
  /** Newest first, priced and free. */
  bundles: z.array(PpvOfferSchema),
});
export type FanPpvStats = z.infer<typeof FanPpvStatsSchema>;

/** A script's moment (☀️ / 🌙 in the platform's naming): the selling engine's « temps présent » rule reads it. */
export const PlatformScriptMomentSchema = z.enum(['day', 'night']);
export type PlatformScriptMoment = z.infer<typeof PlatformScriptMomentSchema>;

/** One step of a platform script: its text, the media it sells, its previews and its price. */
export const PlatformScriptStepSchema = z.object({
  /** The step as the platform names it: what a send of this step refers to. */
  ref: ExternalRefSchema,
  /** Its place in the script, from 0. */
  index: z.number().int().min(0),
  name: z.string(),
  text: z.string(),
  media: z.array(PlatformMediaSchema),
  previewMedia: z.array(PlatformMediaSchema),
  /** Minor units, VAT included; 0 for a free step. */
  priceMinor: z.number().int().min(0),
  currency: CurrencySchema,
});
export type PlatformScriptStep = z.infer<typeof PlatformScriptStepSchema>;

/** « Script natif » (`listPlatformScripts`): a selling script stored on the platform, its steps in order. */
export const PlatformScriptSchema = z.object({
  ref: ExternalRefSchema,
  name: z.string(),
  moment: PlatformScriptMomentSchema.nullable(),
  steps: z.array(PlatformScriptStepSchema).min(1),
});
export type PlatformScript = z.infer<typeof PlatformScriptSchema>;

/**
 * A step already sent to a fan, as the platform tells (`getScriptHistory`): the platform is the only source, a step
 * listed here never goes again (ADR 0018 § 5). `purchased`: the fan bought it (its price is read in the catalogue,
 * `listPlatformScripts`). `stepRef` is the platform's own id of the step, unique on the account. The platform gives no
 * time of sending: the core reads it from its own record of the send.
 */
export const SentScriptStepSchema = z.object({ stepRef: ExternalRefSchema, purchased: z.boolean() });
export type SentScriptStep = z.infer<typeof SentScriptStepSchema>;

/**
 * A media of the creator's vault on the platform (`listVaultMedia`), with its folder (ADR 0099 § 2 to 4).
 * `folderPosition`: its rank in the platform's own list of that folder (or of the vault's root), from 0, as the pages
 * came one after the other. The CRM does not keep that rank, which moves at each new upload: `media_platform_refs.
 * folder_position` keeps the rank among the media of the same folder uploaded at the same millisecond, in this list's
 * order (`vaultRefsOf`), and the order is rebuilt from the upload time, then that rank. `folder.moment`: ☀️ or 🌙 read in the folder's name, which is what decides. `description`:
 * the platform's text, a starting point never validated. `suggestedPriceMinor`: the platform's suggested range, in the
 * platform's minor unit (euro cents on Reveal, like its other prices; to confirm at the first real read), only shown.
 */
/** Longest vault folder name kept (`media_platform_refs.folder_name`, CHECK): longer, the connector cuts it. */
export const VAULT_FOLDER_NAME_MAX = 200;
/** Longest platform text on a vault media kept (`media_platform_refs.platform_description`, CHECK): longer, cut. */
export const VAULT_DESCRIPTION_MAX = 2_000;

export const VaultMediaSchema = z.object({
  ref: ExternalRefSchema,
  kind: ExternalMediaSchema.shape.kind,
  folder: z
    .object({
      ref: ExternalRefSchema,
      name: z.string().max(VAULT_FOLDER_NAME_MAX),
      moment: PlatformScriptMomentSchema.nullable(),
    })
    .nullable(),
  folderPosition: z.number().int().min(0),
  durationSeconds: z.number().min(0).nullable(),
  createdAt: z.iso.datetime(),
  description: z.string().max(VAULT_DESCRIPTION_MAX).nullable(),
  suggestedPriceMinor: z.object({ min: z.number().int().min(0), max: z.number().int().min(0) }).nullable(),
});
export type VaultMedia = z.infer<typeof VaultMediaSchema>;

/**
 * What a connector can do; the core adapts to it, never the other way round. A reading of ADR 0018 is called only
 * when its flag is true, never because the method exists.
 */
export const ConnectorCapabilitiesSchema = z.object({
  unreadWithoutOpen: z.boolean(),
  sendMedia: z.boolean(),
  transactions: z.boolean(),
  markRead: z.boolean(),
  typing: z.boolean(),
  realtime: z.boolean(),
  /** `getFanProfile`. */
  fanProfile: z.boolean(),
  /** `getFanNote`. */
  fanNoteRead: z.boolean(),
  /** `setFanNote`: a platform may let the note be read without letting it be written (ADR 0018 § 1). */
  fanNoteWrite: z.boolean(),
  /** `getCreatorNotes`. */
  creatorNotes: z.boolean(),
  /** `getFanPpvStats`. */
  ppvStats: z.boolean(),
  /** `listPlatformScripts` and `sendScriptStep`. */
  scripts: z.boolean(),
  /** `getScriptHistory`. */
  scriptHistory: z.boolean(),
  /** `listVaultMedia`. */
  vault: z.boolean(),
});
export type ConnectorCapabilities = z.infer<typeof ConnectorCapabilitiesSchema>;

export const ConnectorErrorCodeSchema = z.enum([
  'session_expired',
  'rate_limited',
  'not_found',
  'transient',
  'fatal',
]);
export type ConnectorErrorCode = z.infer<typeof ConnectorErrorCodeSchema>;

/** Pushed by a connector that subscribes to a realtime channel. */
export const ConnectorEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message'), message: ExternalMessageSchema }),
  z.object({ type: z.literal('transaction'), transaction: ExternalTransactionSchema }),
  z.object({ type: z.literal('session'), state: SessionStateSchema }),
]);
export type ConnectorEvent = z.infer<typeof ConnectorEventSchema>;

export type Unsubscribe = () => Promise<void>;

/**
 * `platform_accounts.connector_config` (connectors.md § Règles de bonne conduite): the polling rhythm and the
 * circuit breaker. Every field has a default, so `{}` is a valid configuration.
 */
export const ConnectorConfigSchema = z.object({
  /** Seconds between two polls of the account. */
  pollIntervalSeconds: z.number().int().min(15).max(3_600).default(60),
  /** Random extra wait added to each poll, so the rhythm is never regular. */
  jitterSeconds: z.number().int().min(0).max(300).default(20),
  /** Consecutive failed polls before the breaker opens. */
  breakerThreshold: z.number().int().min(1).max(50).default(5),
  /** How long an open breaker keeps the account quiet. */
  breakerPauseMinutes: z.number().int().min(1).max(240).default(10),
  /**
   * Write guard: whether Impera may send anything through this account. Off by default, so a newly registered
   * account is only read; turned on by hand once the account is the one meant to answer (the test fan account first).
   */
  writes: z.boolean().default(false),
});
export type ConnectorConfig = z.infer<typeof ConnectorConfigSchema>;

/**
 * `POST /v1/connector/sessions`: the extension's « Sync » button sends the platform session it read, with the owner's
 * extension link (ADR 0066 § 7). The session is opaque to the core (each adapter reads its own shape), stored
 * encrypted, never logged and never sent back.
 */
export const ConnectorSessionBodySchema = z.object({
  platformAccountId: PlatformAccountIdSchema,
  session: z.string().min(1).max(65_536),
});
export type ConnectorSessionBody = z.infer<typeof ConnectorSessionBodySchema>;

/**
 * `GET /v1/connector/accounts?platform=`: the accounts the extension may sync, for the owner's link only (ADR 0066 § 7).
 * Never the session itself, only its state and when it last changed.
 */
export const ConnectorAccountChoiceSchema = z.object({
  id: PlatformAccountIdSchema,
  platform: PlatformSchema,
  handle: z.string(),
  creatorName: z.string(),
  sessionState: SessionStateSchema,
  sessionUpdatedAt: z.iso.datetime().nullable(),
});
export type ConnectorAccountChoice = z.infer<typeof ConnectorAccountChoiceSchema>;

export const ConnectorAccountsQuerySchema = z.object({ platform: PlatformSchema });

export const ConnectorAccountsSchema = z.object({ accounts: z.array(ConnectorAccountChoiceSchema) });
export type ConnectorAccounts = z.infer<typeof ConnectorAccountsSchema>;

/** The « Sync » refusals the extension tells apart (`/v1/connector/sessions`). */
export const CONNECTOR_LINK_FORBIDDEN = 'connector_link_forbidden';
export const CONNECTOR_SESSION_UNPROCESSABLE = 'connector_session_unprocessable';
export const CONNECTOR_SESSION_CONFLICT = 'connector_session_conflict';
/** The session of another team member than the « bot » member the account was first synced with (P2-02). */
export const CONNECTOR_SESSION_MEMBER_CONFLICT = 'connector_session_member_conflict';
