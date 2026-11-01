import { BackupStatusSchema, type BackupStatus } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import {
  bodyOf,
  durationOf,
  emptyDraft,
  exportViewOf,
  problemsOf,
  readReport,
  restoreViewOf,
  runErrorOf,
  runNowOf,
  testedDay,
  watchIntervalOf,
  withReport,
  type RestoreDraft,
} from './model';

const PARIS = 'Europe/Paris';
const NOW = new Date('2026-10-27T10:00:00Z');
const SHA = 'a'.repeat(63) + 'b';

function status(patch: Partial<BackupStatus> = {}): BackupStatus {
  return BackupStatusSchema.parse({
    state: 'ok',
    lastSucceededAt: '2026-10-27T02:12:00Z',
    overdueAfterHours: 26,
    lastRun: {
      status: 'succeeded',
      startedAt: '2026-10-27T02:00:00Z',
      finishedAt: '2026-10-27T02:03:30Z',
      sizeBytes: 42_400_000,
      error: null,
    },
    lastRestoreTest: {
      testedAt: '2026-10-20T15:00:00Z',
      backupFinishedAt: '2026-10-20T01:05:00Z',
      durationSeconds: 252,
      rowCountMismatches: 0,
    },
    restoreTestFresh: true,
    ...patch,
  });
}

describe('exportViewOf', () => {
  it('says when the copy last succeeded, and the latest attempt in one faint line', () => {
    expect(exportViewOf(status(), NOW, PARIS)).toEqual({
      tone: 'ok',
      title: 'Sauvegardée le 27 octobre à 03:12',
      text: 'Chaque copie est gardée 30\u00a0jours. Après 26\u00a0h sans copie réussie, le Dashboard et Telegram te préviennent.',
      lastRun:
        'Dernière tentative réussie le 27 octobre, en 3\u00a0min\u00a030\u00a0s, 42,4\u00a0Mo chiffrés.',
    });
  });

  it('speaks with the Dashboard’s amber words when late, and names the failed step', () => {
    const view = exportViewOf(
      status({
        state: 'overdue',
        lastSucceededAt: '2026-10-25T02:12:00Z',
        lastRun: {
          status: 'failed',
          startedAt: '2026-10-27T02:00:00Z',
          finishedAt: '2026-10-27T02:00:40Z',
          sizeBytes: null,
          error: 'failed at step upload',
        },
      }),
      NOW,
      PARIS,
    );
    expect(view.tone).toBe('warn');
    expect(view.title).toBe('Aucune sauvegarde réussie depuis le 25 octobre à 03:12');
    expect(view.text).toMatch(/^La dernière tentative a échoué\./u);
    expect(view.lastRun).toBe(
      'Dernière tentative échouée le 27 octobre à 03:00 : l’envoi vers le stockage a échoué.',
    );
  });

  it('says that none ever succeeded, and that one is running', () => {
    const view = exportViewOf(
      status({
        state: 'never',
        lastSucceededAt: null,
        lastRun: {
          status: 'running',
          startedAt: '2026-10-27T02:00:00Z',
          finishedAt: null,
          sizeBytes: null,
          error: null,
        },
      }),
      NOW,
      PARIS,
    );
    expect(view.title).toBe('Aucune sauvegarde encore');
    expect(view.lastRun).toBe('Une sauvegarde est en cours depuis 03:00.');
  });

  it('has no attempt line before the first run', () => {
    expect(
      exportViewOf(status({ state: 'never', lastSucceededAt: null, lastRun: null }), NOW, PARIS).lastRun,
    ).toBe(null);
  });
});

describe('the first of a month (PAIE-19)', () => {
  it('writes it « 1er » in the export and on a restore test', () => {
    expect(exportViewOf(status({ lastSucceededAt: '2026-11-01T02:12:00Z' }), NOW, PARIS).title).toBe(
      'Sauvegardée le 1er novembre à 03:12',
    );
    expect(testedDay('2026-11-01T12:00:00Z')).toBe('1er novembre');
    expect(testedDay('2026-10-20T12:00:00Z')).toBe('20 octobre');
  });
});

