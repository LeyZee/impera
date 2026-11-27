import {
  CUSTOM_MINUTES_MAX,
  CUSTOM_PERCENT_MAX,
  CUSTOM_PRICE_MAX_MINOR,
  CustomPriceGridSchema,
  isPerMinute,
  READY_VIDEO_MIN_MINOR,
  type CustomFormat,
  type CustomPriceGrid,
  type CustomQuote,
} from '@impera/contracts';

/**
 * Créatrices › Sur mesure (ADR 0159 § C): the words of the screen and the reading of what the owner types. The grid
 * itself and its sum are the contract's (`CustomPriceGridSchema`, `quoteCustomOrder`): the screen never computes a
 * price its own way.
 */

export const FORMAT_LABELS: Readonly<Record<CustomFormat, string>> = {
  photo: 'Photo pour lui',
  video: 'Vidéo pour lui',
  reaction_video: 'Réaction filmée à sa photo',
  rating: 'Note de sa photo',
  call: 'Appel',
  video_call_talk: 'Visio pour parler',
  video_call_sexual: 'Visio sexuelle',
};

export const FORMAT_HINTS: Readonly<Record<CustomFormat, string>> = {
  photo: 'À l’unité : son prénom écrit sur elle, une pose, une tenue.',
  video: 'Jusqu’au nombre de minutes compris, puis un pourcentage par minute en plus.',
  reaction_video: 'Elle se filme en découvrant la photo qu’il envoie.',
  rating: 'Une note et quelques mots sur la photo qu’il envoie.',
  call: 'À la minute, payé en entier d’avance. Elle le passe elle-même.',
  video_call_talk: 'À la minute, payé en entier d’avance. Elle la passe elle-même.',
  video_call_sexual: 'À la minute, payé en entier d’avance. Elle la passe elle-même.',
};

/** The name of a format or a supplement of the grid, for a sentence (« Appel », a supplement's own name). */
export function lineName(grid: CustomPriceGrid, key: string): string {
  const format = grid.formats.find((line) => line.format === key);
  if (format !== undefined) return FORMAT_LABELS[format.format];
  const supplement = grid.supplements.find((line) => line.id === key);
  return supplement === undefined ? key : supplement.label;
}

/** A price as it is typed: « 40 », « 40,50 », « 40.5 € ». Empty is no price yet. */
export function minorOfEuros(text: string): number | null | 'invalid' {
  const clean = text.replace(/\s|€/gu, '').replace(',', '.');
  if (clean === '') return null;
  if (!/^\d{1,5}(\.\d{1,2})?$/u.test(clean)) return 'invalid';
  const minor = Math.round(Number(clean) * 100);
  return minor > CUSTOM_PRICE_MAX_MINOR ? 'invalid' : minor;
}

/** A price as the field shows it: « 40 », « 40,50 ». */
export function eurosOfMinor(minor: number | null): string {
  if (minor === null) return '';
  const euros = Math.floor(minor / 100);
  const cents = minor % 100;
  return cents === 0 ? String(euros) : `${String(euros)},${String(cents).padStart(2, '0')}`;
}

/** A price for a sentence: « 40 € », « 40,50 € ». */
export const euros = (minor: number): string => `${eurosOfMinor(minor)} €`;

/** A whole number typed in a field (a percent, minutes), between `min` and `max`. Empty is none. */
export function wholeOf(text: string, min: number, max: number): number | null | 'invalid' {
  const clean = text.replace(/\s|%/gu, '');
  if (clean === '') return null;
  if (!/^\d{1,4}$/u.test(clean)) return 'invalid';
  const value = Number(clean);
  return value < min || value > max ? 'invalid' : value;
}

export const percentOf = (text: string): number | null | 'invalid' => wholeOf(text, 0, CUSTOM_PERCENT_MAX);
export const minutesOf = (text: string): number | null | 'invalid' => wholeOf(text, 1, CUSTOM_MINUTES_MAX);

/** The fields of a format as they are typed, before they are read. */
export interface FormatDraft {
  readonly format: CustomFormat;
  readonly offered: boolean;
  readonly price: string;
  readonly minMinutes: string;
  readonly includedMinutes: string;
  readonly extraMinutePercent: string;
}

