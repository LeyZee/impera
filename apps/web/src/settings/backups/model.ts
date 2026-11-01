import {
  RESTORE_TEST_FRESH_DAYS,
  RecordRestoreTestBodySchema,
  type BackupErrorCode,
  type BackupStatus,
  type RecordRestoreTestBody,
} from '@nirvana/contracts';

import { withFirstOfMonth } from '@/scheduling/time';
import { backupBannerOf } from '@/screens/dashboard/backups';

/**
 * Réglages › Sauvegardes (EQ-17, ADR 0028): what the page says of the nightly export and of the restore test, and the
 * form that enters a test played on the PC. Pure, so that every wording is tested; the time zone is the reader's,
 * passed in by the tests.
 */

const DAY_MS = 86_400_000;

/** No-break space between a number and its unit: « 4 min 12 s » never splits across two lines. */
const NBSP = '\u00a0';

/** « 12 juillet », « 1er août », with the year when it is not this one. */
function dayOf(iso: string, now: Date, timeZone: string | undefined): string {
  const at = new Date(iso);
  const year = (date: Date) => new Intl.DateTimeFormat('fr-FR', { year: 'numeric', timeZone }).format(date);
  return withFirstOfMonth(
    new Intl.DateTimeFormat('fr-FR', {
      day: 'numeric',
      month: 'long',
      ...(year(at) !== year(now) && { year: 'numeric' }),
      timeZone,
    }).formatToParts(at),
  );
}

/** « 03:12 ». */
function clockOf(iso: string, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone }).format(
    new Date(iso),
  );
}

/** « 20 octobre », « 1er novembre »: the day a restore test was made, in the reader's zone. */
export const testedDay = (iso: string): string =>
  withFirstOfMonth(
    new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).formatToParts(new Date(iso)),
  );

/** « 4 min 12 s », « 52 s », « 1 h 05 min ». */
export function durationOf(seconds: number): string {
  if (seconds < 60) return `${String(seconds)}${NBSP}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = seconds % 60;
    return rest === 0
      ? `${String(minutes)}${NBSP}min`
      : `${String(minutes)}${NBSP}min${NBSP}${String(rest)}${NBSP}s`;
  }
  return `${String(Math.floor(minutes / 60))}${NBSP}h${NBSP}${String(minutes % 60).padStart(2, '0')}${NBSP}min`;
}

/** « 42 Mo », « 860 ko ». */
function sizeOf(bytes: number): string {
  if (bytes < 1_000_000) return `${String(Math.max(1, Math.round(bytes / 1000)))}${NBSP}ko`;
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(bytes / 1_000_000)}${NBSP}Mo`;
}

export type Tone = 'ok' | 'warn';

/** The steps of `ops/db-export/export.sh`, as the service names them in « failed at step … ». */
const FAILED_STEPS: Record<string, string> = {
  start: 'la sauvegarde n’a pas pu démarrer',
  record: 'la sauvegarde n’a pas pu s’inscrire dans la base',
  settings: 'la lecture des réglages de la base a échoué',
  snapshot: 'la base n’a pas pu être figée pour la copie',
  dump: 'la copie de la base a échoué',
  count: 'le comptage des lignes a échoué',
  verify: 'la vérification de la copie a échoué',
  encrypt: 'le chiffrement a échoué',
  upload: 'l’envoi vers le stockage a échoué',
  finish: 'la fin de la sauvegarde n’a pas pu être notée',
};

/**
 * The step that failed, in the page's words. The service writes « failed at step upload »: never shown raw. A step the
 * page does not know yet reads as a failure without detail.
 */
export function runErrorOf(error: string | null): string | null {
  if (error === null) return null;
  const step = /^failed at step (\w+)$/.exec(error.trim())?.[1];
  return step === undefined ? null : (FAILED_STEPS[step] ?? null);
}

export interface ExportView {
  readonly tone: Tone;
  readonly title: string;
  readonly text: string;
  /** The latest attempt, in one faint line; null before the first. */
  readonly lastRun: string | null;
}

