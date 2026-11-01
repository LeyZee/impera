import {
  FactCategorySchema,
  type FactCategory,
  type FactKind,
  type KycSlot,
  type MessageId,
} from '@nirvana/contracts';

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
  readonly value: string;
  readonly kind: FactKind;
  readonly confidence: number;
  readonly sourceMessageId: MessageId | null;
  readonly observedAt: Date;
  readonly expiresAt: Date | null;
  readonly supersededBy: string | null;
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

/** A fact to write, and the active fact it supersedes if any. */
export interface FactWrite {
  readonly fact: Omit<StoredFact, 'id' | 'supersededBy'>;
  readonly supersedes: string | null;
}

/** Keys come from a model: « City », « city » and « city » are one slot. */
function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, '_');
}

function normalizeValue(value: string, category: FactCategory): string {
  const max = category === 'operator_note' ? MAX_OPERATOR_NOTE_LENGTH : MAX_FACT_VALUE_LENGTH;
  return value.trim().replace(/\s+/g, ' ').slice(0, max);
}

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
      .filter((fact) => isActive(fact, now) && fact.category !== 'operator_note')
      .map((fact) => normalizeKey(fact.key)),
  );
  return slots.filter((slot) => !learnt.has(slot));
}

const slot = (fact: { readonly category: FactCategory; readonly key: string }) =>
  `${fact.category}:${fact.key}`;

/** Still true at `now`: not superseded, not expired. */
function isActive(fact: StoredFact, now: Date): boolean {
  return fact.supersededBy === null && (fact.expiresAt === null || fact.expiresAt.getTime() > now.getTime());
}

/**
 * What to write for these proposals, against her active facts (append-only, data-model.md):
 * - a new slot is written;
 * - the same value is not written again, unless a declared fact confirms an inferred one;
 * - another value supersedes the old fact (« Lyon en mai, Paris en août »), except that an inferred fact never
 *   replaces a declared one, and a proposal observed before the active fact changes nothing (a replayed job).
 * Proposals are read in order: two values for one slot in a batch keep the last.
 */
export function planFacts(
  active: readonly StoredFact[],
  proposals: readonly FactProposal[],
  now: Date,
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
    const fact: FactWrite['fact'] = {
      category: proposal.category,
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
      if (fact.kind === 'inferred' && old.kind === 'declared') continue;
      const sameValue = fact.value.toLowerCase() === old.value.toLowerCase();
      if (sameValue && !(fact.kind === 'declared' && old.kind === 'inferred')) continue;
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
    .filter((fact) => isActive(fact, now))
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
