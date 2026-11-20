import { QueryClient } from '@tanstack/react-query';

/**
 * How many times a read is tried again before its screen says « Le serveur ne répond pas » (recette visuelle 16/11,
 * ETA-15): once, the same on every screen, so that each says it as fast as the others (about two seconds) instead of
 * after the library's three tries. A read that sets its own `retry` (a refusal never retried) keeps it.
 */
export const READ_RETRIES = 1;

/** The dashboard's query client: one per signed-in session. */
export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: READ_RETRIES } } });
}
