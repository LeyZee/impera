import type {
  ContentStock,
  HerDay,
  DropCategory,
  StockCategory,
  StockDescriptionState,
  StockMedium,
  StockStanding,
} from '@impera/contracts';

import { DROP_OUTPUTS } from '@/screens/content/model';

/*
 * Coffre Impera (ADR 0163): what each category is for, its colour, where it goes out, and the sentences the screens
 * lead with. The numbers are the server's; only their reading is here.
 */

/** A category's name on the coffre: what she shoots, in her words. */
export const STOCK_NAMES: Readonly<Record<DropCategory, string>> = {
  feed_video: 'Vidéos du feed',
  feed_shoot: 'Séances boudoir',
  reveal_story: 'Stories Reveal',
  mass_dm: 'Relances (Mass DM)',
  script: 'Scripts',
  whale_gift: 'Cadeaux baleines',
  voice_beep: 'Vocal du bip',
  // Non-breaking spaces inside the quotes: the closing one never falls alone on a line (Design, 27/11).
  voice_real: 'Vocal «\u00a0bien réelle\u00a0»',
  sale_video: 'Vidéos à vendre',
  instagram_post: 'Photos Insta',
  instagram_reel: 'Reels Insta',
  instagram_story: 'Stories Insta',
  telegram_post: 'Telegram',
};

/** What it is for, in one sentence: the rhythm the agency asks and what it feeds. */
export const STOCK_USES: Readonly<Record<DropCategory, string>> = {
  feed_video: 'Une vidéo courte par jour sur le feed public. Le soir, la même part sur Telegram.',
  feed_shoot: 'Trois par semaine. Chaque séance nourrit les posts du feed, les relances et les cadeaux.',
  reveal_story: 'En bonus : sa story reprend la vidéo du feed, avec sa propre légende.',
  mass_dm: 'Les médias offerts des relances : jamais payants, trois par semaine et par fan au plus.',
  script: 'Ce que l’IA vend. Il en faut trois prêts.',
  whale_gift: 'Courts, inédits, jamais de nu. Offerts aux gros fans, jamais revendus.',
  voice_beep: 'Sa vraie voix, « laisse-moi un message après le bip », pour le fan qui la croit un robot.',
  voice_real: 'Un ou deux vocaux « je suis bien réelle », la preuve quand le doute reste.',
  sale_video: 'Des vidéos de côté, vendues hors scripts au prix de la grille.',
  instagram_post: 'Au moins deux posts par jour.',
  instagram_reel: 'Un Reel d’essai par jour, pour aller chercher de nouveaux abonnés.',
  instagram_story: 'Quatre par jour, dont une avec l’appel vers Reveal.',
  telegram_post: 'En bonus : la vidéo du feed part déjà le soir sur Telegram.',
};

/**
 * The same, as she reads it on her own coffre: to her, never of her (recette MOD-11). What only the agency weighs stays
 * in its words.
 */
export const HER_USES: Readonly<Record<DropCategory, string>> = {
  ...STOCK_USES,
  feed_video: 'Une vidéo courte par jour sur le fil public de Reveal : Impera la publie pour toi.',
  feed_shoot: 'Trois par semaine. Chaque séance nourrit tes posts du feed, tes relances et tes cadeaux.',
  reveal_story: 'En bonus : ta story reprend ta vidéo du feed, avec sa propre légende.',
  mass_dm: 'Les médias offerts de tes relances : jamais payants, trois par semaine et par fan au plus.',
  script: 'Ce que l’IA vend pour toi. Il en faut trois prêts.',
  whale_gift: 'Courts, inédits, jamais de nu. Offerts à tes plus gros fans, jamais revendus.',
  voice_beep: 'Ta vraie voix, « laisse-moi un message après le bip », pour le fan qui doute que ce soit toi.',
  voice_real: 'Un ou deux vocaux « je suis bien réelle », la preuve quand le doute reste.',
  sale_video: 'Des vidéos de côté, vendues hors scripts au prix de ta grille.',
  telegram_post: 'En bonus : ta vidéo du feed part déjà le soir sur Telegram.',
};

/** The rule the code holds for it, said beside its card; none for the categories without one. */
export const STOCK_RULES: Partial<Readonly<Record<DropCategory, string>>> = {
  feed_video: 'Jamais vers Instagram',
  feed_shoot: 'Jamais vers Instagram',
  reveal_story: 'Jamais vers Instagram',
  mass_dm: 'Offert, jamais revendu',
  script: 'Jamais offert',
  whale_gift: 'Jamais de nu, jamais revendu',
  voice_beep: 'Une fois par fan, jamais vendu',
  voice_real: 'Une fois par fan, jamais vendu',
  sale_video: 'Jamais offerte ni revendue deux fois',
};

