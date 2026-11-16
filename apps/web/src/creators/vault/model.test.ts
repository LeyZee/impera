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
  foldedRows,
  folderRows,
  mediaLine,
  phaseAfterRead,
  phaseLine,
  polls,
  syncedLine,
  vaultFigures,
} from './model';

/* An invented vault (ADR 0010): no real creator, no real media. */
const mediaOf = (fields: Partial<VaultMediaView> = {}): VaultMediaView => ({
  platformMediaId: `m-${String(Math.random())}`,
  kind: 'image',
  durationSeconds: null,
  uploadedAt: '2026-11-10T10:00:00.000Z',
  platformDescription: null,
  suggestedPriceMinor: null,
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
    const rows = folderRows(
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
    expect(rows.map((row) => [row.name, row.unmarked, row.line, row.removed])).toEqual([
      ['Racine du coffre', false, '1 photo', 0],
      ['Nuit 🌙', false, '1 photo', 1],
      ['Dossier sans nom', true, 'Vide', 0],
    ]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(3);
  });

  it('keeps every folder à classer on screen before « Voir les N dossiers », in Reveal’s order', () => {
    const rows = folderRows(
      viewOf(
        Array.from({ length: 8 }, (_, at) =>
          folderOf({
            folderRef: `f${String(at)}`,
            folderName: `D${String(at)}`,
            moment: at === 6 ? null : 'day',
          }),
        ),
      ),
    );
    expect(foldedRows(rows, 5).map((row) => row.name)).toEqual(['D0', 'D1', 'D2', 'D3', 'D4', 'D6']);
    expect(foldedRows(rows.slice(0, 3), 5)).toHaveLength(3);
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
});
