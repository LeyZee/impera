import type {
  ConnectorCapabilities,
  ConnectorErrorCode,
  ConnectorEvent,
  ConversationSnapshot,
  CreatorNote,
  CreatorProfile,
  ExternalMessage,
  ExternalRef,
  ExternalTransaction,
  FanNote,
  FanPpvStats,
  FanProfile,
  FetchedMedia,
  Money,
  OutboundMedia,
  Platform,
  PlatformScript,
  SendResult,
  SentScriptStep,
  SessionState,
  Unsubscribe,
  VaultMedia,
  VerifyResult,
} from '@impera/contracts';

/**
 * The port every platform adapter implements (connectors.md). Each method is idempotent or carries an
 * idempotency key, and fails only with a `ConnectorError`, never a raw HTTP error.
 */
export interface PlatformConnector {
  readonly platform: Platform;
  readonly capabilities: ConnectorCapabilities;
  health(): Promise<SessionState>;
  listConversations(opts: { since?: Date; limit?: number }): Promise<ConversationSnapshot[]>;
  /**
   * One conversation by its id, as the list would give it (recette du 16/11: the copilot opened one no poll read).
   * One the account does not hold fails with `not_found`.
   */
  getConversation(conversationRef: ExternalRef): Promise<ConversationSnapshot>;
  fetchMessages(
    conversationRef: ExternalRef,
    opts: { since?: Date; limit?: number },
  ): Promise<ExternalMessage[]>;
  sendText(conversationRef: ExternalRef, text: string, idempotencyKey: string): Promise<SendResult>;
  sendMedia(conversationRef: ExternalRef, media: OutboundMedia, idempotencyKey: string): Promise<SendResult>;
  verifySent(conversationRef: ExternalRef, idempotencyKey: string): Promise<VerifyResult>;
  listTransactions?(opts: { since?: Date }): Promise<ExternalTransaction[]>;
  markRead?(conversationRef: ExternalRef): Promise<void>;
  setTyping?(conversationRef: ExternalRef, on: boolean): Promise<void>;
  subscribe?(onEvent: (event: ConnectorEvent) => void): Promise<Unsubscribe>;

  /*
   * The readings of ADR 0018, each behind its `capabilities` flag (called only when the flag is true). A fan is named
   * by his `fanRef` from `listConversations`; an unknown one fails with `not_found`.
   */
  /** `fanProfile`. */
  getFanProfile?(fanRef: ExternalRef): Promise<FanProfile>;
  /** `fanNoteRead`: read live, never stored nor logged (ADR 0018 § 1). */
  getFanNote?(fanRef: ExternalRef): Promise<FanNote>;
  /**
   * `fanNoteWrite`: writes the agency's block of the fan's note (its canvas lines), read again just before and every
   * other line kept word for word. Idempotent: the same block written twice changes the note once.
   */
  setFanNote?(fanRef: ExternalRef, text: string, idempotencyKey: string): Promise<void>;
  /** `creatorNotes`: empty when the platform has none. */
  getCreatorNotes?(conversationRef: ExternalRef): Promise<CreatorNote[]>;
  /** `creatorProfile`: her bio as every subscriber reads it, empty when she has none; never written (ADR 0154). */
  getCreatorProfile?(): Promise<CreatorProfile>;
  /** `ppvStats`. */
  getFanPpvStats?(fanRef: ExternalRef): Promise<FanPpvStats>;
  /** `scripts`. */
  listPlatformScripts?(): Promise<PlatformScript[]>;
  /**
   * `scripts`: sends one step of a platform script, priced as the platform lists it (never by us). The history is read
   * again just before: a step already sent in this conversation is refused for good (`ScriptStepAlreadySent`).
   * `expectedPrice` is the step's price as the person or the agent validated it: the platform listing another one
   * just before sends nothing (`ScriptStepPriceChanged`), and so does a reduced price set on the step there
   * (`ScriptStepDiscounted`). The step is named by its own ref (`stepRef`), never by its place: the branches of a step
   * share a rank and come in no stable order (ADR 0112 § 1).
   */
  sendScriptStep?(
    conversationRef: ExternalRef,
    scriptRef: ExternalRef,
    stepRef: ExternalRef,
    expectedPrice: Money,
    idempotencyKey: string,
  ): Promise<SendResult>;
  /** `scriptHistory`: the steps already sent to this fan; the platform is the only source (ADR 0018 § 5). */
  getScriptHistory?(fanRef: ExternalRef): Promise<SentScriptStep[]>;
  /** `vault`: every media of the vault, or of one folder. */
  listVaultMedia?(opts: { folderRef?: ExternalRef }): Promise<VaultMedia[]>;
  /**
   * `mediaDownload`: reads one vault file to `path` (ADR 0113), the media named by its `ref` and its folder as
   * `listVaultMedia` gave them (`null` at the vault's root). A link the platform no longer signs is read again from the
   * folder once. The file at `path` is the caller's to remove, failed or not. Never writes to the platform.
   */
  fetchMedia?(
    mediaRef: ExternalRef,
    opts: { folderRef: ExternalRef | null; path: string },
  ): Promise<FetchedMedia>;
  /**
   * `vaultPreview` (ADR 0138): the small picture of one media of the vault (a photo's reduced size, a video's poster),
   * read now with links fresh from its folder (`null`: the vault's root), and handed back, never kept. `not_found`
   * for a media the folder no longer lists, or one with no picture (a voice note).
   */
  readVaultPreview?(input: { mediaRef: ExternalRef; folderRef: ExternalRef | null }): Promise<VaultPreview>;
}

/** The image types a vault preview may be, read from its first bytes, never from what the platform says. */
export type VaultPreviewType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'image/avif';

/** A vault media's small picture, as `readVaultPreview` hands it back. */
export interface VaultPreview {
  readonly contentType: VaultPreviewType;
  readonly bytes: Uint8Array;
}

/** The only error a connector throws. `retryAfterSeconds` comes with `rate_limited` when the platform says. */
export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;
  readonly retryAfterSeconds: number | null;

  constructor(
    code: ConnectorErrorCode,
    message: string,
    options: { retryAfterSeconds?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ConnectorError';
    this.code = code;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

/**
 * A definitive refusal from the platform's own history (ADR 0018 § 5): the step was already sent in this conversation,
 * so it never goes again. `fatal`, never retried; the guarded writer turns it into a `SendRefused`.
 */
export class ScriptStepAlreadySent extends ConnectorError {
  constructor() {
    super('fatal', 'script_step_already_sent');
    this.name = 'ScriptStepAlreadySent';
  }
}

/**
 * The step's price changed on the platform since a person or the agent validated it: Reveal now lists another price
 * than the expected one, so nothing is sent (the fan would pay what nobody chose). `fatal` for this send, never
 * retried as it is; the guarded writer turns it into a `SendRefused`, and the step is offered again at its new price.
 */
export class ScriptStepPriceChanged extends ConnectorError {
  constructor() {
    super('fatal', 'script_price_changed');
    this.name = 'ScriptStepPriceChanged';
  }
}

/**
 * The step carries a reduced price for a time on the platform (Reveal's « Tarif réduit »): Impera never sells at a
 * discount, so nothing is sent, as for a changed price (Charles, recette 16/11). `fatal`: the draft fails for good
 * and is never retried; once the agency takes the discount off on the platform, the next import makes the script
 * proposable again and only a new proposal sends the step.
 */
export class ScriptStepDiscounted extends ConnectorError {
  constructor() {
    super('fatal', 'script_step_discounted');
    this.name = 'ScriptStepDiscounted';
  }
}
