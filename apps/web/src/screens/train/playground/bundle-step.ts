import type { PlaygroundState } from '@impera/contracts';

/** A media of a turn, as the playground's state carries it. */
export type TurnMedia = NonNullable<PlaygroundState['history'][number]['media']>[number];

/** A step of a script on a turn: every media of the turn carries the same. */
export type BundleStep = NonNullable<TurnMedia['scriptStep']>;

const NOUNS = {
  image: ['photo', 'photos'],
  video: ['vidéo', 'vidéos'],
  audio: ['vocal', 'vocaux'],
} as const;

/** What a bundle holds, as Reveal says it on a locked message: « 3 photos · 1 vidéo ». The teaser is not counted. */
export function bundleCount(media: readonly TurnMedia[]): string {
  const sold = media.filter((each) => each.scriptMedia?.teaser !== true);
  return (['image', 'video', 'audio'] as const)
    .map((kind) => {
      const n = sold.filter((each) => each.description.kind === kind).length;
      return n === 0 ? null : `${String(n)} ${NOUNS[kind][n === 1 ? 0 : 1]}`;
    })
    .filter((part): part is string => part !== null)
    .join(' · ');
}

/** The step a turn carries, when it is a step of a script: its media then show as one bundle, as on Reveal. */
export const bundleStepOf = (media: readonly TurnMedia[] | undefined): BundleStep | undefined =>
  media?.find((each) => each.scriptStep !== undefined)?.scriptStep;

/** How many tiles a bundle shows before « +N »: the rest is counted on the last one. */
export const BUNDLE_TILES = 4;

/** One of four generated tints for a trial media, from its ref: the same media keeps its tint. Never an image. */
const TINTS = [1, 2, 3, 4] as const;
export function trialTint(ref: string): (typeof TINTS)[number] {
  let sum = 0;
  for (const char of ref) sum = (sum * 31 + char.charCodeAt(0)) % 9973;
  return TINTS[sum % TINTS.length] ?? 1;
}
