import {
  CreatorIdSchema,
  PlatformAccountIdSchema,
  type VaultChoicesView,
  type VaultFolderView,
  type VaultMediaView,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  allToggled,
  centsLine,
  choiceIndex,
  choiceOf,
  describeEstimate,
  describeProgress,
  descriptionLine,
  filteredMedia,
  folderCount,
  importLine,
  progressLine,
  railFolders,
  rangeSelected,
  selectedLine,
  toggled,
} from './choice';

/* An invented vault (ADR 0010): no real creator, no real media. */
const CREATOR = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1');
const ACCOUNT = PlatformAccountIdSchema.parse('0192f3a0-0000-7000-8000-0000000000a1');
const media = (id: string, kind: VaultMediaView['kind'] = 'image', removed = false): VaultMediaView => ({
  platformMediaId: id,
  kind,
  durationSeconds: kind === 'image' ? null : 10,
  uploadedAt: '2026-11-10T10:00:00.000Z',
  platformDescription: null,
  suggestedPriceMinor: null,
  blurhash: null,
  removed,
});
const folder = (ref: string | null, items: VaultMediaView[]): VaultFolderView => ({
  platform: 'reveal',
  platformAccountId: ACCOUNT,
  folderRef: ref,
  folderName: ref,
  moment: null,
  media: items,
});
const choices = (fields: Partial<VaultChoicesView>): VaultChoicesView => ({
  creatorId: CREATOR,
  folders: [],
  media: [],
  ...fields,
});
const chosen = (
  id: string,
  imported: boolean,
  description: VaultChoicesView['media'][number]['description'] = 'none',
) => ({ platformAccountId: ACCOUNT, platformMediaId: id, imported, description, excerpt: null });

