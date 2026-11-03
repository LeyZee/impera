import { err, ok, type Result } from '@impera/contracts';

import { mediaKindOf, sniffMediaType, type MediaDescriber } from '../../media';

import type { MediaSight, MediaToSee } from './draft-composer';

/** Why the platform gave no file: the handoff says it. */
type FetchRefusal = 'gone' | 'locked' | 'too_large' | 'unsupported';

/** The file of one of his media, as the platform serves it, or why it cannot be had. */
export type FetchMedia = (
  media: MediaToSee,
) => Promise<Result<{ readonly mediaType: string; readonly data: Uint8Array }, FetchRefusal>>;

/** What the vision reads inline (Gemini, 20 Mo); a bigger file goes to a human (P3-04, hors périmètre). */
export const MEDIA_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Fetches his media from the platform, checks what it really is (size, type read from its bytes, not its name),
 * then has the `media` module describe it (cached by content).
 */
export function createMediaSight(deps: {
  readonly fetchMedia: FetchMedia;
  readonly describer: MediaDescriber;
}): MediaSight {
  return {
    async see(media) {
      let fetched: Awaited<ReturnType<FetchMedia>>;
      try {
        fetched = await deps.fetchMedia(media);
      } catch {
        return err('fetch_failed');
      }
      if (!fetched.ok) return err(fetched.error);
      const { data } = fetched.value;
      if (data.byteLength > MEDIA_MAX_BYTES) return err('too_large');
      const mediaType = sniffMediaType(data);
      if (mediaType === undefined || mediaKindOf(mediaType) !== media.kind) return err('unsupported');
      try {
        const described = await deps.describer.describe({ origin: 'fan', mediaType, data });
        return described.ok ? ok(described.value) : err(described.error.code);
      } catch {
        return err('describe_failed');
      }
    },
  };
}
