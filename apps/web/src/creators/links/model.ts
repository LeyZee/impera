import type { LinkPlacement } from '@impera/contracts';

/** Where a link is placed, in the words both screens use (ADR 0120 § 3, ADR 0121 § 1). */
export const PLACEMENT_LABELS: Readonly<Record<LinkPlacement, string>> = {
  story_daily: 'Story du jour',
  story_highlight: 'Story à la une',
  telegram_channel: 'Canal Telegram',
  other_network: 'Autre réseau',
};

/**
 * An address on one line, cut in its middle: its start says which link it is, its end which page. The whole address
 * is what gets copied; this is only what the card shows.
 */
export function middleCut(address: string, max = 36): string {
  const bare = address.replace(/^https:\/\//u, '');
  if (bare.length <= max) return bare;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${bare.slice(0, head)}…${bare.slice(bare.length - tail)}`;
}
