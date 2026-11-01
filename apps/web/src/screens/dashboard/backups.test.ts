import type { BackupStatus } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { backupBannerOf } from './backups';

const status = (patch: Partial<BackupStatus>): BackupStatus => ({
  state: 'ok',
  lastSucceededAt: '2026-10-26T02:12:00.000Z',
  overdueAfterHours: 26,
  lastRun: null,
  lastRestoreTest: {
    testedAt: '2026-10-01T10:00:00.000Z',
    backupFinishedAt: '2026-09-30T01:05:00.000Z',
    durationSeconds: 420,
    rowCountMismatches: 0,
  },
  restoreTestFresh: true,
  ...patch,
});

describe('the backup banner', () => {
  it('says nothing while the export is on time', () => {
    expect(backupBannerOf(status({}))).toBeNull();
  });

  it('writes the first of a month « 1er » (PAIE-19)', () => {
    expect(
      backupBannerOf(
        status({ state: 'overdue', lastSucceededAt: '2026-11-01T02:12:00.000Z' }),
        'Europe/Paris',
      )?.title,
    ).toBe('Aucune sauvegarde réussie depuis le 1er novembre à 03:12');
  });

  it('says since when no export succeeded, in the reader’s time', () => {
    expect(backupBannerOf(status({ state: 'overdue' }), 'Europe/Paris')).toEqual({
      title: 'Aucune sauvegarde réussie depuis le 26 octobre à 03:12',
      text: 'Elle doit réussir au moins toutes les 26 h : d’ici là, rien de récent n’est copié hors de la base.',
      restore: null,
    });
  });

  it('says when none ever succeeded, and that the last try failed', () => {
    const banner = backupBannerOf(
      status({
        state: 'never',
        lastSucceededAt: null,
        lastRun: {
          status: 'failed',
          startedAt: '2026-10-27T02:00:00.000Z',
          finishedAt: '2026-10-27T02:01:00.000Z',
          sizeBytes: null,
          error: 'upload',
        },
      }),
    );
    expect(banner?.title).toBe('Aucune sauvegarde encore');
    expect(banner?.text).toMatch(/^La dernière tentative a échoué\. /u);
    // The service's step stays out of the banner: nothing of the server's internals on screen.
    expect(banner?.text).not.toContain('upload');
  });

  it('says when one is running', () => {
    const lastRun = {
      status: 'running',
      startedAt: '2026-10-27T02:00:00.000Z',
      finishedAt: null,
      sizeBytes: null,
      error: null,
    } as const;
    expect(backupBannerOf(status({ state: 'overdue', lastRun }))?.text).toMatch(
      /Une sauvegarde est en cours\.$/u,
    );
  });

  it('says when no restore test is recent, even with the export on time', () => {
    expect(backupBannerOf(status({ lastRestoreTest: null, restoreTestFresh: false }))).toEqual({
      title: 'Aucun essai de restauration récent',
      text: 'Aucun essai de restauration n’est encore noté. Il en faut un de moins de 90 jours pour valider une paie.',
      restore: null,
    });
    const old = {
      testedAt: '2026-07-12T10:00:00.000Z',
      backupFinishedAt: '2026-09-30T01:05:00.000Z',
      durationSeconds: 420,
      rowCountMismatches: 0,
    };
    expect(
      backupBannerOf(status({ lastRestoreTest: old, restoreTestFresh: false }), 'Europe/Paris')?.text,
    ).toBe(
      'Le dernier essai de restauration date du 12 juillet. Il en faut un de moins de 90 jours pour valider une paie.',
    );
  });

  it('says a recent test that missed rows by its outcome only', () => {
    const missed = {
      testedAt: '2026-10-20T10:00:00.000Z',
      backupFinishedAt: '2026-09-30T01:05:00.000Z',
      durationSeconds: 420,
      rowCountMismatches: 3,
    };
    expect(
      backupBannerOf(status({ lastRestoreTest: missed, restoreTestFresh: false }), 'Europe/Paris')?.text,
    ).toBe(
      'Le dernier essai de restauration, le 20 octobre, n’a pas retrouvé toutes les lignes. Il en faut un de moins de 90 jours pour valider une paie.',
    );
  });

  it('adds the restore test as one more line when the export is late too', () => {
    const banner = backupBannerOf(
      status({ state: 'overdue', lastRestoreTest: null, restoreTestFresh: false }),
    );
    expect(banner?.title).toMatch(/^Aucune sauvegarde réussie depuis/u);
    expect(banner?.restore).toBe(
      'Aucun essai de restauration n’est encore noté. Il en faut un de moins de 90 jours pour valider une paie.',
    );
    expect(backupBannerOf(status({ state: 'overdue' }))?.restore).toBeNull();
  });
});
