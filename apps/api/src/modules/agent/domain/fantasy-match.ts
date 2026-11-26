import { normaliseWords, type OutfitColour, type OutfitPieceType, type OutfitStyle } from '@impera/contracts';

/**
 * The script closest to his fantasy (Charles 26/11, amendment of ADR 0098 § 6): the code reads his desire map on the
 * card (what he fantasises about, the outfits he likes, the words that work on him, his limits, what cools him) and
 * scores each permitted script by the words they share, deterministically and at no cost. A script that touches one
 * of his limits is never offered; the brain still picks, among the scripts in the order code gives.
 *
 * Nothing here describes a practice: the code only compares his own words with the agency's words for a script.
 */

/** His desire map, as the card holds it: each field a list of short items, his words or a chatter's. */
export interface DesireMap {
  readonly desires: readonly string[];
  readonly outfits: readonly string[];
  readonly wordsThatWork: readonly string[];
  readonly limits: readonly string[];
  readonly coolsHim: readonly string[];
}

export const EMPTY_DESIRE_MAP: DesireMap = {
  desires: [],
  outfits: [],
  wordsThatWork: [],
  limits: [],
  coolsHim: [],
};

/** The card's codes for the desire map (`FanCardFieldSchema`), read from his notes. */
const MAP_KEYS = {
  desires: 'desires',
  outfits: 'outfits',
  words_that_work: 'wordsThatWork',
  limits: 'limits',
  cools_him: 'coolsHim',
} as const satisfies Record<string, keyof DesireMap>;

const isMapKey = (key: string): key is keyof typeof MAP_KEYS => Object.hasOwn(MAP_KEYS, key);

/** How a list field's items are kept in one note (`fans` card, ADR 0085 § 1). */
const LIST_SEPARATOR = ' · ';

/**
 * His desire map from his notes as the engine reads them, one « key : value » line per field (`fanNotesOf`). Only the
 * lines already screened reach here: a line shaped like an order never does.
 */
export function desireMapOf(notes: string): DesireMap {
  const map: Record<keyof DesireMap, string[]> = {
    desires: [],
    outfits: [],
    wordsThatWork: [],
    limits: [],
    coolsHim: [],
  };
  for (const line of notes.split('\n')) {
    const at = line.indexOf(' : ');
    if (at < 0) continue;
    const key = line.slice(0, at).trim().toLowerCase();
    if (!isMapKey(key)) continue;
    const items = line
      .slice(at + 3)
      .split(LIST_SEPARATOR)
      .map((item) => item.trim())
      .filter((item) => item !== '');
    map[MAP_KEYS[key]].push(...items);
  }
  return map;
}

/**
 * His map without what her persona refuses (Charles 26/11 at 21:22): a fantasy, an outfit or a word that touches one of
 * her disgusts, what she never says or never does is neither played nor taken as a script's target. His limits stay.
 */
export function withoutHerLimits(map: DesireMap, refuses: (item: string) => boolean): DesireMap {
  const keep = (items: readonly string[]) => items.filter((item) => !refuses(item));
  return {
    ...map,
    desires: keep(map.desires),
    outfits: keep(map.outfits),
    wordsThatWork: keep(map.wordsThatWork),
  };
}

/**
 * What a script carries, in the media's closed vocabulary (`DropMediaDescriptionSchema`), when the catalogue gives it
 * (`carriesAll`, the union of its steps). Absent today: the score then reads its description and its media's sheets.
 */
export interface ScriptCarriesView {
  readonly intensities?: readonly string[];
  readonly moods?: readonly string[];
  readonly castModes?: readonly string[];
  readonly audioTones?: readonly string[];
  readonly outfitStyles?: readonly OutfitStyle[];
  readonly outfitPieces?: readonly {
    readonly type: OutfitPieceType;
    readonly colours: readonly OutfitColour[];
  }[];
}

/** What a script says of itself: the agency's description, its steps' cards and media sheets, what it carries. */
export interface ScriptTextView {
  readonly description: string;
  readonly steps: readonly { readonly instruction?: string; readonly mediaSheet?: string }[];
  readonly carriesAll?: ScriptCarriesView;
}

