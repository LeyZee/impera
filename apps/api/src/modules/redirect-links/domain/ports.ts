import type {
  CreatorId,
  DetectedLink,
  LinkPlacement,
  LinkServiceRefusalKind,
  RedirectLinkId,
  UserId,
} from '@impera/contracts';

import type { StoredRedirectLink } from './links';

/** What the agency writes of a link: everything but its identity. */
export interface RedirectLinkWrite {
  readonly name: string;
  readonly url: string;
  readonly destination: string;
  readonly placement: LinkPlacement | null;
  readonly usageNote: string;
  readonly enabled: boolean;
}

/** Who asks, read from the session by the route; the store reads the person's rights again in the base. */
export interface RedirectLinkActor {
  readonly userId: UserId;
  readonly ip: string;
}

/** The links the module keeps (`redirect_links`). */
export interface RedirectLinkStore {
  /** Every link of a creator, placed or not, on or off: the owner and an active manager only, anyone else is refused. */
  listForAgency(actor: RedirectLinkActor, creatorId: CreatorId): Promise<readonly StoredRedirectLink[]>;
  /** Her own links that are on and placed, read under her own policy: another creator's rows are never returned. */
  listOwn(userId: UserId): Promise<readonly StoredRedirectLink[]>;
  /**
   * Her links that are on, for what crosses tenants (the channel's posts and its setting, the service role). Null
   * when the table holds no link of hers at all: the caller falls back on what it kept before.
   */
  enabledUnscoped(creatorId: CreatorId): Promise<readonly StoredRedirectLink[] | null>;
  /** A new link, by the owner or an active manager, with its line in the audit log. */
  create(
    actor: RedirectLinkActor,
    creatorId: CreatorId,
    write: RedirectLinkWrite,
  ): Promise<StoredRedirectLink>;
  /** A link corrected, by the owner or an active manager, with its line in the audit log. */
  update(
    actor: RedirectLinkActor,
    creatorId: CreatorId,
    id: RedirectLinkId,
    write: RedirectLinkWrite,
  ): Promise<StoredRedirectLink>;
}

/**
 * The links of the agency's account at the redirect service, read now by the `connectors` module (ADR 0120 § 3), or
 * why they could not be. The account is the agency's, so the list crosses creators: it is the owner's alone.
 */
export type DetectLinks = () => Promise<
  | { readonly ok: true; readonly links: readonly DetectedLink[] }
  | {
      readonly ok: false;
      readonly error: { readonly kind: LinkServiceRefusalKind; readonly message: string };
    }
>;
