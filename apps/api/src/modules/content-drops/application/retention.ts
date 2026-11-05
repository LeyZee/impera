import { ContentDropStorageUnavailable } from '../domain/errors';
import type { DropStorage, ReceiptStore, RetentionStore } from '../domain/ports';
import { abandonedBefore, ABANDONED, noticeUntil } from '../domain/retention';

export interface RetentionDeps {
  readonly storage: Pick<DropStorage, 'remove'>;
  readonly receipts: Pick<ReceiptStore, 'settle'>;
  readonly retention: RetentionStore;
}

/** What one run did, for the job's log line: counts only, never a name nor a key. */
export interface RetentionRun {
  readonly abandoned: number;
  readonly announced: number;
  readonly erased: number;
  readonly failed: number;
}

/**
 * `content_drops.erase_originals` (CR-06 c, ADR 0044 § 2, ADR 0055 § 7), each hour, in three steps that each move
 * only what is still due, so that a replay says nothing twice:
 * 1. a file still waiting for its bytes 24 hours after its drop began is refused, and its drop follows as on any refusal;
 * 2. the agency is told of each original that goes within 7 days;
 * 3. each original due (its date passed, or every drop it came in by withdrawn) is erased from the storage, then marked.
 * A storage that refuses or does not answer leaves the original held and says it once in amber; the next run tries
 * again. Any other failure stops the run: the job's retry, the next hour, takes it again.
 */
export async function eraseOriginals(
  deps: RetentionDeps,
  now: Date,
  correlationId: string,
): Promise<RetentionRun> {
  const abandoned = await deps.retention.abandonedFiles(abandonedBefore(now));
  for (const fileId of abandoned)
    await deps.receipts.settle(fileId, { state: 'refused', refusal: ABANDONED }, now, correlationId);
  const announced = await deps.retention.announce(now, noticeUntil(now), correlationId);
  let erased = 0;
  let failed = 0;
  for (const original of await deps.retention.dueOriginals(now)) {
    try {
      await deps.storage.remove(original.storageKey);
    } catch (error) {
      if (!(error instanceof ContentDropStorageUnavailable)) throw error;
      await deps.retention.eraseFailed(original, now, correlationId);
      failed += 1;
      continue;
    }
    await deps.retention.erased(original, now, correlationId);
    erased += 1;
  }
  return { abandoned: abandoned.length, announced, erased, failed };
}
