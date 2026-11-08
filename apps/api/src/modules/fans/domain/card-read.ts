import {
  FAN_CARD_VALUE_MAX,
  fanCardFieldSpec,
  type FanCardField,
  type FanCardRead,
  type FanCardSource,
  type MessageId,
} from '@impera/contracts';

import type { Card } from './card';
import { checkedValue } from './card';
import { FanCardValueInvalid, FanCardValueRefused } from './errors';
import type { FactProposal } from './facts';

/**
 * His card read in his messages by the AI (ADR 0085 § 7): the card as the read's prompt gets it, and what the read
 * proposes made into facts the card may write. Pure: the service reads the card under the fan's lock and writes.
 */

const SOURCE_WORDS: Readonly<Record<FanCardSource, string>> = {
  noted: 'noté par un chatteur',
  declared: 'dit par lui',
  inferred: 'deviné',
};

/** A happening of his life stops being true 30 days after it was told (§ 8). */
const LIFE_EVENT_DAYS = 30;
const DAY_MS = 86_400_000;

/** His card as the read's prompt gets it: one line per field it shows, its code, its items, then where it comes from. */
export function cardLinesOf(card: Card): string[] {
  return card.fields.flatMap(({ field, current }) =>
    current === null ? [] : [`${field} : ${current.items.join(' · ')} (${SOURCE_WORDS[current.source]})`],
  );
}

/** A new message of his the read may rest a value on: its number in the block the read got, its id, when he wrote it. */
export interface ReadSource {
  readonly number: number;
  readonly messageId: MessageId;
  readonly at: Date;
}

const sameItem = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** The items of a list once the new ones are added, the oldest dropped first when the line is full. */
function mergedItems(before: readonly string[], added: readonly string[]): string[] {
  const items = [...before];
  for (const item of added) if (!items.some((one) => sameItem(one, item))) items.push(item);
  // `checkedValue` joins with « · » (3 characters): the newest items stay.
  while (items.length > 1 && items.join(' · ').length > FAN_CARD_VALUE_MAX) items.shift();
  return items;
}

/**
 * What the read proposes, as facts (§ 7): a value rests on one of his new messages or is dropped; it is checked
 * against its field and against what the card never keeps (§ 8), and dropped when refused; a field only observed is
 * always a guess (§ 2); a list adds its new items to those the card shows; a happening of his life expires 30 days
 * after he told it. Whether a value replaces the card's, waits « à vérifier » or is dropped is `planFacts`' (§ 6).
 */
export function proposalsOfRead(
  read: FanCardRead,
  sources: readonly ReadSource[],
  card: Card = { fields: [], others: [] },
): FactProposal[] {
  const byNumber = new Map(sources.map((source) => [source.number, source]));
  const lists = new Map<FanCardField, readonly string[]>(
    card.fields.flatMap(({ field, current }) =>
      current !== null && fanCardFieldSpec(field).shape === 'list' ? [[field, current.items] as const] : [],
    ),
  );
  return read.facts.flatMap((fact): FactProposal[] => {
    const source = byNumber.get(fact.message);
    if (source === undefined) return [];
    const spec = fanCardFieldSpec(fact.field);
    const items = spec.shape === 'list' ? mergedItems(lists.get(fact.field) ?? [], fact.items) : fact.items;
    let value: string;
    try {
      value = checkedValue(fact.field, items);
    } catch (error) {
      if (error instanceof FanCardValueInvalid || error instanceof FanCardValueRefused) return [];
      throw error;
    }
    if (spec.shape === 'list') lists.set(fact.field, items);
    return [
      {
        category: spec.category,
        key: fact.field,
        value,
        kind: spec.learning === 'observe' ? 'inferred' : fact.kind,
        confidence: fact.confidence,
        sourceMessageId: source.messageId,
        observedAt: source.at,
        ...(fact.field === 'life_events' && {
          expiresAt: new Date(source.at.getTime() + LIFE_EVENT_DAYS * DAY_MS),
        }),
      },
    ];
  });
}
