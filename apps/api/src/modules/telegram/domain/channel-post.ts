import {
  labelHasAddress,
  type ChannelPostDraft,
  type ChannelPostViolation,
  type ChannelTextSegment,
  type RedirectLink,
  type TelegramChannelConfig,
} from '@impera/contracts';

/**
 * A post of her channel as Telegram shows it (ADR 0080 § 5): the voice marks `**bold**` and `__underline__`, the code
 * escapes everything else and adds the link at the end, never the voice (§ 4.3).
 */

/** Telegram's limit for a media's caption, the link included (`parse_mode` HTML counts the visible text). */
export const TELEGRAM_CAPTION_MAX = 1024;

const MARK = /\*\*([^*\n](?:[^*]*?[^*\n])?)\*\*|__([^_\n](?:[^_]*?[^_\n])?)__/gu;

/** Her text cut into its plain, bold and underlined pieces; a mark left open stays as she typed it. */
export function segmentsOf(text: string): ChannelTextSegment[] {
  const segments: ChannelTextSegment[] = [];
  let at = 0;
  for (const match of text.matchAll(MARK)) {
    if (match.index > at) segments.push({ text: text.slice(at, match.index), style: 'plain' });
    if (match[1] !== undefined) segments.push({ text: match[1], style: 'bold' });
    else if (match[2] !== undefined) segments.push({ text: match[2], style: 'underline' });
    at = match.index + match[0].length;
  }
  if (at < text.length) segments.push({ text: text.slice(at), style: 'plain' });
  return segments;
}

/** Telegram's HTML: `&`, `<` and `>` escaped in text, the quote too in an attribute. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const TAGS = { plain: null, bold: 'b', underline: 'u' } as const;

/** How the link reads at the end of a post (§ 4.3): her short text, or the bare address. */
export function linkOf(
  config: Pick<TelegramChannelConfig, 'linkForm' | 'linkLabel'>,
  link: RedirectLink,
): { readonly text: string; readonly url: string; readonly name: string } {
  return { text: config.linkForm === 'label' ? config.linkLabel : link.url, url: link.url, name: link.name };
}

/** The post as sent: her text, a blank line, the link. */
export function renderChannelPost(
  text: string,
  link: { readonly text: string; readonly url: string; readonly name: string } | null,
): Extract<ChannelPostDraft, { kind: 'post' }> {
  const segments = segmentsOf(text.trim());
  const body = segments
    .map((segment) => {
      const tag = TAGS[segment.style];
      const escaped = escapeHtml(segment.text);
      return tag === null ? escaped : `<${tag}>${escaped}</${tag}>`;
    })
    .join('');
  if (link === null) return { kind: 'post', segments, link: null, html: body };
  const tail =
    link.text === link.url
      ? escapeHtml(link.url)
      : `<a href="${escapeHtml(link.url)}">${escapeHtml(link.text)}</a>`;
  return { kind: 'post', segments, link, html: `${body}\n\n${tail}` };
}

/**
 * What Telegram counts of a post: the text as read, the link as read, in UTF-16 units as its entities are counted (an
 * emoji counts two: a post near the limit is refused rather than cut by Telegram).
 */
function visibleLength(draft: Extract<ChannelPostDraft, { kind: 'post' }>): number {
  const text = draft.segments.map((segment) => segment.text).join('');
  return text.length + (draft.link === null ? 0 : 2 + draft.link.text.length);
}

/**
 * The checks of the channel itself, on top of the agent's guards (§ 4.3, § 5.4): an address in her words is the code's
 * to add, never hers; a post longer than a caption would be refused by Telegram.
 */
export function channelChecks(draft: ChannelPostDraft): ChannelPostViolation[] {
  const violations: ChannelPostViolation[] = [];
  const address = guardedTexts(draft).find(labelHasAddress);
  if (address !== undefined) violations.push({ code: 'contact_info', blocking: true, match: null });
  if (draft.kind === 'post' && visibleLength(draft) > TELEGRAM_CAPTION_MAX) {
    violations.push({ code: 'bubble_too_long', blocking: true, match: null });
  }
  return violations;
}

/** The words the guards read: the post's text, or the poll's question and each answer. */
export function guardedTexts(draft: ChannelPostDraft): string[] {
  return draft.kind === 'post'
    ? [draft.segments.map((segment) => segment.text).join('')]
    : [draft.question, ...draft.options];
}
