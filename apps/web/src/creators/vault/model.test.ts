import {
  CreatorIdSchema,
  PlatformAccountIdSchema,
  type VaultFolderView,
  type VaultMediaView,
  type VaultView,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  SYNC_PATIENCE_MS,
  durationLine,
  findFolder,
  folderLine,
  folderTiles,
  tileLine,
  mediaKindLine,
  mediaLine,
  phaseAfterRead,
  phaseLine,
  polls,
  suggestedLine,
  syncedLine,
  uploadedLine,
  vaultFigures,
  waveOf,
} from './model';

/* An invented vault (ADR 0010): no real creator, no real media. */
const mediaOf = (fields: Partial<VaultMediaView> = {}): VaultMediaView => ({
  platformMediaId: `m-${String(Math.random())}`,
  kind: 'image',
  durationSeconds: null,
  uploadedAt: '2026-11-10T10:00:00.000Z',
  platformDescription: null,
  suggestedPriceMinor: null,
  blurhash: null,
  removed: false,
  ...fields,
});
const folderOf = (fields: Partial<VaultFolderView> = {}): VaultFolderView => ({
  platform: 'reveal',
  platformAccountId: PlatformAccountIdSchema.parse('0192f3a0-0000-7000-8000-0000000000a1'),
  folderRef: 'f1',
  folderName: 'Soirée ☀️',
  moment: 'day',
  media: [mediaOf()],
  ...fields,
});
const viewOf = (
  folders: VaultFolderView[],
  syncedAt: string | null = '2026-11-16T10:00:00.000Z',
): VaultView => ({
  creatorId: CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1'),
  folders,
  syncedAt,
});

