import type { FanFlags } from '@impera/contracts';

import { maySulk } from './policy';
import type { ScriptRun } from './script-run';

/**
 * What she does after he refused a paid step (ADR 0156 § 3), in this order, one move per answer of hers: she asks what
 * he did not like, insists a little once, sulks once at most, then lets go. Code decides the move, the voice only
 * writes it (CLAUDE.md rule 3).
 */
export type RefusalMove = 'ask_why' | 'insist' | 'sulk';

/** The moves in their order: her first answer after the refusal asks why, the second insists, the third sulks. */
const MOVES: readonly RefusalMove[] = ['ask_why', 'insist', 'sulk'];

/** The refusal belongs to the session it happened in: past this, he comes back to her, and nothing is held. */
export const REFUSAL_SESSION_MS = 6 * 3_600_000;

export interface RefusalMoment {
  readonly now: Date;
  /** His latest run, as the turn left it: a refusal is a run that ended `refused`. */
  readonly run: ScriptRun | null;
  /** How many answers of hers went out since the run ended: the move is the next one in the order. */
  readonly herAnswersSince: number;
  readonly flags: FanFlags;
  /** The care mode is open (ADR 0088): nothing that pushes a sale. */
  readonly care: boolean;
}

/**
 * Her move on this answer after his refusal, or `null` when none is left. Pushing back a little (insisting, sulking)
 * is never for a fan whose sales are frozen, who is fragile, nobody may write to, or in the care mode (`maySulk`), nor
 * for one who already paid a step of this script: to him she only asks what did not please him. A refusal from another
 * session holds nothing.
 */
export function refusalMove(moment: RefusalMoment): RefusalMove | null {
  const { run } = moment;
  if (run?.status !== 'refused' || run.endedAt === null) return null;
  if (moment.now.getTime() - run.endedAt.getTime() > REFUSAL_SESSION_MS) return null;
  const move = MOVES[moment.herAnswersSince];
  if (move === undefined) return null;
  if (move === 'ask_why') return move;
  // He already paid a step of this script: no whining, aftercare (Charles, 20/11). Only a fan who paid nothing in it.
  if (run.steps.some((step) => step.outcome === 'bought')) return null;
  return !moment.care && maySulk(moment.flags) ? move : null;
}
