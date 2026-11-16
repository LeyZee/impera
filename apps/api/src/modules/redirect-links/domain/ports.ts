import type { CreatorId, LinkPlacement, RedirectLinkId } from '@impera/contracts';

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

/** The links the module keeps (`redirect_links`). */
export interface RedirectLinkStore {
  /** Every link of a creator, for the agency: placed or not, on or off. */
  listForAgency(creatorId: CreatorId): Promise<readonly StoredRedirectLink[]>;
  /** Her own links, read under her own policy: another creator's rows are never returned. */
  listOwn(creatorId: CreatorId): Promise<readonly StoredRedirectLink[]>;
  create(creatorId: CreatorId, write: RedirectLinkWrite): Promise<StoredRedirectLink>;
  update(creatorId: CreatorId, id: RedirectLinkId, write: RedirectLinkWrite): Promise<StoredRedirectLink>;
}
