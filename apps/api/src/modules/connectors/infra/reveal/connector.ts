import type {
  ConnectorCapabilities,
  ConversationSnapshot,
  CreatorNote,
  ExternalMessage,
  ExternalRef,
  ExternalTransaction,
  FanNote,
  FanPpvStats,
  FanProfile,
  PlatformScript,
  SendResult,
  SentScriptStep,
  SessionState,
  VaultMedia,
  VerifyResult,
} from '@impera/contracts';
import { z } from 'zod';

import { ConnectorError, type PlatformConnector } from '../../domain/platform-connector';
import type { ConnectorRegistry } from '../../domain/ports';

import {
  createRevealClient,
  REVEAL_API_BASE_URL,
  type RevealCallLog,
  type RevealClient,
  type RevealFetch,
} from './client';
import {
  messageOf,
  ppvStatsOf,
  profileOf,
  scriptsOf,
  sentStepsOf,
  snapshotOf,
  transactionOf,
  vaultMediaOf,
  type OwnMessages,
} from './mapping';
import { parseRevealSession, type RevealSession } from './session';
import { REVEAL_ENDPOINTS, type RevealAnswer } from './wire';

/** Page sizes of the official client (reveal-api-observed.md § Pagination): no heavier than a chatter. */
const TAKE = { conversations: 20, messages: 10, ppv: 10, scripts: 20, vault: 10, transactions: 10 } as const;
/** A cursor that never ends is a bug or a changed API: stop rather than loop. */
const MAX_PAGES = 500;
/** `health` warns this long before a readable expiry (spec § 2). */
const WARNING_BEFORE_MS = 24 * 3_600_000;

/**
 * What Reveal lets this adapter do (reveal-api-observed.md, Résumé), as far as P2-02 goes: every reading. Sends,
 * read marks and typing arrive with P2-03 and stay off until then.
 */
const CAPABILITIES: ConnectorCapabilities = {
  unreadWithoutOpen: true,
  sendMedia: false,
  transactions: true,
  markRead: false,
  typing: false,
  realtime: false,
  fanProfile: true,
  fanNoteRead: true,
  creatorNotes: true,
  ppvStats: true,
  scripts: true,
  scriptHistory: true,
  vault: true,
};

export interface RevealApiConnectorOptions {
  /** The captured session (`null` when none, or not one of Reveal's): every call then fails `session_expired`. */
  readonly session: RevealSession | null;
  readonly fetch: RevealFetch;
  /** `https://api.reveal.me` by default; FakeReveal's in the tests. */
  readonly baseUrl?: string;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Each call's route, status and duration; never the token, a URL or a body. */
  readonly log?: (entry: RevealCallLog) => void;
  /** The « bot » member's display name, the fallback to know our own messages (spec § 4); `null` when unknown. */
  readonly botDisplayName?: string | null;
}

/** `exp` of a JWT bearer, when the token is one (spec § 2, V2); `null` otherwise. */
function expiryOf(bearer: string): number | null {
  const payload = bearer.split('.')[1];
  if (payload === undefined) return null;
  try {
    const parsed = z
      .object({ exp: z.number() })
      .safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    return parsed.success ? parsed.data.exp * 1_000 : null;
  } catch {
    return null;
  }
}

const isAfter = (iso: string | null, since: Date | undefined): boolean =>
  since === undefined || (iso !== null && Date.parse(iso) > since.getTime());

/**
 * `RevealApiConnector` (reveal-connector-spec.md §§ 3, 4, 6): Reveal's private API with the « bot » member's captured
 * session, for reading only. One client per account, built by the registry from the stored session.
 */
export class RevealApiConnector implements PlatformConnector {
  readonly platform = 'reveal' as const;
  readonly capabilities = CAPABILITIES;

  private readonly client: RevealClient | null;
  private readonly modelId: string;
  private readonly expiresAt: number | null;
  private readonly now: () => Date;
  /** The ids are those of our own sends (`connector_sends`), fed by the writes of P2-03; empty until then. */
  private readonly own: OwnMessages;
  /** Fan → conversation, as `listConversations` read them: Reveal has one conversation per fan and model. */
  private readonly conversationOfFan = new Map<string, string>();

