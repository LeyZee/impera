import type { InstagramMediaRef, MediaInsightNumbers } from '@impera/contracts';

import {
  LISTING_WINDOW_MS,
  planReadings,
  readingBudget,
  snapshotsOf,
  type InstagramInsightsPort,
  type KeptMedia,
  type MediaInsightStore,
} from '../domain/instagram-insights';

export interface MediaInsightsRun {
  /** The steps filled with numbers by this run. */
  readonly read: number;
  /** The steps this run found missed. */
  readonly missed: number;
  /** The media with a step to fill that wait for a later run: the quota, or a reading that failed. */
  readonly deferred: number;
  /** Instagram refused or failed during the run: what was read before is kept, the rest waits. */
  readonly failed: boolean;
}

/**
 * One run of the reading of a creator's Instagram numbers (ADR 0120 § 2): lists her recent media, reads the ones
 * with a step to fill within the calls left this hour, and keeps the rows. A step whose window passed is kept missed,
 * for a media Instagram no longer lists too. Replayed, it writes nothing more: a step kept is never due again.
 *
 * `callsLeft` is what the hour still allows (`callsLeft`): the listing is paid first, and with nothing left the run
 * calls nothing at all.
 */
export async function readMediaInsights(
  deps: { readonly instagram: InstagramInsightsPort; readonly store: MediaInsightStore },
  input: { readonly creatorId: string; readonly now: Date; readonly callsLeft: number },
): Promise<MediaInsightsRun> {
  const { creatorId, now } = input;
  const since = new Date(now.getTime() - LISTING_WINDOW_MS);
  const known = await deps.store.keptOf(creatorId, since);
  const keptByRef = new Map(known.map((media) => [media.ref, media.kept]));
  const keptOf = (ref: InstagramMediaRef) => keptByRef.get(ref) ?? [];

  let failed = false;
  let listed: readonly KeptMedia[] = [];
  if (input.callsLeft >= 1) {
    try {
      listed = (await deps.instagram.listMedia(since)).map((media) => ({
        ref: media.ref,
        kind: media.kind,
        publishedAt: media.publishedAt,
        kept: keptOf(media.ref),
      }));
    } catch {
      failed = true;
    }
  }

  const plan = planReadings(listed, keptOf, now, failed ? 0 : readingBudget(input.callsLeft, 1, false));
  const numbers = new Map<InstagramMediaRef, MediaInsightNumbers>();
  for (const ref of plan.toRead) {
    try {
      numbers.set(ref, await deps.instagram.readInsights(ref));
    } catch {
      failed = true;
      break;
    }
  }

  // Her media of this run, and the ones kept that Instagram no longer lists: their steps still close.
  const listedRefs = new Set(listed.map((media) => media.ref));
  const all = [...listed, ...known.filter((media) => !listedRefs.has(media.ref))];
  const rows = all
    .map((media) => ({
      media,
      snapshots: snapshotsOf(media, numbers.get(media.ref) ?? null, now, media.kept),
    }))
    .filter((row) => row.snapshots.length > 0);
  await deps.store.record(creatorId, rows);

  const snapshots = rows.flatMap((row) => row.snapshots);
  return {
    read: snapshots.filter((snapshot) => snapshot.numbers !== null).length,
    missed: snapshots.filter((snapshot) => snapshot.numbers === null).length,
    deferred: plan.deferred + (plan.toRead.length - numbers.size),
    failed,
  };
}
