import type { VaultFolderView, VaultView } from '@impera/contracts';

/*
 * Créatrices › Scripts › « Son coffre Reveal » (ADR 0099 §§ 2-4): her vault as the last sync read it, and the owner's
 * « Synchroniser le coffre ». Pure rules here, so that the card only lays them out and the tests read them.
 */

/** « Synchronisé à l’instant », « il y a 12 min », « il y a 3 h », « il y a 2 j »; « Jamais synchronisé » before a first. */
export function syncedLine(syncedAt: string | null, now: Date): string {
  if (syncedAt === null) return 'Jamais synchronisé';
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(syncedAt).getTime()) / 60_000));
  if (minutes < 1) return 'Synchronisé à l’instant';
  if (minutes < 60) return `Synchronisé il y a ${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synchronisé il y a ${String(hours)} h`;
  return `Synchronisé il y a ${String(Math.floor(hours / 24))} j`;
}

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`;

/** « 12 photos · 3 vidéos · 1 vocal », what is still listed by Reveal; « Vide » when nothing. */
export function mediaLine(media: VaultFolderView['media']): string {
  const listed = media.filter((each) => !each.removed);
  const parts = [
    [listed.filter((each) => each.kind === 'image').length, 'photo', 'photos'],
    [listed.filter((each) => each.kind === 'video').length, 'vidéo', 'vidéos'],
    [listed.filter((each) => each.kind === 'audio').length, 'vocal', 'vocaux'],
  ] as const;
  const said = parts.filter(([count]) => count > 0).map(([count, one, many]) => plural(count, one, many));
  return said.length === 0 ? 'Vide' : said.join(' · ');
}

/**
 * A folder « À classer »: named, but with neither ☀️ nor 🌙 in its name, so it does not say whether its media are of
 * the Day or the Night. The vault's root has no name to change: it is never one.
 */
const unmarked = (folder: VaultFolderView): boolean => folder.folderRef !== null && folder.moment === null;

/** One folder of her vault as the card lists it, in the platform's order, its name as Reveal gives it. */
export interface FolderRow {
  readonly key: string;
  readonly name: string;
  readonly unmarked: boolean;
  readonly line: string;
  /** No longer listed by Reveal at the last sync, kept with their descriptions. */
  readonly removed: number;
}

export function folderRows(view: VaultView): FolderRow[] {
  return view.folders.map((folder) => ({
    key: `${folder.platformAccountId}:${folder.folderRef ?? ''}`,
    name: folder.folderName ?? (folder.folderRef === null ? 'Racine du coffre' : 'Dossier sans nom'),
    unmarked: unmarked(folder),
    line: mediaLine(folder.media),
    removed: folder.media.filter((each) => each.removed).length,
  }));
}

/**
 * The folders shown before « Voir les N dossiers »: the first `count` in Reveal's order, and every folder à classer
 * wherever it stands, so that the figure « À classer » always points at lines on screen. When only one would stay
 * folded, all of them show: a button for one line is not worth it.
 */
export function foldedRows(rows: readonly FolderRow[], count: number): FolderRow[] {
  const shown = rows.filter((row, at) => at < count || row.unmarked);
  return rows.length - shown.length <= 1 ? [...rows] : shown;
}

/** The three figures at the head of the card: media still listed, folders, and those without ☀️ or 🌙 (« À classer »). */
export function vaultFigures(view: VaultView): {
  readonly media: number;
  readonly folders: number;
  readonly unmarked: number;
} {
  return {
    media: view.folders.reduce((sum, folder) => sum + folder.media.filter((each) => !each.removed).length, 0),
    folders: view.folders.length,
    unmarked: view.folders.filter(unmarked).length,
  };
}

/**
 * Where the owner's « Synchroniser le coffre » stands. `waiting`: asked, the page reads the vault again until the
 * sync went through (its `syncedAt` moves). `none`: no account of hers can be read now. `slow`: still nothing after
 * `SYNC_PATIENCE_MS`, the page keeps reading on its own.
 */
export type SyncPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'asking' }
  | { readonly kind: 'waiting'; readonly since: string | null; readonly askedAt: number }
  | { readonly kind: 'done' }
  | { readonly kind: 'none' }
  | { readonly kind: 'slow'; readonly since: string | null }
  | { readonly kind: 'failed' };

/** How long the card waits for a sync before saying it takes longer than usual. */
export const SYNC_PATIENCE_MS = 120_000;
/** How often the vault is read again while a sync is waited for. */
export const SYNC_POLL_MS = 3_000;

/** The phase once the vault read again says `syncedAt`, at `now` (ms). */
export function phaseAfterRead(phase: SyncPhase, syncedAt: string | null, now: number): SyncPhase {
  if (phase.kind !== 'waiting' && phase.kind !== 'slow') return phase;
  if (syncedAt !== null && syncedAt !== phase.since) return { kind: 'done' };
  if (phase.kind === 'waiting' && now - phase.askedAt >= SYNC_PATIENCE_MS)
    return { kind: 'slow', since: phase.since };
  return phase;
}

/** Whether the card reads the vault again on its own. */
export const polls = (phase: SyncPhase): boolean => phase.kind === 'waiting' || phase.kind === 'slow';

/** What the card says under its button, `null` when nothing. */
export function phaseLine(
  phase: SyncPhase,
): { readonly text: string; readonly tone: 'muted' | 'ok' | 'warn' } | null {
  switch (phase.kind) {
    case 'waiting':
      return {
        text: 'Impera relit son coffre dans Reveal : la carte se met à jour toute seule.',
        tone: 'muted',
      };
    case 'slow':
      return {
        text: 'La synchro prend plus de temps que d’habitude. La carte se met à jour toute seule.',
        tone: 'muted',
      };
    case 'done':
      return { text: 'Coffre à jour.', tone: 'ok' };
    case 'none':
      return {
        text: 'Aucun compte Reveal lisible pour l’instant : reconnecte sa session depuis l’extension, puis réessaie.',
        tone: 'warn',
      };
    case 'failed':
      return { text: 'La synchro n’a pas pu partir : réessaie dans un instant.', tone: 'warn' };
    case 'idle':
    case 'asking':
      return null;
  }
}
