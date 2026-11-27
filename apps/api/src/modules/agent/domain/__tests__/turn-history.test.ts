import { describe, expect, it } from 'vitest';

import {
  askedHisAge,
  earlierFanTexts,
  guardContextOf,
  herAnswersSince,
  hisMessagesAt,
  knownHoursOf,
  relationshipOf,
  withTimeNotes,
  type HistoryTurn,
} from '../turn-history';

const at = (iso: string) => new Date(iso);

// An invented conversation.
const HISTORY: readonly HistoryTurn[] = [
  { from: 'fan', text: 'Salut', at: at('2026-11-20T18:00:00Z') },
  { from: 'creator', text: 'Coucou, t’as quel âge ?', at: at('2026-11-20T18:01:00Z') },
  { from: 'fan', text: 'J’ai 30 ans', at: at('2026-11-20T18:05:00Z') },
  { from: 'creator', text: 'Top', at: at('2026-11-20T18:06:00Z') },
  { from: 'fan', text: 'Tu me fais ça pour 10 € ?', at: at('2026-11-20T21:00:00Z') },
  { from: 'fan', text: 'C’est combien ?', at: at('2026-11-20T21:01:00Z') },
];

describe('what a turn reads of the conversation', () => {
  it('counts how long they have talked, and whether he paid', () => {
    const situation = {
      now: at('2026-11-21T18:00:00Z'),
      relationshipStartedAt: at('2026-11-20T18:00:00Z'),
      spentCents: 1_500,
    };
    expect(knownHoursOf(situation)).toBe(24);
    expect(relationshipOf(situation)).toEqual({ knownHours: 24, hasBought: true });
  });

  it('gives the guards his sums and his price question since her last answer, and his last message', () => {
    const context = guardContextOf(HISTORY, true, 1_500, { flirting: true, meetingTier: 2 });
    expect(context).toMatchObject({
      hasMedia: true,
      allowedPriceMinor: 1_500,
      flirting: true,
      meetingTier: 2,
      sentBefore: ['Coucou, t’as quel âge ?', 'Top'],
      fanAmountsMinor: [1_000],
      fanAskedPrice: true,
      fanLastMessage: 'C’est combien ?',
    });
    expect(guardContextOf(HISTORY)).not.toHaveProperty('meetingTier');
    expect(guardContextOf(HISTORY)).not.toHaveProperty('humiliationWanted');
  });

  it('reads his earlier messages without the run she answers, and her age question once asked', () => {
    expect(earlierFanTexts(HISTORY)).toEqual(['Salut', 'J’ai 30 ans']);
    expect(askedHisAge(HISTORY)).toBe(true);
    expect(askedHisAge(HISTORY.slice(0, 1))).toBe(false);
  });

  it('counts her answers since a moment, and dates his messages', () => {
    expect(herAnswersSince(HISTORY, null)).toBe(0);
    expect(herAnswersSince(HISTORY, at('2026-11-20T18:02:00Z'))).toBe(1);
    expect(hisMessagesAt(HISTORY)).toHaveLength(4);
  });

  it('notes the time that passed before a message of his after a silence', () => {
    const noted = withTimeNotes(HISTORY, 'Europe/Paris');
    expect(noted).toHaveLength(HISTORY.length);
    expect(noted[4]).toHaveProperty('timeNote');
    expect(noted[1]).not.toHaveProperty('timeNote');
  });
});
