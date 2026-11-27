import { ToTalkSchema, type ToTalk } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { nextFanOf, waitWords } from './next';

/* Invented data (ADR 0010). */
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fan = (conversation: number, name: string, waitingMinutes: number | null) => ({
  conversationId: id(conversation),
  fanId: id(100 + conversation),
  fanDisplayName: name,
  tier: 'payer',
  waitingMinutes,
  spentMinor: 4_500,
  lastPurchaseAt: null,
  fanSince: '2026-11-01T10:00:00Z',
  lastMessageAt: '2026-11-27T20:56:00Z',
});

type Fan = ReturnType<typeof fan>;
const toTalk = (waiting: Fan[], newcomers: Fan[] = []): ToTalk =>
  ToTalkSchema.parse({ creatorId: id(999), waiting, newcomers, silent: [], ageHeld: 0 });

describe('« Ensuite » at the foot of the panel (maquette v4, 27/11)', () => {
  it('names who waits first, past two minutes, and counts the others behind him', () => {
    const next = nextFanOf(
      toTalk([fan(1, 'Marco_demo', 4), fan(2, 'Leo_demo', 3)], [fan(3, 'Nouveau_demo', 9)]),
      id(9),
    );
    expect(next).toEqual({ name: 'Marco_demo', waitingMinutes: 4, more: 2 });
  });

  it('never names the conversation open, nor a fan under two minutes or not waiting', () => {
    expect(nextFanOf(toTalk([fan(1, 'Marco_demo', 4)]), id(1))).toBeNull();
    expect(nextFanOf(toTalk([fan(1, 'Marco_demo', 1), fan(2, 'Leo_demo', null)]), id(9))).toBeNull();
  });

  it('says the wait in minutes, then in hours', () => {
    expect(waitWords(4)).toBe('attend depuis 4 min');
    expect(waitWords(60)).toBe('attend depuis 1 h');
    expect(waitWords(72)).toBe('attend depuis 1 h 12');
  });
});
