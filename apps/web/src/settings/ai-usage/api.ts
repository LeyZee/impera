import {
  AiCreditEntrySchema,
  AiUsageSchema,
  ApiErrorSchema,
  type AddAiCreditEntryBody,
  type AiCreditEntry,
  type AiUsage,
} from '@impera/contracts';
import { keepPreviousData, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

/**
 * `/v1/settings/ai-usage` as Réglages › Consommation IA reads and writes it (ADR 0091), parsed with the strict
 * contract. Read every 30 seconds: the gateway's own count of the day reloads at that pace (`refreshEveryMs`).
 */
export const AI_USAGE_REFRESH_MS = 30_000;

export const aiUsageQueryKey = ['settings', 'ai-usage'] as const;

export function useAiUsage(): UseQueryResult<AiUsage> {
  return useQuery({
    queryKey: aiUsageQueryKey,
    queryFn: async () => {
      const response = await fetch('/v1/settings/ai-usage', { credentials: 'include' });
      if (!response.ok) throw new Error(`GET /v1/settings/ai-usage: ${String(response.status)}`);
      return AiUsageSchema.parse(await response.json());
    },
    refetchInterval: AI_USAGE_REFRESH_MS,
    placeholderData: keepPreviousData,
  });
}

/** Reloads the screen after a line is written or taken back. */
export function useRefreshAiUsage(): () => Promise<void> {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: aiUsageQueryKey });
}

/** Each answer in its own words on the dialog: never a code, never « the server does not answer » for a refusal. */
export type CreditOutcome =
  | { readonly kind: 'ok'; readonly value: AiCreditEntry }
  | { readonly kind: 'in_future' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'session_expired' }
  | { readonly kind: 'failed' };

async function codeOf(response: Response): Promise<string | null> {
  const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.code : null;
}

/** `POST /v1/settings/ai-usage/credits`: the same id sent twice is one line, a retry after a lost answer is safe. */
export async function addCreditEntry(body: AddAiCreditEntryBody): Promise<CreditOutcome> {
  try {
    const response = await fetch('/v1/settings/ai-usage/credits', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok) return { kind: 'ok', value: AiCreditEntrySchema.parse(await response.json()) };
    if (response.status === 401) return { kind: 'session_expired' };
    const code = await codeOf(response);
    if (code === 'ai_credit_in_future_unprocessable') return { kind: 'in_future' };
    if (code === 'ai_credit_conflict') return { kind: 'conflict' };
    if (code === 'request_invalid') return { kind: 'invalid' };
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/** `DELETE /v1/settings/ai-usage/credits/:id`: gone already counts as done. */
export async function removeCreditEntry(id: string): Promise<'ok' | 'session_expired' | 'failed'> {
  try {
    const response = await fetch(`/v1/settings/ai-usage/credits/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (response.ok || response.status === 404) return 'ok';
    return response.status === 401 ? 'session_expired' : 'failed';
  } catch {
    return 'failed';
  }
}
