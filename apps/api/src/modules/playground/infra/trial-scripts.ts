import type { AgentScriptView as PlatformScriptView } from '../../agent/index';

/**
 * The trial scripts of the playground (ADR 0103 § 15-17): an invented catalogue, read exactly as a platform's, so that
 * a fictive sale runs from start to end by the same domain functions as production (start gate, next step,
 * reconciliation). Invented from end to end: no media of hers, no price of the agency, nothing a fan ever received.
 * Her own catalogue takes its place in a later lot; until then every persona plays these, marked « essai » on screen.
 */
export const TRIAL_SCRIPTS: readonly PlatformScriptView[] = [
  {
    scriptRef: 'essai-jour',
    moment: 'day',
    description: 'Elle se prépare pour une soirée et lui montre où elle en est, de plus en plus près.',
    steps: [
      {
        stepRef: 'essai-jour:0',
        kind: 'free',
        priceMinor: null,
        instruction: 'Elle lui montre un aperçu, complice, sans rien promettre.',
        mediaSheet: 'Photo d’elle devant le miroir, tenue de soirée pas encore finie, lumière douce.',
        mediaRefs: ['essai-media-1'],
      },
      {
        stepRef: 'essai-jour:1',
        kind: 'paid',
        priceMinor: 900,
        instruction: 'Elle lui propose la suite, sans insister.',
        mediaSheet: 'Photo d’elle dans la tenue finie, cadrage plus serré, regard vers l’objectif.',
        mediaRefs: ['essai-media-2'],
      },
      {
        stepRef: 'essai-jour:2',
        kind: 'bridge',
        priceMinor: null,
        instruction: 'Elle lui demande ce qu’il a préféré, et laisse planer la suite.',
        mediaRefs: [],
      },
      {
        stepRef: 'essai-jour:3',
        kind: 'paid',
        priceMinor: 1500,
        instruction: 'Elle lui propose la vidéo, comme un secret entre eux.',
        mediaSheet: 'Courte vidéo d’elle qui tourne sur elle-même dans la tenue, musique douce.',
        mediaRefs: ['essai-media-3'],
      },
    ],
    mediaValidated: true,
    descriptionValidated: true,
    touchesLimits: false,
  },
  {
    scriptRef: 'essai-nuit',
    moment: 'night',
    description: 'Fin de soirée, elle est rentrée et ne dort pas encore : un moment à deux, tard.',
    steps: [
      {
        stepRef: 'essai-nuit:0',
        kind: 'free',
        priceMinor: null,
        instruction: 'Elle lui montre qu’elle est rentrée, détendue.',
        mediaSheet: 'Photo d’elle sur le canapé, lumière tamisée, plaid sur les jambes.',
        mediaRefs: ['essai-media-4'],
      },
      {
        stepRef: 'essai-nuit:1',
        kind: 'paid',
        priceMinor: 1200,
        instruction: 'Elle lui propose une photo plus intime, avec douceur.',
        mediaSheet: 'Photo d’elle en tenue de nuit, cadrage serré, ambiance tamisée.',
        mediaRefs: ['essai-media-5'],
      },
      {
        stepRef: 'essai-nuit:2',
        kind: 'paid',
        priceMinor: 2000,
        instruction: 'Elle lui propose la vidéo de la fin de soirée.',
        mediaSheet: 'Vidéo d’elle qui lui souhaite bonne nuit, voix basse, lumière d’une lampe.',
        mediaRefs: ['essai-media-6'],
      },
    ],
    mediaValidated: true,
    descriptionValidated: true,
    touchesLimits: false,
  },
];

/** The trial script of this ref, as the screen names it; `undefined` for any other. */
export const trialScript = (scriptRef: string): PlatformScriptView | undefined =>
  TRIAL_SCRIPTS.find((script) => script.scriptRef === scriptRef);
