import type { VaultMedia } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  compareVaultFolders,
  compareVaultOrder,
  planVaultSync,
  vaultRefsOf,
  type StoredVaultRef,
} from '../vault-sync';

const folder = (id: string, name: string, moment: 'day' | 'night' | null = null) => ({
  ref: { platform: 'reveal' as const, id },
  name,
  moment,
});

function media(id: string, createdAt: string, extra: Partial<VaultMedia> = {}): VaultMedia {
  return {
    ref: { platform: 'reveal', id },
    kind: 'image',
    folder: folder('folder_a', 'Dossier inventé ☀️', 'day'),
    folderPosition: 0,
    durationSeconds: null,
    createdAt,
    description: null,
    suggestedPriceMinor: null,
    ...extra,
  };
}

const stored = (read: readonly VaultMedia[]): StoredVaultRef[] =>
  vaultRefsOf(read).map((row) => ({ ...row, removed: false }));

describe('vault sync plan (ADR 0099 § 2 to 4)', () => {
  const read = [
    media('m3', '2026-11-10T10:00:02.000Z'),
    // Two uploads of the same time: the platform's own order between them is kept.
    media('m2b', '2026-11-10T10:00:01.000Z'),
    media('m2a', '2026-11-10T10:00:01.000Z'),
    media('m1', '2026-11-10T10:00:00.000Z', {
      description: 'Texte inventé',
      suggestedPriceMinor: { min: 500, max: 900 },
    }),
  ];

  it('ranks the uploads of the same time as the platform listed them, and nothing else', () => {
    expect(vaultRefsOf(read).map((row) => [row.platformMediaId, row.folderPosition])).toEqual([
      ['m3', 0],
      ['m2b', 0],
      ['m2a', 1],
      ['m1', 0],
    ]);
    expect(vaultRefsOf(read)[3]).toMatchObject({
      folderRef: 'folder_a',
      folderMoment: 'day',
      platformDescription: 'Texte inventé',
      suggestedMinMinor: 500,
      suggestedMaxMinor: 900,
    });
  });

  it('writes everything the first time, then nothing while nothing moves', () => {
    expect(planVaultSync(read, []).upserts).toHaveLength(4);
    expect(planVaultSync(read, stored(read))).toEqual({ upserts: [], removals: [] });
  });

  it('a new upload takes its place without rewriting the others', () => {
    const later = [media('m4', '2026-11-10T11:00:00.000Z'), ...read];
    expect(planVaultSync(later, stored(read))).toEqual({
      upserts: [expect.objectContaining({ platformMediaId: 'm4', folderPosition: 0 })],
      removals: [],
    });
  });

  it('moves a media to its new folder, marks one no longer listed, and brings it back when listed again', () => {
    const moved = read.map((m) =>
      m.ref.id === 'm3' ? { ...m, folder: folder('folder_b', 'Autre dossier 🌙', 'night') } : m,
    );
    const withoutM1 = moved.filter((m) => m.ref.id !== 'm1');
    const plan = planVaultSync(withoutM1, stored(read));
    expect(plan.upserts.map((row) => [row.platformMediaId, row.folderRef, row.folderMoment])).toEqual([
      ['m3', 'folder_b', 'night'],
    ]);
    expect(plan.removals).toEqual(['m1']);
    const afterRemoval = stored(read).map((row) =>
      row.platformMediaId === 'm1' ? { ...row, removed: true } : row,
    );
    expect(planVaultSync(withoutM1, afterRemoval).removals).toEqual([]);
    expect(planVaultSync(read, afterRemoval).upserts.map((row) => row.platformMediaId)).toEqual(['m1']);
  });

  it('keeps a media listed twice once, where it was listed first', () => {
    const twice = [...read, media('m3', '2026-11-10T10:00:02.000Z', { folder: null })];
    expect(vaultRefsOf(twice).filter((row) => row.platformMediaId === 'm3')).toEqual([
      expect.objectContaining({ folderRef: 'folder_a' }),
    ]);
  });

  it('sorts as the platform lists: newest first, its rank between equal times, then its id', () => {
    const rows = vaultRefsOf(read).reverse();
    expect(rows.sort(compareVaultOrder).map((row) => row.platformMediaId)).toEqual([
      'm3',
      'm2b',
      'm2a',
      'm1',
    ]);
  });

  it('sorts the folders by their number, the root last', () => {
    const folders = [
      { folderRef: null, folderName: null },
      { folderRef: 'f10', folderName: 'SCRIPT 10' },
      { folderRef: 'f2', folderName: 'SCRIPT 2' },
    ];
    expect(folders.sort(compareVaultFolders).map((f) => f.folderRef)).toEqual(['f2', 'f10', null]);
  });
});