describe('runErrorOf', () => {
  it('words each step of export.sh, and never shows the raw line', () => {
    expect(runErrorOf('failed at step dump')).toBe('la copie de la base a échoué');
    expect(runErrorOf('failed at step encrypt')).toBe('le chiffrement a échoué');
    expect(runErrorOf('failed at step somewhere-new')).toBe(null);
    expect(runErrorOf('ERROR: relation x does not exist')).toBe(null);
    expect(runErrorOf(null)).toBe(null);
  });
});

describe('runNowOf (REG-24)', () => {
  it('offers to export now, says a request that waits, and hides while an export runs', () => {
    expect(runNowOf(status())).toEqual({ kind: 'offer' });
    expect(runNowOf(status({ runRequestedAt: '2026-10-27T09:58:00Z' }), PARIS)).toEqual({
      kind: 'asked',
      text: 'Relance demandée à 10:58 : elle démarre dans la minute.',
    });
    expect(
      runNowOf(
        status({
          lastRun: {
            status: 'running',
            startedAt: '2026-10-27T09:59:00Z',
            finishedAt: null,
            sizeBytes: null,
            error: null,
          },
        }),
      ),
    ).toEqual({ kind: 'running' });
  });
});

describe('watchIntervalOf (REG-24)', () => {
  it('reads the status again every 15 s while a request waits or an export runs, never otherwise', () => {
    const running = {
      status: 'running' as const,
      startedAt: '2026-10-27T09:59:00Z',
      finishedAt: null,
      sizeBytes: null,
      error: null,
    };
    expect(watchIntervalOf(undefined)).toBe(false);
    expect(watchIntervalOf(status())).toBe(false);
    expect(watchIntervalOf(status({ runRequestedAt: '2026-10-27T09:58:00Z' }))).toBe(15_000);
    expect(watchIntervalOf(status({ lastRun: running }))).toBe(15_000);
  });
});

describe('restoreViewOf', () => {
  it('words a fresh test with the day it stops counting', () => {
    expect(restoreViewOf(status(), NOW, PARIS)).toEqual({
      tone: 'ok',
      title: 'Essai réussi le 20 octobre',
      text: 'Sauvegarde du 20 octobre restaurée en 4\u00a0min\u00a012\u00a0s, toutes les lignes retrouvées.',
      validity: 'Valable jusqu’au 18 janvier 2027',
    });
  });

  it('asks for a first test', () => {
    const view = restoreViewOf(status({ lastRestoreTest: null, restoreTestFresh: false }), NOW, PARIS);
    expect(view.tone).toBe('warn');
    expect(view.title).toBe('Aucun essai de restauration noté');
    expect(view.text).toMatch(/moins de 90\u00a0jours\.$/u);
  });

  it('says a test that missed rows holds the pay back, whatever its age', () => {
    const view = restoreViewOf(
      status({
        lastRestoreTest: {
          testedAt: '2026-10-20T15:00:00Z',
          backupFinishedAt: '2026-10-20T01:05:00Z',
          durationSeconds: 52,
          rowCountMismatches: 2,
        },
        restoreTestFresh: false,
      }),
      NOW,
      PARIS,
    );
    expect(view).toEqual({
      tone: 'warn',
      title: 'L’essai du 20 octobre n’a pas tout retrouvé',
      text: 'Sauvegarde du 20 octobre restaurée en 52\u00a0s, mais 2\u00a0tables n’avaient pas le bon nombre de lignes. La paie attend un essai réussi de moins de 90\u00a0jours.',
      validity: null,
    });
  });

  it('says an old test no longer counts, with its year when it is not this one', () => {
    const view = restoreViewOf(
      status({
        lastRestoreTest: {
          testedAt: '2025-12-20T15:00:00Z',
          backupFinishedAt: '2025-12-19T02:05:00Z',
          durationSeconds: 3_900,
          rowCountMismatches: 0,
        },
        restoreTestFresh: false,
      }),
      NOW,
      PARIS,
    );
    expect(view.title).toBe('Le dernier essai date du 20 décembre 2025');
    expect(view.text).toBe(
      'Sauvegarde du 19 décembre 2025 restaurée en 1\u00a0h\u00a005\u00a0min, toutes les lignes retrouvées. Il a plus de 90\u00a0jours : la paie attend un nouvel essai réussi.',
    );
  });
});