/** The fields of a supplement as they are typed. */
export interface SupplementDraft {
  readonly id: string;
  readonly label: string;
  readonly offered: boolean;
  readonly percent: string;
}

/** The fields of a kind of video already shot, as they are typed: its name and the range its price is drawn in. */
export interface ReadyVideoDraft {
  readonly id: string;
  readonly label: string;
  readonly offered: boolean;
  readonly min: string;
  readonly max: string;
}

export interface GridDraft {
  readonly formats: readonly FormatDraft[];
  readonly supplements: readonly SupplementDraft[];
  readonly readyVideos: readonly ReadyVideoDraft[];
}

const text = (value: number | null): string => (value === null ? '' : String(value));

export function draftOf(grid: CustomPriceGrid): GridDraft {
  return {
    formats: grid.formats.map((line) => ({
      format: line.format,
      offered: line.offered,
      price: eurosOfMinor(line.priceMinor),
      minMinutes: text(line.minMinutes),
      includedMinutes: text(line.includedMinutes),
      extraMinutePercent: text(line.extraMinutePercent),
    })),
    supplements: grid.supplements.map((line) => ({
      id: line.id,
      label: line.label,
      offered: line.offered,
      percent: text(line.percent),
    })),
    readyVideos: grid.readyVideos.map((line) => ({
      id: line.id,
      label: line.label,
      offered: line.offered,
      min: eurosOfMinor(line.minMinor),
      max: eurosOfMinor(line.maxMinor),
    })),
  };
}

/** Which typed field cannot be read, by a key the screen points at (`video.price`, `sup_….label`). */
export type DraftProblems = ReadonlyMap<string, string>;

const known = <T>(value: T | 'invalid'): T | null => (value === 'invalid' ? null : value);

/**
 * The grid the draft gives, or the fields to fix first. A field left empty is « pas encore de prix »: the grid holds
 * it as null, and an order that needs it goes to her without a price (« hors grille »).
 */
export function readDraft(draft: GridDraft): { grid: CustomPriceGrid | null; problems: DraftProblems } {
  const problems = new Map<string, string>();
  const formats = draft.formats.map((line) => {
    const price = minorOfEuros(line.price);
    if (price === 'invalid')
      problems.set(`${line.format}.price`, 'Un prix comme 40 ou 40,50, jusqu’à 10 000 €.');
    const perMinute = isPerMinute(line.format);
    const minMinutes = perMinute ? minutesOf(line.minMinutes) : null;
    if (minMinutes === 'invalid')
      problems.set(`${line.format}.minMinutes`, `De 1 à ${String(CUSTOM_MINUTES_MAX)} minutes.`);
    const video = line.format === 'video';
    const included = video ? minutesOf(line.includedMinutes) : null;
    if (included === 'invalid')
      problems.set(`${line.format}.includedMinutes`, `De 1 à ${String(CUSTOM_MINUTES_MAX)} minutes.`);
    const extra = video ? percentOf(line.extraMinutePercent) : null;
    if (extra === 'invalid')
      problems.set(`${line.format}.extraMinutePercent`, `De 0 à ${String(CUSTOM_PERCENT_MAX)} %.`);
    return {
      format: line.format,
      offered: line.offered,
      priceMinor: known(price),
      minMinutes: known(minMinutes),
      includedMinutes: known(included),
      extraMinutePercent: known(extra),
    };
  });
  const names = new Set<string>();
  const supplements = draft.supplements.map((line) => {
    const percent = percentOf(line.percent);
    if (percent === 'invalid') problems.set(`${line.id}.percent`, `De 0 à ${String(CUSTOM_PERCENT_MAX)} %.`);
    const label = line.label.trim();
    const key = label.toLocaleLowerCase('fr');
    if (label === '') problems.set(`${line.id}.label`, 'Donne-lui un nom.');
    else if (names.has(key)) problems.set(`${line.id}.label`, 'Un autre supplément porte déjà ce nom.');
    names.add(key);
    return {
      id: line.id,
      label,
      offered: line.offered,
      percent: known(percent),
    };
  });
  const videoNames = new Set<string>();
  const readyVideos = draft.readyVideos.map((line) => {
    const label = line.label.trim();
    const key = label.toLocaleLowerCase('fr');
    if (label === '') problems.set(`${line.id}.label`, 'Donne-lui un nom.');
    else if (videoNames.has(key)) problems.set(`${line.id}.label`, 'Une autre ligne porte déjà ce nom.');
    videoNames.add(key);
    const min = rangeEnd(line.min);
    const max = rangeEnd(line.max);
    if (min === null) problems.set(`${line.id}.min`, RANGE_PROBLEM);
    if (max === null) problems.set(`${line.id}.max`, RANGE_PROBLEM);
    else if (min !== null && max < min) problems.set(`${line.id}.max`, 'Au moins le bas de la fourchette.');
    return { id: line.id, label, offered: line.offered, minMinor: min ?? 0, maxMinor: max ?? 0 };
  });
  if (problems.size > 0) return { grid: null, problems };
  const parsed = CustomPriceGridSchema.safeParse({ formats, supplements, readyVideos });
  return parsed.success
    ? { grid: parsed.data, problems }
    : { grid: null, problems: new Map([['grid', 'Cette grille ne passe pas : vérifie chaque ligne.']]) };
}

