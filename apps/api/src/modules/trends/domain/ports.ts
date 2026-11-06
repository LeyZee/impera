import type {
  ContentIdea,
  ContentIdeaCorrection,
  ContentIdeaList,
  ContentIdeaState,
  CreatorId,
  IdeaDropCategory,
  ExtensionLink,
  ExtensionLinkCreated,
  ExtensionLinkId,
  PasteTrendLinkBody,
  TrendCaptureDescription,
  TrendReadingsBatch,
  UserId,
  UserRole,
} from '@impera/contracts';

/** Who acts, from the dashboard session: the account, its role as the session holds it, and the request's address. */
export interface TrendActor {
  readonly userId: UserId;
  readonly role: UserRole;
  readonly ip: string;
}

/** A pasted link, ready to be kept: the body read by its form, with its lifetime. */
export interface PastedSignal extends PasteTrendLinkBody {
  readonly observedAt: Date;
  readonly expiresAt: Date;
}

/** The signals the module keeps (`trend_signals`), written through the person's own door. */
export interface SignalStore {
  /** Whether this paste added the signal: the same address pasted again for the same creator adds nothing. */
  pasteLink(actor: TrendActor, signal: PastedSignal): Promise<boolean>;
}

/** The person an extension's link names, read from its token. */
export interface LinkHolder {
  readonly userId: UserId;
  readonly role: UserRole;
}

/** The links of the extensions (`extension_links`), through the admin connection only. */
export interface ExtensionLinkStore {
  /** The person's live links, the oldest first. */
  live(userId: UserId): Promise<ExtensionLink[]>;
  /**
   * A link for one of the actor's browsers: a live one of the same label is replaced, otherwise one is added. `null` for
   * an account that cannot have one, `full` past `EXTENSION_LINKS_LIVE_MAX` live links.
   */
  create(actor: TrendActor, label: string): Promise<ExtensionLinkCreated | 'full' | null>;
  /** Whether that live link of the actor's was revoked. */
  revoke(actor: TrendActor, linkId: ExtensionLinkId): Promise<boolean>;
  /** Who a token names, or null: unknown, revoked, or an account gone. `touch`: a batch it brings (`lastUsedAt`). */
  holder(token: string, options: { readonly touch: boolean }): Promise<LinkHolder | null>;
}

/** A creator the linked person may mark a post for. */
export interface MarkableCreator {
  readonly id: CreatorId;
  readonly displayName: string;
}

/** The readings of the extension (`trend_readings`), each under the person who watched. */
export interface ReadingStore {
  /** The creators the holder may mark a post for, as `record` checks them. */
  markable(holder: LinkHolder): Promise<MarkableCreator[]>;
  /** The posts of a batch kept or updated; how many. A refused mark refuses the whole batch. */
  record(holder: LinkHolder, batch: TrendReadingsBatch): Promise<number>;
  /** The creator a post of the holder's own watch session is marked for; null if not read, or read unmarked. */
  markedFor(holder: LinkHolder, watchSession: string, code: string): Promise<CreatorId | null>;
  /** Keeps the vision's description on that reading; false when it is no longer there or no longer marked. */
  describe(
    holder: LinkHolder,
    watchSession: string,
    code: string,
    description: TrendCaptureDescription,
  ): Promise<boolean>;
}

/** The captures of a marked post, decoded, in memory only. */
interface TrendCaptures {
  readonly captures: readonly { readonly mediaType: string; readonly data: Uint8Array }[];
  readonly durationS: number | null;
  readonly creatorId: CreatorId;
}

/**
 * The vision, through the LLM gateway, as a trend watch call. `budget`: the watch's cap or the daily one is spent;
 * `unavailable`: no model answered.
 */
export interface CaptureVision {
  describe(
    input: TrendCaptures,
  ): Promise<
    | { readonly ok: true; readonly description: TrendCaptureDescription }
    | { readonly ok: false; readonly reason: 'budget' | 'unavailable' }
  >;
}

/** The ideas of « Idées du jour » (`content_ideas`), under the owner's or an active manager's account. */
export interface IdeaStore {
  /** Her ideas proposed on her `day` (today in her zone when absent), the first proposed first, each with its signal. */
  ofDay(creatorId: CreatorId, userId: UserId, day: string | undefined, now: Date): Promise<ContentIdeaList>;
  /**
   * Validated, with its correction applied when it is still `proposed`; `check` reads the idea as it leaves and throws
   * to refuse it. Answers the idea as it stands: a validated or suggested idea comes back unchanged.
   */
  validate(
    creatorId: CreatorId,
    userId: UserId,
    ideaId: string,
    correction: ContentIdeaCorrection | null,
    check: (idea: ContentIdea) => void,
    now: Date,
  ): Promise<ContentIdea>;
  /** Refused, with its reason; a refused idea answers unchanged. */
  refuse(
    creatorId: CreatorId,
    userId: UserId,
    ideaId: string,
    reason: string | null,
    now: Date,
  ): Promise<ContentIdea>;
  /** The suggestion it became, of the same id: `validated` → `suggested`. */
  suggested(creatorId: CreatorId, userId: UserId, ideaId: string): Promise<ContentIdea>;
}

/** An idea as its follow-up job reads it (`withAdmin`): what the content request it asks is made of. */
interface FollowedIdea {
  readonly id: string;
  readonly creatorId: string;
  readonly state: ContentIdeaState;
  readonly category: IdeaDropCategory;
  readonly title: string;
  readonly requestId: string | null;
}

/**
 * The follow-up of an idea once she decided in her agenda (VEI-01 d2), under the owner's role: a job has no account
 * to read under. Each write moves the idea only from `suggested`, so a replay changes nothing.
 */
export interface IdeaFollowStore {
  /** The idea that became this suggestion, `null` when none did (a suggestion of the agency's own). */
  ofSuggestion(suggestionId: string): Promise<FollowedIdea | null>;
  /** Her shoot accepted: the content request asked under the idea's id is recorded on it. */
  requested(ideaId: string): Promise<void>;
  /** Her shoot declined: the idea is `declined`, its request never asked. */
  declined(ideaId: string): Promise<void>;
  /** Her drop for the idea's content request has all its bytes: the idea of hers that asked it is `deposited`. */
  deposited(creatorId: string, requestId: string): Promise<void>;
}
