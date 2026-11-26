import { CreatorIdSchema, type CreatorId, type Me } from '@impera/contracts';
import { useSyncExternalStore } from 'react';

/**
 * The tab of a creator's sheet, the view inside it and the creator picked, in the address
 * (`?onglet=medias&vue=depots&creatrice=<id>`), so that a link, a reload or a step back lands on the same view of the
 * same creator (lessons of #217 and of the recette 28/10). Seven tabs (ADR 0149 § 1 and § 5); the addresses of the
 * eleven tabs before them are read by `legacyCreatorsSearch` and redirected.
 */
export interface CreatorsSearch {
  readonly onglet?: 'persona' | 'ia' | 'medias' | 'scripts' | 'agenda' | 'alertes' | 'compte';
  /** The view inside the tab; the tab's first view leaves it out. */
  readonly vue?: 'depots' | 'a-copier' | 'structures' | 'sur-mesure' | 'idees' | 'demandes';
  readonly creatrice?: CreatorId;
  /**
   * The vault folder opened in Médias (`dossier`, its platform id, `racine` for the vault's root): one the last sync no
   * longer lists shows the folders. Kept by nothing else: a tab or a creator changed leaves it out.
   */
  readonly dossier?: string;
}

/** The seven tabs of a creator's sheet, in their order (ADR 0149 § 1). Her links are Trafic's (`/trafic`). */
export const CREATOR_TABS = ['persona', 'ai', 'media', 'scripts', 'agenda', 'alerts', 'account'] as const;
export type CreatorTabName = (typeof CREATOR_TABS)[number];

/**
 * What a creator's sheet shows, one at a time: a whole tab (her persona, her AI, her alerts, her account)
 * or one view of a tab (her vault or her drops in Médias; her scripts in preparation, what is to copy into Reveal, the agency's
 * structures or her made-to-measure prices in Scripts; her agenda, her ideas of the day or what the agency asks of her in Agenda). The four subjects of Compte are one page:
 * each names its card there.
 */
export type CreatorSheet =
  | 'persona'
  | 'hours'
  | 'vault'
  | 'content'
  | 'scripts'
  | 'copy'
  | 'structures'
  | 'custom'
  | 'agenda'
  | 'ideas'
  | 'requests'
  | 'alerts'
  | 'telegram'
  | 'access'
  | 'rate'
  | 'profile';

const TAB_OF: Readonly<Record<CreatorSheet, CreatorTabName>> = {
  persona: 'persona',
  hours: 'ai',
  vault: 'media',
  content: 'media',
  scripts: 'scripts',
  copy: 'scripts',
  structures: 'scripts',
  custom: 'scripts',
  agenda: 'agenda',
  ideas: 'agenda',
  requests: 'agenda',
  alerts: 'alerts',
  telegram: 'account',
  access: 'account',
  rate: 'account',
  profile: 'account',
};

/** The tab a sheet lives in. */
export const tabOf = (sheet: CreatorSheet): CreatorTabName => TAB_OF[sheet];

const TAB_SLUGS = {
  persona: 'persona',
  ai: 'ia',
  media: 'medias',
  scripts: 'scripts',
  agenda: 'agenda',
  alerts: 'alertes',
  account: 'compte',
} as const;

/** The view a sheet is inside its tab, in the address; a tab's first view, and a tab of one page, have none. */
const VIEW_SLUGS: Partial<Readonly<Record<CreatorSheet, NonNullable<CreatorsSearch['vue']>>>> = {
  content: 'depots',
  copy: 'a-copier',
  structures: 'structures',
  custom: 'sur-mesure',
  ideas: 'idees',
  requests: 'demandes',
};

/** The card of Compte a sheet is, as the fragment of its address (`#part`). */
const ACCOUNT_CARDS: Partial<Readonly<Record<CreatorSheet, string>>> = {
  telegram: 'telegram',
  access: 'acces',
  rate: 'part',
  profile: 'profil',
};

/** The id of a sheet's card on the page of Compte; none for a sheet that is not one of its cards. */
export const accountCardId = (sheet: CreatorSheet): string | undefined => ACCOUNT_CARDS[sheet];

