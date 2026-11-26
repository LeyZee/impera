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

/** A label as it reads inside a sentence: its first letter in lower case. */
const lowerFirst = (text: string): string => text.charAt(0).toLocaleLowerCase('fr-FR') + text.slice(1);

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

/** How many of a group's fields are known, among those it shows: the count on its tab (Charles 21/11, piste C). */
export function groupShare(
  entries: readonly FanCardEntry[],
  group: FanCardGroup,
): { readonly known: number; readonly total: number } {
  const specs = restOf(group);
  const known = specs.filter((spec) => entryOf(entries, spec.field).current !== null).length;
  return { known, total: specs.length };
}

/** How many fields of a group, among those it shows, wait for a chatter: an amber dot on its tab (V-EXT-07). */
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

/** What « N à découvrir » opens (Design 16/11, lot 0141-3): a title, and the fields not known yet under it. */
export interface ToDiscover {
  readonly title: string;
  readonly labels: readonly string[];
}

/**
 * What is not known of him yet, by place: the brief first, then each group. A field with a value or one waiting for a
 * check is not to discover. What is masked while his age is contested is not named either (ADR 0141 § 9).
 */
export function toDiscover(entries: readonly FanCardEntry[], masked: boolean): readonly ToDiscover[] {
  const unknown = (spec: FanCardFieldSpec): boolean => {
    const entry = entryOf(entries, spec.field);
    return entry.current === null && entry.toCheck.length === 0 && !(masked && spec.group === 'intimate');
  };
  const sections = [
    {
      title: 'En bref',
      labels: ESSENTIALS.map(specOf)
        .filter((spec): spec is FanCardFieldSpec => spec !== undefined && unknown(spec))
        .map((spec) => lowerFirst(spec.label)),
    },
    ...PANEL_GROUPS.map(({ group, title }) => ({
      title,
      labels: restOf(group)
        .filter(unknown)
        .map((spec) => lowerFirst(spec.label)),
    })),
  ];
  return sections.filter(({ labels }) => labels.length > 0);
}
