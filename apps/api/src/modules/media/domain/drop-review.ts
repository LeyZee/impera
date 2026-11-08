import type { DescriptionReviewReason, DropMediaDescription } from '@impera/contracts';

/**
 * Words that point to another media (ADR 0083 § 3): each media is described as if it were the only one, so a
 * description that says « à nouveau » or « la même robe » has read something it should not have, or invented it.
 * Matched on whole words, case and accents folded, outside her quoted words.
 */
const BACK_REFERENCES: readonly RegExp[] = [
  /\ba nouveau\b/u,
  /\bde nouveau\b/u,
  /\bencore\b/u,
  /\btoujours\b/u,
  /\bla meme\b/u,
  /\ble meme\b/u,
  /\bles memes\b/u,
  /\bcomme sur\b/u,
  /\bcomme avant\b/u,
  /\bcomme precedemment\b/u,
  /\bprecedent(e|s|es)?\b/u,
];

/** What she says is quoted, and is hers: « encore ! » in her mouth points to nothing. */
const QUOTED = /«[^»]*»|"[^"]*"|“[^”]*”/gu;

const folded = (text: string): string =>
  text
    .replace(QUOTED, ' ')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[’']/gu, ' ');

/** Whether a description points to another media (ADR 0083 § 3). */
export function pointsElsewhere(
  description: Pick<DropMediaDescription, 'detailed' | 'factualDescription' | 'segments'>,
): boolean {
  const text = folded(
    [
      description.detailed,
      description.factualDescription,
      ...description.segments.map((s) => s.description),
    ].join('\n'),
  );
  return BACK_REFERENCES.some((pattern) => pattern.test(text));
}

/**
 * Why a description of hers waits for a human (ADR 0083 § 3 to 5), read by the code, never trusted to the model:
 * she always shoots alone, so another person seen or flagged is a doubt to clear, not a fact.
 */
export function reviewReasonsOf(description: DropMediaDescription): DescriptionReviewReason[] {
  const reasons: DescriptionReviewReason[] = [];
  if (pointsElsewhere(description)) reasons.push('back_reference');
  if (
    description.castMode === 'duo' ||
    description.castMode === 'group' ||
    description.flags.includes('identifiable_third_party')
  )
    reasons.push('not_alone');
  if (description.confidenceLow || description.notVisible) reasons.push('unsure');
  if (description.flags.some((flag) => flag !== 'identifiable_third_party')) reasons.push('flagged');
  return reasons;
}
