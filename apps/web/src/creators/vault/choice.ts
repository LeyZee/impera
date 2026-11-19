import {
  VAULT_DESCRIBE_COST_TENTHS,
  VAULT_DESCRIBE_MAX,
  type VaultChoicesView,
  type VaultDescriptionState,
  type VaultFolderView,
  type VaultMediaView,
  type VaultView,
} from '@impera/contracts';

/*
 * The vault by choice (ADR 0145 § 5, amendment of 17/11): what of her vault enters the CRM, ticked by the owner, and
 * what is described, on her request with its cost said first. Pure rules here: the page lays them out.
 */

/** Where one media stands: imported or not, and its description. */
export interface MediaChoice {
  readonly imported: boolean;
  readonly description: VaultDescriptionState;
  readonly excerpt: string | null;
}

/** A media the choices do not list yet (a sync just read it): not imported, never described. */
const UNCHOSEN: MediaChoice = { imported: false, description: 'none', excerpt: null };

const mediaKey = (account: string, mediaId: string): string => `${account}:${mediaId}`;
const folderKey = (account: string, folderRef: string | null): string => `${account}:${folderRef ?? ''}`;

/** The choices, read by media and by folder. */
export interface ChoiceIndex {
  readonly media: ReadonlyMap<string, MediaChoice>;
  readonly folders: ReadonlyMap<string, boolean>;
}

export function choiceIndex(view: VaultChoicesView | undefined): ChoiceIndex {
  return {
    media: new Map(
      (view?.media ?? []).map((each) => [
        mediaKey(each.platformAccountId, each.platformMediaId),
        { imported: each.imported, description: each.description, excerpt: each.excerpt },
      ]),
    ),
    folders: new Map(
      (view?.folders ?? []).map((each) => [folderKey(each.platformAccountId, each.folderRef), each.imported]),
    ),
  };
}

/** One media's choice; a media the choices do not list yet follows its folder's tick, never described. */
export function choiceOf(
  index: ChoiceIndex,
  folder: Pick<VaultFolderView, 'platformAccountId' | 'folderRef'>,
  media: Pick<VaultMediaView, 'platformMediaId'>,
): MediaChoice {
  const listed = index.media.get(mediaKey(folder.platformAccountId, media.platformMediaId));
  if (listed !== undefined) return listed;
  const ticked = index.folders.get(folderKey(folder.platformAccountId, folder.folderRef)) ?? false;
  return ticked ? { ...UNCHOSEN, imported: true } : UNCHOSEN;
}

/**
 * The folders as the rail lists them: in the platform's order, the vault's root last, an ordinary folder there, never
 * « Tout ».
 */
export function railFolders(view: VaultView): VaultFolderView[] {
  return [
    ...view.folders.filter((folder) => folder.folderRef !== null),
    ...view.folders.filter((folder) => folder.folderRef === null),
  ];
}

/** A folder's tick: none of its media imported, some, or all. */
export type FolderTick = 'none' | 'some' | 'all';

export interface FolderCount {
  readonly tick: FolderTick;
  /** Still listed by the platform, the only ones counted. */
  readonly listed: number;
  readonly imported: number;
  readonly described: number;
}

export function folderCount(index: ChoiceIndex, folder: VaultFolderView): FolderCount {
  const listed = folder.media.filter((each) => !each.removed);
  const choices = listed.map((each) => choiceOf(index, folder, each));
  const imported = choices.filter((each) => each.imported).length;
  const described = choices.filter((each) => each.imported && each.description === 'described').length;
  // An empty folder says its own tick: what the next sync brings into it follows it.
  const empty =
    index.folders.get(folderKey(folder.platformAccountId, folder.folderRef)) === true ? 'all' : 'none';
  const tick: FolderTick =
    listed.length === 0 ? empty : imported === 0 ? 'none' : imported === listed.length ? 'all' : 'some';
  return { tick, listed: listed.length, imported, described };
}

/** « 3 sur 12 importés », « Aucun importé sur 12 », « Les 12 importés », « Vide ». */
export function importLine(count: Pick<FolderCount, 'listed' | 'imported'>): string {
  if (count.listed === 0) return 'Vide';
  if (count.imported === 0) return `Aucun importé sur ${String(count.listed)}`;
  if (count.imported === count.listed)
    return count.listed === 1 ? 'Importé' : `Les ${String(count.listed)} importés`;
  return `${String(count.imported)} sur ${String(count.listed)} ${count.imported === 1 ? 'importé' : 'importés'}`;
}

