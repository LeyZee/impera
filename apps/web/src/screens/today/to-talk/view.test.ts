import { ConversationIdSchema, FanIdSchema, type ToTalkFan } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { duration, euros, standingOf, whenOf } from './view';

const NOW = new Date('2026-11-21T14:00:00Z');
const fan = (over: Partial<ToTalkFan>): ToTalkFan => ({
  conversationId: ConversationIdSchema.parse('00000000-0000-4000-8000-0000000000c1'),
  fanId: FanIdSchema.parse('00000000-0000-4000-8000-0000000000f1'),
  fanDisplayName: 'Fan inventé',
  tier: null,
  waitingMinutes: null,
  spentMinor: 0,
  lastPurchaseAt: null,
  fanSince: '2026-11-21T10:00:00Z',
  lastMessageAt: null,
  ...over,
});

describe('« À qui parler », in words', () => {
  it('writes amounts and waits as everywhere in the CRM', () => {
    expect([euros(5000), euros(4990)]).toEqual(['50 €', '49,90 €']);
    expect([duration(0), duration(45), duration(130), duration(3000)]).toEqual([
      '1 min',
      '45 min',
      '2 h',
      '2 j',
    ]);
  });

  it('says what a payer spent and when he last bought, and how new a newcomer is', () => {
    expect(standingOf(fan({ spentMinor: 25_000, lastPurchaseAt: '2026-11-18T09:00:00Z' }), NOW)).toBe(
      '250 € dépensés · dernier achat il y a 3 jours',
    );
    expect(standingOf(fan({}), NOW)).toBe('arrivé aujourd’hui');
    expect(standingOf(fan({ fanSince: '2026-11-19T10:00:00Z' }), NOW)).toBe('arrivé il y a 2 jours');
  });

  it('never says he arrived after his message: waiting a day means here a day at least (recette 27/11, G9)', () => {
    const waiting = fan({ waitingMinutes: 1_500 });
    expect([standingOf(waiting, NOW), whenOf(waiting, NOW).text]).toEqual([
      'arrivé il y a 1 jour',
      'attend depuis 1 j',
    ]);
  });

  it('says a long wait in amber, and how long a quiet fan has been quiet', () => {
    expect(whenOf(fan({ waitingMinutes: 31 }), NOW)).toEqual({ text: 'attend depuis 31 min', long: true });
    expect(whenOf(fan({ waitingMinutes: 4 }), NOW).long).toBe(false);
    expect(
      whenOf(fan({ waitingMinutes: null, tier: 'new', lastMessageAt: NOW.toISOString() }), NOW).text,
    ).toBe('à accueillir');
    expect(whenOf(fan({ lastMessageAt: '2026-11-15T14:00:00Z' }), NOW).text).toBe('rien depuis 6 jours');
  });
});
