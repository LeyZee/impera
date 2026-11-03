import type {
  CreatorId,
  ExtensionLink,
  ExtensionLinkCreated,
  ExtensionLinkId,
  PasteTrendLinkBody,
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
  /** Who a token names, or null: unknown, revoked, or an account gone. */
  holder(token: string): Promise<LinkHolder | null>;
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
}