  constructor(options: RevealApiConnectorOptions) {
    const { session } = options;
    this.now = options.now ?? (() => new Date());
    this.modelId = session?.modelId ?? '';
    this.expiresAt = session === null ? null : expiryOf(session.bearer);
    this.own = { ids: new Set(), botDisplayName: options.botDisplayName ?? null };
    this.client =
      session === null
        ? null
        : createRevealClient({
            baseUrl: options.baseUrl ?? REVEAL_API_BASE_URL,
            bearer: session.bearer,
            userAgent: session.userAgent,
            fetch: options.fetch,
            now: () => this.now().getTime(),
            sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
            log: options.log ?? (() => undefined),
          });
  }

  /** `GET /models/:modelId` (spec § 2): refused → `expired`; a readable expiry less than a day away → `warning`. */
  async health(): Promise<SessionState> {
    if (this.client === null) return 'none';
    try {
      await this.client.get('models.get', REVEAL_ENDPOINTS['models.get'].shape, this.modelId);
    } catch (error) {
      if (error instanceof ConnectorError && error.code === 'session_expired') return 'expired';
      throw error;
    }
    if (this.expiresAt !== null && this.expiresAt - this.now().getTime() < WARNING_BEFORE_MS)
      return 'warning';
    return 'valid';
  }

  /** Most recent first, pages read while their last conversation moved after `since` (spec § 4). */
  async listConversations(opts: { since?: Date; limit?: number }): Promise<ConversationSnapshot[]> {
    const snapshots: ConversationSnapshot[] = [];
    await this.conversationPages((item) => {
      const snapshot = snapshotOf(item);
      if (!isAfter(snapshot.lastMessageAt, opts.since)) return false;
      snapshots.push(snapshot);
      return opts.limit === undefined || snapshots.length < opts.limit;
    });
    return snapshots;
  }

