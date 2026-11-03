import type { TrendCapturesBody, TrendCapturesDescribed } from '@impera/contracts';

import {
  TrendCaptureReadingNotFound,
  TrendCaptureVisionUnavailable,
  TrendWatchBudgetLimited,
} from '../domain/errors';
import type { CaptureVision, LinkHolder, ReadingStore } from '../domain/ports';

/**
 * The captures of a post the holder marked (ADR 0060 § 2, source 6): decoded in memory, read by the vision, then
 * dropped with the request. Only the description is kept, on the reading; the vision call counts in the trend watch's
 * cap (ADR 0060 § 7).
 */
export async function describeCaptures(
  readings: ReadingStore,
  vision: CaptureVision,
  holder: LinkHolder,
  body: TrendCapturesBody,
): Promise<TrendCapturesDescribed> {
  const creatorId = await readings.markedFor(holder, body.watchSession, body.code);
  if (creatorId === null) throw new TrendCaptureReadingNotFound();
  const read = await vision.describe({
    captures: body.captures.map((capture) => ({
      mediaType: capture.mediaType,
      data: Uint8Array.from(Buffer.from(capture.data, 'base64')),
    })),
    durationS: body.durationS,
    creatorId,
  });
  if (!read.ok)
    throw read.reason === 'budget' ? new TrendWatchBudgetLimited() : new TrendCaptureVisionUnavailable();
  // Unmarked meanwhile (the extension sent the same post again, unmarked): the description has nothing to stay on.
  if (!(await readings.describe(holder, body.watchSession, body.code, read.description)))
    throw new TrendCaptureReadingNotFound();
  return { description: read.description };
}
