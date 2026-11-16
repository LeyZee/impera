import { ConnectorError, type VaultPreview } from '../../domain/platform-connector';
import { VAULT_PREVIEW_MAX_BYTES, previewTypeOf } from '../../domain/vault-preview';

import type { RevealAnswer } from './wire';

/**
 * Where Reveal serves the small pictures of the vault (ADR 0138 § 5, ADR 0113 § 2): written here, never read from a
 * setting nor trusted from an answer. A link to any other origin is refused before it is called. Empty until the
 * first real read of the vault's links on the agency's computer names them: a new origin comes by a PR reviewed by
 * Sécurité.
 */
export const REVEAL_MEDIA_ORIGINS: readonly string[] = [];

/** `fetch`, narrowed to one read of a file: no header of ours (never the session's bearer), no redirect followed. */
export type RevealFileFetch = (
  url: string,
  init: { readonly method: 'GET'; readonly redirect: 'manual'; readonly signal: AbortSignal },
) => Promise<{
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

const FILE_TIMEOUT_MS = 15_000;

type VaultItem = RevealAnswer<'vault.medias'>['data'][number];

/** The link of a vault media's small picture: a photo's reduced size, a video's poster; none for a voice note. */
export function previewLinkOf(item: VaultItem): string | null {
  if (item.type === 'photo') return item.smallUrl;
  if (item.type === 'video') return item.thumbnailUrl ?? null;
  return null;
}

/**
 * One read of a small picture (ADR 0138 §§ 1 and 2): only from an origin written in `origins`, with no header of
 * ours, no redirect followed, at most `VAULT_PREVIEW_MAX_BYTES`, an image by its first bytes. `expired`: the platform
 * refused the link (403, 404, 410), which a fresh listing may cure once.
 */
export async function readPreviewFile(
  fetchFile: RevealFileFetch,
  url: string,
  origins: readonly string[],
): Promise<VaultPreview | 'expired'> {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    throw new ConnectorError('fatal', 'vault preview: unreadable link');
  }
  // The origin alone is said: never the link, which is signed.
  if (!origins.includes(origin))
    throw new ConnectorError('fatal', `vault preview: origin not allowed (${origin})`);
  let answer: Awaited<ReturnType<RevealFileFetch>>;
  let body: ArrayBuffer;
  try {
    answer = await fetchFile(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
    });
    if (answer.status === 403 || answer.status === 404 || answer.status === 410) return 'expired';
    if (answer.status === 429) throw new ConnectorError('rate_limited', 'vault preview: rate limited');
    if (answer.status < 200 || answer.status >= 300) {
      throw new ConnectorError('transient', `vault preview: status ${String(answer.status)}`);
    }
    body = await answer.arrayBuffer();
  } catch (error) {
    if (error instanceof ConnectorError) throw error;
    // The cause is left out on purpose: a network error may quote the signed link.
    throw new ConnectorError('transient', 'vault preview: unreachable');
  }
  if (body.byteLength > VAULT_PREVIEW_MAX_BYTES)
    throw new ConnectorError('fatal', 'vault preview: too large');
  const bytes = new Uint8Array(body);
  const contentType = previewTypeOf(bytes);
  if (contentType === null) throw new ConnectorError('fatal', 'vault preview: not an image');
  return { contentType, bytes };
}
