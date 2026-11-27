import {
  DECISION_LATER_MINUTES,
  DECISIONS_SHOWN_MAX,
  type CreatorDecision,
  type DecisionAnswer,
  type DecisionState,
} from '@impera/contracts';

/** A decision as the base keeps it: what she reads, and where it stands. */
export interface StoredDecision extends Omit<CreatorDecision, 'expiresAt'> {
  readonly state: DecisionState;
  readonly answerKey: string | null;
  readonly laterUntil: Date | null;
  readonly expiresAt: Date;
}

/** Still a question at `now`: open, and not past its end. */
export const waits = (decision: StoredDecision, now: Date): boolean =>
  decision.state === 'open' && decision.expiresAt.getTime() > now.getTime();

/**
 * What she is shown at `now`: what still waits and is not put aside, the one that ends first on top, a few at most.
 * The owner reads what she put aside too: it still waits.
 */
export function shown(decisions: readonly StoredDecision[], now: Date, aside: boolean): StoredDecision[] {
  return decisions
    .filter(
      (decision) =>
        waits(decision, now) &&
        (aside || decision.laterUntil === null || decision.laterUntil.getTime() <= now.getTime()),
    )
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || a.id.localeCompare(b.id))
    .slice(0, DECISIONS_SHOWN_MAX);
}

/** « Plus tard »: aside for a while, never past the end of the question. */
export function asideUntil(now: Date, expiresAt: Date): Date {
  return new Date(Math.min(now.getTime() + DECISION_LATER_MINUTES * 60_000, expiresAt.getTime()));
}

export const answerOf = (decision: StoredDecision, key: string): DecisionAnswer | null =>
  decision.answers.find((answer) => answer.key === key) ?? null;

/** What she reads: the decision without where it stands. */
export function toRead(decision: StoredDecision): CreatorDecision {
  return {
    id: decision.id,
    kind: decision.kind,
    category: decision.category,
    question: decision.question,
    context: decision.context,
    layout: decision.layout,
    answers: decision.answers,
    otherIdeasLeft: decision.otherIdeasLeft,
    expiresAt: decision.expiresAt.toISOString(),
  };
}