/** The figures at the head of the vault: media still listed, imported, and described among those imported. */
export function choiceFigures(
  view: VaultView,
  index: ChoiceIndex,
): { readonly listed: number; readonly imported: number; readonly described: number } {
  return view.folders
    .map((folder) => folderCount(index, folder))
    .reduce(
      (sum, count) => ({
        listed: sum.listed + count.listed,
        imported: sum.imported + count.imported,
        described: sum.described + count.described,
      }),
      { listed: 0, imported: 0, described: 0 },
    );
}

/** The filters above the grid, four at most: they add up (« Photos » and « Non décrits »: the photos not described). */
export const VAULT_FILTERS = ['photos', 'videos', 'undescribed', 'unimported'] as const;
export type VaultFilter = (typeof VAULT_FILTERS)[number];
export const FILTER_NAMES: Record<VaultFilter, string> = {
  photos: 'Photos',
  videos: 'Vidéos',
  undescribed: 'Non décrits',
  unimported: 'Non importés',
};

/** The media a folder shows under the filters on, in the platform's order. Photos and Vidéos together: both kinds. */
export function filteredMedia(
  folder: VaultFolderView,
  index: ChoiceIndex,
  filters: ReadonlySet<VaultFilter>,
): VaultMediaView[] {
  const kinds = new Set<VaultMediaView['kind']>([
    ...(filters.has('photos') ? (['image'] as const) : []),
    ...(filters.has('videos') ? (['video'] as const) : []),
  ]);
  return folder.media.filter((media) => {
    if (kinds.size > 0 && !kinds.has(media.kind)) return false;
    const choice = choiceOf(index, folder, media);
    if (filters.has('undescribed') && choice.description === 'described') return false;
    if (filters.has('unimported') && choice.imported) return false;
    return true;
  });
}

/** A media can be picked while the platform still lists it: one it removed is kept, never imported again. */
export const selectable = (media: Pick<VaultMediaView, 'removed'>): boolean => !media.removed;

/** One media ticked or unticked in the selection (a filter on or off, alike). */
export function toggled<T>(selected: ReadonlySet<T>, id: T): Set<T> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Shift and a click: every media from the last one clicked to this one, in the order shown, joins the selection. Without
 * a last one, or one the filters hid since, only this one.
 */
export function rangeSelected(
  selected: ReadonlySet<string>,
  order: readonly string[],
  anchor: string | null,
  id: string,
): Set<string> {
  const from = anchor === null ? -1 : order.indexOf(anchor);
  const to = order.indexOf(id);
  if (from < 0 || to < 0) return toggled(selected, id);
  const [start, end] = from <= to ? [from, to] : [to, from];
  return new Set([...selected, ...order.slice(start, end + 1)]);
}

/** « Tout sélectionner dans ce dossier »: every media shown that can be picked; again, none. */
export function allToggled(selected: ReadonlySet<string>, shown: readonly string[]): Set<string> {
  const every = shown.length > 0 && shown.every((id) => selected.has(id));
  if (every) return new Set([...selected].filter((id) => !shown.includes(id)));
  return new Set([...selected, ...shown]);
}

/** « 1 média sélectionné », « 3 médias sélectionnés ». */
export const selectedLine = (count: number): string =>
  count === 1 ? '1 média sélectionné' : `${String(count)} médias sélectionnés`;

/** The media of these that a description would be asked for: imported, still listed, a photo or a video, never asked. */
export function describable(
  folder: VaultFolderView,
  index: ChoiceIndex,
  ids: ReadonlySet<string>,
): VaultMediaView[] {
  return folder.media.filter((media) => {
    if (!ids.has(media.platformMediaId) || media.removed || media.kind === 'audio') return false;
    const choice = choiceOf(index, folder, media);
    return choice.imported && choice.description === 'none';
  });
}

/**
 * What « Décrire par IA » would cost for these media, said on its button before any call, at the server's own figures.
 * The server counts again and decides.
 */
