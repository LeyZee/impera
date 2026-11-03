import type {
  ConnectorCapabilities,
  ConnectorErrorCode,
  ConnectorEvent,
  ConversationSnapshot,
  ExternalMessage,
  ExternalRef,
  ExternalTransaction,
  OutboundMedia,
  Platform,
  SendResult,
  SessionState,
  Unsubscribe,
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