describe('« Son coffre Reveal »: the rules of the card', () => {
  it('says when the vault was last read, in words', () => {
    const now = new Date('2026-11-16T12:00:00.000Z');
    expect(syncedLine(null, now)).toBe('Jamais synchronisé');
    expect(syncedLine('2026-11-16T11:59:40.000Z', now)).toBe('Synchronisé à l’instant');
    expect(syncedLine('2026-11-16T11:48:00.000Z', now)).toBe('Synchronisé il y a 12 min');
    expect(syncedLine('2026-11-16T09:00:00.000Z', now)).toBe('Synchronisé il y a 3 h');
    expect(syncedLine('2026-11-14T09:00:00.000Z', now)).toBe('Synchronisé il y a 2 j');
    // A clock a little behind the server never says « il y a -1 min ».
    expect(syncedLine('2026-11-16T12:00:30.000Z', now)).toBe('Synchronisé à l’instant');
  });

  it('counts what Reveal still lists, by kind, never what it removed', () => {
    expect(
      mediaLine([
        mediaOf(),
        mediaOf(),
        mediaOf({ kind: 'video' }),
        mediaOf({ kind: 'audio' }),
        mediaOf({ removed: true }),
      ]),
    ).toBe('2 photos · 1 vidéo · 1 vocal');
    expect(mediaLine([mediaOf({ removed: true })])).toBe('Vide');
    expect(mediaLine([mediaOf({ kind: 'audio' }), mediaOf({ kind: 'audio' })])).toBe('2 vocaux');
  });

  it('lists her folders in Reveal’s order, the root and an unnamed one said in words, those à classer marked', () => {
    const tiles = folderTiles(
      viewOf([
        folderOf({ folderRef: null, folderName: null, moment: null }),
        folderOf({
          folderRef: 'f2',
          folderName: 'Nuit 🌙',
          moment: 'night',
          media: [mediaOf(), mediaOf({ removed: true })],
        }),
        folderOf({ folderRef: 'f3', folderName: null, moment: null, media: [] }),
      ]),
    );
    // Her names as Reveal gives them, never an emoji added; the root, which has no name to change, is never à classer.
    expect(tiles.map((tile) => [tile.id, tile.name, tile.unmarked, tile.line, tile.removed])).toEqual([
      ['racine', 'Racine du coffre', false, '1 photo', 0],
      ['f2', 'Nuit 🌙', false, '1 photo', 1],
      ['f3', 'Dossier sans nom', true, 'Vide', 0],
    ]);
    expect(new Set(tiles.map((tile) => tile.key)).size).toBe(3);
  });

  it('covers a folder with the previews of its first four media still listed', () => {
    const [tile] = folderTiles(
      viewOf([
        folderOf({
          media: [
            mediaOf({ blurhash: 'LA' }),
            mediaOf({ blurhash: 'LB', removed: true }),
            mediaOf({ blurhash: null }),
            mediaOf({ blurhash: 'LC' }),
            mediaOf({ blurhash: 'LD' }),
            mediaOf({ blurhash: 'LE' }),
          ],
        }),
      ]),
    );
    expect(tile?.cover.map((item) => item.hash)).toEqual(['LA', null, 'LC', 'LD']);
  });

  it('opens the folder the address names, and none when the last sync no longer lists it', () => {
    const view = viewOf([folderOf(), folderOf({ folderRef: null, folderName: null, moment: null })]);
    expect(findFolder(view, 'f1')?.folderName).toBe('Soirée ☀️');
    expect(findFolder(view, 'racine')?.folderRef).toBeNull();
    expect(findFolder(view, 'gone')).toBeNull();
    expect(findFolder(view, null)).toBeNull();
  });

  it('says what a media is, how long, when it came and Reveal’s range', () => {
    expect(durationLine(42)).toBe('0:42');
    expect(durationLine(725)).toBe('12:05');
    expect(durationLine(3_729)).toBe('1:02:09');
    expect(mediaKindLine(mediaOf())).toBe('Photo');
    expect(mediaKindLine(mediaOf({ kind: 'video', durationSeconds: 42 }))).toBe('Vidéo · 0:42');
    expect(mediaKindLine(mediaOf({ kind: 'audio', durationSeconds: null }))).toBe('Vocal');
    expect(uploadedLine('2026-11-10T10:00:00.000Z')).toBe('Ajouté le 10 novembre 2026');
    // Intl puts a narrow no-break space before the euro sign: compared once spaces are made plain.
    const plain = (text: string): string => text.replace(/\s/gu, ' ');
    expect(plain(suggestedLine({ min: 1_000, max: 2_550 }))).toBe('10 € – 25,50 €');
    expect(plain(suggestedLine({ min: 900, max: 900 }))).toBe('9 €');
  });

  it('gives the three figures: media still listed, folders, folders without ☀️ or 🌙', () => {
    expect(
      vaultFigures(
        viewOf([
          folderOf({ media: [mediaOf(), mediaOf({ removed: true })] }),
          folderOf({ folderRef: 'f2', moment: null, media: [mediaOf({ kind: 'video' })] }),
          folderOf({ folderRef: null, folderName: null, moment: null, media: [] }),
        ]),
      ),
    ).toEqual({ media: 2, folders: 3, unmarked: 1 });
  });

  it('waits for the sync until its date moves, then says it is done', () => {
    const waiting = { kind: 'waiting', since: '2026-11-16T10:00:00.000Z', askedAt: 1_000 } as const;
    expect(polls(waiting)).toBe(true);
    // The same date read again: still waiting.
    expect(phaseAfterRead(waiting, '2026-11-16T10:00:00.000Z', 2_000)).toBe(waiting);
    expect(phaseAfterRead(waiting, '2026-11-16T12:00:00.000Z', 2_000)).toEqual({ kind: 'done' });
    // A first sync ever: any date is new.
    expect(
      phaseAfterRead({ kind: 'waiting', since: null, askedAt: 0 }, '2026-11-16T12:00:00.000Z', 1),
    ).toEqual({
      kind: 'done',
    });
    // Too long: said, and the card keeps reading until it goes through.
    const slow = phaseAfterRead(waiting, '2026-11-16T10:00:00.000Z', 1_000 + SYNC_PATIENCE_MS);
    expect(slow).toEqual({ kind: 'slow', since: '2026-11-16T10:00:00.000Z' });
    expect(polls(slow)).toBe(true);
    expect(phaseAfterRead(slow, '2026-11-16T12:00:00.000Z', 1)).toEqual({ kind: 'done' });
    // Outside a sync, a read changes nothing.
    expect(phaseAfterRead({ kind: 'idle' }, '2026-11-16T12:00:00.000Z', 1)).toEqual({ kind: 'idle' });
    expect(polls({ kind: 'done' })).toBe(false);
  });

  it('says each outcome, amber only when her team must act', () => {
    expect(phaseLine({ kind: 'idle' })).toBeNull();
    expect(phaseLine({ kind: 'asking' })).toBeNull();
    expect(phaseLine({ kind: 'done' })?.tone).toBe('ok');
    expect(phaseLine({ kind: 'none' })?.tone).toBe('warn');
    expect(phaseLine({ kind: 'none' })?.text).toContain('extension');
    expect(phaseLine({ kind: 'failed' })?.tone).toBe('warn');
    expect(phaseLine({ kind: 'waiting', since: null, askedAt: 0 })?.tone).toBe('muted');
  });

  it('says what a folder holds, then what Reveal removed from it', () => {
    expect(folderLine([mediaOf({ kind: 'image' }), mediaOf({ kind: 'image', removed: true })])).toBe(
      '1 photo · 1 retiré de Reveal',
    );
    expect(folderLine([mediaOf({ removed: true }), mediaOf({ removed: true })])).toBe('2 retirés de Reveal');
    expect(folderLine([mediaOf({ kind: 'audio' })])).toBe('1 vocal');
  });

  it('draws the same wave for the same voice note, each bar between 0.2 and 1', () => {
    const wave = waveOf('media_07', 14);
    expect(wave).toHaveLength(14);
    expect(waveOf('media_07', 14)).toEqual(wave);
    expect(waveOf('media_08', 14)).not.toEqual(wave);
    for (const bar of wave) {
      expect(bar).toBeGreaterThanOrEqual(0.2);
      expect(bar).toBeLessThanOrEqual(1);
    }
  });

  it('writes a tile’s line in full for two kinds, as a total beyond', () => {
    expect(tileLine([mediaOf({ kind: 'image' }), mediaOf({ kind: 'video' })])).toBe('1 photo · 1 vidéo');
    expect(
      tileLine([
        mediaOf({ kind: 'image' }),
        mediaOf({ kind: 'video' }),
        mediaOf({ kind: 'audio' }),
        mediaOf({ kind: 'audio', removed: true }),
      ]),
    ).toBe('3 médias');
  });
});