export function describeEstimate(
  folder: VaultFolderView,
  index: ChoiceIndex,
  ids: ReadonlySet<string>,
): { readonly count: number; readonly costCents: number } {
  const media = describable(folder, index, ids);
  const tenths = media.reduce(
    (sum, each) =>
      sum + (each.kind === 'video' ? VAULT_DESCRIBE_COST_TENTHS.video : VAULT_DESCRIBE_COST_TENTHS.image),
    0,
  );
  return { count: media.length, costCents: Math.ceil(tenths / 10) };
}

/** At most this many media in one request: a larger selection is asked in turns, never cut silently. */
export const DESCRIBE_AT_ONCE = VAULT_DESCRIBE_MAX;

const EUROS = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
});
/** « 0,03 € », « 1,20 € »: euro cents always, the cost of a description being a few of them. */
export const centsLine = (cents: number): string => EUROS.format(cents / 100);

/** A media's description as the grid says it under its tile, `null` when there is nothing to say. */
export function descriptionLine(choice: MediaChoice): {
  readonly text: string;
  readonly tone: 'described' | 'muted' | 'warn';
} {
  switch (choice.description) {
    case 'described':
      return { text: choice.excerpt ?? 'Décrit', tone: 'described' };
    case 'asked':
      return {
        text: choice.imported ? 'Description en cours' : 'Description à l’import',
        tone: 'muted',
      };
    case 'to_agency':
      return { text: 'Illisible par l’IA : à décrire par l’agence', tone: 'warn' };
    case 'none':
      return { text: choice.imported ? 'Pas encore décrit' : 'Non importé', tone: 'muted' };
  }
}

/** A run of descriptions asked from this page: how far it went, read on the choices. */
export function describeProgress(
  batch: readonly string[],
  folder: VaultFolderView | undefined,
  index: ChoiceIndex,
): { readonly done: number; readonly total: number } {
  if (folder === undefined) return { done: 0, total: batch.length };
  const ids = new Set(batch);
  const done = folder.media.filter((media) => {
    if (!ids.has(media.platformMediaId)) return false;
    const state = choiceOf(index, folder, media).description;
    return state === 'described' || state === 'to_agency';
  }).length;
  return { done, total: batch.length };
}

/** « Descriptions : 5 sur 8 », then « 8 médias décrits ». */
export function progressLine(progress: { readonly done: number; readonly total: number }): string {
  if (progress.done >= progress.total)
    return progress.total === 1 ? '1 média décrit' : `${String(progress.total)} médias décrits`;
  return `Descriptions : ${String(progress.done)} sur ${String(progress.total)}`;
}

/** The grid's groups, said once by their title instead of a mark on every tile. */
export type MediaGroupKey = 'in' | 'out' | 'gone';
export const GROUP_NAMES: Record<MediaGroupKey, string> = {
  in: 'Importés',
  out: 'Dans Reveal seulement',
  gone: 'Retirés de Reveal',
};

/**
 * The media shown, in groups: imported, then those Reveal lists that are not, then those Reveal no longer lists; each in
 * the platform's order, an empty group left out. Their order, one after the other, is the order shown.
 */
export function mediaGroups(
  folder: VaultFolderView,
  index: ChoiceIndex,
  shown: readonly VaultMediaView[],
): { readonly key: MediaGroupKey; readonly media: VaultMediaView[] }[] {
  const keyOf = (media: VaultMediaView): MediaGroupKey =>
    media.removed ? 'gone' : choiceOf(index, folder, media).imported ? 'in' : 'out';
  return (['in', 'out', 'gone'] as const)
    .map((key) => ({ key, media: shown.filter((media) => keyOf(media) === key) }))
    .filter((group) => group.media.length > 0);
}

/** « 16 importés sur 40 · 5 décrits sur 16 », « Aucun média importé sur 40 ». */
export function summaryLine(figures: {
  readonly listed: number;
  readonly imported: number;
  readonly described: number;
}): string {
  if (figures.imported === 0) return `Aucun média importé sur ${String(figures.listed)}`;
  const imported = `${String(figures.imported)} ${figures.imported === 1 ? 'importé' : 'importés'} sur ${String(figures.listed)}`;
  const described =
    figures.described === 0
      ? 'aucun décrit'
      : `${String(figures.described)} ${figures.described === 1 ? 'décrit' : 'décrits'} sur ${String(figures.imported)}`;
  return `${imported} · ${described}`;
}