/** Each category's colour: the design system's thirteen content hues, in their fixed order (Charles, 21/11). */
export const STOCK_COLOURS: Readonly<Record<DropCategory, string>> = {
  feed_video: 'var(--nv-content-1)',
  feed_shoot: 'var(--nv-content-2)',
  reveal_story: 'var(--nv-content-3)',
  mass_dm: 'var(--nv-content-4)',
  script: 'var(--nv-content-5)',
  whale_gift: 'var(--nv-content-6)',
  // The two voices in one family of sand, light then deep; what is sold as a video in green.
  voice_beep: 'var(--nv-content-12)',
  voice_real: 'var(--nv-content-13)',
  sale_video: 'var(--nv-content-11)',
  instagram_post: 'var(--nv-content-7)',
  instagram_reel: 'var(--nv-content-8)',
  instagram_story: 'var(--nv-content-9)',
  telegram_post: 'var(--nv-content-10)',
};

export const PLATFORM_NAMES: Readonly<Record<StockCategory['platform'], string>> = {
  reveal: 'Reveal',
  instagram: 'Instagram',
  telegram: 'Telegram',
};

const UNIT_WORDS: Readonly<Record<DropCategory, readonly [string, string]>> = {
  feed_video: ['vidéo', 'vidéos'],
  feed_shoot: ['séance', 'séances'],
  reveal_story: ['story', 'stories'],
  mass_dm: ['média', 'médias'],
  script: ['script', 'scripts'],
  whale_gift: ['cadeau', 'cadeaux'],
  voice_beep: ['vocal', 'vocaux'],
  voice_real: ['vocal', 'vocaux'],
  sale_video: ['vidéo', 'vidéos'],
  instagram_post: ['photo', 'photos'],
  instagram_reel: ['Reel', 'Reels'],
  instagram_story: ['story', 'stories'],
  telegram_post: ['post', 'posts'],
};

/** « 1 séance », « 3 séances ». */
export const unitsOf = (category: DropCategory, count: number): string =>
  `${String(count)} ${UNIT_WORDS[category][count > 1 ? 1 : 0]}`;

/** « 4 j », « 2,5 j », « 14 j + » past two weeks. */
export function daysLabel(days: number): string {
  if (days >= 14) return '14 j +';
  return `${days.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} j`;
}

/** Its pace in words: « 1 par jour », « 3 par semaine », « 4 au moins », « en bonus ». */
export function paceOf(category: StockCategory): string {
  if (category.mode === 'bonus') return 'En bonus';
  if (category.mode === 'count') return `${String(category.target ?? 0)} au moins`;
  const week = category.perWeek ?? 0;
  return week % 7 === 0 ? `${String(week / 7)} par jour` : `${String(week)} par semaine`;
}

/**
 * How full its gauge is, from 0 to 100: the days against the target, or the count against its minimum. Without a
 * target, full as soon as something is in, empty at nothing (recette MOD-11: never green at 0).
 */
export function fillOf(category: StockCategory): number {
  if (category.target === null || category.target === 0) return category.stockUnits > 0 ? 100 : 0;
  const value = category.mode === 'days' ? (category.daysAhead ?? 0) : category.stockUnits;
  return Math.min(100, Math.round((value / category.target) * 100));
}

/** The weekday a stock of so many days runs dry on, from today: « dimanche ». */
export function dryDay(days: number, now: Date): string {
  const day = new Date(now.getTime() + Math.floor(days) * 86_400_000);
  return day.toLocaleDateString('fr-FR', { weekday: 'long' });
}

/**
 * What she can drop today: the tiles of her Contenu, and her scripts (asked by the agency). Instagram and Telegram
 * open to her with their connection; until then their categories ask nothing of her.
 */
export const HER_CATEGORIES: ReadonlySet<DropCategory> = new Set([
  ...DROP_OUTPUTS.flatMap((output) => output.categories),
  'script',
]);

export interface PlatformStock {
  readonly platform: StockCategory['platform'];
  readonly categories: readonly StockCategory[];
  /** Its weakest days, among its categories at a pace; null when none is. */
  readonly days: number | null;
  /** Whether she drops for it yet: one of its categories is hers, or something of it is already in. */
  readonly open: boolean;
}

export function platformsOf(stock: ContentStock): readonly PlatformStock[] {
  return (['reveal', 'instagram', 'telegram'] as const).map((platform) => {
    const categories = stock.categories.filter((one) => one.platform === platform);
    const open = categories.some(
      (one) => HER_CATEGORIES.has(one.category) || one.stockMedia + one.scheduledUnits + one.outUnits7 > 0,
    );
    const paced = categories.flatMap((one) =>
      one.mode === 'days' && one.daysAhead !== null ? [one.daysAhead] : [],
    );
    return { platform, categories, open, days: paced.length === 0 ? null : Math.min(...paced) };
  });
}

