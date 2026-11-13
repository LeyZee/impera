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
  OutboundMedia,
  PlatformScript,
  SendResult,
  SentScriptStep,
  SessionState,
  VaultMedia,
  VerifyResult,
} from '@impera/contracts';
import { z } from 'zod';

import {
  ConnectorError,
  ScriptStepAlreadySent,
  type PlatformConnector,
} from '../../domain/platform-connector';
import type { ConnectorRegistry, ConnectorSend, SendJournal } from '../../domain/ports';

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
import { withAgencyBlock } from './note';
import { fingerprintOf, isSendOf, type SendContent } from './sends';
import { parseRevealSession, type RevealSession } from './session';
import { REVEAL_ENDPOINTS, type RevealAnswer } from './wire';

/** Page sizes of the official client (reveal-api-observed.md § Pagination): no heavier than a chatter. */
const TAKE = { conversations: 20, messages: 10, ppv: 10, scripts: 20, vault: 10, transactions: 10 } as const;
/** A cursor that never ends is a bug or a changed API: stop rather than loop. */
const MAX_PAGES = 500;
/** `health` warns this long before a readable expiry (spec § 2): the token lives 24 h only (V1). */
const WARNING_BEFORE_MS = 2 * 3_600_000;
/** `verifySent` reads this many of the newest messages (spec § 5, point 3): two pages of the official client's ten. */
const VERIFY_DEPTH = 20;
/** Our own pace (spec § 5): 20 sends a minute per account, Reveal's 60 well out of reach… */
const SENDS_PER_MINUTE = 20;
const MINUTE_MS = 60_000;
/** …and never two sends in one conversation less than 2 s apart. */
const CONVERSATION_GAP_MS = 2_000;

/**
 * What Reveal lets this adapter do (reveal-api-observed.md, Résumé): every reading (P2-02), and since P2-03 the
 * writes: text, script step, voice note (`sendMedia` takes one audio of the vault and nothing else: the bot never sends
 * a free media), client note, read mark, typing. Every write still goes through the account's write guard first.
 */
