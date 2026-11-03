import type { FactCategory, FactKind } from '@nirvana/contracts';

/**
 * What the creator reads of her fan's facts (CR-02, Bilan's review of #464): only what he said himself. Never a
 * chatter's note (`operator_note`: it would tell her someone writes in her place), never what the model deduced
 * (`inferred`: she does not see the AI, ADR 0042 § 2), and never his buying profile (`commercial`: Charles, 03/11,
 * no exact detail for her). Decided here, in code, never in a prompt (rule 3 of CLAUDE.md).
 */
const HIDDEN_FROM_CREATOR: ReadonlySet<FactCategory> = new Set(['operator_note', 'commercial']);

export function creatorNotesOf(
  facts: readonly { readonly category: FactCategory; readonly kind: FactKind; readonly value: string }[],
): string[] {
  return facts
    .filter((fact) => fact.kind === 'declared' && !HIDDEN_FROM_CREATOR.has(fact.category))
    .map((fact) => fact.value)
    .filter((value) => value.length > 0);
}
