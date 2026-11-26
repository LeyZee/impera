import type { ScriptRun } from './script-run';

/**
 * How frank her words may be (Charles 21/11, decided again 26/11 at 21:16): warm, playful and suggestive by default;
 * crude once he is hot and has seen the free teaser of her running script, or as soon as he is crude first, without
 * waiting for a purchase. Never before his adult age is confirmed, never when he asked for nothing explicit. Her crude
 * words are her persona's (her sheet, her sexting examples) or the agency's base style, never the repo's.
 */
export type Register = 'suggestive' | 'crude';

export interface RegisterInput {
  /** His latest run: open, with a teaser of hers he has seen (a free step sent), or a paid step bought. */
  readonly run: Pick<ScriptRun, 'status' | 'steps'> | null;
  /** His desire is in the hot band (`desireBandOf`). */
  readonly hot: boolean;
  /** His own message is crude (`explicit_language`): she may follow him there. */
  readonly heIsCrude: boolean;
  readonly ageConfirmed: boolean;
  /** A human's « rien d'explicite » for him. */
  readonly noExplicit: boolean;
}

export function registerOf(input: RegisterInput): Register {
  if (!input.ageConfirmed || input.noExplicit) return 'suggestive';
  if (input.heIsCrude) return 'crude';
  const { run } = input;
  if (run?.status !== 'open') return 'suggestive';
  const bought = run.steps.some((step) => step.kind === 'paid' && step.outcome === 'bought');
  const teaserSeen = run.steps.some((step) => step.kind === 'free' && step.outcome !== 'refused');
  return bought || (input.hot && teaserSeen) ? 'crude' : 'suggestive';
}