/** What leads the agency's coffre: the platform that runs dry first, or that everything holds. */
export interface StockHeadline {
  readonly title: string;
  readonly lead: string;
  readonly tone: 'ok' | 'warn';
}

export function headlineOf(stock: ContentStock, now: Date): StockHeadline {
  const platforms = platformsOf(stock).filter((one) => one.open && one.days !== null);
  const open = new Set(platforms.flatMap((one) => one.categories.map((category) => category.category)));
  const lacking = stock.categories.filter(
    (one) => open.has(one.category) && one.lacking > 0 && one.mode !== 'bonus',
  );
  const toValidate = stock.media.filter((one) => one.description === 'to_validate').length;
  const look = toValidate === 0 ? '' : ` ${descriptionsLine(toValidate)}`;
  if (lacking.length === 0)
    return { title: 'Le coffre tient la semaine', lead: `Tout est d’avance.${look}`, tone: 'ok' };
  const weakest = platforms.reduce<PlatformStock | null>(
    (low, one) => (low === null || (one.days ?? 0) < (low.days ?? 0) ? one : low),
    null,
  );
  const most = [...lacking].sort((a, b) => fillOf(a) - fillOf(b))[0];
  const missing = most === undefined ? '' : ` Il manque surtout ${unitsOf(most.category, most.lacking)}.`;
  if (weakest?.days == null)
    return { title: 'Il manque des médias', lead: `${missing.trim()}${look}`, tone: 'warn' };
  const title =
    weakest.days < 1
      ? `${PLATFORM_NAMES[weakest.platform]} est à sec`
      : `${PLATFORM_NAMES[weakest.platform]} tombe à sec ${dryDay(weakest.days, now)}`;
  return { title, lead: `${missing.trim()}${look}`, tone: 'warn' };
}

const descriptionsLine = (count: number): string =>
  count === 1 ? 'Une description attend un œil.' : `${String(count)} descriptions attendent un œil.`;

/**
 * Media in stock per category, counted from the one list every screen reads: the headline, the donut and the
 * category view never disagree.
 */
export function mediaCountOf(stock: ContentStock, category: DropCategory): { readonly inStock: number } {
  return {
    inStock: stock.media.filter((one) => one.category === category && one.standing === 'stock').length,
  };
}

/** The four figures under the headline. */
export interface StockFigures {
  readonly inStock: number;
  readonly scripts: number;
  readonly dropped14: number;
  readonly droppedBefore: number;
  readonly out7: number;
  readonly toValidate: number;
  readonly failed: number;
}

export function figuresOf(stock: ContentStock, now: Date): StockFigures {
  const at = now.getTime();
  const within = (iso: string, from: number, to: number): boolean => {
    const time = Date.parse(iso);
    return time > at - from * 86_400_000 && time <= at - to * 86_400_000;
  };
  return {
    inStock: stock.media.filter((one) => one.standing === 'stock').length,
    scripts: stock.media.filter((one) => one.category === 'script' && one.standing === 'stock').length,
    dropped14: stock.media.filter((one) => within(one.droppedAt, 14, 0)).length,
    droppedBefore: stock.media.filter((one) => within(one.droppedAt, 28, 14)).length,
    out7: stock.media.filter((one) => one.outAt !== null && within(one.outAt, 7, 0)).length,
    toValidate: stock.media.filter((one) => one.description === 'to_validate').length,
    failed: stock.media.filter((one) => one.description === 'failed').length,
  };
}

/** Media dropped each day of the last 14, oldest first, for the figure's small curve. */
export function droppedByDay(stock: ContentStock, now: Date): readonly number[] {
  const days = Array.from({ length: 14 }, () => 0);
  for (const one of stock.media) {
    const ago = Math.floor((now.getTime() - Date.parse(one.droppedAt)) / 86_400_000);
    if (ago >= 0 && ago < 14) days[13 - ago] = (days[13 - ago] ?? 0) + 1;
  }
  return days;
}

export const STANDING_LABELS: Readonly<Record<StockStanding, string>> = {
  stock: 'En stock',
  scheduled: 'Programmé',
  out: 'Parti',
};

export const DESCRIPTION_LABELS: Readonly<Record<StockDescriptionState, string>> = {
  validated: 'Description validée',
  to_validate: 'À valider',
  pending: 'Pas encore décrite',
  failed: 'L’IA n’a pas su la décrire',
};

export const STOCK_FILTERS = ['all', 'stock', 'scheduled', 'out', 'to_validate'] as const;
export type StockFilter = (typeof STOCK_FILTERS)[number];

export const FILTER_LABELS: Readonly<Record<StockFilter, string>> = {
  all: 'Tout',
  stock: 'En stock',
  scheduled: 'Programmés',
  out: 'Partis',
  to_validate: 'À valider',
};

