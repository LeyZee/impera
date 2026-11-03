import {
  normaliseWords,
  type PersonaLimits,
  type ScriptDisgustBlock,
  type ScriptSegment,
} from '@nirvana/contracts';

/** The persona entries a stage must not touch: what she never does, never shows, and what disgusts her (ADR 0056 § 1). */
const stageTerms = (limits: PersonaLimits): readonly string[] => [
  ...limits.never_do,
  ...limits.never_show,
  ...limits.disgusts,
];

/** A bridge's teaser is a sentence she says: what she never says, and what disgusts her (Agent's review of SC-01). */
const bridgeTerms = (limits: PersonaLimits): readonly string[] => [...limits.never_say, ...limits.disgusts];

const prepared = (terms: readonly string[]) =>
  terms.map((term) => ({ term, words: normaliseWords(term) })).filter((entry) => entry.words !== '');

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
 * The segments of a structure that touch one of her limits, read in code (never by a model): a stage against what she
 * never does, never shows and is disgusted by; a bridge's teaser against what she never says and is disgusted by. An
 * entry matches as whole words, case, accents and look-alike letters set aside (`normaliseWords`), so « pieds » blocks
 * « Pieds nus » and not « trépied ». One block per segment and entry. Empty: the structure can be asked of her.
 */
export function disgustBlocks(
  segments: readonly ScriptSegment[],
  limits: PersonaLimits,
): ScriptDisgustBlock[] {
  const forStage = prepared(stageTerms(limits));
  const forBridge = prepared(bridgeTerms(limits));
  const blocks: ScriptDisgustBlock[] = [];
  for (const segment of segments) {
    const stage = segment.kind === 'stage';
    const words = stage ? stageWords(segment) : ` ${normaliseWords(segment.teaser)} `;
    const found = new Set<string>();
    for (const { term, words: needle } of stage ? forStage : forBridge) {
      if (found.has(needle) || !words.includes(` ${needle} `)) continue;
      found.add(needle);
      blocks.push({ key: segment.key, stageName: stage ? segment.name : segment.teaser, term });
    }
  }
  return blocks;
}
