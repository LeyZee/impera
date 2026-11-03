import {
  normaliseWords,
  type PersonaLimits,
  type ScriptDisgustBlock,
  type ScriptSegment,
} from '@impera/contracts';

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

/** What a segment is read as, against which entries: a bridge twice, its teaser said and its slots shot. */
function readings(
  segment: ScriptSegment,
  forStage: ReturnType<typeof prepared>,
  forBridge: ReturnType<typeof prepared>,
): { readonly words: string; readonly terms: ReturnType<typeof prepared> }[] {
  if (segment.kind === 'stage') return [{ words: stageWords(segment), terms: forStage }];
  const shot = segment.mediaSlots.map((slot) => slot.hint ?? '').join(' ');
  return [
    { words: ` ${normaliseWords(segment.teaser)} `, terms: forBridge },
    { words: ` ${normaliseWords(shot)} `, terms: forStage },
  ];
}

/**
 * The segments of a structure that touch one of her limits, read in code (never by a model): a stage against what she
 * never does, never shows and is disgusted by; a bridge's teaser against what she never says and is disgusted by, and
 * the hints of its media slots, which she shoots, as a stage's (Agent's review of SC-01 b). An entry matches as whole
 * words, case, accents and look-alike letters set aside (`normaliseWords`), so « pieds » blocks « Pieds nus » and not
 * « trépied ». One block per segment and entry. Empty: the structure can be asked of her.
 */
export function disgustBlocks(
  segments: readonly ScriptSegment[],
  limits: PersonaLimits,
): ScriptDisgustBlock[] {
  const forStage = prepared(stageTerms(limits));
  const forBridge = prepared(bridgeTerms(limits));
  const blocks: ScriptDisgustBlock[] = [];
  for (const segment of segments) {
    const stageName = segment.kind === 'stage' ? segment.name : segment.teaser;
    const found = new Set<string>();
    for (const { words, terms } of readings(segment, forStage, forBridge))
      for (const { term, words: needle } of terms) {
        if (found.has(needle) || !words.includes(` ${needle} `)) continue;
        found.add(needle);
        blocks.push({ key: segment.key, stageName, term });
      }
  }
  return blocks;
}
