import type {
  ConnectorCapabilities,
  ConnectorErrorCode,
  ConversationSnapshot,
  ExternalMessage,
  ExternalRef,
  OutboundMedia,
  Platform,
  SendResult,
  SessionState,
  VerifyResult,
} from '@impera/contracts';

import { ConnectorError, type PlatformConnector } from '../../domain/platform-connector';

type FailingMethod =
  'health' | 'listConversations' | 'fetchMessages' | 'sendText' | 'sendMedia' | 'verifySent';

interface FakeConversation {
  readonly ref: ExternalRef;
  readonly fanRef: ExternalRef;
  readonly fanDisplayName: string;
  readonly messages: ExternalMessage[];
}

/** One message the fake platform recorded as sent by the creator's side. */
export interface FakeSent {
  readonly conversationId: string;
  readonly text: string;
  readonly idempotencyKey: string;
  readonly messageRef: ExternalRef;
}

/**
 * An in-memory platform for tests and local development (connectors.md, phase 0). A test writes the scenario:
 * fans who write (`enqueueInbound`), failures (`failNext`), an expired session (`expireSession`), slow calls
 * (`delayMs`). Sends are idempotent per key, like the port requires. The clock is injected so that message
 * dates follow the test's time.
 */
export class FakeConnector implements PlatformConnector {
  readonly capabilities: ConnectorCapabilities = {
    unreadWithoutOpen: true,
    sendMedia: true,
    transactions: false,
    markRead: false,
    typing: false,
    realtime: false,
    // The readings of ADR 0018: none here; FakeReveal plays them for the contract.
    fanProfile: false,
    fanNoteRead: false,
    fanNoteWrite: false,
    creatorNotes: false,
    ppvStats: false,
    scripts: false,
    scriptHistory: false,
    vault: false,
  };

  readonly sent: FakeSent[] = [];
  /** Calls per method, to observe what the core asked. */
  readonly calls: Record<FailingMethod, number> = {
    health: 0,
    listConversations: 0,
    fetchMessages: 0,
    sendText: 0,
    sendMedia: 0,
    verifySent: 0,
  };
  /** Added to every call: lets a test observe two calls overlapping (or not). */
  delayMs = 0;
  /** Highest number of calls in flight at once. */
  maxInFlight = 0;

  private readonly conversations = new Map<string, FakeConversation>();
  private readonly failures: { method: FailingMethod; code: ConnectorErrorCode }[] = [];
  private session: SessionState = 'valid';
  private inFlight = 0;
  private counter = 0;

  constructor(
    private readonly clock: { now(): Date } = { now: () => new Date() },
    readonly platform: Platform = 'reveal',
  ) {}

  /** A fan writes; creates the conversation on its first message. Returns the message as the platform shows it. */
  enqueueInbound(input: {
    conversationId: string;
    fanId: string;
    fanDisplayName: string;
    text: string;
  }): ExternalMessage {
    const conversation = this.conversationOf(input.conversationId, input.fanId, input.fanDisplayName);
    const message = this.message(conversation.ref, 'inbound', input.text);
    conversation.messages.push(message);
    return message;
  }

  /** The next call to `method` fails with `code` (queued: two calls queue two failures). */
  failNext(method: FailingMethod, code: ConnectorErrorCode): void {
    this.failures.push({ method, code });
  }

  /** Every call fails with `session_expired` from now on, until `renewSession`. */
  expireSession(): void {
    this.session = 'expired';
  }

  renewSession(): void {
    this.session = 'valid';
  }

  health(): Promise<SessionState> {
    return this.call('health', () => this.session);
  }

  listConversations(opts: { since?: Date; limit?: number }): Promise<ConversationSnapshot[]> {
    return this.call('listConversations', () => {
      const snapshots = [...this.conversations.values()]
        .map((conversation) => ({ conversation, last: conversation.messages.at(-1) }))
        .filter(
          ({ last }) =>
            opts.since === undefined || (last !== undefined && new Date(last.createdAt) > opts.since),
        )
        .sort((a, b) => (b.last?.createdAt ?? '').localeCompare(a.last?.createdAt ?? ''))
        .map(({ conversation, last }) => ({
          ref: conversation.ref,
          fanRef: conversation.fanRef,
          fanDisplayName: conversation.fanDisplayName,
          unreadCount: conversation.messages.filter((m) => m.direction === 'inbound').length,
          lastMessageAt: last?.createdAt ?? null,
          ...(last === undefined ? {} : { lastMessagePreview: last.text.slice(0, 80) }),
        }));
      return snapshots.slice(0, opts.limit ?? snapshots.length);
    });
  }

