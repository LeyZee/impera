import type { VaultPreviewType } from './platform-connector';

/** Largest small picture handed back (ADR 0138 § 2): bigger, it is not a preview, and it is refused. */
export const VAULT_PREVIEW_MAX_BYTES = 3_000_000;

const startsWith = (bytes: Uint8Array, at: number, signature: readonly number[]): boolean =>
  signature.every((byte, offset) => bytes[at + offset] === byte);

const ascii = (text: string): number[] => Array.from({ length: text.length }, (_, at) => text.charCodeAt(at));

/**
 * What a small picture is, read from its first bytes, never from the platform's word (ADR 0138 § 2): JPEG, PNG, WebP,
 * GIF or AVIF; `null` for anything else (a video, a page, an error), which is never handed on.
 */
export function previewTypeOf(bytes: Uint8Array): VaultPreviewType | null {
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, 0, ascii('RIFF')) && startsWith(bytes, 8, ascii('WEBP'))) return 'image/webp';
  if (startsWith(bytes, 0, ascii('GIF87a')) || startsWith(bytes, 0, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(bytes, 4, ascii('ftypavif')) || startsWith(bytes, 4, ascii('ftypavis'))) return 'image/avif';
  return null;
}
