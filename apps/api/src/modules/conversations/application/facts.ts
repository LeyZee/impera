import { FactCategorySchema } from '@nirvana/contracts';

import type { DraftFact, ProposedFact } from '../domain/ports';

/** The fan's message a fact is read in: his last one the engine saw. */
interface SourceMessage {
  readonly id: DraftFact['sourceMessageId'];
  readonly at: Date;
}

/**
 * The brief's facts as the draft keeps them (P3-02). A category the contract does not know is dropped, and so is
 * `operator_note`: only a chatter writes one, never a model. Each fact is dated by the fan's message it was read
 * in, so a replayed job proposes the same fact at the same date and the `fans` module writes nothing new.
 */
export function readProposedFacts(
  proposed: readonly ProposedFact[],
  source: SourceMessage | null,
  now: Date,
): DraftFact[] {
  const facts: DraftFact[] = [];
  for (const fact of proposed) {
    const category = FactCategorySchema.safeParse(fact.category);
    if (!category.success || category.data === 'operator_note') continue;
    facts.push({
      category: category.data,
      key: fact.key,
      value: fact.value,
      kind: fact.kind,
      confidence: fact.confidence,
      sourceMessageId: source?.id ?? null,
      observedAt: source?.at ?? now,
    });
  }
  return facts;
}

/**
 * A chatter's note on giving the conversation back, as a fact of its own (P3-02). Its slot is its date: notes add
 * up instead of replacing each other, and a replayed job finds the same slot with the same value.
 */
export function operatorNoteFact(note: string, at: Date): DraftFact {
  return {
    category: 'operator_note',
    key: `note_${String(at.getTime())}`,
    value: note,
    kind: 'declared',
    confidence: 1,
    sourceMessageId: null,
    observedAt: at,
  };
}
