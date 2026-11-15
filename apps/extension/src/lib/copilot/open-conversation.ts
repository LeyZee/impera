import { PlatformConversationIdSchema } from '@impera/contracts';

import { placeOf } from '../tab';

/**
 * The Reveal conversation open in a tab (ADR 0086 § 2), read from its address alone: the panel follows it without a
 * click and without touching the page. Reveal's dashboard names it after `/conversations/`, under the model's own
 * segment (`/models/<model>/conversations/<conversation>`, seen on the PC on 2026-11-11): the same UUID the API and
 * the sync use (`docs/reference/reveal-api-observed.md`, question 4). Anything else says « Ouvre une conversation ».
 * The id is opaque: checked against the contract, never parsed further.
 */

const PATH_PREFIX = 'conversations';

/** `null` when the tab is not on Reveal, or on a Reveal page that is not one conversation. */
export function openConversationOf(url: string | undefined): string | null {
  // `placeOf` checks HTTPS and the reveal.me domain; no CRM is ever named here.
  if (url === undefined || placeOf(url, 'null') !== 'reveal') return null;
  const segments = new URL(url).pathname.split('/').filter((segment) => segment !== '');
  const at = segments.lastIndexOf(PATH_PREFIX);
  if (at === -1 || at !== segments.length - 2) return null;
  let id: string;
  try {
    id = decodeURIComponent(segments[at + 1] ?? '');
  } catch {
    return null;
  }
  const value = PlatformConversationIdSchema.safeParse(id);
  return value.success ? value.data : null;
}