const ALL_SHEETS: readonly CreatorSheet[] = [
  'persona',
  'hours',
  'vault',
  'content',
  'scripts',
  'copy',
  'structures',
  'custom',
  'agenda',
  'ideas',
  'requests',
  'alerts',
  'access',
  'rate',
  'profile',
  'telegram',
];

/**
 * The sheets a member opens: all of them for the owner; for an active manager her vault and her other drops (recette
 * créatrice 1), her sent scripts (SC-03 c2b), her agenda (CR-05 lot c, Charles, 05/11 17h22: « Ouvrir aux managers »),
 * her ideas of the day (VEI-02, ADR 0060 § 5), what the agency asks of her (MED-09) and her persona to read, never
 * to change (trou béant 18, Charles 21/11: « lecture seule pour le manager actif »); the persona alone for anyone
 * else. Her redirect links are no sheet: Trafic holds them. The first one is where Créatrices opens: her
 * persona for the owner, Médias for an active manager (ADR 0149 § 1).
 */
export function sheetsFor(user: Pick<Me, 'role' | 'teamScope'>): readonly CreatorSheet[] {
  if (user.role === 'owner') return ALL_SHEETS;
  return user.teamScope === 'agency'
    ? ['vault', 'content', 'scripts', 'copy', 'agenda', 'ideas', 'requests', 'persona']
    : ['persona'];
}

/** Longest folder id read in the address: longer, none. */
const FOLDER_ID_MAX = 200;

const TABS_READ: readonly unknown[] = Object.values(TAB_SLUGS);

const isTabSlug = (value: unknown): value is NonNullable<CreatorsSearch['onglet']> =>
  TABS_READ.includes(value);

/** The views each tab reads; another one reads as the tab's first view. */
const VIEWS_OF: Partial<
  Readonly<Record<NonNullable<CreatorsSearch['onglet']>, readonly NonNullable<CreatorsSearch['vue']>[]>>
> = {
  medias: ['depots'],
  scripts: ['a-copier', 'structures', 'sur-mesure'],
  agenda: ['idees', 'demandes'],
};

/**
 * Anything but a known tab reads as the persona; anything but a view of that tab, as its first view; anything but a
 * creator id, as no creator picked; a folder only on the vault, as a short non-empty text.
 */
export function parseCreatorsSearch(search: Record<string, unknown>): CreatorsSearch {
  const creator = CreatorIdSchema.safeParse(search['creatrice']);
  const folder = search['dossier'];
  const tab = isTabSlug(search['onglet']) ? search['onglet'] : undefined;
  const view = tab === undefined ? undefined : VIEWS_OF[tab]?.find((one) => one === search['vue']);
  return {
    ...(tab === undefined ? {} : { onglet: tab }),
    ...(view === undefined ? {} : { vue: view }),
    ...(creator.success ? { creatrice: creator.data } : {}),
    ...(tab === TAB_SLUGS.media &&
    view === undefined &&
    typeof folder === 'string' &&
    folder.trim() !== '' &&
    folder.length <= FOLDER_ID_MAX
      ? { dossier: folder }
      : {}),
  };
}

/** The sheet an address opens; Compte (`compte`) is one page, named by its last card. */
export function sheetOf(search: CreatorsSearch): CreatorSheet {
  const { onglet: tab, vue: view } = search;
  if (tab === undefined || tab === 'persona') return 'persona';
  if (tab === 'ia') return 'hours';
  if (tab === 'medias') return view === 'depots' ? 'content' : 'vault';
  if (tab === 'scripts')
    return view === 'a-copier'
      ? 'copy'
      : view === 'structures'
        ? 'structures'
        : view === 'sur-mesure'
          ? 'custom'
          : 'scripts';
  if (tab === 'agenda') return view === 'idees' ? 'ideas' : view === 'demandes' ? 'requests' : 'agenda';
  return tab === 'alertes' ? 'alerts' : 'profile';
}

/**
 * The address of a sheet: the persona leaves `onglet` out, a tab's first view leaves `vue` out, no creator leaves
 * `creatrice` out, no folder (or another sheet than her vault) leaves `dossier` out.
 */
