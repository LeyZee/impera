import type { CreatorId } from '@impera/contracts';

import { avatarKeyOf, isAvatarSourceType, type AvatarPorts, type AvatarSkip } from '../domain/avatar';

/**
 * Her photo, from the platform's address to our bucket (CRM-07 a2b): fetched, checked by its first bytes, re-encoded
 * as a JPEG, written under `creators/<id>/avatar`, then her `avatar_key` set. Replayable: the same key is written over.
 * A photo that is not one is skipped, never retried; a platform or a storage that does not answer throws.
 */
export async function copyAvatarFrom(
  ports: AvatarPorts,
  creatorId: CreatorId,
  url: string,
): Promise<{ readonly copied: true } | { readonly copied: false; readonly skip: AvatarSkip }> {
  const fetched = await ports.fetch(url);
  if (!fetched.ok) return { copied: false, skip: fetched.reason };
  if (!isAvatarSourceType(ports.sniff(fetched.bytes))) return { copied: false, skip: 'not_an_image' };
  const jpeg = await ports.toJpeg(fetched.bytes);
  const key = avatarKeyOf(creatorId);
  await ports.store.put(key, jpeg);
  // Removed meanwhile: the object stays without a reader, written over if she ever comes back under this id.
  if (!(await ports.records.set(creatorId, key))) return { copied: false, skip: 'creator_gone' };
  return { copied: true };
}
