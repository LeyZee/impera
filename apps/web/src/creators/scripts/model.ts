import {
  SCRIPT_EXPORT_MAX_BYTES,
  scriptDropCode,
  type ContentDrop,
  type ContentDropId,
  type CreatorContent,
  type ScriptStructure,
  type ShotMoment,
} from '@impera/contracts';

/**
 * Créatrices › Scripts (SC-03 c2b): her sent scripts as the team copies them into Reveal, each with its number, its
 * moment, its media and where its archive stands. Pure, so that what the screen offers is tested without it.
 */

export const MOMENT_LABELS: Readonly<Record<ShotMoment, string>> = { day: 'Jour', night: 'Nuit' };
export const MOMENT_EMOJIS: Readonly<Record<ShotMoment, string>> = { day: '☀️', night: '🌙' };

/** Why the archive of a script is not offered yet, or not at all; each one is a server refusal never sent for. */
export type ExportBlocker = 'not_ready' | 'moment_unknown' | 'too_large';

export const BLOCKER_TEXTS: Readonly<Record<ExportBlocker, string>> = {
  not_ready: 'Ses médias sont encore vérifiés : l’archive arrive dès qu’ils sont tous gardés.',
  moment_unknown:
    'Demandé avant que le moment de tournage soit fixé : son archive ne devine pas s’il est de jour ou de nuit.',
  too_large: 'Ses médias pèsent plus de 4\u00a0Go : ils ne tiennent pas dans une seule archive.',
};

export interface SentScriptRow {
  readonly dropId: ContentDropId;
  /** « S012 », the name of its folder in Reveal. */
  readonly code: string;
  readonly number: number;
  /** Its structure's name; `null` when the library no longer lists it. */
  readonly name: string | null;
  readonly moment: ShotMoment | null;
  readonly photos: number;
  readonly videos: number;
  readonly bytes: number;
  readonly sentAt: string;
  readonly blocker: ExportBlocker | null;
  readonly exportedAt: string | null;
  /** When her originals go at the latest: 30 days after the copy is confirmed (ADR 0044 § 2). */
  readonly originalsUntil: string | null;
}

const NBSP = '\u00a0';

const READY_STATES: ReadonlySet<ContentDrop['state']> = new Set(['ready', 'scheduled', 'published']);
const AFTER_EXPORT_MS = 30 * 86_400_000;

export const scriptCode = (number: number): string => scriptDropCode(number);

/** Her sent scripts, the latest first: a drop with a number is a script she sent, never one she is filling. */
export function sentScripts(
  content: CreatorContent,
  structures: readonly ScriptStructure[],
): readonly SentScriptRow[] {
  const requests = new Map(content.requests.map((request) => [request.id, request]));
  const library = new Map(structures.map((structure) => [structure.id, structure]));
  return content.drops
    .flatMap((drop) => {
      if (drop.scriptNumber === null || drop.state === 'withdrawn') return [];
      const request = drop.requestId === null ? undefined : requests.get(drop.requestId);
      const structure = request?.structureId == null ? undefined : library.get(request.structureId);
      const ownMoment = structure?.current.moment;
      // The moment its request fixed (« ok alternance »); before it, its structure's, never guessed for « both ».
      const moment = request?.moment ?? (ownMoment === 'day' || ownMoment === 'night' ? ownMoment : null);
      const kept = drop.files.filter((file) => file.slotKey !== null && file.state !== 'refused');
      const bytes = kept.reduce((total, file) => total + file.bytes, 0);
      const blocker: ExportBlocker | null = !READY_STATES.has(drop.state)
        ? 'not_ready'
        : moment === null
          ? 'moment_unknown'
          : bytes > SCRIPT_EXPORT_MAX_BYTES
            ? 'too_large'
            : null;
      return [
        {
          dropId: drop.id,
          code: scriptCode(drop.scriptNumber),
          number: drop.scriptNumber,
          name: structure?.current.name ?? null,
          moment,
          photos: kept.filter((file) => file.kind === 'image').length,
          videos: kept.filter((file) => file.kind === 'video').length,
          bytes,
          sentAt: drop.createdAt,
          blocker,
          exportedAt: drop.exportedAt,
          originalsUntil:
            drop.exportedAt === null
              ? null
              : new Date(Date.parse(drop.exportedAt) + AFTER_EXPORT_MS).toISOString(),
        },
      ];
    })
    .sort((a, b) => b.number - a.number);
}

/** « 3 photos · 1 vidéo · 1,2 Go » */
export function mediaLine(row: Pick<SentScriptRow, 'photos' | 'videos' | 'bytes'>): string {
  const parts = [
    ...(row.photos === 0 ? [] : [row.photos === 1 ? '1 photo' : `${String(row.photos)} photos`]),
    ...(row.videos === 0 ? [] : [row.videos === 1 ? '1 vidéo' : `${String(row.videos)} vidéos`]),
  ];
  return [...(parts.length === 0 ? ['Aucun média'] : parts), weightOf(row.bytes)].join(' · ');
}

function weightOf(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1).replace('.', ',')}${NBSP}Go`;
  return `${String(Math.max(1, Math.round(bytes / 1_000_000)))}${NBSP}Mo`;
}

/** « 6 novembre », in her time zone, never broken between the day and its month. */
export const dayLabel = (iso: string, timezone: string): string =>
  new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: timezone })
    .format(new Date(iso))
    .replace(' ', NBSP);
