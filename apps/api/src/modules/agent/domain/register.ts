import type { ScriptRun } from './script-run';

/**
 * How frank her words may be (Charles 21/11, decided again 26/11 at 21:16, 22:47 and 23:09): a ladder, not a switch.
 * Before his first paid step, playful with tension, `sensual` at most, even hot with the teaser seen; explicit only when
 * he is clearly crude first. Then it climbs with the intensity of what he has already seen (the media's closed tags),
 * never lower than explicit on an explicit step and never past what a media showed; after the last step, tenderness. Never past suggestive before his adult age is confirmed or when he asked for nothing explicit.
 * The names are neutral: her words for each level are her persona's or the agency's base style, never the repo's.
 */
export const REGISTER_LADDER = ['suggestive', 'sensual', 'explicit', 'very_explicit'] as const;
export type Register = (typeof REGISTER_LADDER)[number] | 'tender';
type Rung = (typeof REGISTER_LADDER)[number];

/** A media's intensity (`MediaDescription.intensity`) as a rung: what she may say of what he has seen. */
const RUNG_OF_INTENSITY: Readonly<Record<string, Rung>> = {
  soft: 'suggestive',
  suggestive: 'sensual',
  explicit: 'explicit',
  hardcore: 'very_explicit',
};

export interface RegisterInput {
  /** His latest run as he has seen it: the steps sent before this answer. */
  readonly run: Pick<ScriptRun, 'status' | 'steps'> | null;
  /** The media intensities of the steps he has seen, from their tags; empty when the catalogue gives none. */
  readonly seenIntensities: readonly string[];
  /** His desire is in the hot band (`desireBandOf`). */
  readonly hot: boolean;
  /** His own message is crude (`explicit_language`): she may follow him there. */
  readonly heIsCrude: boolean;
  /** He came after the last step of her script: tenderness. */
  readonly afterFinale: boolean;
  readonly ageConfirmed: boolean;
  /** A human's « rien d'explicite » for him. */
  readonly noExplicit: boolean;
  /**
   * He already bought from her, ever (Charles 26/11): she may meet his level at once, hot is enough to be frank, without
   * waiting for his crude words or a paid step of this evening. Absent: false.
   */
  readonly boughtBefore?: boolean;
}

const rank = (rung: Rung): number => REGISTER_LADDER.indexOf(rung);
const higher = (a: Rung, b: Rung): Rung => (rank(a) >= rank(b) ? a : b);

export function registerOf(input: RegisterInput): Register {
  if (!input.ageConfirmed || input.noExplicit) return 'suggestive';
  if (input.afterFinale) return 'tender';
  const { run } = input;
  const open = run?.status === 'open';
  const bought = open && run.steps.some((step) => step.kind === 'paid' && step.outcome === 'bought');
  // His own level, capped at explicit: what she may follow without any media. Before his first paid step, sensual at
  // most unless he is crude first, even hot with the teaser seen (Charles 23:09).
  // A fan who already bought from her may be met at his level at once (Charles 26/11): hot is enough.
  const his: Rung =
    input.heIsCrude || bought || (input.boughtBefore === true && input.hot)
      ? 'explicit'
      : input.hot
        ? 'sensual'
        : 'suggestive';
  if (!open) return his;
  // What he has seen sets the floor and lets her go further: never prim on an explicit step.
  const seen = input.seenIntensities
    .map((intensity) => RUNG_OF_INTENSITY[intensity])
    .filter((rung) => rung !== undefined)
    .reduce<Rung>(higher, 'suggestive');
  return higher(his, seen);
}
