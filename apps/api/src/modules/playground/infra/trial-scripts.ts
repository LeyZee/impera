import type { AgentScriptView as PlatformScriptView } from '../../agent/index';

import type { PlaygroundScript, ShownMedia, ShownStep } from './catalogue';

/**
 * The trial scripts of the playground (ADR 0103 § 15-17): an invented catalogue, read exactly as a platform's, so that
 * a fictive sale runs from start to end by the same domain functions as production (start gate, next step,
 * reconciliation). Invented from end to end: no media of hers, no price of the agency, nothing a fan ever received.
 * The invented persona plays these; one of her versions plays her own scripts. Marked « essai » on screen.
 */

interface TrialStep {
  readonly kind: 'free' | 'paid' | 'bridge';
  readonly priceMinor?: number;
  readonly instruction: string;
  readonly text?: string;
  readonly media?: readonly ShownMedia[];
  readonly teaser?: readonly ShownMedia[];
}

const photo = (n: number, description: string): ShownMedia => ({
  ref: `essai-media-${String(n)}`,
  kind: 'image',
  description,
});
const video = (n: number, description: string): ShownMedia => ({
  ref: `essai-media-${String(n)}`,
  kind: 'video',
  description,
});

/** A trial script as a platform would list it: its steps in order, each with its bundle. */
function trialOf(
  scriptRef: string,
  name: string,
  moment: 'day' | 'night',
  description: string,
  steps: readonly TrialStep[],
): PlaygroundScript {
  const view: PlatformScriptView = {
    scriptRef,
    moment,
    description,
    steps: steps.map((step, index) => {
      const media = step.media ?? [];
      return {
        stepRef: `${scriptRef}:${String(index)}`,
        kind: step.kind,
        priceMinor: step.priceMinor ?? null,
        instruction: step.instruction,
        ...(media.length > 0 && {
          mediaSheet: media.map((each) => each.description ?? '').join(' '),
        }),
        mediaRefs: media.map((each) => each.ref),
      };
    }),
    mediaValidated: true,
    descriptionValidated: true,
    touchesLimits: false,
  };
  const shown: ShownStep[] = steps.map((step) => ({
    text: step.text ?? '',
    media: step.media ?? [],
    teaser: step.teaser ?? [],
  }));
  return { view, name, steps: shown };
}

export const TRIAL_CATALOGUE: readonly PlaygroundScript[] = [
  trialOf(
    'essai-jour',
    'Essai · Jour',
    'day',
    'Elle se prépare pour une soirée et lui montre où elle en est, de plus en plus près.',
    [
      {
        kind: 'free',
        instruction: 'Elle lui montre un aperçu, complice, sans rien promettre.',
        text: 'Devine où j’en suis 🙈',
        media: [photo(1, 'Photo d’elle devant le miroir, tenue de soirée pas encore finie, lumière douce.')],
      },
      {
        kind: 'paid',
        priceMinor: 900,
        instruction: 'Elle lui propose la suite, sans insister.',
        text: 'La tenue finie, rien que pour toi',
        teaser: [photo(2, 'Photo d’elle de dos dans la tenue finie, cadrage large.')],
        media: [
          photo(3, 'Photo d’elle dans la tenue finie, cadrage plus serré, regard vers l’objectif.'),
          photo(4, 'Photo d’elle assise au bord du lit, chaussures à la main.'),
          photo(5, 'Photo d’elle qui rit devant le miroir, la main dans les cheveux.'),
        ],
      },
      {
        kind: 'bridge',
        instruction: 'Elle lui demande ce qu’il a préféré, et laisse planer la suite.',
      },
      {
        kind: 'paid',
        priceMinor: 1500,
        instruction: 'Elle lui propose la vidéo, comme un secret entre eux.',
        text: 'Celle-là, je ne l’ai montrée à personne',
        media: [
          video(6, 'Courte vidéo d’elle qui tourne sur elle-même dans la tenue, musique douce.'),
          photo(7, 'Photo d’elle prête à partir, manteau sur l’épaule.'),
        ],
      },
    ],
  ),
  trialOf(
    'essai-nuit',
    'Essai · Nuit',
    'night',
    'Fin de soirée, elle est rentrée et ne dort pas encore : un moment à deux, tard.',
    [
      {
        kind: 'free',
        instruction: 'Elle lui montre qu’elle est rentrée, détendue.',
        text: 'Enfin rentrée 😌',
        media: [photo(8, 'Photo d’elle sur le canapé, lumière tamisée, plaid sur les jambes.')],
      },
      {
        kind: 'paid',
        priceMinor: 1200,
        instruction: 'Elle lui propose une photo plus intime, avec douceur.',
        text: 'Juste entre nous',
        teaser: [photo(9, 'Photo d’elle de profil près de la lampe, en tenue de nuit.')],
        media: [
          photo(10, 'Photo d’elle en tenue de nuit, cadrage serré, ambiance tamisée.'),
          photo(11, 'Photo d’elle allongée, le téléphone à la main, sourire en coin.'),
        ],
      },
      {
        kind: 'paid',
        priceMinor: 2000,
        instruction: 'Elle lui propose la vidéo de la fin de soirée.',
        text: 'Pour finir la soirée',
        media: [
          video(12, 'Vidéo d’elle qui lui souhaite bonne nuit, voix basse, lumière d’une lampe.'),
          video(13, 'Courte vidéo d’elle qui éteint la lampe en riant.'),
          photo(14, 'Photo d’elle sous la couette, seul son regard dépasse.'),
          photo(15, 'Photo de la lampe de chevet allumée, la pièce dans la pénombre.'),
        ],
      },
    ],
  ),
];

/** The trial scripts as the agent reads them. */
export const TRIAL_SCRIPTS: readonly PlatformScriptView[] = TRIAL_CATALOGUE.map((script) => script.view);
