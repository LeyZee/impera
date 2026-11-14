import { ContentDropIdSchema, newId, type ContentDrop } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { AgencyContentStore, ScriptVersions } from '../../domain/ports';
import { creatorDrops, creatorScriptSteps } from '../reads';

const refuse = (what: string) => (): Promise<never> => Promise.reject(new Error(`${what} not expected`));

/** Invented drops, newest first, as the store pages them. */
const drop = (): ContentDrop => ({
  id: newId(ContentDropIdSchema),
  category: 'feed_shoot',
  correctedFrom: null,
  sentence: null,
  state: 'ready',
  blockedReason: null,
  requestId: null,
  files: [],
  scriptNumber: null,
  exportedAt: null,
  createdAt: '2026-11-14T08:00:00.000Z',
});

function storeOf(drops: readonly ContentDrop[], asked: number[]): AgencyContentStore {
  const none = refuse('store');
  return {
    content: none,
    drop: none,
    correct: none,
    withdraw: none,
    ask: none,
    cancel: none,
    fileTarget: none,
    markSent: none,
    sentScript: none,
    confirmExport: none,
    sentDrop: none,
    confirmDropExport: none,
    dropsPage: (_creatorId, _userId, _after, limit) => {
      asked.push(limit);
      return Promise.resolve(drops.slice(0, limit));
    },
    scriptDrops: () => Promise.resolve([]),
  };
}

const owner = { userId: 'owner', role: 'owner' as const };
const versions: ScriptVersions = {
  frozen: refuse('frozen'),
  card: refuse('card'),
  folderCard: refuse('folderCard'),
  freeze: refuse('freeze'),
};

describe('the agency’s reads of her drops (ADR 0026 § 1)', () => {
  it('pages 50 drops at most, asks one more to know whether another page follows', async () => {
    const asked: number[] = [];
    const drops = Array.from({ length: 60 }, drop);
    const page = await creatorDrops(storeOf(drops, asked), owner, 'nora', { after: null, limit: 500 });
    expect(asked).toEqual([51]);
    expect(page.drops).toHaveLength(50);
    expect(page.next).toBe(drops[49]?.id);
    const last = await creatorDrops(storeOf(drops.slice(0, 3), asked), owner, 'nora', {
      after: null,
      limit: 0,
    });
    expect([last.drops.length, last.next]).toEqual([1, drops[0]?.id]);
  });

  it('refuses a reader who is not of the agency before any read, and an `after` that is no id', async () => {
    const asked: number[] = [];
    const store = storeOf([drop()], asked);
    await expect(
      creatorDrops(store, { userId: 'her', role: 'creator' }, 'nora', { after: null }),
    ).rejects.toMatchObject({ code: 'content_drop_forbidden' });
    await expect(
      creatorScriptSteps({ store, versions }, { userId: 'her', role: 'creator' }, 'nora', 'x'),
    ).rejects.toMatchObject({ code: 'content_drop_forbidden' });
    expect(await creatorDrops(store, owner, 'nora', { after: 'pas-un-id' })).toEqual({
      drops: [],
      next: null,
    });
    expect(asked).toEqual([]);
  });
});
