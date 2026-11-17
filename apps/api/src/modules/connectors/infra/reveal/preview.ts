import { ConnectorError, type VaultPreview } from '../../domain/platform-connector';
import { VAULT_PREVIEW_MAX_BYTES, previewTypeOf } from '../../domain/vault-preview';
import {
  VaultFileError,
  readVaultPicture,
  type DownloadBounds,
  type FileTransport,
} from '../download/vault-file';

import type { RevealAnswer } from './wire';

/** A small picture comes in one GET: well under a file's time. */
const PREVIEW_TIMEOUT_MS = 15_000;

type VaultItem = RevealAnswer<'vault.medias'>['data'][number];

/** The link of a vault media's small picture: a photo's reduced size, a video's poster; none for a voice note. */
export function previewLinkOf(item: VaultItem): string | null {
  if (item.type === 'photo') return item.smallUrl;
  if (item.type === 'video') return item.thumbnailUrl ?? null;
  return null;
}

/**
 * The bounds of one small picture: the file hosts of ADR 0113 § 2, no second list; the size of ADR 0138 § 2. A video's
 * poster is a vault file on the videos host, so the files' origin header (ADR 0113 § 2, amendment of 16/11) is taken
 * as it is: the same host, the same fixed value, no second constant.
 */
export function previewBounds(files: DownloadBounds): DownloadBounds {
  return {
    hosts: files.hosts,
    maxBytes: VAULT_PREVIEW_MAX_BYTES,
    timeoutMs: PREVIEW_TIMEOUT_MS,
    maxSegments: 0,
    maxKeys: 0,
    ...(files.allowHttp === true ? { allowHttp: true } : {}),
    ...(files.referer === undefined ? {} : { referer: files.referer }),
  };
}

/** The host a refused link named, for the log: never the link, which is signed. */
function hostOf(url: string): string {
  return URL.canParse(url) ? new URL(url).hostname : 'unreadable link';
}

/**
 * One read of a small picture (ADR 0138 §§ 1 and 2), by the vault files' own reader (ADR 0113 § 2): its hosts, its
 * transport, no header of ours but the videos host's origin header, no redirect followed, at most `VAULT_PREVIEW_MAX_BYTES`, an image by its first bytes.
 * `expired`: the platform refused the link (401, 403, 404, 410), which a fresh listing may cure once.
 */
export async function readPreviewFile(
  transport: FileTransport,
  url: string,
  bounds: DownloadBounds,
): Promise<VaultPreview | 'expired'> {
  let bytes: Uint8Array;
  try {
    bytes = await readVaultPicture(transport, url, bounds);
  } catch (error) {
    if (!(error instanceof VaultFileError)) throw error;
    switch (error.reason) {
      case 'expired':
      case 'gone':
        return 'expired';
      case 'host_refused':
        // The host alone is said: never the link, which is signed.
        throw new ConnectorError('fatal', `vault preview: host refused (${hostOf(url)})`);
      case 'too_large':
        throw new ConnectorError('fatal', 'vault preview: too large');
      case 'unsupported':
      case 'failed':
        // The cause is left out on purpose: a network error may quote the signed link.
        throw new ConnectorError('transient', 'vault preview: unreachable');
    }
  }
  const contentType = previewTypeOf(bytes);
  if (contentType === null) throw new ConnectorError('fatal', 'vault preview: not an image');
  return { contentType, bytes };
}
