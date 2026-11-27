import { Readable } from 'node:stream';

import type { FastifyReply } from 'fastify';

import { byteRangeOf } from '../../domain/byte-range';
import { ContentDropFileNotFound } from '../../domain/errors';
import type { DropStorage, ReviewedFile } from '../../domain/ports';

const THUMBNAIL_CACHE_SECONDS = 300;

/** Her medium's reduced picture (SC-04 lot c4, ADR 0030 § 4), from our own origin (the CRM's CSP: `img-src 'self'`). */
export async function sendThumbnail(
  reply: FastifyReply,
  storage: DropStorage,
  file: ReviewedFile | null,
): Promise<FastifyReply> {
  if (file?.thumbnailKey == null) throw new ContentDropFileNotFound();
  const stream = await storage.read(file.thumbnailKey);
  if (stream === null) throw new ContentDropFileNotFound();
  return reply
    .header('content-type', 'image/jpeg')
    .header('cache-control', `private, max-age=${String(THUMBNAIL_CACHE_SECONDS)}`)
    .header('x-content-type-options', 'nosniff')
    .send(Readable.from(stream));
}

/**
 * Her medium itself while its original is held (SC-04 lot c4, ADR 0044 § 2), from our own origin (`media-src 'self'`):
 * a photo whole, a video in the parts its player asks (`Range`). Each opening is audited (`opened`), not each part.
 */
export async function sendMedium(
  reply: FastifyReply,
  storage: DropStorage,
  file: ReviewedFile | null,
  rangeHeader: string | undefined,
  opened: (file: ReviewedFile) => Promise<void>,
): Promise<FastifyReply> {
  if (file?.originalKey == null) throw new ContentDropFileNotFound();
  const range = byteRangeOf(rangeHeader, file.bytes);
  if (range.kind === 'unsatisfiable')
    return reply
      .code(416)
      .header('content-range', `bytes */${String(file.bytes)}`)
      .send();
  const part = range.kind === 'part' ? { start: range.start, end: range.end } : undefined;
  const stream = await storage.read(file.originalKey, part);
  if (stream === null) throw new ContentDropFileNotFound();
  if (part === undefined || part.start === 0) await opened(file);
  reply
    .header('content-type', file.mime)
    .header('accept-ranges', 'bytes')
    .header('cache-control', 'private, no-store')
    .header('x-content-type-options', 'nosniff')
    .header('content-disposition', 'inline');
  if (part === undefined) reply.header('content-length', String(file.bytes));
  else
    reply
      .code(206)
      .header('content-range', `bytes ${String(part.start)}-${String(part.end)}/${String(file.bytes)}`)
      .header('content-length', String(part.end - part.start + 1));
  return reply.send(Readable.from(stream));
}
