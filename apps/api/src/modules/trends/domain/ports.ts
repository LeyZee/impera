import type {
  ExtensionLinkCreated,
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
  live(userId: UserId): Promise<{ readonly createdAt: Date } | null>;
  /** A new link for the actor, the previous one revoked; null for an account that cannot have one. */
  replace(actor: TrendActor): Promise<ExtensionLinkCreated | null>;
  /** Whether a live link was revoked. */
  revoke(actor: TrendActor): Promise<boolean>;
  /** Who a token names, or null: unknown, revoked, or an account gone. */
  holder(token: string): Promise<LinkHolder | null>;
}

/** The readings of the extension (`trend_readings`), each under the person who watched. */
export interface ReadingStore {
  /** The posts of a batch kept or updated; how many. A refused mark refuses the whole batch. */
  record(holder: LinkHolder, batch: TrendReadingsBatch): Promise<number>;
}