/**
 * The nightly export. Late or never: the Dashboard's own amber words (`backupBannerOf`), so that both screens say the
 * same thing. On time: when it last succeeded, and what it promises.
 */
export function exportViewOf(status: BackupStatus, now: Date, timeZone?: string): ExportView {
  const run = status.lastRun;
  const failedStep = runErrorOf(run?.error ?? null);
  const lastRun =
    run === null
      ? null
      : run.status === 'running'
        ? `Une sauvegarde est en cours depuis ${clockOf(run.startedAt, timeZone)}.`
        : run.status === 'failed'
          ? `Dernière tentative échouée le ${dayOf(run.startedAt, now, timeZone)} à ${clockOf(run.startedAt, timeZone)}${failedStep === null ? '' : ` : ${failedStep}`}.`
          : `Dernière tentative réussie le ${dayOf(run.startedAt, now, timeZone)}${
              run.finishedAt === null
                ? ''
                : `, en ${durationOf(Math.max(1, Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000)))}`
            }${run.sizeBytes === null ? '' : `, ${sizeOf(run.sizeBytes)} chiffrés`}.`;
  if (status.state !== 'ok' || status.lastSucceededAt === null) {
    const banner = backupBannerOf({ ...status, restoreTestFresh: true }, timeZone);
    return {
      tone: 'warn',
      title: banner?.title ?? 'Aucune sauvegarde encore',
      text: banner?.text ?? '',
      lastRun,
    };
  }
  return {
    tone: 'ok',
    title: `Sauvegardée le ${dayOf(status.lastSucceededAt, now, timeZone)} à ${clockOf(status.lastSucceededAt, timeZone)}`,
    // « Chaque nuit… » is the page's lede, just above: the block says only what it adds (REG-25).
    text: `Chaque copie est gardée 30${NBSP}jours. Après ${String(status.overdueAfterHours)}${NBSP}h sans copie réussie, le Dashboard et Telegram te préviennent.`,
    lastRun,
  };
}

/**
 * « Relancer la sauvegarde maintenant » (REG-24): what the strip offers. `asked`: a request waits for the service,
 * which picks it up within a minute. `running`: an export runs now, its outcome will show. Otherwise the button.
 */
export type RunNowView =
  | { readonly kind: 'offer' }
  | { readonly kind: 'asked'; readonly text: string }
  | { readonly kind: 'running' };

export function runNowOf(status: BackupStatus, timeZone?: string): RunNowView {
  if (status.runRequestedAt !== undefined) {
    return {
      kind: 'asked',
      text: `Relance demandée à ${clockOf(status.runRequestedAt, timeZone)} : elle démarre dans la minute.`,
    };
  }
  return status.lastRun?.status === 'running' ? { kind: 'running' } : { kind: 'offer' };
}

/** How often the page reads the status again while a request waits or an export runs; otherwise never by itself. */
export const WATCH_MS = 15_000;

/**
 * Réglages reads the status again only while something is under way: « Relance demandée… » turns into « en cours »
 * when the service picks the request up, then into the outcome, without the owner reloading the page.
 */
export function watchIntervalOf(status: BackupStatus | undefined): number | false {
  if (status === undefined) return false;
  return status.runRequestedAt !== undefined || status.lastRun?.status === 'running' ? WATCH_MS : false;
}

export interface RestoreView {
  readonly tone: Tone;
  readonly title: string;
  readonly text: string;
  /** « Valable jusqu’au 10 octobre » for a fresh test; null otherwise. */
  readonly validity: string | null;
}

const PAY_RULE = `La paie attend un essai réussi de moins de ${String(RESTORE_TEST_FRESH_DAYS)}${NBSP}jours.`;

/**
 * The latest restore test (ADR 0028 § 6). Its freshness is the server's (`restoreTestFresh`, the bound the pay guard
 * reads); the page only words it. Counts only, never what the test printed.
 */