// The French words a fan uses for each closed value, so « bas noirs » meets `stockings` in `black`. Generic words of
// the vocabulary, never a creator's.
const STYLE_WORDS: Readonly<Record<OutfitStyle, readonly string[]>> = {
  lingerie: ['lingerie', 'dentelle', 'sous vetements'],
  nightwear: ['nuisette', 'pyjama', 'tenue de nuit'],
  evening: ['robe de soiree', 'soiree', 'chic'],
  casual: ['tenue decontractee'],
  sportswear: ['sport', 'legging', 'tenue de sport'],
  swimwear: ['maillot', 'bikini'],
  costume: ['cosplay', 'deguisement', 'costume'],
  nothing: ['nue', 'nu'],
  other: [],
};

const PIECE_WORDS: Readonly<Record<OutfitPieceType, readonly string[]>> = {
  lingerie_top: ['soutien gorge', 'brassiere'],
  lingerie_bottom: ['culotte', 'string', 'tanga'],
  bodysuit: ['body'],
  garter_belt: ['porte jarretelles', 'jarretelles'],
  stockings: ['bas', 'collants'],
  dress: ['robe'],
  skirt: ['jupe'],
  top: ['haut', 'debardeur'],
  shirt: ['chemise', 'chemisier'],
  sweater: ['pull'],
  jacket: ['veste'],
  trousers: ['pantalon', 'jean'],
  shorts: ['short'],
  swimsuit: ['maillot'],
  robe: ['peignoir'],
  pyjamas: ['pyjama'],
  towel: ['serviette'],
  heels: ['talons', 'escarpins'],
  shoes: ['chaussures'],
  boots: ['bottes', 'cuissardes'],
  accessory: [],
  other: [],
};

const COLOUR_WORDS: Readonly<Record<OutfitColour, readonly string[]>> = {
  black: ['noir'],
  white: ['blanc'],
  red: ['rouge'],
  pink: ['rose'],
  purple: ['violet'],
  blue: ['bleu'],
  green: ['vert'],
  yellow: ['jaune'],
  orange: ['orange'],
  brown: ['marron'],
  beige: ['beige'],
  grey: ['gris'],
  gold: ['dore', 'or'],
  silver: ['argente'],
  nude: ['nude', 'chair'],
  transparent: ['transparent', 'transparence'],
  multicolour: ['multicolore'],
};

const MOOD_WORDS: Readonly<Record<string, readonly string[]>> = {
  playful: ['joueuse', 'taquine'],
  sensual: ['sensuelle'],
  dominant: ['dominante', 'domine', 'dominer', 'ordres'],
  submissive: ['soumise', 'soumission', 'obeissante'],
  romantic: ['romantique', 'tendre', 'tendresse'],
  casual: [],
  sporty: ['sportive'],
  artistic: ['artistique'],
  intense: ['intense'],
};

const AUDIO_WORDS: Readonly<Record<string, readonly string[]>> = {
  soft: ['douce', 'murmure', 'chuchote'],
  playful: ['joueuse'],
  moaning: ['gemissements', 'gemir', 'gemit'],
  commanding: ['ordres', 'autoritaire'],
  neutral: [],
};

/** Words of no meaning for a match: articles, pronouns, the verbs of every sentence. */
const STOPWORDS = new Set([
  'les',
  'des',
  'une',
  'aux',
  'avec',
  'sans',
  'pour',
  'sur',
  'dans',
  'par',
  'que',
  'qui',
  'quand',
  'comme',
  'mais',
  'est',
  'sont',
  'etre',
  'avoir',
  'fait',
  'faire',
  'elle',
  'lui',
  'leur',
  'eux',
  'moi',
  'toi',
  'nous',
  'vous',
  'ils',
  'elles',
  'son',
  'ses',
  'mon',
  'mes',
  'ton',
  'tes',
  'notre',
  'votre',
  'cette',
  'ces',
  'cet',
  'tout',
  'tous',
  'toute',
  'toutes',
  'tres',
  'plus',
  'moins',
  'bien',
  'pas',
  'aime',
  'aimer',
  'adore',
  'adorer',
  'veut',
  'vouloir',
  'quelque',
  'chose',
  'quand',
  'ils',
  'the',
  'and',
  'with',
]);

/** One word as compared: no accent, no case, singular and masculine read alike (« noires » is « noir »). */
function stem(word: string): string {
  let stemmed = word;
  if (stemmed.length > 3 && /[sx]$/u.test(stemmed)) stemmed = stemmed.slice(0, -1);
  if (stemmed.length > 3 && stemmed.endsWith('e')) stemmed = stemmed.slice(0, -1);
  return stemmed;
}

