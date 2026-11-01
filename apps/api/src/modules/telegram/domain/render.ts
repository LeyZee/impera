import type { TelegramTopic } from '@nirvana/contracts';

import type { Notice } from './signals';

/**
 * Telegram text, in HTML parse mode (ADR 0020 §10). Everything that is not a tag the module writes is escaped,
 * so a creator name or a kill switch reason can never inject markup or a link.
 */

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const TOPIC_MARK: Readonly<Record<TelegramTopic, string>> = {
  urgent: '🔴',
  important: '🟠',
  info: '🔵',
  sale: '💰',
  keyword: '🔎',
  validation: '🎙️',
  custom: '🔔',
};

/** Info and sales do not ring (ADR 0020 §2): they must not wake anyone at night. */
export function isSilentTopic(topic: TelegramTopic): boolean {
  return topic === 'info' || topic === 'sale';
}

/** Most serious first: the order of a flush and of a grouped message. */
export const TOPIC_RANK: Readonly<Record<TelegramTopic, number>> = {
  urgent: 0,
  important: 1,
  keyword: 2,
  custom: 3,
  validation: 4,
  sale: 5,
  info: 6,
};

/** Telegram refuses a text over 4 096 characters. */
export const MAX_TEXT = 4096;

export interface RenderedNotice {
  readonly text: string;
  /** One plain line for the CRM's journal of deliveries. */
  readonly summary: string;
}

export function renderNotice(notice: Notice, creatorName: string | null, webOrigin: string): RenderedNotice {
  const who = creatorName ?? 'Nirvana';
  const lines = [
    `${TOPIC_MARK[notice.topic]} <b>${escapeHtml(notice.title)} · ${escapeHtml(who)}</b>`,
    escapeHtml(notice.body),
  ];
  if (notice.link !== null) {
    const url = new URL(notice.link.path, webOrigin).toString();
    lines.push(`<a href="${escapeHtml(url)}">${escapeHtml(notice.link.label)}</a>`);
  }
  return { text: lines.join('\n'), summary: notice.body };
}

/**
 * Several messages waiting for the same group go out as one (ADR 0020 §8), cut to Telegram's limit. Identical texts
 * are said once, their count on the first line (« (×20) »): twenty statements refused for the same reason name no
 * one, so they read the same.
 */
export function joinTexts(texts: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const text of texts) counts.set(text, (counts.get(text) ?? 0) + 1);
  const groups = [...counts].map(([text, count]) => ({
    text: count === 1 ? text : withCount(text, count),
    count,
  }));
  const joined = groups.map((group) => group.text).join('\n\n');
  if (joined.length <= MAX_TEXT) return joined;
  const kept: string[] = [];
  let length = 0;
  let rest = texts.length;
  for (const group of groups) {
    if (length + group.text.length + 2 > MAX_TEXT - 60) break;
    kept.push(group.text);
    length += group.text.length + 2;
    rest -= group.count;
  }
  return `${kept.join('\n\n')}\n\n… et ${String(rest)} autre${rest > 1 ? 's' : ''} dans le CRM.`;
}

function withCount(text: string, count: number): string {
  const end = text.indexOf('\n');
  const mark = ` (×${String(count)})`;
  return end === -1 ? `${text}${mark}` : `${text.slice(0, end)}${mark}${text.slice(end)}`;
}

/** The original message, closed by a person: « ✓ Pris en main par Théo », « ✓ Rendu à l’agent par Théo ». */
export function renderClosedBy(original: string, label: string, firstName: string | null): string {
  return `${original}\n✓ ${firstName === null ? escapeHtml(label) : `${escapeHtml(label)} par ${escapeHtml(firstName)}`}`;
}

export function renderResend(text: string): string {
  return `${text}\n<i>(renvoi)</i>`;
}

export function renderPlain(text: string): string {
  return escapeHtml(text);
}