export function filtered(media: readonly StockMedium[], filter: StockFilter): readonly StockMedium[] {
  if (filter === 'all') return media;
  if (filter === 'to_validate') return media.filter((one) => one.description === 'to_validate');
  return media.filter((one) => one.standing === filter);
}

/** Her media of one category, grouped by drop (a boudoir session stays together), newest drop first. */
export interface StockDropGroup {
  readonly dropId: StockMedium['dropId'];
  readonly droppedAt: string;
  readonly media: readonly StockMedium[];
  readonly out: number;
}

export function groupsOf(media: readonly StockMedium[]): readonly StockDropGroup[] {
  const groups = new Map<string, StockMedium[]>();
  for (const one of media) {
    const list = groups.get(one.dropId);
    if (list === undefined) groups.set(one.dropId, [one]);
    else list.push(one);
  }
  return [...groups.values()].flatMap((list) => {
    const [first] = list;
    return first === undefined
      ? []
      : [
          {
            dropId: first.dropId,
            droppedAt: first.droppedAt,
            media: list,
            out: list.filter((one) => one.standing === 'out').length,
          },
        ];
  });
}

/** « déposée le 20/11 ». */
export const droppedOnLabel = (iso: string): string =>
  new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

/** « 0:14 ». */
export function durationLabel(ms: number | null): string | null {
  if (ms === null) return null;
  const seconds = Math.round(ms / 1000);
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * What leads her coffre (the model's): her video of the day while her coffre has none for today, the one line of « Ma
 * journée » it does, read from the same server answer as her Aujourd'hui (ADR 0140, avenant du 27/11); then what would
 * give her advance for the week, the weakest first. It never says her day is done: Aujourd'hui alone counts her day.
 * Scripts are asked by the agency, one request at a time: none asked, none is claimed of her (recette MOD-02).
 */
export interface HerFocus {
  /** Above the title: today's, the week's (a pace), or her coffre's (a minimum to hold). */
  readonly when: 'today' | 'week' | 'stock' | null;
  readonly title: string;
  readonly lead: string;
  readonly category: DropCategory | null;
  readonly bonus: readonly StockCategory[];
}

/** What her coffre may ask of her: her tiles, and her scripts while one is asked. */
const askable = (one: StockCategory, scriptsAsked: number): boolean =>
  HER_CATEGORIES.has(one.category) &&
  one.lacking > 0 &&
  one.mode !== 'bonus' &&
  (one.category !== 'script' || scriptsAsked > 0);

export function herFocusOf(stock: ContentStock, day: HerDay | null, scriptsAsked: number): HerFocus {
  const lacking = stock.categories
    .filter((one) => askable(one, scriptsAsked))
    .sort((a, b) => fillOf(a) - fillOf(b));
  const videoLeft =
    day !== null &&
    day.day === day.today &&
    day.lines.some((line) => line.source === 'drop' && line.done < line.target);
  if (videoLeft)
    return {
      when: 'today',
      title: 'Ta vidéo du jour',
      lead: 'Dépose-la : Impera la publie pour toi sur Reveal.',
      category: 'feed_video',
      bonus: lacking.filter((one) => one.category !== 'feed_video').slice(0, 2),
    };
  const [first, ...rest] = lacking;
  if (first === undefined)
    return {
      when: null,
      title: 'Ton coffre est plein d’avance',
      lead: 'Tout ce que tu as déposé tient la semaine. Ce que tu ajoutes est du bonus.',
      category: null,
      bonus: [],
    };
  // A pace asks a day's worth; a minimum, all it lacks, so that the title and her ring say the same count (Design, 27/11).
  const count =
    first.mode === 'days' ? Math.min(first.lacking, Math.ceil((first.perWeek ?? 7) / 7)) : first.lacking;
  const target = first.target ?? 0;
  return {
    when: first.mode === 'days' ? 'week' : 'stock',
    title: `Encore ${unitsOf(first.category, count)}`,
    lead:
      first.mode === 'days'
        ? `${STOCK_NAMES[first.category]} : de l’avance pour ta semaine.`
        : `${STOCK_NAMES[first.category]} : il en faut ${String(target)} ${target > 1 ? 'prêts' : 'prêt'}.`,
    category: first.category,
    bonus: rest.slice(0, 2),
  };
}

/** Under her ring: what she holds, against the minimum asked when one is asked. */
export function ringSub(category: StockCategory): string {
  // A bonus asks nothing of her: no « sur », only what she has.
  if (category.mode !== 'count' || category.target === null)
    return `${unitsOf(category.category, category.stockUnits)} en stock`;
  // « 0 prêt sur 3 », « 2 prêts sur 3 »: the word agrees with what she holds (recette F3).
  return `${String(category.stockUnits)} ${category.stockUnits > 1 ? 'prêts' : 'prêt'} sur ${String(category.target)}`;
}
