import {
  AnsweredDecisionSchema,
  CreatorDecisionsSchema,
  type CreatorDecision,
  type CreatorSummary,
} from '@impera/contracts';
import { useQueries } from '@tanstack/react-query';

/*
 * « Elle n'a pas encore répondu » (INS-05, ADR 0164): the questions that wait on her creators, read by the owner who
 * answers in her place. The owner's routes only: `/v1/creators/:creatorId/decisions`, an audit line on each answer.
 */

const path = (creatorId: string): string => `/v1/creators/${encodeURIComponent(creatorId)}/decisions`;
export const ownerDecisionsKey = (creatorId: string): readonly string[] => ['owner-decisions', creatorId];

/** A question and whose it is. */
export interface OwnedDecision {
  readonly creator: CreatorSummary;
  readonly decision: CreatorDecision;
}

/**
 * What waits on each of `creators`, read again each minute, the one that ends first on top. A creator whose list does
 * not come is left out: the card says what it read, never a failure for a single one.
 */
export function useOwnerDecisions(creators: readonly CreatorSummary[]): {
  readonly decisions: readonly OwnedDecision[];
  readonly pending: boolean;
} {
  const results = useQueries({
    queries: creators.map((creator) => ({
      queryKey: ownerDecisionsKey(creator.id),
      queryFn: async () => {
        const response = await fetch(path(creator.id), { credentials: 'include' });
        if (!response.ok) throw new Error(`GET decisions: ${String(response.status)}`);
        return CreatorDecisionsSchema.parse(await response.json()).decisions;
      },
      refetchInterval: 60_000,
      retry: 1,
    })),
  });
  const decisions = results
    .flatMap((result, at) => {
      const creator = creators[at];
      return creator === undefined ? [] : (result.data ?? []).map((decision) => ({ creator, decision }));
    })
    .sort((one, other) => Date.parse(one.decision.expiresAt) - Date.parse(other.decision.expiresAt));
  return { decisions, pending: results.some((result) => result.isPending) };
}

/** The owner's answer in her place; what is kept, said back. */
export async function answerInHerPlace(creatorId: string, id: string, answer: string): Promise<string> {
  const response = await fetch(`${path(creatorId)}/${encodeURIComponent(id)}/answer`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answer }),
  });
  if (!response.ok) throw new Error(`POST decisions answer: ${String(response.status)}`);
  return AnsweredDecisionSchema.parse(await response.json()).noted;
}

const SOON_MS = 2 * 60 * 60 * 1000;

/** When a question ends, as the tag says it: amber under two hours, never red. */
export function dueOf(expiresAt: string, now: Date, timeZone?: string): { label: string; soon: boolean } {
  const ends = new Date(expiresAt);
  const left = ends.getTime() - now.getTime();
  if (left < SOON_MS) {
    const minutes = Math.max(1, Math.round(left / 60_000));
    return {
      label:
        minutes < 60 ? `Plus que ${String(minutes)} min` : `Plus que ${String(Math.round(minutes / 60))} h`,
      soon: true,
    };
  }
  const day = (at: Date): string => new Intl.DateTimeFormat('fr-CA', { timeZone }).format(at);
  const clock = new Intl.DateTimeFormat('fr-FR', { timeZone, hour: '2-digit', minute: '2-digit' })
    .format(ends)
    .replace(':', ' h ');
  if (day(ends) === day(now)) return { label: `Jusqu’à ${clock}`, soon: false };
  if (day(ends) === day(new Date(now.getTime() + 24 * 60 * 60 * 1000)))
    return { label: `Jusqu’à demain ${clock}`, soon: false };
  const date = new Intl.DateTimeFormat('fr-FR', { timeZone, day: 'numeric', month: 'long' }).format(ends);
  return { label: `Jusqu’au ${date}`, soon: false };
}
