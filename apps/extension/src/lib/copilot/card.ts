import {
  FAN_CARD_FIELDS,
  FAN_CARD_INTENSITY_LABELS,
  FAN_CARD_LEAD_LABELS,
  FanCardIntensitySchema,
  FanCardLeadSchema,
  type FanCardEntry,
  type FanCardField,
  type FanCardFieldSpec,
  type FanCardGroup,
  type FanCardValue,
} from '@impera/contracts';

/**
 * The fan's card as the panel reads it (ADR 0086 § 3.2 and § 10): what a chatter needs in three seconds on top, the
 * rest folded by group. The same words as the Suivi's card (apps/web, `screens/tracking/card/model.ts`): a value says
 * where it comes from and how old it is, a guess is said as a guess.
 */

/** § 10: first name, age, town, what excites him, what he does not want, the last thing he told. */
export const ESSENTIALS: readonly FanCardField[] = [
  'first_name',
  'age',
  'location',
  'desires',
  'limits',
  'life_events',
];

export const PANEL_GROUPS: readonly { readonly group: FanCardGroup; readonly title: string }[] = [
  { group: 'him', title: 'Lui' },
  // Not « Ce qu'il aime chez elle »: one of its fields has that name (V-EXT-28).
  { group: 'about_her', title: 'Elle, vue par lui' },
  { group: 'intimate', title: 'Intime' },
];

export const specOf = (field: FanCardField): FanCardFieldSpec | undefined =>
  FAN_CARD_FIELDS.find((spec) => spec.field === field);

/** The fields of a group the essentials do not already show, in the card's order. */
export const restOf = (group: FanCardGroup): readonly FanCardFieldSpec[] =>
  FAN_CARD_FIELDS.filter((spec) => spec.group === group && !ESSENTIALS.includes(spec.field));

export function entryOf(entries: readonly FanCardEntry[], field: FanCardField): FanCardEntry {
  return entries.find((one) => one.field === field) ?? { field, current: null, toCheck: [] };
}

/** A closed value's label is written for a choice (« Coquin »); in the card it reads as the others (Design, lot -2). */
function closedLabel(field: FanCardField, item: string): string {
  if (field === 'intensity') {
    const value = FanCardIntensitySchema.safeParse(item);
    return value.success ? lowerFirst(FAN_CARD_INTENSITY_LABELS[value.data]) : item;
  }
  if (field === 'lead') {
    const value = FanCardLeadSchema.safeParse(item);
    return value.success ? lowerFirst(FAN_CARD_LEAD_LABELS[value.data]) : item;
  }
  return item;
}

/** A closed value by its label, a list as its items in a row. */
export const valueText = (field: FanCardField, items: readonly string[]): string =>
  items.map((item) => closedLabel(field, item)).join(' · ');

/** « hier », « il y a 3 jours »: how old a value is, said as a person says it. */
function ageOf(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${String(hours)} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'hier';
  if (days < 30) return `il y a ${String(days)} jours`;
  const months = Math.floor(days / 30);
  if (months < 12) return `il y a ${String(months)} mois`;
  const years = Math.floor(months / 12);
  return `il y a ${String(years)} an${years > 1 ? 's' : ''}`;
}

/** « Dit par lui, il y a 3 jours », « Noté par Inès, hier ». */
export function sourceLine(value: FanCardValue, now: Date): string {
  const who =
    value.source === 'declared'
      ? 'Dit par lui'
      : value.source === 'inferred'
        ? 'Deviné'
        : value.notedByName === null
          ? 'Noté par un chatteur'
          : `Noté par ${value.notedByName}`;
  return `${who}, ${ageOf(value.observedAt, now)}`;
}

/** « 4 sur 11 » for a group's folded line, on the fields it shows. */
export function groupLine(entries: readonly FanCardEntry[], group: FanCardGroup): string {
  const specs = restOf(group);
  const known = specs.filter((spec) => entryOf(entries, spec.field).current !== null).length;
  return `${String(known)} sur ${String(specs.length)}`;
}

/** How many fields of a group, among those it shows, wait for a chatter: said on its folded line (V-EXT-07). */
export const groupChecks = (entries: readonly FanCardEntry[], group: FanCardGroup): number =>
  restOf(group).filter((spec) => entryOf(entries, spec.field).toCheck.length > 0).length;

/** How many fields wait for a chatter (ADR 0085 § 6): said in amber, it stops nothing. */
export const toCheckCount = (entries: readonly FanCardEntry[]): number =>
  entries.filter((entry) => entry.toCheck.length > 0).length;

/** The three words that say who he is, on one line on top (recette du 16/11, EXT-04): « Alpha · 34 ans · Lyon ». */
export const IDENTITY = ['first_name', 'age', 'location'] as const satisfies readonly FanCardField[];
type IdentityField = (typeof IDENTITY)[number];

/** Each part of the identity line by its short name, for its source and its doubt. */
export const IDENTITY_WORDS: Readonly<Record<IdentityField, string>> = {
  first_name: 'prénom',
  age: 'âge',
  location: 'ville',
};

/** A part of the identity line: an age of digits is said in years, the rest as it was noted. */
export function identityText(field: IdentityField, items: readonly string[]): string {
  const text = valueText(field, items);
  return field === 'age' && /^\d{1,3}$/u.test(text.trim()) ? `${text.trim()} ans` : text;
}

/** A label as it reads inside a sentence: its first letter in lower case. */
export const lowerFirst = (text: string): string => text.charAt(0).toLocaleLowerCase('fr-FR') + text.slice(1);

/**
 * Where the identity line comes from, said once (EXT-04): one source when the three parts share it, else one line per
 * source naming its parts, « prénom et âge : dit par lui, hier ».
 */
export function identitySources(entries: readonly FanCardEntry[], now: Date): string[] {
  const bySource = new Map<string, string[]>();
  for (const field of IDENTITY) {
    const { current } = entryOf(entries, field);
    if (current === null) continue;
    const line = sourceLine(current, now);
    bySource.set(line, [...(bySource.get(line) ?? []), IDENTITY_WORDS[field]]);
  }
  if (bySource.size <= 1) return [...bySource.keys()];
  return [...bySource].map(([line, words]) => {
    const named =
      words.length === 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} et ${words.at(-1) ?? ''}`;
    return `${named.charAt(0).toLocaleUpperCase('fr-FR')}${named.slice(1)} : ${lowerFirst(line)}`;
  });
}

/**
 * When the newest value of the card was noted, so that a value noted after the panel first read it is marked
 * « nouveau » (ADR 0086 § 10, EXT-14); `null` for a card with no value yet.
 */
export function newestOf(entries: readonly FanCardEntry[]): string | null {
  let newest: string | null = null;
  for (const { current } of entries)
    if (current !== null && (newest === null || Date.parse(current.observedAt) > Date.parse(newest)))
      newest = current.observedAt;
  return newest;
}
