import {
  normaliseWords,
  type PersonaLimits,
  type ScriptDisgustBlock,
  type ScriptSegment,
} from '@nirvana/contracts';

/** The persona entries a stage must not touch: what she never does, never shows, and what disgusts her (ADR 0056 § 1). */
const refusedTerms = (limits: PersonaLimits): readonly string[] => [
  ...limits.never_do,
  ...limits.never_show,
  ...limits.disgusts,
];

/** Everything the card asks of her for one stage, as the guards read words. */
function stageWords(stage: Extract<ScriptSegment, { kind: 'stage' }>): string {
  const texts = [
    stage.name,
    stage.intention,
    stage.mood ?? '',
    ...stage.mediaSlots.map((slot) => slot.hint ?? ''),
    ...stage.variants.map((variant) => variant.hint),
  ];
  return ` ${normaliseWords(texts.join(' '))} `;
}

/**
 * The stages of a structure that touch one of her limits, read in code (never by a model): an entry matches as whole
 * words, case, accents and look-alike letters set aside (`normaliseWords`), so « pieds » blocks « Pieds nus » and not
 * « trépied ». One block per stage and entry. Empty: the structure can be asked of her.
 */
export function disgustBlocks(
  segments: readonly ScriptSegment[],
  limits: PersonaLimits,
): ScriptDisgustBlock[] {
  const terms = refusedTerms(limits)
    .map((term) => ({ term, words: normaliseWords(term) }))
    .filter((entry) => entry.words !== '');
  const blocks: ScriptDisgustBlock[] = [];
  for (const segment of segments) {
    if (segment.kind !== 'stage') continue;
    const words = stageWords(segment);
    const found = new Set<string>();
    for (const { term, words: needle } of terms) {
      if (found.has(needle) || !words.includes(` ${needle} `)) continue;
      found.add(needle);
      blocks.push({ key: segment.key, stageName: segment.name, term });
    }
  }
  return blocks;
}
