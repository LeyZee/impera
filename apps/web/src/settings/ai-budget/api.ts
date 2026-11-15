import {
  AiBudgetSchema,
  ApiErrorSchema,
  REAUTHENTICATION_ERROR_CODE,
  type AiBudget,
  type PutAiBudgetBody,
} from '@impera/contracts';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

/**
 * `/v1/settings/ai-budget` (choix de Charles 12/11), parsed with the strict contract. Read every 30 seconds, like
 * Consommation IA: the day's spend moves with each call.
 */
const URL = '/v1/settings/ai-budget';
const REFRESH_MS = 30_000;

export const aiBudgetQueryKey = ['settings', 'ai-budget'] as const;

export function useAiBudget(): UseQueryResult<AiBudget> {
  return useQuery({
    queryKey: aiBudgetQueryKey,
    queryFn: async () => {
      const response = await fetch(URL, { credentials: 'include' });
      if (!response.ok) throw new Error(`GET ${URL}: ${String(response.status)}`);
      return AiBudgetSchema.parse(await response.json());
    },
    refetchInterval: REFRESH_MS,
  });
}

/** Shows the saved values at once, without waiting for the next read. */
export function useSetAiBudget(): (budget: AiBudget) => void {
  const client = useQueryClient();
  return (budget) => {
    client.setQueryData(aiBudgetQueryKey, budget);
  };
}

/** Each answer in its own words on the dialog; `reauth`: the password and a code are asked, then it is sent again. */
export type SaveOutcome =
  | { readonly kind: 'ok'; readonly value: AiBudget }
  | { readonly kind: 'reauth' }
  | { readonly kind: 'refused'; readonly message: string }
  | { readonly kind: 'session_expired' }
  | { readonly kind: 'failed' };

/** `PUT /v1/settings/ai-budget`: both values, `null` for the default. */
export async function saveAiBudget(body: PutAiBudgetBody): Promise<SaveOutcome> {
  try {
    const response = await fetch(URL, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok) return { kind: 'ok', value: AiBudgetSchema.parse(await response.json()) };
    if (response.status === 401) return { kind: 'session_expired' };
    const error = ApiErrorSchema.safeParse(await response.json().catch(() => null));
    if (!error.success) return { kind: 'failed' };
    if (error.data.error.code === REAUTHENTICATION_ERROR_CODE) return { kind: 'reauth' };
    if (response.status === 422) return { kind: 'refused', message: error.data.error.message };
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}
