import {
  CreatorIdSchema,
  PlatformAccountIdSchema,
  type VaultChoicesView,
  type VaultFolderView,
  type VaultMediaView,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { choiceIndex } from './choice';
import {
  appliedLine,
  applyLabel,
  currentPick,
  draftChanges,
  draftLine,
  draftSummary,
  folderToggled,
  inImperaLine,
  mediaToggled,
  pickOf,
  type PickDraft,
} from './picker';

/* An invented vault (ADR 0010): no real creator, no real media. */
const CREATOR = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1');
const ACCOUNT = PlatformAccountIdSchema.parse('0192f3a0-0000-7000-8000-0000000000a1');
const media = (id: string, removed = false): VaultMediaView => ({
  platformMediaId: id,
  kind: 'image',
  durationSeconds: null,
  uploadedAt: '2026-11-10T10:00:00.000Z',
  platformDescription: null,
  suggestedPriceMinor: null,
  blurhash: null,
  removed,
});
const folder = (ref: string | null, ids: string[]): VaultFolderView => ({
  platform: 'reveal',
  platformAccountId: ACCOUNT,
  folderRef: ref,
  folderName: ref,
  moment: null,
  media: ids.map((id) => media(id)),
});
const choices = (fields: Partial<VaultChoicesView>): VaultChoicesView => ({
  creatorId: CREATOR,
  folders: [],
  media: [],
  ...fields,
});
const imported = (id: string) => ({
  platformAccountId: ACCOUNT,
  platformMediaId: id,
  imported: true,
  description: 'none' as const,
  excerpt: null,
  descriptionId: null,
  detailed: null,
  validated: false,
});
const EMPTY: PickDraft = new Map();

describe('« Choisir dans Reveal », the draft (ADR 0145 § 5, avenant du 20/11)', () => {
  const a = folder('a', ['a1', 'a2', 'a3']);
  const b = folder('b', ['b1', 'b2']);
  const root = folder(null, ['r1']);

  it('reads where each folder stands today: whole, none, or some of its media', () => {
    const index = choiceIndex(
      choices({
        folders: [{ platformAccountId: ACCOUNT, folderRef: 'a', imported: true }],
        media: [imported('b2')],
      }),
    );
    expect(currentPick(index, a)).toEqual({ kind: 'all' });
    expect(currentPick(index, b)).toEqual({ kind: 'some', ids: new Set(['b2']) });
    expect(currentPick(index, root)).toEqual({ kind: 'none' });
    expect(inImperaLine(currentPick(index, a), a)).toBe('Dans Impera');
    expect(inImperaLine(currentPick(index, b), b)).toBe('1 sur 2 dans Impera');
    expect(inImperaLine(currentPick(index, root), root)).toBeNull();
  });

  it('ticks a folder whole and back, a tick back to today’s leaving the draft', () => {
    const index = choiceIndex(undefined);
    const once = folderToggled(EMPTY, index, a);
    expect(pickOf(once, index, a)).toEqual({ kind: 'all' });
    expect(folderToggled(once, index, a).size).toBe(0);
    // A folder in part, ticked: all of it.
    const part = choiceIndex(choices({ media: [imported('b1')] }));
    expect(pickOf(folderToggled(EMPTY, part, b), part, b)).toEqual({ kind: 'all' });
  });

  it('ticks media one by one, all of them making the folder whole, none of them nothing', () => {
    const index = choiceIndex(undefined);
    let draft = mediaToggled(EMPTY, index, a, 'a2');
    expect(pickOf(draft, index, a)).toEqual({ kind: 'some', ids: new Set(['a2']) });
    draft = mediaToggled(mediaToggled(draft, index, a, 'a1'), index, a, 'a3');
    expect(pickOf(draft, index, a)).toEqual({ kind: 'all' });
    draft = mediaToggled(mediaToggled(mediaToggled(draft, index, a, 'a1'), index, a, 'a2'), index, a, 'a3');
    expect(draft.size).toBe(0);
  });

  it('sums up what enters and what leaves, says the folders on the foot and the media on the button', () => {
    const index = choiceIndex(choices({ media: [imported('b1'), imported('b2')] }));
    const draft = folderToggled(folderToggled(EMPTY, index, a), index, b);
    const summary = draftSummary(draft, index, [a, b, root]);
    expect(summary).toEqual({ mediaIn: 3, mediaOut: 2 });
    expect(draftLine(draft)).toBe('1 dossier coché · 1 dossier décoché');
    expect(draftLine(folderToggled(draft, index, b))).toBe('1 dossier coché');
    expect(draftLine(EMPTY)).toBeNull();
    expect(applyLabel(summary)).toBe('Importer 3 médias, retirer 2');
    expect(applyLabel({ mediaIn: 1, mediaOut: 0 })).toBe('Importer 1 média');
    expect(applyLabel({ mediaIn: 0, mediaOut: 4 })).toBe('Retirer 4 médias');
    expect(appliedLine({ mediaIn: 3, mediaOut: 0 })).toBe(
      '3 médias importés. Pour les faire décrire, ouvre un dossier et sélectionne-les.',
    );
    expect(appliedLine({ mediaIn: 0, mediaOut: 1 })).toBe('1 média retiré d’Impera.');
  });

  it('writes a folder whole as one tick, a folder in part as its tick off then its media', () => {
    const index = choiceIndex(undefined);
    const draft = mediaToggled(folderToggled(EMPTY, index, a), index, b, 'b2');
    expect(draftChanges(draft, [a, b])).toEqual([
      {
        platformAccountId: ACCOUNT,
        folders: [
          { folderRef: 'a', imported: true },
          { folderRef: 'b', imported: false },
        ],
        media: [{ platformMediaId: 'b2', imported: true }],
      },
    ]);
    expect(draftChanges(EMPTY, [a, b])).toEqual([]);
  });

  it('sends a folder of thousands in turns of 500 media at most', () => {
    const big = folder(
      null,
      Array.from({ length: 1_201 }, (_, at) => `m${String(at)}`),
    );
    const index = choiceIndex(undefined);
    const draft = mediaToggled(folderToggled(EMPTY, index, big), index, big, 'm0');
    const changes = draftChanges(draft, [big]);
    expect(changes.map((each) => [each.folders.length, each.media.length])).toEqual([
      [1, 500],
      [0, 500],
      [0, 200],
    ]);
  });
});
