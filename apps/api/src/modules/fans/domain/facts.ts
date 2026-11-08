import {
  FactCategorySchema,
  FanCardFieldSchema,
  fanCardFieldSpec,
  type FactCategory,
  type FactKind,
  type FanCardField,
  type KycSlot,
  type MessageId,
  type StoredFactKind,
  type UserId,
} from '@impera/contracts';

/** Facts she brings back in a reply: more would crowd the context (P3-02). */
export const MAX_ACTIVE_FACTS = 40;

/** Longest value kept: a fact is a line of the fan's notes, not a message. */
export const MAX_FACT_VALUE_LENGTH = 300;

/** A chatter's note is kept whole, as long as `release` accepts it. */
export const MAX_OPERATOR_NOTE_LENGTH = 1_000;

/** A fact as stored (`fan_facts`): never changed in place, a newer one supersedes it. */
export interface StoredFact {
  readonly id: string;
  readonly category: FactCategory;
  readonly key: string;
  /** Empty only for a field of his card a chatter cleared (ADR 0085 § 6): never read as a value. */
  readonly value: string;
  readonly kind: StoredFactKind;
  readonly confidence: number;
  readonly sourceMessageId: MessageId | null;
  readonly observedAt: Date;
  readonly expiresAt: Date | null;
  readonly supersededBy: string | null;
  /** The chatter who wrote a `noted` value (ADR 0085 § 5); absent or null for every other kind. */
  readonly notedBy?: UserId | null;
}

/** Something learnt about the fan, from the brief or from a human. */
export interface FactProposal {
  readonly category: FactCategory;
  readonly key: string;
  readonly value: string;
  readonly kind: FactKind;
  readonly confidence: number;
  readonly sourceMessageId: MessageId | null;
  readonly observedAt: Date;
  /** Only for what stops being true (« en vacances jusqu'à lundi »); retention is the purge's (security.md). */
  readonly expiresAt?: Date | null;
}

/**
 * A fact to write, and the active fact it supersedes if any. `overriddenBy`: a value the AI read that contradicts a
 * chatter's note, written already superseded by it, so that it is « à vérifier » on the card and never read as true
 * (ADR 0085 § 6). `alsoSupersedes`: other active facts of a card field written under another category before the card
 * existed, superseded with it.
 */
export interface FactWrite {
  readonly fact: Omit<StoredFact, 'id' | 'supersededBy'>;
  readonly supersedes: string | null;
  readonly overriddenBy?: string;
  readonly alsoSupersedes?: readonly string[];
}

/** Keys come from a model: « City », « city » and « city » are one slot. */
function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, '_');
}

function normalizeValue(value: string, category: FactCategory): string {
  const max = category === 'operator_note' ? MAX_OPERATOR_NOTE_LENGTH : MAX_FACT_VALUE_LENGTH;
  return value.trim().replace(/\s+/g, ' ').slice(0, max);
}

/** The card field a key names (ADR 0085 § 1), whatever its case; null for a key outside the card. */
function cardFieldOf(key: string): FanCardField | null {
  const field = FanCardFieldSchema.safeParse(normalizeKey(key));
  return field.success ? field.data : null;
}

/**
 * The card field a fact fills: its key's, except a chatter's note left at the hand-back, which stays a note whatever
 * its key (« Autres », never a field).
 */
export function fieldOfFact(fact: {
  readonly category: FactCategory;
  readonly key: string;
}): FanCardField | null {
  return fact.category === 'operator_note' ? null : cardFieldOf(fact.key);
}

/** A fact that says something: a field a chatter cleared is an empty line, never a value. */
export const saysSomething = (fact: { readonly value: string }): boolean => fact.value !== '';

/** Order of strength (ADR 0085 § 6): a chatter's note, then what he said, then a guess. */
export const SOURCE_RANK: Readonly<Record<StoredFactKind, number>> = { noted: 3, declared: 2, inferred: 1 };

/**
 * The canvas lines still to learn, among `slots` and in their order (P5-01): a line is learnt once one of his facts
 * still true at `now` has it as key (« Location » and « location » alike), however many facts he has. A chatter's note
 * never fills a line.
 */
export function kycSlotsToLearn(
  slots: readonly KycSlot[],
  facts: readonly StoredFact[],
  now: Date,
): KycSlot[] {
  const learnt = new Set(
    facts
      .filter((fact) => isActive(fact, now) && fact.category !== 'operator_note' && saysSomething(fact))
      .map((fact) => normalizeKey(fact.key)),
  );
  return slots.filter((slot) => !learnt.has(slot));
}