  fetchMessages(
    conversationRef: ExternalRef,
    opts: { since?: Date; limit?: number },
  ): Promise<ExternalMessage[]> {
    return this.call('fetchMessages', () => {
      const messages = this.existing(conversationRef).messages.filter(
        (message) => opts.since === undefined || new Date(message.createdAt) > opts.since,
      );
      // The most recent ones when limited, oldest first like a conversation reads.
      return opts.limit === undefined ? [...messages] : messages.slice(-opts.limit);
    });
  }

  sendText(conversationRef: ExternalRef, text: string, idempotencyKey: string): Promise<SendResult> {
    return this.call('sendText', () => this.send(conversationRef, text, idempotencyKey));
  }

  sendMedia(conversationRef: ExternalRef, media: OutboundMedia, idempotencyKey: string): Promise<SendResult> {
    return this.call('sendMedia', () => this.send(conversationRef, media.text, idempotencyKey));
  }

  verifySent(conversationRef: ExternalRef, idempotencyKey: string): Promise<VerifyResult> {
    return this.call('verifySent', (): VerifyResult => {
      this.existing(conversationRef);
      const found = this.sent.find((sent) => sent.idempotencyKey === idempotencyKey);
      return found === undefined ? { status: 'not_found' } : { status: 'sent', messageRef: found.messageRef };
    });
  }

  private async call<T>(method: FailingMethod, run: () => T): Promise<T> {
    this.calls[method] += 1;
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      if (this.session === 'expired' && method !== 'health') {
        throw new ConnectorError('session_expired', 'Session expirée');
      }
      const index = this.failures.findIndex((failure) => failure.method === method);
      const failure = index === -1 ? undefined : this.failures.splice(index, 1)[0];
      if (failure !== undefined) {
        throw new ConnectorError(failure.code, `Échec simulé : ${failure.code}`, {
          ...(failure.code === 'rate_limited' ? { retryAfterSeconds: 1 } : {}),
        });
      }
      return run();
    } finally {
      this.inFlight -= 1;
    }
  }

  private send(conversationRef: ExternalRef, text: string, idempotencyKey: string): SendResult {
    const conversation = this.existing(conversationRef);
    const already = this.sent.find((sent) => sent.idempotencyKey === idempotencyKey);
    if (already !== undefined) {
      const original = conversation.messages.find((message) => message.ref.id === already.messageRef.id);
      return {
        messageRef: already.messageRef,
        sentAt: original?.createdAt ?? this.clock.now().toISOString(),
      };
    }
    const message = this.message(conversation.ref, 'outbound', text);
    conversation.messages.push(message);
    this.sent.push({ conversationId: conversation.ref.id, text, idempotencyKey, messageRef: message.ref });
    return { messageRef: message.ref, sentAt: message.createdAt };
  }

  private conversationOf(id: string, fanId: string, fanDisplayName: string): FakeConversation {
    const existing = this.conversations.get(id);
    if (existing !== undefined) return existing;
    const created: FakeConversation = {
      ref: { platform: this.platform, id },
      fanRef: { platform: this.platform, id: fanId },
      fanDisplayName,
      messages: [],
    };
    this.conversations.set(id, created);
    return created;
  }

  private existing(ref: ExternalRef): FakeConversation {
    const conversation = this.conversations.get(ref.id);
    if (conversation === undefined)
      throw new ConnectorError('not_found', `Conversation inconnue : ${ref.id}`);
    return conversation;
  }

  private message(
    conversationRef: ExternalRef,
    direction: 'inbound' | 'outbound',
    text: string,
  ): ExternalMessage {
    this.counter += 1;
    // Strictly increasing dates even when the test clock stands still: `since` filters stay exact.
    const createdAt = new Date(this.clock.now().getTime() + this.counter).toISOString();
    return {
      ref: { platform: this.platform, id: `fake-m-${String(this.counter)}` },
      conversationRef,
      direction,
      text,
      media: [],
      priceMinor: null,
      currency: null,
      isPaid: false,
      createdAt,
    };
  }
}
