import type { CreatorId } from '@impera/contracts';

/**
 * A creator's photo, copied from the platform at her import (CRM-07 a2b, ADR 0069 § 3): kept by us so that nothing
 * depends on the platform's address, and served by our API (the CRM's CSP takes images from its own origin only).
 */

/** Where her photo lives in the media bucket: one object per creator, written over by a new copy. */
export const avatarKeyOf = (creatorId: CreatorId): string => `creators/${creatorId}/avatar`;

/** A photo larger than this is not taken: a profile picture is far smaller. */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/** The image types a photo is read from; anything else (a video, a page, a GIF) is not a photo. */
const AVATAR_SOURCE_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

export const isAvatarSourceType = (mediaType: string | undefined): boolean =>
  mediaType !== undefined && AVATAR_SOURCE_TYPES.includes(mediaType);

/** Why a photo was not copied, said in the log; none of them is retried. */
export type AvatarSkip =
  | 'not_connected'
  | 'list_refused'
  | 'not_listed'
  | 'no_photo'
  | 'refused_address'
  | 'not_found'
  | 'too_large'
  | 'not_an_image'
  | 'creator_gone';

export type FetchedAvatar =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly reason: 'refused_address' | 'not_found' | 'too_large' };

/** What the copy reads, re-encodes and keeps; given by the composition root. */
export interface AvatarPorts {
  /**
   * The image at a platform's public HTTPS address, never more than `AVATAR_MAX_BYTES`, never from a private or local
   * address, no redirect followed. Throws when the address does not answer: the job tries again.
   */
  fetch(url: string): Promise<FetchedAvatar>;
  /** The type its first bytes say, whatever the platform announced. */
  sniff(bytes: Uint8Array): string | undefined;
  /** Re-encoded as a JPEG, its metadata (place, device) left behind. */
  toJpeg(image: Uint8Array): Promise<Uint8Array>;
  readonly store: AvatarStore;
  readonly records: AvatarRecords;
}

/** The media bucket, for photos only. */
export interface AvatarStore {
  put(key: string, jpeg: Uint8Array): Promise<void>;
  /** `null` when there is no object at `key`. */
  get(key: string): Promise<Uint8Array | null>;
}

/** `creators.avatar_key`, read and written across creators by the job and the route. */
export interface AvatarRecords {
  /** `false` when the creator no longer exists. */
  set(creatorId: CreatorId, key: string): Promise<boolean>;
  /** Her key, `null` without a photo or a creator. */
  keyOf(creatorId: CreatorId): Promise<string | null>;
}
