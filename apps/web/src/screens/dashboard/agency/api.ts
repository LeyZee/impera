import { AgencyInsightsSchema, type AgencyInsights, type AgencyPeriod } from '@impera/contracts';
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';

/** The figures are not this account's (a scope of its own, ADR 0078 § 1): said as such, never retried. */
export class NotYours extends Error {}

/**
 * `GET /v1/dashboard/agency` (ADR 0078): the agency's insights, read in the registers by the server, never a call to a
 * platform from this screen. Parsed with the strict contract: a field the server would add by mistake fails here.
 */
export function useAgencyInsights(
  period: AgencyPeriod,
  creatorId: string | null,
): UseQueryResult<AgencyInsights> {
  return useQuery({
    queryKey: ['dashboard', 'agency', period, creatorId],
    queryFn: async () => {
      const query = new URLSearchParams({ period });
      if (creatorId !== null) query.set('creatorId', creatorId);
      const response = await fetch(`/v1/dashboard/agency?${query.toString()}`, { credentials: 'include' });
      if (response.status === 403) throw new NotYours('GET /v1/dashboard/agency: 403');
      if (!response.ok) throw new Error(`GET /v1/dashboard/agency: ${String(response.status)}`);
      return AgencyInsightsSchema.parse(await response.json());
    },
    // The register is read every minute: the screen follows it, the period changes without a blank.
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
    retry: (count, error) => !(error instanceof NotYours) && count < 1,
  });
}