  /** Oldest first; pages read toward the past until `since`, `limit` or the first message (spec § 4). */
  async fetchMessages(
    conversationRef: ExternalRef,
    opts: { since?: Date; limit?: number },
  ): Promise<ExternalMessage[]> {
    const client = this.session();
    const messages: ExternalMessage[] = [];
    let cursor: string | null = null;
    for (let pages = 0; ; pages++) {
      if (pages === MAX_PAGES) throw runaway('messages.list');
      const page: RevealAnswer<'messages.list'> = await client.get(
        'messages.list',
        REVEAL_ENDPOINTS['messages.list'].shape,
        conversationRef.id,
        [['take', String(TAKE.messages)], ...(cursor === null ? [] : [['cursor', cursor] as const])],
      );
      for (const item of page.data) {
        if (!isAfter(item.message.createdAt, opts.since)) return messages.reverse();
        messages.push(messageOf(item, conversationRef, this.own));
        if (opts.limit !== undefined && messages.length >= opts.limit) return messages.reverse();
      }
      if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) return messages.reverse();
      cursor = page.pageInfo.endCursor;
    }
  }

  sendText(): Promise<SendResult> {
    return Promise.reject(writesLater());
  }

  sendMedia(): Promise<SendResult> {
    return Promise.reject(writesLater());
  }

  verifySent(): Promise<VerifyResult> {
    return Promise.reject(writesLater());
  }

  /** Paid and refunded sales, newest first, until `since` (spec § 4). */
  async listTransactions(opts: { since?: Date }): Promise<ExternalTransaction[]> {
    const client = this.session();
    const transactions: ExternalTransaction[] = [];
    let cursor: string | null = null;
    for (let pages = 0; ; pages++) {
      if (pages === MAX_PAGES) throw runaway('transactions.list');
      const page: RevealAnswer<'transactions.list'> = await client.get(
        'transactions.list',
        REVEAL_ENDPOINTS['transactions.list'].shape,
        this.modelId,
        [
          ['take', String(TAKE.transactions)],
          ['status[]', 'paid'],
          ['status[]', 'refunded'],
          ...(cursor === null ? [] : [['cursor', cursor] as const]),
        ],
      );
      for (const transaction of page.data) {
        if (!isAfter(transaction.createdAt, opts.since)) return transactions;
        transactions.push(transactionOf(transaction));
      }
      if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) return transactions;
      cursor = page.pageInfo.endCursor;
    }
  }

  async getFanProfile(fanRef: ExternalRef): Promise<FanProfile> {
    const client = this.session();
    const conversationId = await this.conversationOf(fanRef);
    const item = await client.get(
      'conversations.get',
      REVEAL_ENDPOINTS['conversations.get'].shape,
      conversationId,
    );
    return profileOf(
      item,
      await client.get('conversations.stats', REVEAL_ENDPOINTS['conversations.stats'].shape, conversationId),
    );
  }

  /** Read live and handed over: never kept, never logged (ADR 0018 § 1). */
  async getFanNote(fanRef: ExternalRef): Promise<FanNote> {
    const item = await this.session().get(
      'conversations.get',
      REVEAL_ENDPOINTS['conversations.get'].shape,
      await this.conversationOf(fanRef),
    );
    return { text: item.conversation.note ?? '' };
  }

  /** One note per model on Reveal, the same beside every conversation (spec § 4). */
  async getCreatorNotes(): Promise<CreatorNote[]> {
    const model = await this.session().get('models.get', REVEAL_ENDPOINTS['models.get'].shape, this.modelId);
    return model.creatorNote.trim() === '' ? [] : [{ text: model.creatorNote }];
  }

  async getFanPpvStats(fanRef: ExternalRef): Promise<FanPpvStats> {
    const client = this.session();
    const conversationId = await this.conversationOf(fanRef);
    const history = async (kind: 'paid' | 'free') => {
      const pages: RevealAnswer<'conversations.ppvHistory'>[] = [];
      let cursor: string | null = null;
      for (;;) {
        if (pages.length === MAX_PAGES) throw runaway('conversations.ppvHistory');
        const page: RevealAnswer<'conversations.ppvHistory'> = await client.get(
          'conversations.ppvHistory',
          REVEAL_ENDPOINTS['conversations.ppvHistory'].shape,
          conversationId,
          [
            ['take', String(TAKE.ppv)],
            ['kind', kind],
            ...(cursor === null ? [] : [['cursor', cursor] as const]),
          ],
        );
        pages.push(page);
        if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) return pages;
        cursor = page.pageInfo.endCursor;
      }
    };
    const paid = await history('paid');
    const free = await history('free');
    const [first] = paid;
    if (first === undefined) throw runaway('conversations.ppvHistory');
    return ppvStatsOf(
      { first, bundles: paid.flatMap((page) => page.bundles) },
      free.flatMap((page) => page.bundles),
    );
  }

  /** Sequences and loose steps (spec § 6); the vault is read only when a name says no moment. */
  async listPlatformScripts(): Promise<PlatformScript[]> {
    const client = this.session();
    const sequences = await client.get(
      'scriptSequences.list',
      REVEAL_ENDPOINTS['scriptSequences.list'].shape,
      this.modelId,
    );
    const steps = await this.scriptPages([['withConversations', 'false']]);
    const named = scriptsOf(sequences, steps, () => null);
    if (named.every((script) => script.moment !== null)) return named;
    const folders = new Map<string, string>();
    for (const media of await this.listVaultMedia({})) {
      if (media.folder !== null) folders.set(media.ref.id, media.folder.name);
    }
    return scriptsOf(sequences, steps, (mediaId) => folders.get(mediaId) ?? null);
  }

  /** The steps already sent in the fan's conversation: Reveal is the only source (ADR 0018 § 5). */
  async getScriptHistory(fanRef: ExternalRef): Promise<SentScriptStep[]> {
    const conversationId = await this.conversationOf(fanRef);
    return sentStepsOf(await this.scriptPages([['conversationId', conversationId]]));
  }

  /** The folders, then each folder's media; without a folder, the media at the vault's root too. */
  async listVaultMedia(opts: { folderRef?: ExternalRef }): Promise<VaultMedia[]> {
    const client = this.session();
    const folders = await client.get('vault.folders', REVEAL_ENDPOINTS['vault.folders'].shape, this.modelId);
    const asked = opts.folderRef;
    const wanted = asked === undefined ? folders : folders.filter((folder) => folder.id === asked.id);
    if (asked !== undefined && wanted.length === 0) {
      throw new ConnectorError('not_found', 'vault.folders: no such folder');
    }
    const media: VaultMedia[] = [];
    const seen = new Set<string>();
    for (const folder of wanted) {
      for (const item of await this.vaultPages(folder.id)) {
        seen.add(item.id);
        media.push(vaultMediaOf(item, folder));
      }
    }
    if (asked === undefined) {
      for (const item of await this.vaultPages(null)) {
        if (!seen.has(item.id)) media.push(vaultMediaOf(item, null));
      }
    }
    return media;
  }

  private session(): RevealClient {
    if (this.client === null) throw new ConnectorError('session_expired', 'no Reveal session captured');
    return this.client;
  }

  /** Walks the conversation list, most recent first, while `keep` says so; remembers each fan's conversation. */
  private async conversationPages(
    keep: (item: RevealAnswer<'conversations.list'>['data'][number]) => boolean,
  ): Promise<void> {
    const client = this.session();
    let cursor: string | null = null;
    for (let pages = 0; ; pages++) {
      if (pages === MAX_PAGES) throw runaway('conversations.list');
      const page: RevealAnswer<'conversations.list'> = await client.get(
        'conversations.list',
        REVEAL_ENDPOINTS['conversations.list'].shape,
        '',
        [
          ['take', String(TAKE.conversations)],
          ['modelId', this.modelId],
          ['filter', 'all'],
          ...(cursor === null ? [] : [['cursor', cursor] as const]),
        ],
      );
      for (const item of page.data) {
        this.conversationOfFan.set(item.member.id, item.conversation.id);
        if (!keep(item)) return;
      }
      if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) return;
      cursor = page.pageInfo.endCursor;
    }
  }

  /** The fan's conversation: from the last listing, else the whole list read again, else `not_found` (spec § 4). */
  private async conversationOf(fanRef: ExternalRef): Promise<string> {
    const known = this.conversationOfFan.get(fanRef.id);
    if (known !== undefined) return known;
    await this.conversationPages((item) => item.member.id !== fanRef.id);
    const found = this.conversationOfFan.get(fanRef.id);
    if (found === undefined) throw new ConnectorError('not_found', 'conversations.list: unknown fan');
    return found;
  }

  private async scriptPages(query: readonly (readonly [string, string])[]) {
    const client = this.session();
    const items: RevealAnswer<'scripts.list'>['data'] = [];
    let cursor: string | null = null;
    for (let pages = 0; ; pages++) {
      if (pages === MAX_PAGES) throw runaway('scripts.list');
      const page: RevealAnswer<'scripts.list'> = await client.get(
        'scripts.list',
        REVEAL_ENDPOINTS['scripts.list'].shape,
        this.modelId,
        [['take', String(TAKE.scripts)], ...query, ...(cursor === null ? [] : [['cursor', cursor] as const])],
      );
      items.push(...page.data);
      if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) return items;
      cursor = page.pageInfo.endCursor;
    }
  }

  private async vaultPages(folderId: string | null) {
    const client = this.session();
    const items: RevealAnswer<'vault.medias'>['data'] = [];
    let cursor: string | null = null;
    for (let pages = 0; ; pages++) {
      if (pages === MAX_PAGES) throw runaway('vault.medias');
      const page: RevealAnswer<'vault.medias'> = await client.get(
        'vault.medias',
        REVEAL_ENDPOINTS['vault.medias'].shape,
        this.modelId,
        [
          ['take', String(TAKE.vault)],
          ...(folderId === null ? [] : [['vaultFolderId', folderId] as const]),
          ...(cursor === null ? [] : [['cursor', cursor] as const]),
        ],
      );
      items.push(...page.data);
      if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) return items;
      cursor = page.pageInfo.endCursor;
    }
  }
}

function runaway(route: string): ConnectorError {
  return new ConnectorError('fatal', `${route}: pagination did not end`);
}

/** Sends need `connector_sends` and the write guard's tests against FakeReveal: P2-03. */
function writesLater(): ConnectorError {
  return new ConnectorError('fatal', 'reveal writes are not wired yet (P2-03)');
}

/**
 * The registry's factory for Reveal: one `RevealApiConnector` per account, from its stored session. A session that
 * is missing or not Reveal's gives a connector whose `health` says `none` and whose calls fail `session_expired`.
 */
export function revealApiConnectors(options: {
  readonly fetch: RevealFetch;
  readonly baseUrl?: string;
  readonly log?: (platformAccountId: string, entry: RevealCallLog) => void;
}): NonNullable<ConnectorRegistry['reveal']> {
  return (account, session) =>
    new RevealApiConnector({
      session: session === null ? null : parseRevealSession(session),
      fetch: options.fetch,
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      ...(options.log === undefined ? {} : { log: (entry) => options.log?.(account.id, entry) }),
    });
}