/** The words of a text that carry meaning, compared as stems. */
export function contentWords(text: string): ReadonlySet<string> {
  const words = normaliseWords(text)
    .split(' ')
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
  return new Set(words.map(stem));
}

function carriedWords(carries: ScriptCarriesView | undefined): string[] {
  if (carries === undefined) return [];
  return [
    ...(carries.outfitStyles ?? []).flatMap((style) => STYLE_WORDS[style]),
    ...(carries.outfitPieces ?? []).flatMap((piece) => [
      ...PIECE_WORDS[piece.type],
      ...piece.colours.flatMap((colour) => COLOUR_WORDS[colour]),
    ]),
    ...(carries.moods ?? []).flatMap((mood) => MOOD_WORDS[mood] ?? []),
    ...(carries.audioTones ?? []).flatMap((tone) => AUDIO_WORDS[tone] ?? []),
  ];
}

/**
 * Every word a script is known by: what it carries in the closed vocabulary first, when the catalogue gives it, then
 * the agency's description and its steps' cards and media sheets (a fantasy is often a scenario, told in words).
 */
function scriptWords(script: ScriptTextView): ReadonlySet<string> {
  return contentWords(
    [
      ...carriedWords(script.carriesAll),
      script.description,
      ...script.steps.flatMap((step) => [step.instruction ?? '', step.mediaSheet ?? '']),
    ].join(' \n '),
  );
}

/** An item meets a script when at least half of its words are the script's own: « lingerie noire » needs one of two. */
const MATCH_SHARE = 0.5;

/** How much of an item the script shares, 0 to 1; an item with no meaningful word shares nothing. */
function share(item: string, words: ReadonlySet<string>): number {
  const own = [...contentWords(item)];
  if (own.length === 0) return 0;
  return own.filter((word) => words.has(word)).length / own.length;
}

const hits = (item: string, words: ReadonlySet<string>): boolean => share(item, words) >= MATCH_SHARE;

/** Whether his message speaks of an item of his map: half its words at least, as a script would meet it. */
export function mentions(item: string, text: string): boolean {
  return hits(item, contentWords(text));
}

/** The weight of each part of his map: his fantasies and outfits lead, the words that work on him tip the balance. */
const WEIGHTS = { desires: 1, outfits: 1, wordsThatWork: 0.5, coolsHim: -1 } as const;

/** A script and what of his map it meets: the items it shares, the score code orders by. */
export interface FantasyMatch<T> {
  readonly script: T;
  /** His items it shares (fantasies first, then outfits, then the words that work), in his own words. */
  readonly matches: readonly string[];
  readonly score: number;
}

/** What of his map a script shares, and its score; `null` when it touches one of his limits. */
export function fantasyMatchOf(
  script: ScriptTextView,
  map: DesireMap,
): Omit<FantasyMatch<never>, 'script'> | null {
  const words = scriptWords(script);
  if (map.limits.some((limit) => hits(limit, words))) return null;
  const desires = map.desires.filter((item) => hits(item, words));
  const outfits = map.outfits.filter((item) => hits(item, words));
  const wordsThatWork = map.wordsThatWork.filter((item) => hits(item, words));
  const cools = map.coolsHim.filter((item) => hits(item, words));
  const score =
    desires.reduce((sum, item) => sum + share(item, words) * WEIGHTS.desires, 0) +
    outfits.reduce((sum, item) => sum + share(item, words) * WEIGHTS.outfits, 0) +
    wordsThatWork.reduce((sum, item) => sum + share(item, words) * WEIGHTS.wordsThatWork, 0) +
    cools.length * WEIGHTS.coolsHim;
  return { matches: [...new Set([...desires, ...outfits, ...wordsThatWork])], score };
}

/**
 * Her permitted scripts, closest to his fantasy first (equal scores keep the agency's order), those that touch one of
 * his limits left out; and his fantasies no script left meets (`uncovered`), which she never promises.
 */
export function rankByFantasy<T extends ScriptTextView>(
  scripts: readonly T[],
  map: DesireMap,
): { readonly ranked: readonly FantasyMatch<T>[]; readonly uncovered: readonly string[] } {
  const scored = scripts.flatMap((script, index) => {
    const match = fantasyMatchOf(script, map);
    return match === null ? [] : [{ ...match, script, index }];
  });
  const ranked = scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ script, matches, score }) => ({ script, matches, score }));
  const covered = new Set(ranked.flatMap((one) => one.matches));
  return { ranked, uncovered: map.desires.filter((item) => !covered.has(item)) };
}