const RANGE_PROBLEM = 'Un prix comme 40, d’1 € à 10 000 €.';

/** One end of a ready video's range: required, at least 1 €. */
function rangeEnd(typed: string): number | null {
  const minor = minorOfEuros(typed);
  return minor === null || minor === 'invalid' || minor < READY_VIDEO_MIN_MINOR ? null : minor;
}

/** Eight hex digits, drawn here once for a new line's id. */
function freshHex(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A new supplement: `sup_` and eight hex digits, drawn here once. */
export function newSupplement(): SupplementDraft {
  return { id: `sup_${freshHex()}`, label: '', offered: true, percent: '' };
}

/** A new kind of video already shot: `rv_` and eight hex digits, drawn here once. */
export function newReadyVideo(): ReadyVideoDraft {
  return { id: `rv_${freshHex()}`, label: '', offered: true, min: '', max: '' };
}

/** Lines of a list the owner adds to: changed, added or removed since the saved one. */
function listChanges(saved: readonly { id: string }[], draft: readonly { id: string }[]): number {
  const before = new Map(saved.map((line) => [line.id, JSON.stringify(line)]));
  const changed = draft.filter((line) => before.get(line.id) !== JSON.stringify(line)).length;
  const removed = saved.filter((line) => !draft.some((one) => one.id === line.id)).length;
  return changed + removed;
}

/** How many lines differ from the saved grid, for « 3 modifications ». */
export function changesBetween(saved: GridDraft, draft: GridDraft): number {
  const formats = draft.formats.filter(
    (line, index) => JSON.stringify(line) !== JSON.stringify(saved.formats[index]),
  ).length;
  return (
    formats +
    listChanges(saved.supplements, draft.supplements) +
    listChanges(saved.readyVideos, draft.readyVideos)
  );
}

/** What the calculator says of a quote, in one sentence. */
export function quoteSentence(grid: CustomPriceGrid, quote: CustomQuote): string {
  if (quote.kind === 'price') return `${euros(quote.totalMinor)}, arrondi à l’euro.`;
  if (quote.kind === 'declined')
    return `Elle ne le fait pas (${lineName(grid, quote.by)}) : l’IA déclinera sans lui demander.`;
  return `Hors grille : ${quote.missing.map((key) => lineName(grid, key)).join(', ')} sans prix. La demande partira à elle sans prix proposé.`;
}

/** When the grid was last saved, for the head: « Enregistrée le 20/11 à 15 h 53 ». */
export function savedLine(updatedAt: string | null): string {
  if (updatedAt === null) return 'Jamais enregistrée : remplis les prix, puis enregistre.';
  const at = new Date(updatedAt);
  const day = at.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const hour = at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
  return `Enregistrée le ${day} à ${hour}.`;
}
