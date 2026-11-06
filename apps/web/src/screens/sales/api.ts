import {
  CreatorConversationSchema,
  CreatorFanInsightsSchema,
  CreatorFanPageSchema,
  CreatorMessagePageSchema,
  type CreatorConversation,
  type CreatorFanInsights,
  type CreatorFanPage,
  type CreatorMessagePage,
} from '@impera/contracts';
import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query';

/*
 * What the creator reads of her own account (CR-02, ADR 0042 § 2), parsed with the `strict` contracts: a field the
 * server would add by mistake (an author, a note) fails here instead of reaching her screen. Nothing of it is kept
 * by the service worker (`/v1/` never is) nor written anywhere in the browser.
 */

const BASE = '/v1/creator-space';

/** Her fans and her messages come fifty at a time: a long thread reads « Messages plus anciens » before the rest. */
const PAGE = 50;

/** Her conversation is not hers, or no longer exists: said as such, never retried. */
export class ConversationGone extends Error {}

async function read<T>(url: string, parse: (body: unknown) => T): Promise<T> {
  const response = await fetch(url, { credentials: 'include' });
  if (response.status === 404) throw new ConversationGone(`GET ${url}: 404`);
  if (!response.ok) throw new Error(`GET ${url}: ${String(response.status)}`);
  return parse(await response.json());
}

const pageUrl = (path: string, cursor: string | null): string => {
  const query = new URLSearchParams({ limit: String(PAGE) });
  if (cursor !== null) query.set('cursor', cursor);
  return `${BASE}${path}?${query.toString()}`;
};

/** The first page has no cursor. */
const FIRST_PAGE: string | null = null;

const retryOnce = (count: number, error: Error): boolean => !(error instanceof ConversationGone) && count < 1;

/** `GET /v1/creator-space/fans`: her fans, last seen first, a page at a time. */
export function useCreatorFans(): UseInfiniteQueryResult<InfiniteData<CreatorFanPage, string | null>> {
  return useInfiniteQuery({
    queryKey: ['creator-space', 'fans'],
    queryFn: ({ pageParam }) => read(pageUrl('/fans', pageParam), (body) => CreatorFanPageSchema.parse(body)),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: 60_000,
    retry: retryOnce,
    retryDelay: 400,
  });
}

/**
 * `GET /v1/creator-space/conversations/:id`: the conversation she opens, and its fan. The server writes each opening in
 * the audit log (ADR 0042 § Conséquences): read once when she opens it, never again in the background, so the log says
 * how often she opened it, not how long it stayed on screen.
 */
export function useCreatorConversation(conversationId: string): UseQueryResult<CreatorConversation> {
  return useQuery({
    queryKey: ['creator-space', 'conversation', conversationId],
    queryFn: () =>
      read(`${BASE}/conversations/${conversationId}`, (body) => CreatorConversationSchema.parse(body)),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: retryOnce,
    retryDelay: 400,
  });
}

/** `GET /v1/creator-space/conversations/:id/messages`: newest first, a page at a time; read again every 30 s. */
export function useCreatorMessages(
  conversationId: string,
): UseInfiniteQueryResult<InfiniteData<CreatorMessagePage, string | null>> {
  return useInfiniteQuery({
    queryKey: ['creator-space', 'messages', conversationId],
    queryFn: ({ pageParam }) =>
      read(pageUrl(`/conversations/${conversationId}/messages`, pageParam), (body) =>
        CreatorMessagePageSchema.parse(body),
      ),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: (query) => (query.state.error instanceof ConversationGone ? false : 30_000),
    retry: retryOnce,
    retryDelay: 400,
  });
}

/**
 * `GET /v1/creator-space/fan-insights`: « Qui sont tes fans », shares on all her fans, stopped at midnight in her time
 * zone (ADR 0074 § 2). They change once a day: read again every ten minutes, never every minute.
 */
export function useCreatorFanInsights(): UseQueryResult<CreatorFanInsights> {
  return useQuery({
    queryKey: ['creator-space', 'fan-insights'],
    queryFn: () => read(`${BASE}/fan-insights`, (body) => CreatorFanInsightsSchema.parse(body)),
    refetchInterval: 600_000,
    retry: retryOnce,
    retryDelay: 400,
  });
}
