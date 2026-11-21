import {
  AnsweredDecisionSchema,
  CreatorDecisionsSchema,
  type CreatorDecision,
  type CreatorDecisionId,
} from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/* « À décider », hers (ADR 0162): what waits on her, her answer, « Plus tard ». The server holds the truth. */

const BASE = '/v1/creator-space/decisions';
export const DECISIONS_KEY = ['creator-space', 'decisions'] as const;

/** `GET /v1/creator-space/decisions`: what waits on her now. Read again each minute: a question may arrive or end. */
export function useDecisions(): UseQueryResult<CreatorDecision[]> {
  return useQuery({
    queryKey: DECISIONS_KEY,
    queryFn: async () => {
      const response = await fetch(BASE, { credentials: 'include' });
      if (!response.ok) throw new Error(`GET ${BASE}: ${String(response.status)}`);
      return CreatorDecisionsSchema.parse(await response.json()).decisions;
    },
    refetchInterval: 60_000,
    retry: 1,
  });
}

async function post(path: string, body?: unknown): Promise<Response> {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`POST ${BASE}${path}: ${String(response.status)}`);
  return response;
}

/** Her answer; what she reads back. */
export async function answerDecision(id: CreatorDecisionId, answer: string): Promise<string> {
  const response = await post(`/${id}/answer`, { answer });
  return AnsweredDecisionSchema.parse(await response.json()).noted;
}

/** « Plus tard »: aside for a while. */
export async function putDecisionAside(id: CreatorDecisionId): Promise<void> {
  await post(`/${id}/later`);
}