/** A card field is one slot whatever the category it was written in (ADR 0085 § 1); any other key, its category's. */
const slot = (fact: { readonly category: FactCategory; readonly key: string }) => {
  const field = fieldOfFact(fact);
  return field === null ? `${fact.category}:${normalizeKey(fact.key)}` : `card:${field}`;
};

/** Still true at `now`: not superseded, not expired. */
export function isActive(fact: StoredFact, now: Date): boolean {
  return fact.supersededBy === null && (fact.expiresAt === null || fact.expiresAt.getTime() > now.getTime());
}

/**
 * What to write for these proposals, against her active facts (append-only, data-model.md):
 * - a new slot is written; a card field is written in its card category (ADR 0085 § 3);
 * - the same value is not written again, unless a declared fact confirms an inferred one;
 * - another value supersedes the old fact (« Lyon en mai, Paris en août »), except that a weaker source never replaces
 *   a stronger one (a chatter's note, then what he said, then a guess, ADR 0085 § 6), and a proposal observed before
 *   the active fact changes nothing (a replayed job);
 * - against a chatter's note, another value is written « à vérifier » (`overriddenBy`), once: `pending` holds those
 *   already waiting.
 * Proposals are read in order: two values for one slot in a batch keep the last.
 */
export function planFacts(
  active: readonly StoredFact[],
  proposals: readonly FactProposal[],
  now: Date,
  pending: readonly StoredFact[] = [],
): FactWrite[] {
  const current = new Map<string, { readonly ref: string | null; readonly fact: FactWrite['fact'] }>();
  for (const fact of active) {
    if (isActive(fact, now)) current.set(slot(fact), { ref: fact.id, fact });
  }
  const writes = new Map<string, FactWrite>();
  for (const proposal of proposals) {
    const key = normalizeKey(proposal.key);
    const value = normalizeValue(proposal.value, proposal.category);
    if (key === '' || value === '') continue;
    const field = fieldOfFact({ category: proposal.category, key });
    const fact: FactWrite['fact'] = {
      category: field === null ? proposal.category : fanCardFieldSpec(field).category,
      key,
      value,
      kind: proposal.kind,
      confidence: proposal.confidence,
      sourceMessageId: proposal.sourceMessageId,
      observedAt: proposal.observedAt,
      expiresAt: proposal.expiresAt ?? null,
    };
    const id = slot(fact);
    const before = current.get(id);
    if (before !== undefined) {
      const old = before.fact;
      if (fact.observedAt.getTime() < old.observedAt.getTime()) continue;
      const sameValue = fact.value.toLowerCase() === old.value.toLowerCase();
      if (SOURCE_RANK[fact.kind] < SOURCE_RANK[old.kind]) {
        // A chatter's note stands; what contradicts it waits under the field for a human, once.
        const waiting = pending.some(
          (one) => one.supersededBy === before.ref && one.value.toLowerCase() === fact.value.toLowerCase(),
        );
        if (old.kind === 'noted' && before.ref !== null && !sameValue && !waiting && !writes.has(id)) {
          writes.set(`${id}:check`, { fact, supersedes: null, overriddenBy: before.ref });
        }
        continue;
      }
      if (sameValue && SOURCE_RANK[fact.kind] === SOURCE_RANK[old.kind]) continue;
    }
    // A slot written earlier in this batch is replaced in the batch: it supersedes what that write superseded.
    const supersedes = writes.get(id)?.supersedes ?? before?.ref ?? null;
    writes.set(id, { fact, supersedes });
    current.set(id, { ref: supersedes, fact });
  }
  return [...writes.values()];
}

// A chatter's notes come first: a human wrote them for her, the 40-fact cap never drops them before a guess.
const CATEGORY_ORDER = new Map(
  ['operator_note', ...FactCategorySchema.options.filter((category) => category !== 'operator_note')].map(
    (category, index) => [category, index],
  ),
);

/**
 * What the context gets (data-model.md): active facts by category (a chatter's notes first), then confidence, then
 * the newest; 40 at most.
 */
export function selectActiveFacts(facts: readonly StoredFact[], now: Date): StoredFact[] {
  return facts
    .filter((fact) => isActive(fact, now) && saysSomething(fact))
    .sort(
      (a, b) =>
        (CATEGORY_ORDER.get(a.category) ?? 0) - (CATEGORY_ORDER.get(b.category) ?? 0) ||
        b.confidence - a.confidence ||
        b.observedAt.getTime() - a.observedAt.getTime(),
    )
    .slice(0, MAX_ACTIVE_FACTS);
}

/** Her facts about a fan are kept this long after his last contact (security.md), then the purge drops them. */
const FACT_RETENTION_DAYS = 365;

/** Fans last seen before this date lose their facts. */
export function factRetentionCutoff(now: Date): Date {
  return new Date(now.getTime() - FACT_RETENTION_DAYS * 86_400_000);
}
