import type { VaultFolderView, VaultMediaView, VaultView } from '@impera/contracts';

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

/** The value of `dossier` in the address for a folder: its platform id, `racine` for the vault's root. */
export const ROOT_FOLDER_ID = 'racine';
export const folderIdOf = (folder: Pick<VaultFolderView, 'folderRef'>): string =>
  folder.folderRef ?? ROOT_FOLDER_ID;

/**
 * The folder an address opens; `null` when it names none, or one the last sync no longer lists: the card then shows
 * the folders, never an error.
 */
export function findFolder(view: VaultView, id: string | null): VaultFolderView | null {
  if (id === null) return null;
  return view.folders.find((folder) => folderIdOf(folder) === id) ?? null;
}

/** A folder's name as the card shows it: Reveal's, or what stands for it. */
export const folderName = (folder: Pick<VaultFolderView, 'folderName' | 'folderRef'>): string =>
  folder.folderName ?? (folder.folderRef === null ? 'Racine du coffre' : 'Dossier sans nom');

/** One folder of her vault as the card shows it, in the platform's order, its name as Reveal gives it. */
export interface FolderTile {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly moment: VaultFolderView['moment'];
  readonly unmarked: boolean;
  readonly line: string;
  /** No longer listed by Reveal at the last sync, kept with their descriptions. */
  readonly removed: number;
  /** Its first media still listed, at most four, for the tile's cover: a voice note has no picture, only its wave. */
  readonly cover: readonly CoverItem[];
}

export interface CoverItem {
  readonly kind: VaultMediaView['kind'];
  readonly hash: string | null;
  readonly seed: string;
}

/**
 * A tile's one line: the detail while it holds two kinds at most (« 6 photos · 2 vidéos »), the total beyond
 * (« 12 médias »), so it never runs out of room; the detail is in the folder.
 */
export function tileLine(media: VaultFolderView['media']): string {
  const listed = media.filter((each) => !each.removed);
  const kinds = new Set(listed.map((each) => each.kind)).size;
  return kinds <= 2 ? mediaLine(media) : plural(listed.length, 'média', 'médias');
}

/** How many previews make a folder's cover. */
const COVER = 4;

export function folderTiles(view: VaultView): FolderTile[] {
  return view.folders.map((folder) => ({
    id: folderIdOf(folder),
    key: `${folder.platformAccountId}:${folder.folderRef ?? ''}`,
    name: folderName(folder),
    moment: folder.moment,
    unmarked: unmarked(folder),
    line: tileLine(folder.media),
    removed: folder.media.filter((each) => each.removed).length,
    cover: folder.media
      .filter((each) => !each.removed)
      .slice(0, COVER)
      .map((each) => ({ kind: each.kind, hash: each.blurhash, seed: each.platformMediaId })),
  }));
}

/** « 1 retiré de Reveal », « 3 retirés de Reveal »; `null` when none. */
export const removedLine = (count: number): string | null =>
  count === 0 ? null : `${String(count)} ${count === 1 ? 'retiré' : 'retirés'} de Reveal`;

/** A folder's whole line: what Reveal still lists, then what it removed (« 9 photos · 1 vocal · 1 retiré de Reveal »). */
export function folderLine(media: VaultFolderView['media']): string {
  const removed = removedLine(media.filter((each) => each.removed).length);
  const listed = mediaLine(media);
  if (removed === null) return listed;
  return listed === 'Vide' ? removed : `${listed} · ${removed}`;
}

/**
 * The bars of a voice note's drawn wave, each from 0.2 to 1: Reveal gives no wave, so it is drawn from the media's id,
 * the same for the same note on every screen. A picture of a sound, never its sound.
 */
export function waveOf(seed: string, bars: number): number[] {
  let state = 2166136261;
  for (let at = 0; at < seed.length; at += 1) state = Math.imul(state ^ seed.charCodeAt(at), 16777619) >>> 0;
  const heights: number[] = [];
  for (let at = 0; at < bars; at += 1) {
    state = Math.imul(state ^ (state >>> 15), 2246822507) >>> 0;
    state = Math.imul(state ^ (state >>> 13), 3266489909) >>> 0;
    state = (state ^ (state >>> 16)) >>> 0;
    // A voice swells in the middle: an envelope over the noise, so the wave reads as speech, not as static.
    const envelope = Math.sin((Math.PI * (at + 0.5)) / bars);
    heights.push(Math.round((0.2 + 0.8 * envelope * (0.45 + 0.55 * (state / 4294967295))) * 100) / 100);
  }
  return heights;
}

/** « 0:42 », « 12:05 », « 1:02:09 »: a video's or a voice note's length. */
export function durationLine(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const two = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${String(h)}:${two(m)}:${two(s)}` : `${String(m)}:${two(s)}`;
}

const KIND_NAMES = { image: 'Photo', video: 'Vidéo', audio: 'Vocal' } as const;

/** « Photo », « Vidéo · 0:42 »: what a media is, as its tile and its sheet name it. */
export function mediaKindLine(media: Pick<VaultMediaView, 'kind' | 'durationSeconds'>): string {
  const name = KIND_NAMES[media.kind];
  return media.kind === 'image' || media.durationSeconds === null
    ? name
    : `${name} · ${durationLine(media.durationSeconds)}`;
}

const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** « Ajouté le 12 novembre 2026 », in the reader's own time zone. */
export const uploadedLine = (uploadedAt: string): string => `Ajouté le ${DAY.format(new Date(uploadedAt))}`;

const WHOLE = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});
const CENTS = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
});
/** « 10 € », « 25,50 € »: cents only when there are some. */
const euros = (minor: number): string => (minor % 100 === 0 ? WHOLE : CENTS).format(minor / 100);

/** « 10 € – 25,50 € », Reveal's suggested range from its minor unit (cents); one figure when both ends meet. */
export function suggestedLine(range: NonNullable<VaultMediaView['suggestedPriceMinor']>): string {
  return range.min === range.max ? euros(range.min) : `${euros(range.min)} – ${euros(range.max)}`;
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
