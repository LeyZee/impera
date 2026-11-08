import {
  FAN_CARD_FIELDS,
  FAN_CARD_QUOTE_MAX,
  FAN_CARD_VALUE_MAX,
  FanCardIntensitySchema,
  FanCardLeadSchema,
  fanCardFieldSpec,
  type FanCardField,
  type FanCardSource,
  type MessageId,
  type UserId,
} from '@impera/contracts';

import { FanCardValueInvalid, FanCardValueRefused } from './errors';
import { fieldOfFact, isActive, saysSomething, SOURCE_RANK, type FactWrite, type StoredFact } from './facts';

/**
 * The fan's card (ADR 0085): his facts read field by field, and a chatter's correction planned against them. Pure: the
 * store reads and writes, the service calls these.
 */

/** How the items of a list field are kept in one `fan_facts.value` (one slot per field, § 1). */
const LIST_SEPARATOR = ' · ';

/** The items of a value, as the card shows them: a list field splits, a one-value field is one item. */
export function itemsOf(field: FanCardField, value: string): string[] {
  if (fanCardFieldSpec(field).shape === 'one') return [value];
  return value
    .split(LIST_SEPARATOR)
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/** Items kept in one value; the separator never appears inside an item. */
function valueOf(items: readonly string[]): string {
  return items.map((item) => item.replaceAll('·', ' ').replace(/\s+/gu, ' ').trim()).join(LIST_SEPARATOR);
}

/**
 * What the card never keeps (§ 8), the forms of the agent's contact guards: an address on the web, an e-mail, a phone
 * number, an @account, a network or messaging app. Religion, opinions, origin and detailed health are not words a
 * pattern finds: the prompt of `fans.read_card` keeps them out (lot b).
 */
const NEVER_KEPT: readonly RegExp[] = [
  /\b(https?:\/\/|www\.)\S+/iu,
  /\b[\w.+-]+ ?@ ?[\w-]+ ?\. ?[a-z]{2,}\b/iu,
  /(\+?\d[\s.,/-]{0,2}){9,}/u,
  /(^|\s)@[\w.]{2,}/u,
  /\b(snap(chat)?|whats ?app|insta(gram)?|telegram|tik ?tok|facebook|messenger|twitter|signal|discord|onlyfans|mym)\b/iu,
];

/** Whether a value holds what the card never keeps (§ 8). */
export function neverKept(value: string): boolean {
  return NEVER_KEPT.some((pattern) => pattern.test(value));
}

/** A chatter's gesture on a field (§ 6): write its items, or clear it. */
export type CardEdit = { readonly items: readonly string[] } | { readonly clear: true };

/**
 * The value a chatter's items make for this field, or the refusal: a one-value field takes one item, `intensity` and
 * `lead` a value of their closed list, a list fits the 300 characters of a line, and nothing the card never keeps.
 */
export function checkedValue(field: FanCardField, items: readonly string[]): string {
  const spec = fanCardFieldSpec(field);
  if (spec.shape === 'one' && items.length !== 1) throw new FanCardValueInvalid();
  const [first = ''] = items;
  if (field === 'intensity' && !FanCardIntensitySchema.safeParse(first).success)
    throw new FanCardValueInvalid();
  if (field === 'lead' && !FanCardLeadSchema.safeParse(first).success) throw new FanCardValueInvalid();
  const value = valueOf(items);
  if (value === '' || value.length > FAN_CARD_VALUE_MAX) throw new FanCardValueInvalid();
  if (items.some(neverKept)) throw new FanCardValueRefused();
  return value;
}

/** His active facts of a field, whatever category they were written in before the card existed. */
const factsOfField = (field: FanCardField, active: readonly StoredFact[], now: Date): StoredFact[] =>
  active.filter((fact) => isActive(fact, now) && fieldOfFact(fact) === field);

/** The fact a field shows: the strongest source, then the newest (§ 6). */
function shownFact(facts: readonly StoredFact[]): StoredFact | undefined {
  return [...facts].sort(
    (a, b) => SOURCE_RANK[b.kind] - SOURCE_RANK[a.kind] || b.observedAt.getTime() - a.observedAt.getTime(),
  )[0];
}

/** What a waiting value « à vérifier » is: never kept again once a chatter writes the field. */
const isWaitingOn = (fact: StoredFact, shown: StoredFact, now: Date): boolean =>
  fact.supersededBy === shown.id &&
  fact.kind !== 'noted' &&
  saysSomething(fact) &&
  fact.observedAt.getTime() > shown.observedAt.getTime() &&
  (fact.expiresAt === null || fact.expiresAt.getTime() > now.getTime());

/**
 * A chatter writes a field (§ 6): a `noted` line in the field's category, superseding every active fact of the field.
 * Nothing is written when the field already shows his note with these words and nothing waits under it: the gesture
 * is idempotent. Writing the value he keeps settles what was « à vérifier », since those waited on the old note.
 */
export function planCardEdit(
  field: FanCardField,
  edit: CardEdit,
  active: readonly StoredFact[],
  pending: readonly StoredFact[],
  author: UserId,
  now: Date,
): FactWrite[] {
  const value = 'clear' in edit ? '' : checkedValue(field, edit.items);
  const facts = factsOfField(field, active, now);
  const shown = shownFact(facts);
  const unchanged = shown?.kind === 'noted' && shown.value === value;
  if (unchanged && !pending.some((fact) => isWaitingOn(fact, shown, now))) return [];
  if (shown === undefined && value === '') return [];
  return [
    {
      fact: {
        category: fanCardFieldSpec(field).category,
        key: field,
        value,
        kind: 'noted',
        confidence: 1,
        sourceMessageId: null,
        observedAt: now,
        expiresAt: null,
        notedBy: author,
      },
      supersedes: shown?.id ?? null,
      alsoSupersedes: facts.filter((fact) => fact.id !== shown?.id).map((fact) => fact.id),
    },
  ];
}

/** A value of the card as the domain reads it, before the route dates it. */
export interface CardValue {
  readonly items: readonly string[];
  readonly source: FanCardSource;
  readonly observedAt: Date;
  readonly notedBy: UserId | null;
  readonly notedByName: string | null;
  readonly sourceMessageId: MessageId | null;
}

interface CardEntry {
  readonly field: FanCardField;
  readonly current: CardValue | null;
  readonly toCheck: readonly CardValue[];
}

interface CardOther {
  readonly key: string;
  readonly value: string;
  readonly source: FanCardSource;
  readonly observedAt: Date;
}

export interface Card {
  readonly fields: readonly CardEntry[];
  readonly others: readonly CardOther[];
}

/** Members' display names by id: who noted a value (§ 5). */
export type MemberNames = ReadonlyMap<string, string>;

function cardValue(field: FanCardField, fact: StoredFact, names: MemberNames): CardValue {
  const notedBy = fact.notedBy ?? null;
  return {
    items: itemsOf(field, fact.value),
    source: fact.kind,
    observedAt: fact.observedAt,
    notedBy,
    notedByName: notedBy === null ? null : (names.get(notedBy) ?? null),
    sourceMessageId: fact.sourceMessageId,
  };
}

/**
 * His message as a value of the card quotes it (§ 5): on one line, cut to `FAN_CARD_QUOTE_MAX` with an ellipsis; null
 * when nothing is left to read (a media alone).
 */
export function quoteOf(text: string): string | null {
  const line = text.replace(/\s+/gu, ' ').trim();
  if (line === '') return null;
  const chars = Array.from(line);
  if (chars.length <= FAN_CARD_QUOTE_MAX) return line;
  return `${chars
    .slice(0, FAN_CARD_QUOTE_MAX - 1)
    .join('')
    .trimEnd()}…`;
}

const newestFirst = (a: StoredFact, b: StoredFact): number => b.observedAt.getTime() - a.observedAt.getTime();

/**
 * His card (§ 3, § 6): each field in the card's order, its shown value (none when cleared) and what waits under it;
 * then « Autres », the facts outside the fields, a chatter's notes at the hand-back included, newest first.
 */
export function cardOf(
  active: readonly StoredFact[],
  pending: readonly StoredFact[],
  now: Date,
  names: MemberNames = new Map(),
): Card {
  const fields = FAN_CARD_FIELDS.map(({ field }): CardEntry => {
    const shown = shownFact(factsOfField(field, active, now));
    if (shown === undefined) return { field, current: null, toCheck: [] };
    return {
      field,
      current: saysSomething(shown) ? cardValue(field, shown, names) : null,
      toCheck: pending
        .filter((fact) => isWaitingOn(fact, shown, now))
        .sort(newestFirst)
        .map((fact) => cardValue(field, fact, names)),
    };
  });
  const others = active
    .filter((fact) => isActive(fact, now) && saysSomething(fact) && fieldOfFact(fact) === null)
    .sort(newestFirst)
    .map((fact): CardOther => ({
      key: fact.key,
      value: fact.value,
      source: fact.category === 'operator_note' ? 'noted' : fact.kind,
      observedAt: fact.observedAt,
    }));
  return { fields, others };
}
