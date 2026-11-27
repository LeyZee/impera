import type { AlertTrigger } from '@impera/contracts';

/** The same alert, however it matched: a custom one by its row, a system one by its code. */
const alertKey = ({ alert }: AlertTrigger): string => (alert.kind === 'custom' ? alert.id : alert.code);

/**
 * Her alerts not yet sounded since her last answer: the team hears of each once until she answers, whether the agent
 * read it in his turn or the watch read it while the agent did not answer him (`conversation.watch_keywords`).
 */
export function unsounded<T extends { readonly trigger: AlertTrigger }>(
  alerts: readonly T[],
  sounded: readonly AlertTrigger[],
): T[] {
  const done = new Set(sounded.map(alertKey));
  return alerts.filter((alert) => !done.has(alertKey(alert.trigger)));
}
