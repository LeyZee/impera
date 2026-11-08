import {
  ApiErrorSchema,
  FAN_CARD_FIELDS,
  FAN_CARD_INTENSITY_LABELS,
  FAN_CARD_ITEMS_MAX,
  FAN_CARD_LEAD_LABELS,
  FAN_CARD_VALUE_INVALID,
  FAN_CARD_VALUE_MAX,
  FAN_CARD_VALUE_UNPROCESSABLE,
  FanCardIntensitySchema,
  FanCardLeadSchema,
  type FanCardEntry,
  type FanCardField,
  type FanCardFieldSpec,
  type FanCardGroup,
  type FanCardSource,
  type FanCardValue,
} from '@impera/contracts';

/**
 * The fan's card in the Suivi (ADR 0085, lot c): the fields in three groups, each value with where it comes from and
 * how old it is, « à vérifier » under a field where the AI read something else than a chatter noted.
 */

export const CARD_GROUPS: readonly { readonly group: FanCardGroup; readonly title: string }[] = [
  { group: 'him', title: 'Lui' },
  { group: 'about_her', title: 'Ce qu’il aime chez elle' },
  { group: 'intimate', title: 'Intime' },
];

/** The two fields whose values are a closed list: chosen in one tap, never typed. */
export type ClosedField = Extract<FanCardField, 'intensity' | 'lead'>;

export const CLOSED_CHOICES: Readonly<Record<ClosedField, readonly { value: string; label: string }[]>> = {
  intensity: FanCardIntensitySchema.options.map((value) => ({
    value,
    label: FAN_CARD_INTENSITY_LABELS[value],
  })),
  lead: FanCardLeadSchema.options.map((value) => ({ value, label: FAN_CARD_LEAD_LABELS[value] })),
};

export const isClosed = (field: FanCardField): field is ClosedField =>
  field === 'intensity' || field === 'lead';

/** A value as the card reads it: a closed value by its label, a list as its items in a row. */
export function valueText(field: FanCardField, items: readonly string[]): string {
  if (isClosed(field)) {
    return items
      .map((item) => CLOSED_CHOICES[field].find((one) => one.value === item)?.label ?? item)
      .join(' · ');
  }
  return items.join(' · ');
}

const SOURCE_WORDS: Readonly<Record<FanCardSource, string>> = {
  declared: 'Dit par lui',
  inferred: 'Deviné',
  noted: 'Noté par un chatteur',
};

/** « hier », « il y a 3 jours »: how old a value is, said as a person says it. */
export function ageOf(iso: string, now: Date): string {
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

/** « Dit par lui, il y a 3 jours » (§ 5): a value guessed is said as a guess. */
export function sourceLine(
  value: Pick<FanCardValue, 'source' | 'observedAt' | 'notedByName'>,
  now: Date,
): string {
  const who =
    value.source === 'noted' && value.notedByName !== null
      ? `Noté par ${value.notedByName}`
      : SOURCE_WORDS[value.source];
  return `${who}, ${ageOf(value.observedAt, now)}`;
}

/**
 * What a chatter needs at a glance (ADR 0086 § 10), always shown on top: first name, age, town, what excites him, what
 * he does not want, the last thing he told. The extension's panel shows the same six.
 */
export const ESSENTIALS: readonly FanCardField[] = [
  'first_name',
  'age',
  'location',
  'desires',
  'limits',
  'life_events',
];

export const essentialSpecs = (): readonly FanCardFieldSpec[] =>
  ESSENTIALS.flatMap((field) => FAN_CARD_FIELDS.filter((spec) => spec.field === field));

/** The specs of a group the essentials do not already show, in the card's order. */
export const fieldsOf = (group: FanCardGroup): readonly FanCardFieldSpec[] =>
  FAN_CARD_FIELDS.filter((spec) => spec.group === group && !ESSENTIALS.includes(spec.field));

/** The entry of a field, an empty one when the server has none for it. */
export function entryOf(entries: readonly FanCardEntry[], field: FanCardField): FanCardEntry {
  return entries.find((one) => one.field === field) ?? { field, current: null, toCheck: [] };
}

/** « 4 sur 9 », and how many wait for a chatter: the folded line of a group, on the fields it holds. */
export function groupLine(
  entries: readonly FanCardEntry[],
  group: FanCardGroup,
): { readonly filled: string; readonly toCheck: number } {
  const specs = fieldsOf(group);
  const known = specs.filter((spec) => entryOf(entries, spec.field).current !== null).length;
  const toCheck = specs.filter((spec) => entryOf(entries, spec.field).toCheck.length > 0).length;
  return { filled: `${String(known)} sur ${String(specs.length)}`, toCheck };
}

/** How many fields of the whole card wait for a chatter: said on the sheet's folded line. */
export const toCheckCount = (entries: readonly FanCardEntry[]): number =>
  entries.filter((entry) => entry.toCheck.length > 0).length;

/** « 1 à vérifier », « 2 à vérifier ». */
export const toCheckWords = (count: number): string => `${String(count)} à vérifier`;

/** What a chatter typed, as the items the server takes: one line, or one item per line for a list. */
export function itemsOf(text: string, shape: FanCardFieldSpec['shape']): string[] {
  if (shape === 'one') {
    const one = text.replace(/\s+/gu, ' ').trim();
    return one === '' ? [] : [one];
  }
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** The value in the field to correct it: a list one item per line. */
export const editText = (items: readonly string[]): string => items.join('\n');

/** Why the save stays shut, before the server is asked; null: it can go. */
export function itemsProblem(items: readonly string[]): string | null {
  if (items.length === 0) return 'Écris une valeur, ou efface la case.';
  if (items.length > FAN_CARD_ITEMS_MAX) return `${String(FAN_CARD_ITEMS_MAX)} éléments au plus.`;
  if (items.some((item) => item.length > FAN_CARD_VALUE_MAX))
    return `${String(FAN_CARD_VALUE_MAX)} caractères au plus par élément.`;
  return null;
}

/** A refusal of the server, in the chatter's words; nothing was written. */
export function cardError(status: number, body: unknown): string {
  const answer = ApiErrorSchema.safeParse(body);
  const code = answer.success ? answer.data.error.code : null;
  if (code === FAN_CARD_VALUE_UNPROCESSABLE || status === 422)
    return 'La fiche ne garde ni adresse, ni numéro, ni e‑mail, ni compte ailleurs : rien n’a été écrit.';
  if (code === FAN_CARD_VALUE_INVALID || status === 400)
    return 'Cette valeur ne va pas dans cette case : rien n’a été écrit.';
  if (status === 404) return 'Ce fan n’existe plus.';
  if (status === 403) return 'Tu ne peux plus ouvrir ce fan : rien n’a été écrit.';
  if (status === 401) return 'Ta session a expiré : reconnecte-toi.';
  return 'Le serveur ne répond pas : rien n’a été écrit. Réessaie dans un instant.';
}
