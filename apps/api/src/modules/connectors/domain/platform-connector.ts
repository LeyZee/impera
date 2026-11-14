import type {
  ConnectorCapabilities,
  ConnectorErrorCode,
  ConnectorEvent,
  ConversationSnapshot,
  CreatorNote,
  ExternalMessage,
  ExternalRef,
  ExternalTransaction,
  FanNote,
  FanPpvStats,
  FanProfile,
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
  /** `creatorNotes`: empty when the platform has none. */
  getCreatorNotes?(conversationRef: ExternalRef): Promise<CreatorNote[]>;
  /** `ppvStats`. */
  getFanPpvStats?(fanRef: ExternalRef): Promise<FanPpvStats>;
  /** `scripts`. */
  listPlatformScripts?(): Promise<PlatformScript[]>;
  /** `scriptHistory`: the steps already sent to this fan; the platform is the only source (ADR 0018 § 5). */
  getScriptHistory?(fanRef: ExternalRef): Promise<SentScriptStep[]>;
  /** `vault`: every media of the vault, or of one folder. */
  listVaultMedia?(opts: { folderRef?: ExternalRef }): Promise<VaultMedia[]>;
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