describe('durationOf', () => {
  it('reads seconds as a person would, number and unit never split across two lines', () => {
    expect([1, 59, 60, 252, 3_600, 3_900].map(durationOf)).toEqual([
      '1\u00a0s',
      '59\u00a0s',
      '1\u00a0min',
      '4\u00a0min\u00a012\u00a0s',
      '1\u00a0h\u00a000\u00a0min',
      '1\u00a0h\u00a005\u00a0min',
    ]);
  });
});

describe('readReport', () => {
  const ok = [
    `export sha256: ${SHA.toUpperCase()}`,
    'restored in 252 s, worker queue emptied',
    'row counts: all 31 tables match',
  ].join('\n');

  it('keeps the fingerprint, the duration and no mismatch from a report that matches', () => {
    expect(readReport(ok)).toEqual({ sha256: SHA, durationSeconds: 252, rowCountMismatches: 0 });
  });

  it('counts the tables that differ', () => {
    const differ = ok.replace(
      'row counts: all 31 tables match',
      'row counts differ: fans (12 expected, 11 restored), messages (40 expected, missing restored)',
    );
    expect(readReport(differ).rowCountMismatches).toBe(2);
  });

  it('finds the lines inside a longer paste, and nothing in a stranger text', () => {
    expect(readReport(`Voici le compte rendu :\n\n${ok}\n\nFin.`).durationSeconds).toBe(252);
    expect(readReport('bonjour')).toEqual({});
    expect(readReport('export sha256: abc')).toEqual({});
  });
});

describe('the form', () => {
  const filled: RestoreDraft = {
    sha256: ` ${SHA} `,
    testedAt: '2026-10-27T09:30',
    durationSeconds: '252',
    rowCountMismatches: '0',
    notes: '  ',
  };

  it('starts at the reader’s clock, and takes from a report only what it found', () => {
    const draft = emptyDraft(NOW);
    expect(draft.testedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u);
    expect(withReport({ ...draft, notes: 'gardée' }, { durationSeconds: 90 })).toEqual({
      ...draft,
      notes: 'gardée',
      durationSeconds: '90',
    });
  });

  it('builds the body through the contract', () => {
    expect(bodyOf(filled, '0199f2a0-0000-7000-8000-000000000001', NOW)).toEqual({
      id: '0199f2a0-0000-7000-8000-000000000001',
      backupSha256: SHA,
      testedAt: new Date('2026-10-27T09:30').toISOString(),
      durationSeconds: 252,
      rowCountMismatches: 0,
      notes: null,
    });
  });

  it('names each wrong field, and sends nothing while one is wrong', () => {
    const wrong: RestoreDraft = {
      sha256: 'abc',
      testedAt: '',
      durationSeconds: '4.5',
      rowCountMismatches: '-1',
      notes: 'x'.repeat(501),
    };
    expect(Object.keys(problemsOf(wrong, NOW)).toSorted()).toEqual([
      'durationSeconds',
      'notes',
      'rowCountMismatches',
      'sha256',
      'testedAt',
    ]);
    expect(bodyOf(wrong, '0199f2a0-0000-7000-8000-000000000001', NOW)).toBeNull();
    expect(problemsOf({ ...filled, durationSeconds: '' }, NOW).durationSeconds).toBeDefined();
  });

  it('refuses an end of test still to come, past the server’s five minutes', () => {
    const ahead = (minutes: number) => {
      const at = new Date(NOW.getTime() + minutes * 60_000);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
    };
    expect(problemsOf({ ...filled, testedAt: ahead(4) }, NOW).testedAt).toBeUndefined();
    expect(problemsOf({ ...filled, testedAt: ahead(10) }, NOW).testedAt).toBe(
      'Cette heure n’est pas encore passée.',
    );
  });
});
