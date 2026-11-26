import type { ScriptRun } from './script-run';

/**
 * How frank her words may be (Charles 21/11): warm, playful and suggestive by default, never crude outside the
 * action; crude only once the action is engaged, a paid step of the evening's script bought and the run still open.
 * Her crude words are her persona's (her sheet, her sexting examples), never the repo's.
 */
export type Register = 'suggestive' | 'crude';

export function registerOf(run: Pick<ScriptRun, 'status' | 'steps'> | null): Register {
  const engaged =
    run?.status === 'open' && run.steps.some((step) => step.kind === 'paid' && step.outcome === 'bought');
  return engaged ? 'crude' : 'suggestive';
}
