import { describe, expect, it } from 'vitest';

import { ContentDropStorageUnavailable } from '../../domain/errors';
import type { DropStorage, DueOriginal, FileOutcome, ReceiptStore, RetentionStore } from '../../domain/ports';
import { ABANDONED, abandonedBefore, keptUntil, noticeUntil } from '../../domain/retention';
import { eraseOriginals } from '../retention';

const NOW = new Date('2026-11-05T16:20:00.000Z');

describe('content-drops › the dates of an original (CR-06 c)', () => {
  it('keeps it a year, refuses a send after 24 hours, tells the agency 7 days before', () => {
    expect(keptUntil(NOW).toISOString()).toBe('2027-11-05T16:20:00.000Z');
    expect(abandonedBefore(NOW).toISOString()).toBe('2026-11-04T16:20:00.000Z');
    expect(noticeUntil(NOW).toISOString()).toBe('2026-11-12T16:20:00.000Z');
  });
});

describe('content-drops › content_drops.erase_originals', () => {
  const original = (id: string, reason: DueOriginal['reason'] = 'due'): DueOriginal => ({
    mediaAssetId: id,
    creatorId: 'creator',
    storageKey: `media/creator/${id}`,
    reason,
    erasedOn: '2026-11-05',
  });

  function fakes(refusedKeys: readonly string[], due: readonly DueOriginal[]) {
    const log: string[] = [];
    const removed: string[] = [];
    const storage: Pick<DropStorage, 'remove'> = {
      remove: (key) => {
        if (refusedKeys.includes(key)) return Promise.reject(new ContentDropStorageUnavailable('refused'));
        removed.push(key);
        return Promise.resolve();
      },
    };
    const receipts: Pick<ReceiptStore, 'settle'> = {
      settle: (fileId: string, outcome: FileOutcome) => {
        log.push(`settle ${fileId} ${outcome.state === 'refused' ? outcome.refusal : outcome.state}`);
        return Promise.resolve();
      },
    };
    const retention: RetentionStore = {
      abandonedFiles: (before) => {
        log.push(`abandoned before ${before.toISOString()}`);
        return Promise.resolve(['file-1']);
      },
      announce: (_now, until) => {
        log.push(`announce until ${until.toISOString()}`);
        return Promise.resolve(2);
      },
      dueOriginals: () => Promise.resolve([...due]),
      // Given again meanwhile: checked again under the lock, it stays held.
      erase: async (one, _now, _correlationId, remove) => {
        if (one.mediaAssetId === 'given-again') return false;
        await remove(one.storageKey);
        log.push(`erased ${one.mediaAssetId} ${one.reason}`);
        return true;
      },
      eraseFailed: (one) => {
        log.push(`failed ${one.mediaAssetId}`);
        return Promise.resolve();
      },
    };
    return {
      log,
      removed,
      deps: { storage, receipts, retention },
    };
  }

  it('refuses the unfinished sends, announces, then erases each original due before marking it', async () => {
    const { log, removed, deps } = fakes(
      ['media/creator/m2'],
      [original('m1'), original('m2'), original('given-again'), original('m3', 'withdrawn')],
    );
    const run = await eraseOriginals(deps, NOW, 'job:1');
    expect(run).toEqual({ abandoned: 1, announced: 2, erased: 2, failed: 1 });
    expect(removed).toEqual(['media/creator/m1', 'media/creator/m3']);
    expect(log).toEqual([
      'abandoned before 2026-11-04T16:20:00.000Z',
      `settle file-1 ${ABANDONED}`,
      'announce until 2026-11-12T16:20:00.000Z',
      'erased m1 due',
      // Refused by the storage: said in amber, held, tried again next hour; the others go on.
      'failed m2',
      'erased m3 withdrawn',
    ]);
  });

  it('stops on any other failure: the next run takes it again', async () => {
    const { deps } = fakes([], [original('m1')]);
    const broken = { ...deps, storage: { remove: () => Promise.reject(new Error('bug')) } };
    await expect(eraseOriginals(broken, NOW, 'job:1')).rejects.toThrow('bug');
  });
});
