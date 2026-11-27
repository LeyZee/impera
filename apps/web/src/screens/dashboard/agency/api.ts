import {
  AgencyInsightsSchema,
  AgencySteeringSchema,
  type AgencyInsights,
  type AgencySteering,
} from '@impera/contracts';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { selectionQuery, type AgencySelection } from './period';

/** The figures are not this account's (a scope of its own, ADR 0078 § 1): said as such, never retried. */
export class NotYours extends Error {}

/**
 * `GET /v1/dashboard/agency` (ADR 0078): the agency's insights, read in the registers by the server, never a call to a
 * platform from this screen. Parsed with the strict contract: a field the server would add by mistake fails here.
 */
export function useAgencyInsights(
  selection: AgencySelection,
  creatorId: string | null,
): UseQueryResult<AgencyInsights> {
  return useQuery({
    queryKey: ['dashboard', 'agency', selection, creatorId],
    queryFn: async () => {
      const query = new URLSearchParams(selectionQuery(selection));
      if (creatorId !== null) query.set('creatorId', creatorId);
      const response = await fetch(`/v1/dashboard/agency?${query.toString()}`, { credentials: 'include' });
      if (response.status === 403) throw new NotYours('GET /v1/dashboard/agency: 403');
      if (!response.ok) throw new Error(`GET /v1/dashboard/agency: ${String(response.status)}`);
      return AgencyInsightsSchema.parse(await response.json());
    },
    // The register is read every minute: the screen follows it, the days change without a blank.
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
    retry: (count, error) => !(error instanceof NotYours) && count < 1,
  });
}

/** A write of an objective the server refused or could not make, with the sentence the screen shows. */
export class ObjectiveNotSaved extends Error {}

/**
 * `PUT` or `DELETE /v1/dashboard/agency/objectives/:creatorId/:month` (ADR 0092 § 6): the owner sets a creator's
 * revenue objective for a month, or takes it away (`amountMinor` null). The figures are read again after.
 */
export function useSetObjective(): UseMutationResult<
  void,
  Error,
  { creatorId: string; month: string; amountMinor: number | null }
> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ creatorId, month, amountMinor }) => {
      const response = await fetch(`/v1/dashboard/agency/objectives/${creatorId}/${month}`, {
        method: amountMinor === null ? 'DELETE' : 'PUT',
        credentials: 'include',
        ...(amountMinor === null
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amountMinor }) }),
      });
      if (response.status === 403) throw new ObjectiveNotSaved('Seul le propriétaire fixe les objectifs.');
      if (!response.ok)
        throw new ObjectiveNotSaved('L’objectif n’a pas été enregistré. Réessaie dans un instant.');
    },
    onSettled: () => client.invalidateQueries({ queryKey: ['dashboard', 'agency'] }),
  });
}

/**
 * `GET /v1/dashboard/agency/steering` (ADR 0092, avenant du 21/11/2026): the day's objective, traffic to money and the
 * fans the revenue hangs on, on fixed windows whatever the period read below.
 */
export function useAgencySteering(creatorId: string | null): UseQueryResult<AgencySteering> {
  return useQuery({
    queryKey: ['dashboard', 'agency', 'steering', creatorId],
    queryFn: async () => {
      const query = creatorId === null ? '' : `?creatorId=${encodeURIComponent(creatorId)}`;
      const response = await fetch(`/v1/dashboard/agency/steering${query}`, { credentials: 'include' });
      if (response.status === 403) throw new NotYours('GET /v1/dashboard/agency/steering: 403');
      if (!response.ok) throw new Error(`GET /v1/dashboard/agency/steering: ${String(response.status)}`);
      return AgencySteeringSchema.parse(await response.json());
    },
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
    retry: (count, error) => !(error instanceof NotYours) && count < 1,
  });
}
