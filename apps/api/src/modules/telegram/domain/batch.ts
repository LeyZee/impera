import type { TelegramTopic } from '@impera/contracts';

import { TOPIC_RANK, isSilentTopic, joinTexts } from './render';

/**
 * What one flush of a group sends (ADR 0020 §8). Edits and replies act on one message each and go alone. New
 * messages waiting together go as one, the most serious first, but a ringing message never rides with a silent one:
 * the ringing ones go first, the silent ones in the next round.
 */

export interface Pending {
  readonly id: string;
  readonly topic: TelegramTopic;
  readonly action: 'send' | 'edit' | 'reply';
  readonly text: string;
  readonly createdAt: Date;
}

export type Batch =
  | { readonly kind: 'single'; readonly item: Pending }
  | {
      readonly kind: 'joined';
      readonly items: readonly Pending[];
      readonly text: string;
      readonly isSilent: boolean;
    };

function bySeriousness(a: Pending, b: Pending): number {
  return TOPIC_RANK[a.topic] - TOPIC_RANK[b.topic] || a.createdAt.getTime() - b.createdAt.getTime();
}

/** The next thing to send among the pending deliveries of a group, or null when there is none. */
export function nextBatch(pending: readonly Pending[]): Batch | null {
  const sorted = [...pending].sort(bySeriousness);
  const first = sorted[0];
  if (first === undefined) return null;
  if (first.action !== 'send') return { kind: 'single', item: first };
  const isSilent = isSilentTopic(first.topic);
  const items = sorted.filter((item) => item.action === 'send' && isSilentTopic(item.topic) === isSilent);
  if (items.length === 1) return { kind: 'single', item: first };
  return { kind: 'joined', items, text: joinTexts(items.map((item) => item.text)), isSilent };
}
