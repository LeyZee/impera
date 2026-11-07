import type {
  ContentDrop,
  ContentRequest,
  CreatorContent,
  CreatorId,
  DropCategory,
  ScriptCadence,
  ScriptStructure,
} from '@impera/contracts';

import { DROP_OUTPUTS, dueOf, namedDay } from '@/screens/content/model';

/**
 * Créatrices › Demandes (recette MED-09): what the agency asks of her, as the screen lays it out. Pure, so that what
 * it says is tested without a browser.
 */

/** What the agency may ask of her: what goes to an output she has (Reveal today, ADR 0055 § 1), and a script. */
export const ASKABLE_CATEGORIES: readonly DropCategory[] = [
  ...DROP_OUTPUTS.flatMap((output) => output.categories),
  'script',
];

export type RequestStanding = 'todo' | 'shooting' | 'dropped' | 'refused' | 'cancelled';

export const STANDING_LABELS: Readonly<Record<RequestStanding, string>> = {
  todo: 'À faire',
  shooting: 'En tournage',
  dropped: 'Déposée',
  refused: 'Refusée',
  cancelled: 'Annulée',
};

export interface RequestRow {
  readonly request: ContentRequest;
  readonly standing: RequestStanding;
  /** « Pour mardi », « En retard depuis le 3 nov. »: in her days. */
  readonly due: { readonly text: string; readonly late: boolean };
  /** Her script's structure, by the library's name; `null` for another category or a structure gone. */
  readonly structureName: string | null;
  /** Only a request nothing answers yet is the agency's to cancel (recette MED-07). */
  readonly cancellable: boolean;
}

function standingOf(request: ContentRequest, drops: ReadonlyMap<string, ContentDrop>): RequestStanding {
  if (request.state === 'refused') return 'refused';
  if (request.state === 'cancelled') return 'cancelled';
  if (request.dropId === null) return 'todo';
  return drops.get(request.dropId)?.state === 'filling' ? 'shooting' : 'dropped';
}

export interface RequestGroups {
  /** Open, the nearest day first. */
  readonly current: readonly RequestRow[];
  /** Refused or cancelled, the latest first. */
  readonly closed: readonly RequestRow[];
}

/** Her requests as the agency reads them: what is under way, then what is closed. */
export function requestGroups(
  content: CreatorContent,
  structures: readonly ScriptStructure[],
  today: string,
): RequestGroups {
  const drops = new Map(content.drops.map((drop) => [drop.id, drop]));
  const names = new Map(structures.map((structure) => [structure.id, structure.current.name]));
  const rows = content.requests.map((request): RequestRow => {
    const standing = standingOf(request, drops);
    return {
      request,
      standing,
      due:
        request.state === 'open'
          ? dueOf(request.dueOn, today)
          : { text: `Pour ${namedDay(request.dueOn, today)}`, late: false },
      structureName: request.structureId === null ? null : (names.get(request.structureId) ?? null),
      cancellable: standing === 'todo',
    };
  });
  return {
    current: rows
      .filter((row) => row.request.state === 'open')
      .sort((a, b) => a.request.dueOn.localeCompare(b.request.dueOn)),
    closed: rows
      .filter((row) => row.request.state !== 'open')
      .sort((a, b) => b.request.createdAt.localeCompare(a.request.createdAt)),
  };
}

/** « Tous les 7 jours », « Tous les jours ». */
export const everyText = (days: number): string =>
  days === 1 ? 'Tous les jours' : `Tous les ${String(days)} jours`;

/**
 * What the cadence last did, in the agency's words: `warn` when it needs a hand (amber, never red: nothing is urgent,
 * a script is simply not asked).
 */
export function cadenceNote(
  cadence: Pick<ScriptCadence, 'outcome' | 'skipped'>,
): { readonly text: string; readonly warn: boolean } | null {
  switch (cadence.outcome) {
    case null:
      return null;
    case 'asked':
      return { text: 'Le dernier script est parti avec la prochaine structure de sa file.', warn: false };
    case 'reused':
      return { text: 'Sa file était vide : la dernière structure lui a été redemandée.', warn: true };
    case 'queue_empty':
      return { text: 'Aucune structure dans sa file : aucun script n’a été demandé.', warn: true };
    case 'no_persona':
      return { text: 'Elle n’a pas de persona active : aucun script n’a été demandé.', warn: true };
    case 'blocked':
      return {
        text: `Les structures de sa file touchent ses limites, aucune n’a été demandée : ${cadence.skipped
          .map((skip) => skip.name)
          .join(', ')}.`,
        warn: true,
      };
  }
}

export interface AskDraft {
  readonly category: DropCategory | '';
  readonly dueOn: string;
  readonly reason: string;
  readonly structureId: string;
}

export type AskField = 'category' | 'dueOn' | 'reason' | 'structureId';

/** What is missing or wrong before « Demander », in the form's words. */
export function askProblems(draft: AskDraft, today: string): Partial<Record<AskField, string>> {
  return {
    ...(draft.category === '' ? { category: 'Choisis ce que tu lui demandes.' } : {}),
    ...(draft.dueOn === ''
      ? { dueOn: 'Pour quel jour ?' }
      : draft.dueOn < today
        ? { dueOn: 'Ce jour est déjà passé pour elle : aujourd’hui ou plus tard.' }
        : {}),
    ...(draft.reason.trim() === ''
      ? { reason: 'Dis-lui en une phrase ce que tu attends.' }
      : draft.reason.trim().length > 160
        ? { reason: '160 caractères au plus.' }
        : {}),
    ...(draft.category === 'script' && draft.structureId === ''
      ? { structureId: 'Choisis la structure du script.' }
      : {}),
  };
}

/** The structures of the library she may be asked: shared, or kept for her. */
export const askableStructures = (
  structures: readonly ScriptStructure[],
  creatorId: CreatorId,
): readonly ScriptStructure[] =>
  structures.filter(
    (structure) => structure.reservedCreatorId === null || structure.reservedCreatorId === creatorId,
  );
