import { FanListPageSchema, type FanListPage, type FanListQuery } from '@impera/contracts';
import {
  keepPreviousData,
  useInfiniteQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';

/**
 * `GET /v1/fans` (ADR 0124): every fan of one creator, for the owner and an active manager of her list. Parsed with the
 * `strict` contract: a field the server would add by mistake fails here instead of reaching the screen.
 */

/** Why the list could not be read, as the page says it. */
export type FansErrorKind = 'session_expired' | 'forbidden' | 'unavailable';

export const FANS_ERRORS: Readonly<Record<FansErrorKind, string>> = {
  session_expired: 'Ta session a expiré. Reconnecte-toi.',
  forbidden: 'Cette liste se lit par le propriétaire et les managers qui suivent la créatrice.',
  unavailable: 'Le serveur ne répond pas. Réessaie dans un instant.',
};

export class FansError extends Error {
  readonly kind: FansErrorKind;

  constructor(kind: FansErrorKind, detail: string) {
    super(`${FANS_ERRORS[kind]} (${detail})`);
    this.name = 'FansError';
    this.kind = kind;
  }
}

export const fansErrorKind = (error: unknown): FansErrorKind =>
  error instanceof FansError ? error.kind : 'unavailable';

/** What the screen chooses; the server's defaults fill the rest. */
export type FansFilter = Pick<FanListQuery, 'filter' | 'sort' | 'period'> & {
  readonly creatorId: string;
  readonly q: string;
};

/** Fifty fans a page: « Voir la suite » asks for the next. */
export const FANS_PAGE = 50;

export function fansUrl(filter: FansFilter, cursor: string | null): string {
  const query = new URLSearchParams({
    creatorId: filter.creatorId,
    filter: filter.filter,
    sort: filter.sort,
    period: filter.period,
    limit: String(FANS_PAGE),
  });
  if (filter.q.trim() !== '') query.set('q', filter.q.trim());
  if (cursor !== null) query.set('cursor', cursor);
  return `/v1/fans?${query.toString()}`;
}

async function fetchFans(filter: FansFilter, cursor: string | null): Promise<FanListPage> {
  let response: Response;
  try {
    response = await fetch(fansUrl(filter, cursor), { credentials: 'include' });
  } catch {
    throw new FansError('unavailable', 'GET /v1/fans: network');
  }
  if (response.status === 401) throw new FansError('session_expired', 'GET /v1/fans: 401');
  if (response.status === 403) throw new FansError('forbidden', 'GET /v1/fans: 403');
  if (!response.ok) throw new FansError('unavailable', `GET /v1/fans: ${String(response.status)}`);
  const parsed = FanListPageSchema.safeParse(await response.json());
  if (!parsed.success) throw new FansError('unavailable', 'GET /v1/fans: unexpected answer');
  return parsed.data;
}

const FIRST_PAGE: string | null = null;

/** Her fans, a page at a time; the previous list stays on screen while another filter is read. */
export function useFans(
  filter: FansFilter | null,
): UseInfiniteQueryResult<InfiniteData<FanListPage, string | null>> {
  return useInfiniteQuery({
    queryKey: ['fans', filter],
    queryFn: ({ pageParam }) => {
      if (filter === null) throw new FansError('unavailable', 'no creator');
      return fetchFans(filter, pageParam);
    },
    enabled: filter !== null,
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
    retry: (count, error) => fansErrorKind(error) === 'unavailable' && count < 1,
    retryDelay: 400,
  });
}
