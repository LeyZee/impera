import type { ScriptRun } from './script-run';

/**
 * He left in the middle of a script (Charles, 20/11): the run went cold with a paid step still waiting for him, never
 * bought. When he comes back hot, she does not pick the game up as if nothing happened: she teases him about it first.
 * The first time, once, playful; after a second run he left, she is vexed, and comes back on it on each hot message
 * of his until she said it enough. No step goes on a message where she teases him, so no script restarts before.
 * Never with a fan she must not sell to (care, fragile, sales frozen): the caller says so through `held`.
 */

/** How many times she teases him about the run he left: once the first time, more once he did it again. */
const TEASES = { first: 1, again: 3 } as const;

export type AbandonTease = keyof typeof TEASES;

/** A run he left: it went cold with a paid step waiting, sent or opened, never bought nor refused. */
export function isAbandon(run: ScriptRun): boolean {
  const last = run.steps.at(-1);
  return (
    run.status === 'stalled' &&
    last?.kind === 'paid' &&
    (last.outcome === 'sent' || last.outcome === 'opened')
  );
}

export interface AbandonInput {
  readonly now: Date;
  /** His latest run, as stored. */
  readonly latest: ScriptRun | null;
  /** His runs before the latest that went cold: those he left count toward « again ». */
  readonly earlier: readonly ScriptRun[];
  /** How many times she already teased him about the latest run. */
  readonly teased: number;
  /** His desire at or above her opening score on this message: she teases him only when he comes back hot. */
  readonly hot: boolean;
  /** Nothing may be sold to him now (care, fragile, sales frozen, do not contact): no tease either. */
  readonly held: boolean;
}

/** Whether she teases him on this message about the run he left, and how: `null`, she does not. */
export function abandonTease(input: AbandonInput): AbandonTease | null {
  const { latest } = input;
  if (latest === null || !isAbandon(latest) || input.held || !input.hot) return null;
  // The message the run went cold at recalls the step waiting (ADR 0156 § 1): the tease is for when he comes back.
  if (latest.endedAt === null || latest.endedAt.getTime() >= input.now.getTime()) return null;
  const kind: AbandonTease = input.earlier.some(isAbandon) ? 'again' : 'first';
  return input.teased < TEASES[kind] ? kind : null;
}