const CAPABILITIES: ConnectorCapabilities = {
  unreadWithoutOpen: true,
  sendMedia: true,
  transactions: true,
  markRead: true,
  typing: true,
  realtime: false,
  fanProfile: true,
  fanNoteRead: true,
  fanNoteWrite: true,
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
  /**
   * The account's `connector_sends` (spec § 5): the ids of our own messages, and the attempts a send records before
   * calling Reveal. Without it, every write is refused: a send nobody records could go twice.
   */
  readonly sends?: SendJournal;
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

/** What `prior` found of a key before a send. */
interface Prior {
  readonly key: string;
  readonly send: ConnectorSend | null;
  readonly done: SendResult | null;
}

const isAfter = (iso: string | null, since: Date | undefined): boolean =>
  since === undefined || (iso !== null && Date.parse(iso) > since.getTime());

/**
 * `RevealApiConnector` (reveal-connector-spec.md §§ 3 to 6): Reveal's private API with the « bot » member's captured
 * session. Reads (P2-02) and writes (P2-03); a write is called only behind the account's write guard
 * (`outbound-sender.ts`), and a send is recorded in `connector_sends` before Reveal is called, so it never goes twice.
 * One client per account, built by the registry from the stored session.
 */
export class RevealApiConnector implements PlatformConnector {
  readonly platform = 'reveal' as const;
  readonly capabilities = CAPABILITIES;

  private readonly client: RevealClient | null;
  private readonly modelId: string;
  private readonly expiresAt: number | null;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly botDisplayName: string | null;
  private readonly sends: SendJournal | null;
  /** When the sends of the last minute left, for our own pace (spec § 5). */
  private sentAt: number[] = [];
  private readonly lastSendIn = new Map<string, number>();
  /** Fan → conversation, as `listConversations` read them: Reveal has one conversation per fan and model. */
  private readonly conversationOfFan = new Map<string, string>();

  constructor(options: RevealApiConnectorOptions) {
    const { session } = options;
    this.now = options.now ?? (() => new Date());
    this.modelId = session?.modelId ?? '';
    this.expiresAt = session === null ? null : expiryOf(session.bearer);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.botDisplayName = options.botDisplayName ?? null;
    this.sends = options.sends ?? null;
    this.client =
      session === null
        ? null
        : createRevealClient({
            baseUrl: options.baseUrl ?? REVEAL_API_BASE_URL,
            bearer: session.bearer,
            userAgent: session.userAgent,
            fetch: options.fetch,
            now: () => this.now().getTime(),
            sleep: this.sleep,
            log: options.log ?? (() => undefined),
          });
  }

  /** `GET /models/:modelId` (spec § 2): refused → `expired`; a readable expiry less than 2 h away → `warning`. */
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
      const own = await this.ownOf(conversationRef.id, page.data);
      for (const item of page.data) {
        if (!isAfter(item.message.createdAt, opts.since)) return messages.reverse();
        messages.push(messageOf(item, conversationRef, own));
        if (opts.limit !== undefined && messages.length >= opts.limit) return messages.reverse();
      }
      if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) return messages.reverse();
      cursor = page.pageInfo.endCursor;
    }
  }

  /** `POST /conversations/:id/messages` with the text only (spec § 5), recorded first, never sent twice. */
  async sendText(conversationRef: ExternalRef, text: string, idempotencyKey: string): Promise<SendResult> {
    const prior = await this.prior(conversationRef, idempotencyKey);
    if (prior.done !== null) return prior.done;
    return this.send(conversationRef, prior, { text, scriptRef: null, mediaIds: [] }, () => ({
      message: { content: text, isUnread: true },
      mediaIds: [],
      files: [],
    }));
  }

  /**
   * A voice note only (spec § 5): one audio of the creator's vault, free, which Reveal shows the fan as a voice note
   * with its player (reveal-api-observed.md, E7). Any other media is refused before anything is called: the bot never
   * sends a free media (inventory, 17/10), it sells through the platform's scripts.
   */
  async sendMedia(
    conversationRef: ExternalRef,
    media: OutboundMedia,
    idempotencyKey: string,
  ): Promise<SendResult> {
    const [voice, ...others] = media.mediaRefs;
    if (voice === undefined || others.length > 0 || (media.priceMinor ?? 0) > 0) {
      throw new ConnectorError('fatal', 'reveal sends one free voice note only');
    }
    const prior = await this.prior(conversationRef, idempotencyKey);
    if (prior.done !== null) return prior.done;
    const audio = await this.vaultPages(null, [['mediaType', 'audio']]);
    if (!audio.some((item) => item.id === voice.id && item.type === 'audio')) {
      throw new ConnectorError('fatal', 'reveal sends voice notes of the vault only');
    }
    return this.send(
      conversationRef,
      prior,
      { text: media.text, scriptRef: null, mediaIds: [voice.id] },
      () => ({ message: { content: media.text, isUnread: true }, mediaIds: [voice.id], files: [] }),
    );
  }

  /**
   * One step of a platform script (spec §§ 5, 6; ADR 0018 § 5): its text, its media and its price as `scripts.list`
   * gives them, never a price of ours. The fan's history is read again just before: a step already sent in this
   * conversation is refused for good (`ScriptStepAlreadySent`), and a history that cannot be read sends nothing.
   */
  async sendScriptStep(
    conversationRef: ExternalRef,
    scriptRef: ExternalRef,
    stepIndex: number,
    idempotencyKey: string,
  ): Promise<SendResult> {
    const prior = await this.prior(conversationRef, idempotencyKey);
    if (prior.done !== null) return prior.done;
    const client = this.session();
    const sequences = await client.get(
      'scriptSequences.list',
      REVEAL_ENDPOINTS['scriptSequences.list'].shape,
      this.modelId,
    );
    const steps = await this.scriptPages([['withConversations', 'false']]);
    const script = scriptsOf(sequences, steps, () => null).find((item) => item.ref.id === scriptRef.id);
    const step = script?.steps[stepIndex];
    if (step === undefined) throw new ConnectorError('not_found', 'scripts.list: no such script step');
    const history = sentStepsOf(await this.scriptPages([['conversationId', conversationRef.id]]));
    if (history.some((sent) => sent.stepRef.id === step.ref.id)) throw new ScriptStepAlreadySent();
    const mediaIds = step.media.map((item) => item.ref.id);
    return this.send(conversationRef, prior, { text: step.text, scriptRef: step.ref.id, mediaIds }, () => ({
      scriptId: step.ref.id,
      message: { content: step.text, isUnread: true },
      ...(mediaIds.length === 0
        ? { mediaIds: [], files: [] }
        : {
            bundle: {
              type: 'media',
              price: step.priceMinor,
              mediaIds,
              files: [],
              teasingMediaIds: step.previewMedia.map((item) => item.ref.id),
              teasingFiles: [],
            },
          }),
    }));
  }

  /**
   * After a send whose outcome is unknown (spec § 5, point 3): a key never recorded was never sent; one with Reveal's
   * id is sent; one still pending is looked for among the 20 newest messages, and recorded once found.
   */
  async verifySent(conversationRef: ExternalRef, idempotencyKey: string): Promise<VerifyResult> {
    const journal = this.journal();
    const send = await journal.find(idempotencyKey);
    if (send?.platformConversationId !== conversationRef.id) return { status: 'not_found' };
    if (send.platformMessageId !== null) {
      return { status: 'sent', messageRef: { platform: 'reveal', id: send.platformMessageId } };
    }
    const found = await this.lookFor(send);
    return found === null ? { status: 'not_found' } : { status: 'sent', messageRef: found.messageRef };
  }

  /** `PATCH /conversations/:id/read`. */
  async markRead(conversationRef: ExternalRef): Promise<void> {
    await this.session().write(
      'conversations.read',
      REVEAL_ENDPOINTS['conversations.read'].shape,
      conversationRef.id,
    );
  }

  /**
   * `POST /conversations/:id/typing` while `on`; Reveal has no route to stop, the mark fades by itself. The caller
   * repeats it every 3 s during the typing delay, as the official client does (spec § 5).
   */
  async setTyping(conversationRef: ExternalRef, on: boolean): Promise<void> {
    if (!on) return;
    await this.session().write(
      'conversations.typing',
      REVEAL_ENDPOINTS['conversations.typing'].shape,
      conversationRef.id,
    );
  }

  /**
   * The agency's block of the client note (spec § 5): Reveal replaces the note whole, so it is read again just before
   * and only the canvas lines change, on the note as read now, never on an older read (a chatter may have written in
   * between). The same block twice writes once: nothing is sent when the note already says it. Never kept, never
   * logged (ADR 0018 § 1).
   */
  async setFanNote(fanRef: ExternalRef, text: string): Promise<void> {
    const client = this.session();
    const conversationId = await this.conversationOf(fanRef);
    const item = await client.get(
      'conversations.get',
      REVEAL_ENDPOINTS['conversations.get'].shape,
      conversationId,
    );
    const current = item.conversation.note ?? '';
    const note = withAgencyBlock(current, text);
    if (note === null) throw new ConnectorError('fatal', 'the note block holds a line out of the canvas');
    if (note === current) return;
    await client.write('conversations.note', REVEAL_ENDPOINTS['conversations.note'].shape, conversationId, {
      note,
    });
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

  private journal(): SendJournal {
    if (this.sends === null) throw new ConnectorError('fatal', 'no send journal: reveal writes refused');
    return this.sends;
  }

  /** Our own messages of a page: those whose id `connector_sends` holds, the « bot » member's name as a fallback. */
  private async ownOf(
    conversationId: string,
    items: RevealAnswer<'messages.list'>['data'],
  ): Promise<OwnMessages> {
    const outbound = items.filter((item) => item.authorMessage.memberId === undefined);
    const ids =
      this.sends === null || outbound.length === 0
        ? new Set<string>()
        : await this.sends.ownIds(
            conversationId,
            outbound.map((item) => item.message.id),
          );
    return { ids, botDisplayName: this.botDisplayName };
  }

  /**
   * What a send of `key` finds before calling anything (spec § 5, points 3 and 4): the recorded send once Reveal's id
   * is known (`done`); a pending attempt is first looked for in the thread, so a process killed between Reveal's answer
   * and our record never sends twice. `done` is `null` when nothing of this key reached Reveal.
   */
  private async prior(conversationRef: ExternalRef, key: string): Promise<Prior> {
    const send = await this.journal().find(key);
    if (send === null) return { key, send: null, done: null };
    if (send.platformConversationId !== conversationRef.id) {
      throw new ConnectorError('fatal', 'idempotency key already used in another conversation');
    }
    if (send.platformMessageId !== null) {
      const done = {
        messageRef: { platform: 'reveal' as const, id: send.platformMessageId },
        sentAt: (send.sentAt ?? send.startedAt).toISOString(),
      };
      return { key, send, done };
    }
    return { key, send, done: await this.lookFor(send) };
  }

  /** A pending attempt among the 20 newest messages of its conversation; recorded when found. */
  private async lookFor(send: ConnectorSend): Promise<SendResult | null> {
    const client = this.session();
    const journal = this.journal();
    const items: RevealAnswer<'messages.list'>['data'] = [];
    let cursor: string | null = null;
    while (items.length < VERIFY_DEPTH) {
      const page: RevealAnswer<'messages.list'> = await client.get(
        'messages.list',
        REVEAL_ENDPOINTS['messages.list'].shape,
        send.platformConversationId,
        [['take', String(TAKE.messages)], ...(cursor === null ? [] : [['cursor', cursor] as const])],
      );
      items.push(...page.data);
      if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) break;
      cursor = page.pageInfo.endCursor;
    }
    const claimed = (await this.ownOf(send.platformConversationId, items)).ids;
    // The oldest match first: of two identical texts, the earlier is the one this attempt made.
    const found = items
      .slice(0, VERIFY_DEPTH)
      .reverse()
      .find((item) => isSendOf(item, send, { claimed, botDisplayName: this.botDisplayName }));
    if (found === undefined) return null;
    const sentAt = new Date(found.message.createdAt);
    await journal.settle(send.idempotencyKey, found.message.id, sentAt);
    return { messageRef: { platform: 'reveal', id: found.message.id }, sentAt: found.message.createdAt };
  }

  /**
   * One send through `POST …/messages` (spec § 5), once `prior` found nothing of this key at Reveal: our own pace is
   * kept, the attempt is recorded (or kept, with its first start, on a retry), then Reveal is called and its id
   * recorded. An error leaves the attempt pending: the next try looks for it before sending again.
   */
  private async send(
    conversationRef: ExternalRef,
    prior: Prior,
    content: SendContent,
    body: () => object,
  ): Promise<SendResult> {
    const client = this.session();
    const journal = this.journal();
    const { key } = prior;
    const fingerprint = fingerprintOf(content);
    if (prior.send !== null && prior.send.fingerprint !== fingerprint) {
      throw new ConnectorError('fatal', 'idempotency key already used for another content');
    }
    await this.pace(conversationRef.id);
    await journal.begin({
      idempotencyKey: key,
      platformConversationId: conversationRef.id,
      fingerprint,
      scriptRef: content.scriptRef,
      startedAt: this.now(),
    });
    const answer = await client.write(
      'messages.send',
      REVEAL_ENDPOINTS['messages.send'].shape,
      conversationRef.id,
      body(),
    );
    await journal.settle(key, answer.id, new Date(answer.createdAt));
    return { messageRef: { platform: 'reveal', id: answer.id }, sentAt: answer.createdAt };
  }

  /**
   * Our own pace (spec § 5): over 20 sends in the last minute, `rate_limited` before anything is recorded or sent;
   * within 2 s of the last send in this conversation, a wait.
   */
  private async pace(conversationId: string): Promise<void> {
    const now = this.now().getTime();
    this.sentAt = this.sentAt.filter((at) => at > now - MINUTE_MS);
    const [oldest] = this.sentAt;
    if (oldest !== undefined && this.sentAt.length >= SENDS_PER_MINUTE) {
      throw new ConnectorError('rate_limited', 'reveal: our own pace of 20 sends a minute', {
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + MINUTE_MS - now) / 1_000)),
      });
    }
    const last = this.lastSendIn.get(conversationId);
    if (last !== undefined && now - last < CONVERSATION_GAP_MS) {
      await this.sleep(CONVERSATION_GAP_MS - (now - last));
    }
    const at = this.now().getTime();
    this.sentAt.push(at);
    this.lastSendIn.set(conversationId, at);
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

  private async vaultPages(folderId: string | null, query: readonly (readonly [string, string])[] = []) {
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
          ...query,
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

/**
 * The registry's factory for Reveal: one `RevealApiConnector` per account, from its stored session. A session that
 * is missing or not Reveal's gives a connector whose `health` says `none` and whose calls fail `session_expired`.
 */
export function revealApiConnectors(options: {
  readonly fetch: RevealFetch;
  readonly baseUrl?: string;
  readonly log?: (platformAccountId: string, entry: RevealCallLog) => void;
  /** Tests only: FakeReveal's clock, so an attempt and the message it made are dated alike. */
  readonly now?: () => Date;
}): NonNullable<ConnectorRegistry['reveal']> {
  return (account, session, context) =>
    new RevealApiConnector({
      session: session === null ? null : parseRevealSession(session),
      sends: context.sends,
      fetch: options.fetch,
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.log === undefined ? {} : { log: (entry) => options.log?.(account.id, entry) }),
    });
}
