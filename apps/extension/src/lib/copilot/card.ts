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
  { group: 'about_her', title: 'Ce qu’il aime chez elle' },
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

function closedLabel(field: FanCardField, item: string): string {
  if (field === 'intensity') {
    const value = FanCardIntensitySchema.safeParse(item);
    return value.success ? FAN_CARD_INTENSITY_LABELS[value.data] : item;
  }
  if (field === 'lead') {
    const value = FanCardLeadSchema.safeParse(item);
    return value.success ? FAN_CARD_LEAD_LABELS[value.data] : item;
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

/** How many fields wait for a chatter (ADR 0085 § 6): said in amber, it stops nothing. */
export const toCheckCount = (entries: readonly FanCardEntry[]): number =>
  entries.filter((entry) => entry.toCheck.length > 0).length;