export function restoreViewOf(status: BackupStatus, now: Date, timeZone?: string): RestoreView {
  const test = status.lastRestoreTest;
  if (test === null) {
    return {
      tone: 'warn',
      title: 'Aucun essai de restauration noté',
      text: `Une sauvegarde qu’on n’a jamais restaurée ne prouve rien. ${PAY_RULE}`,
      validity: null,
    };
  }
  const restored = `Sauvegarde du ${dayOf(test.backupFinishedAt, now, timeZone)} restaurée en ${durationOf(test.durationSeconds)}`;
  if (test.rowCountMismatches > 0) {
    const tables =
      test.rowCountMismatches > 1 ? `${String(test.rowCountMismatches)}${NBSP}tables` : 'une table';
    return {
      tone: 'warn',
      title: `L’essai du ${dayOf(test.testedAt, now, timeZone)} n’a pas tout retrouvé`,
      text: `${restored}, mais ${tables} n’avai${test.rowCountMismatches > 1 ? 'ent' : 't'} pas le bon nombre de lignes. ${PAY_RULE}`,
      validity: null,
    };
  }
  if (!status.restoreTestFresh) {
    return {
      tone: 'warn',
      title: `Le dernier essai date du ${dayOf(test.testedAt, now, timeZone)}`,
      text: `${restored}, toutes les lignes retrouvées. Il a plus de ${String(RESTORE_TEST_FRESH_DAYS)}${NBSP}jours : la paie attend un nouvel essai réussi.`,
      validity: null,
    };
  }
  return {
    tone: 'ok',
    title: `Essai réussi le ${dayOf(test.testedAt, now, timeZone)}`,
    text: `${restored}, toutes les lignes retrouvées.`,
    validity: `Valable jusqu’au ${dayOf(new Date(Date.parse(test.testedAt) + RESTORE_TEST_FRESH_DAYS * DAY_MS).toISOString(), now, timeZone)}`,
  };
}

/** What the report of `restore-check.sh` gives, line by line; a line it does not find leaves its field as it was. */
export interface ReportReading {
  readonly sha256?: string;
  readonly durationSeconds?: number;
  readonly rowCountMismatches?: number;
}

/**
 * Reads the report the restore session hands over (`ops/db-export/restore-check.sh`): « export sha256: … »,
 * « restored in 252 s, … », then « row counts: all 31 tables match » or « row counts differ: a (3 expected, 2
 * restored), b (…) ». Only these three figures are kept; the rest of the paste goes nowhere.
 */
