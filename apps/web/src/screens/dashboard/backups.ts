import { BackupStatusSchema, RESTORE_TEST_FRESH_DAYS, type BackupStatus } from '@nirvana/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

import { withFirstOfMonth } from '@/scheduling/time';

/** The export is daily: reading its state again every five minutes is plenty. */
const REFRESH_MS = 300_000;

/**
 * `GET /v1/backups/status`, owner only (ADR 0028, OPS-02), parsed with the contract. The one reader of its cache: the
 * Dashboard's banner and Réglages › Sauvegardes both read through it, so that they always say the same thing.
 */
export const backupStatusQuery = queryOptions({
  queryKey: ['backups', 'status'],
  queryFn: async (): Promise<BackupStatus> => {
    const response = await fetch('/v1/backups/status', { credentials: 'include' });
    if (!response.ok) throw new Error(`GET /v1/backups/status: ${String(response.status)}`);
    return BackupStatusSchema.parse(await response.json());
  },
  retry: 1,
});

/** The state of the daily export, read for the owner only; undefined until it answers, or while it fails. */
export function useBackupStatus(enabled: boolean): BackupStatus | undefined {
  return useQuery({ ...backupStatusQuery, enabled, refetchInterval: REFRESH_MS }).data;
}

export interface BackupBanner {
  readonly title: string;
  readonly text: string;
  /** The restore test, when the export is late too: one more line under the text. */
  readonly restore: string | null;
}

/** « 26 octobre à 03:12 », in the reader's time zone. */
function when(iso: string, timeZone: string | undefined): string {
  const at = new Date(iso);
  const clock = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone }).format(at);
  return `${day(iso, timeZone)} à ${clock}`;
}

/** « 12 juillet », « 1er août », in the reader's time zone. */
function day(iso: string, timeZone: string | undefined): string {
  return withFirstOfMonth(
    new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone }).formatToParts(
      new Date(iso),
    ),
  );
}

/**
 * Why the restore test is not fresh (ADR 0028 § 6), and what it holds back: a pay is not validated without one of
 * less than `RESTORE_TEST_FRESH_DAYS` days (EQ-17). Its counts only, never what the test printed.
 */
function restoreLine(status: BackupStatus, timeZone: string | undefined): string {
  const needed = `Il en faut un de moins de ${String(RESTORE_TEST_FRESH_DAYS)} jours pour valider une paie.`;
  const test = status.lastRestoreTest;
  if (test === null) return `Aucun essai de restauration n’est encore noté. ${needed}`;
  if (test.rowCountMismatches > 0) {
    return `Le dernier essai de restauration, le ${day(test.testedAt, timeZone)}, n’a pas retrouvé toutes les lignes. ${needed}`;
  }
  return `Le dernier essai de restauration date du ${day(test.testedAt, timeZone)}. ${needed}`;
}

/**
 * Nothing while the export is on time and the restore test fresh (zero noise). Otherwise one amber banner: a copy is
 * missing or unproven, not an urgency of a fan (the red stays the urgencies'). Nothing in the app fixes the export, so
 * the banner has no action.
 */
export function backupBannerOf(status: BackupStatus, timeZone?: string): BackupBanner | null {
  const restore = status.restoreTestFresh ? null : restoreLine(status, timeZone);
  if (status.state === 'ok') {
    return restore === null
      ? null
      : { title: 'Aucun essai de restauration récent', text: restore, restore: null };
  }
  const running = status.lastRun?.status === 'running' ? ' Une sauvegarde est en cours.' : '';
  const failed = status.lastRun?.status === 'failed' ? 'La dernière tentative a échoué. ' : '';
  if (status.state === 'never' || status.lastSucceededAt === null) {
    return {
      title: 'Aucune sauvegarde encore',
      text: `${failed}La sauvegarde chiffrée de chaque nuit n’a jamais réussi : rien n’est copié hors de la base.${running}`,
      restore,
    };
  }
  return {
    title: `Aucune sauvegarde réussie depuis le ${when(status.lastSucceededAt, timeZone)}`,
    text: `${failed}Elle doit réussir au moins toutes les ${String(status.overdueAfterHours)} h : d’ici là, rien de récent n’est copié hors de la base.${running}`,
    restore,
  };
}