describe('the vault by choice, for the screen (ADR 0145 § 5)', () => {
  it('reads a media’s choice, a media not listed yet following its folder’s tick', () => {
    const index = choiceIndex(
      choices({
        folders: [{ platformAccountId: ACCOUNT, folderRef: 'f1', imported: true }],
        media: [chosen('a', false)],
      }),
    );
    const f1 = folder('f1', []);
    expect(choiceOf(index, f1, media('a')).imported).toBe(false);
    expect(choiceOf(index, f1, media('new'))).toEqual({ imported: true, description: 'none', excerpt: null });
    expect(choiceOf(index, folder('f2', []), media('other')).imported).toBe(false);
    expect(choiceOf(choiceIndex(undefined), f1, media('a')).imported).toBe(false);
  });

  it('puts the root last, an ordinary folder', () => {
    const rail = railFolders({
      creatorId: CREATOR,
      syncedAt: null,
      folders: [folder(null, []), folder('f1', []), folder('f2', [])],
    });
    expect(rail.map((each) => each.folderRef)).toEqual(['f1', 'f2', null]);
  });

  it('ticks a folder all, some or none on the media still listed; an empty folder says its own tick', () => {
    const f1 = folder('f1', [media('a'), media('b'), media('gone', 'image', true)]);
    const none = folderCount(choiceIndex(undefined), f1);
    expect(none).toEqual({ tick: 'none', listed: 2, imported: 0, described: 0 });
    const some = folderCount(choiceIndex(choices({ media: [chosen('a', true, 'described')] })), f1);
    expect(some).toEqual({ tick: 'some', listed: 2, imported: 1, described: 1 });
    const all = folderCount(choiceIndex(choices({ media: [chosen('a', true), chosen('b', true)] })), f1);
    expect(all.tick).toBe('all');
    const empty = folder('f9', []);
    expect(folderCount(choiceIndex(undefined), empty).tick).toBe('none');
    const ticked = choiceIndex(
      choices({ folders: [{ platformAccountId: ACCOUNT, folderRef: 'f9', imported: true }] }),
    );
    expect(folderCount(ticked, empty).tick).toBe('all');
  });

  it('says how much of a folder is imported', () => {
    expect(importLine({ listed: 0, imported: 0 })).toBe('Vide');
    expect(importLine({ listed: 12, imported: 0 })).toBe('Aucun importé sur 12');
    expect(importLine({ listed: 12, imported: 1 })).toBe('1 sur 12 importé');
    expect(importLine({ listed: 12, imported: 3 })).toBe('3 sur 12 importés');
    expect(importLine({ listed: 12, imported: 12 })).toBe('Les 12 importés');
    expect(importLine({ listed: 1, imported: 1 })).toBe('Importé');
  });

  it('filters by kind, by description and by import, the filters adding up', () => {
    const f1 = folder('f1', [media('p1'), media('p2'), media('v1', 'video'), media('n1', 'audio')]);
    const index = choiceIndex(choices({ media: [chosen('p1', true, 'described'), chosen('v1', true)] }));
    const ids = (filters: Parameters<typeof filteredMedia>[2]) =>
      filteredMedia(f1, index, filters).map((each) => each.platformMediaId);
    expect(ids(new Set())).toEqual(['p1', 'p2', 'v1', 'n1']);
    expect(ids(new Set(['photos']))).toEqual(['p1', 'p2']);
    expect(ids(new Set(['photos', 'videos']))).toEqual(['p1', 'p2', 'v1']);
    expect(ids(new Set(['undescribed']))).toEqual(['p2', 'v1', 'n1']);
    expect(ids(new Set(['photos', 'unimported']))).toEqual(['p2']);
  });

  it('selects one, a run with Shift in the order shown, all and none', () => {
    const order = ['a', 'b', 'c', 'd'];
    expect([...toggled(new Set(['a']), 'a')]).toEqual([]);
    expect([...rangeSelected(new Set(), order, 'b', 'd')].sort()).toEqual(['b', 'c', 'd']);
    expect([...rangeSelected(new Set(['a']), order, 'd', 'c')].sort()).toEqual(['a', 'c', 'd']);
    // No last click, or one the filters hid: only this one.
    expect([...rangeSelected(new Set(), order, null, 'c')]).toEqual(['c']);
    expect([...rangeSelected(new Set(), order, 'hidden', 'c')]).toEqual(['c']);
    expect([...allToggled(new Set(['x']), order)].sort()).toEqual(['a', 'b', 'c', 'd', 'x']);
    expect([...allToggled(new Set(order), order)]).toEqual([]);
    expect(selectedLine(1)).toBe('1 média sélectionné');
    expect(selectedLine(3)).toBe('3 médias sélectionnés');
  });

  it('costs only an imported photo or video never described nor asked, rounded up like the server', () => {
    const f1 = folder('f1', [
      media('p1'),
      media('p2'),
      media('v1', 'video'),
      media('n1', 'audio'),
      media('out'),
      media('done'),
      media('gone', 'image', true),
    ]);
    const index = choiceIndex(
      choices({
        media: [
          chosen('p1', true),
          chosen('p2', true),
          chosen('v1', true),
          chosen('n1', true),
          chosen('done', true, 'described'),
          chosen('gone', true),
        ],
      }),
    );
    const all = new Set(f1.media.map((each) => each.platformMediaId));
    // 2 × 0.5 c€ + 1.5 c€ = 2.5 c€, said 3 c€.
    expect(describeEstimate(f1, index, all)).toEqual({ count: 3, costCents: 3 });
    expect(describeEstimate(f1, index, new Set(['out', 'done']))).toEqual({ count: 0, costCents: 0 });
    expect(centsLine(3).replace(/\s/gu, ' ')).toBe('0,03 €');
  });

  it('says where a description stands under its tile, and how far a run went', () => {
    expect(descriptionLine({ imported: true, description: 'described', excerpt: 'Inventée' })).toEqual({
      text: 'Inventée',
      tone: 'described',
    });
    expect(descriptionLine({ imported: true, description: 'asked', excerpt: null }).text).toBe(
      'Description en cours',
    );
    expect(descriptionLine({ imported: false, description: 'asked', excerpt: null }).text).toBe(
      'Description à l’import',
    );
    expect(descriptionLine({ imported: true, description: 'to_agency', excerpt: null }).tone).toBe('warn');
    expect(descriptionLine({ imported: false, description: 'none', excerpt: null }).text).toBe('Non importé');
    const f1 = folder('f1', [media('a'), media('b')]);
    const index = choiceIndex(
      choices({ media: [chosen('a', true, 'described'), chosen('b', true, 'asked')] }),
    );
    expect(describeProgress(['a', 'b'], f1, index)).toEqual({ done: 1, total: 2 });
    expect(progressLine({ done: 1, total: 2 })).toBe('Descriptions : 1 sur 2');
    expect(progressLine({ done: 2, total: 2 })).toBe('2 médias décrits');
  });
});