export function readReport(text: string): ReportReading {
  const sha256 = /export sha256:\s*([0-9a-f]{64})\b/i.exec(text)?.[1]?.toLowerCase();
  const duration = /restored in (\d+) s\b/.exec(text)?.[1];
  const differ = /row counts differ: (.*)$/m.exec(text)?.[1];
  const rowCountMismatches =
    differ !== undefined
      ? (differ.match(/\(\d+ expected, /g) ?? []).length
      : /row counts: all \d+ tables match/.test(text)
        ? 0
        : undefined;
  return {
    ...(sha256 !== undefined && { sha256 }),
    ...(duration !== undefined && { durationSeconds: Number(duration) }),
    ...(rowCountMismatches !== undefined && { rowCountMismatches }),
  };
}

/** The form, as typed: the end of the test is the reader's wall clock (`datetime-local`). */
export interface RestoreDraft {
  readonly sha256: string;
  readonly testedAt: string;
  readonly durationSeconds: string;
  readonly rowCountMismatches: string;
  readonly notes: string;
}

export type DraftField = keyof RestoreDraft;

/** « 2026-10-27T14:05 » for an instant, in the reader's zone (what a `datetime-local` field holds). */
export function wallClockOf(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export function emptyDraft(now: Date): RestoreDraft {
  return { sha256: '', testedAt: wallClockOf(now), durationSeconds: '', rowCountMismatches: '', notes: '' };
}

/** The report read into the draft: what it found replaces what was typed, the rest stays. */
export function withReport(draft: RestoreDraft, reading: ReportReading): RestoreDraft {
  return {
    ...draft,
    ...(reading.sha256 !== undefined && { sha256: reading.sha256 }),
    ...(reading.durationSeconds !== undefined && { durationSeconds: String(reading.durationSeconds) }),
    ...(reading.rowCountMismatches !== undefined && {
      rowCountMismatches: String(reading.rowCountMismatches),
    }),
  };
}

/** The server allows five minutes of clock difference; the page says « in the future » past the same bound. */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

const wholeIn = (text: string, min: number, max: number): number | null => {
  const value = Number(text.trim());
  return text.trim() !== '' && Number.isInteger(value) && value >= min && value <= max ? value : null;
};

/** What is wrong with each field, in the page's words; empty when the draft can be sent. */
export function problemsOf(draft: RestoreDraft, now: Date): Partial<Record<DraftField, string>> {
  const problems: Partial<Record<DraftField, string>> = {};
  if (!/^[0-9a-f]{64}$/i.test(draft.sha256.trim())) {
    problems.sha256 = 'L’empreinte compte 64\u00a0caractères, chiffres et lettres de a à f.';
  }
  const testedAt = new Date(draft.testedAt);
  if (Number.isNaN(testedAt.getTime())) problems.testedAt = 'Indique le jour et l’heure de fin de l’essai.';
  else if (testedAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    problems.testedAt = 'Cette heure n’est pas encore passée.';
  }
  if (wholeIn(draft.durationSeconds, 1, 86_400) === null) {
    problems.durationSeconds = 'Un nombre entier de secondes, de 1 à 86\u00a0400.';
  }
  if (wholeIn(draft.rowCountMismatches, 0, 1_000_000) === null) {
    problems.rowCountMismatches = 'Le nombre de tables qui diffèrent : 0 quand tout correspond.';
  }
  if (draft.notes.trim().length > 500) problems.notes = 'Au plus 500\u00a0caractères.';
  return problems;
}

/** The body of `POST /v1/backups/restore-tests`, through the contract; null while a field is wrong. */
export function bodyOf(draft: RestoreDraft, id: string, now: Date): RecordRestoreTestBody | null {
  if (Object.keys(problemsOf(draft, now)).length > 0) return null;
  const parsed = RecordRestoreTestBodySchema.safeParse({
    id,
    backupSha256: draft.sha256.trim(),
    testedAt: new Date(draft.testedAt).toISOString(),
    durationSeconds: Number(draft.durationSeconds.trim()),
    rowCountMismatches: Number(draft.rowCountMismatches.trim()),
    notes: draft.notes,
  });
  return parsed.success ? parsed.data : null;
}

/** A refusal of the server, in the page's words, and the field it points at when it points at one. */
export const REFUSALS: Record<
  Exclude<BackupErrorCode, 'reauthentication_forbidden'> | 'request_invalid' | 'role_forbidden',
  { readonly message: string; readonly field: DraftField | null }
> = {
  restore_test_backup_unprocessable: {
    message:
      'Aucune sauvegarde réussie n’a cette empreinte. Reprends la ligne « export sha256 » du compte rendu.',
    field: 'sha256',
  },
  restore_test_before_backup_unprocessable: {
    message: 'L’essai est daté d’avant la fin de cette sauvegarde. Vérifie le jour et l’heure.',
    field: 'testedAt',
  },
  restore_test_in_future_unprocessable: {
    message: 'L’essai est daté dans le futur. Vérifie le jour et l’heure.',
    field: 'testedAt',
  },
  restore_test_conflict: {
    message: 'Cet essai est déjà noté avec d’autres valeurs. Ferme cette fenêtre et note-le de nouveau.',
    field: null,
  },
  request_invalid: { message: 'Une valeur n’est pas acceptée. Vérifie les champs.', field: null },
  role_forbidden: { message: 'Seul le propriétaire note un essai de restauration.', field: null },
};
