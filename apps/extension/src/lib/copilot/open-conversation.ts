import { PlatformConversationIdSchema } from '@impera/contracts';

import { placeOf } from '../tab';

/**
 * The Reveal conversation open in a tab (ADR 0086 § 2), read from its address alone: the panel follows it without a
 * click and without touching the page. Which part of Reveal's address names the conversation is not known before the
 * Reveal capture (`docs/runbooks/reveal-capture-express.md`): until then the panel takes a segment after `/messages/`
 * or `/chat/`, or a `conversation` or `chat` parameter, and says « Ouvre une conversation » for anything else. The id
 * is opaque: checked against the contract, never parsed further.
 */

const PATH_PREFIXES = new Set(['messages', 'chat']);
const PARAMETERS = ['conversation', 'chat'] as const;

/** `null` when the tab is not on Reveal, or on a Reveal page that is not one conversation. */
export function openConversationOf(url: string | undefined): string | null {
  // `placeOf` checks HTTPS and the reveal.me domain; no CRM is ever named here.
  if (url === undefined || placeOf(url, 'null') !== 'reveal') return null;
  const parsed = new URL(url);
  for (const name of PARAMETERS) {
    const value = PlatformConversationIdSchema.safeParse(parsed.searchParams.get(name));
    if (value.success) return value.data;
  }
  const segments = parsed.pathname.split('/').filter((segment) => segment !== '');
  for (let at = 0; at < segments.length - 1; at += 1) {
    const prefix = segments[at];
    if (prefix !== undefined && PATH_PREFIXES.has(prefix)) {
      const value = PlatformConversationIdSchema.safeParse(decodeURIComponent(segments[at + 1] ?? ''));
      if (value.success) return value.data;
    }
  }
  return null;
}