export function creatorsSearch(
  sheet: CreatorSheet,
  creatorId: CreatorId | null,
  folderId: string | null = null,
): CreatorsSearch {
  const tab = TAB_OF[sheet];
  const view = VIEW_SLUGS[sheet];
  return {
    ...(tab === 'persona' ? {} : { onglet: TAB_SLUGS[tab] }),
    ...(view === undefined ? {} : { vue: view }),
    ...(creatorId === null ? {} : { creatrice: creatorId }),
    ...(sheet === 'vault' && folderId !== null ? { dossier: folderId } : {}),
  };
}

/**
 * A sheet's address for this member: her persona is named (`onglet=persona`) when this member's sheet opens elsewhere
 * (an active manager lands on Médias, ADR 0149 § 1), since an address with no tab sends them there (trou béant 18).
 */
export function sheetSearch(
  sheets: readonly CreatorSheet[],
  sheet: CreatorSheet,
  creatorId: CreatorId | null,
): CreatorsSearch {
  const search = creatorsSearch(sheet, creatorId);
  return sheet === 'persona' && sheets[0] !== 'persona' ? { ...search, onglet: 'persona' } : search;
}

/** The tabs before the seven (ADR 0149 § 5), and the sheet each one became. */
const LEGACY_SHEETS: Readonly<Record<string, CreatorSheet>> = {
  heures: 'hours',
  idees: 'ideas',
  demandes: 'requests',
  'sur-mesure': 'custom',
  contenu: 'content',
  telegram: 'telegram',
  acces: 'access',
  pourcentage: 'rate',
  profil: 'profile',
};

/**
 * Where an address of the tabs before the seven leads now, the creator kept: `heures` to IA; `idees` and `demandes` to
 * their view of Agenda; `contenu` to Médias › Dépôts; `sur-mesure` to its view of Scripts; `telegram`, `acces`, `pourcentage` and `profil` to their card of
 * Compte; `scripts` with a `dossier` to that folder of her vault in Médias. Null for an address of today.
 */
export function legacyCreatorsSearch(
  search: Record<string, unknown>,
): { readonly search: CreatorsSearch; readonly hash?: string } | null {
  const creator = CreatorIdSchema.safeParse(search['creatrice']);
  const creatorId = creator.success ? creator.data : null;
  const tab = search['onglet'];
  if (typeof tab !== 'string') return null;
  const folder = search['dossier'];
  if (
    tab === 'scripts' &&
    typeof folder === 'string' &&
    folder.trim() !== '' &&
    folder.length <= FOLDER_ID_MAX
  )
    return { search: creatorsSearch('vault', creatorId, folder) };
  const sheet = Object.hasOwn(LEGACY_SHEETS, tab) ? LEGACY_SHEETS[tab] : undefined;
  if (sheet === undefined) return null;
  const hash = ACCOUNT_CARDS[sheet];
  return { search: creatorsSearch(sheet, creatorId), ...(hash === undefined ? {} : { hash }) };
}

/**
 * The tab of her sheet left open last, kept on the device: Créatrices opens the chosen creator's sheet where one left
 * it (ADR 0149 § 2). A view inside the tab is not kept: the tab opens on its first one.
 */
const LAST_TAB_KEY = 'impera.creator-tab';

const listeners = new Set<() => void>();

function keptTab(): string | null {
  try {
    return localStorage.getItem(LAST_TAB_KEY);
  } catch {
    // Refused (private window, blocked site data): Créatrices opens on the first tab.
    return null;
  }
}

/** Remembers the tab of the sheet on screen, and tells the menu, whose link follows it. */
export function rememberCreatorTab(sheet: CreatorSheet): void {
  if (keptTab() === TAB_OF[sheet]) return;
  try {
    localStorage.setItem(LAST_TAB_KEY, TAB_OF[sheet]);
  } catch {
    return;
  }
  for (const listener of listeners) listener();
}

/** The first sheet of the tab left open last that this member opens; none kept, or one no longer theirs, is none. */
export function rememberedSheet(sheets: readonly CreatorSheet[]): CreatorSheet | undefined {
  const kept = keptTab();
  return sheets.find((sheet) => TAB_OF[sheet] === kept);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `rememberedSheet`, followed: the menu's link changes as soon as another tab of her sheet is on screen. */
export function useRememberedSheet(sheets: readonly CreatorSheet[]): CreatorSheet | undefined {
  const kept = useSyncExternalStore(subscribe, keptTab, () => null);
  return sheets.find((sheet) => TAB_OF[sheet] === kept);
}
