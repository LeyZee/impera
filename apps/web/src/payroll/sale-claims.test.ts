import { PlatformAccountIdSchema, ShiftIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  claimAnswerText,
  claimBlockedText,
  claimShiftLine,
  claimsWaiting,
  pendingCountText,
} from './sale-claims';

const shift = {
  shiftId: ShiftIdSchema.parse('01900000-0000-7000-8000-000000000001'),
  creatorName: 'Nora Vidal',
  platformAccountId: PlatformAccountIdSchema.parse('01900000-0000-7000-8000-000000000002'),
  platform: 'reveal' as const,
  handle: 'nora',
  startsAt: '2026-11-21T13:05:00.000Z',
  endsAt: '2026-11-21T19:05:00.000Z',
};

describe('« J’ai été décisif sur une vente », les textes (trou 15)', () => {
  it('names the shift by its creator, account, day and hours in the agency’s zone', () => {
    expect(claimShiftLine(shift, 'Europe/Paris')).toBe(
      'Nora Vidal · @nora sur Reveal · sam. 21 nov. · 14\u00a0h\u00a005 – 20\u00a0h\u00a005',
    );
  });

  it('turns « Signaler un shift » off at three waiting, or with no shift to signal', () => {
    const waiting = { state: 'waiting' as const };
    expect(claimsWaiting([waiting, { state: 'settled' }, waiting])).toBe(2);
    expect(claimBlockedText([waiting, waiting], [shift])).toBeNull();
    expect(claimBlockedText([waiting, waiting, waiting], [shift])).toBe(
      'Tu as 3 signalements en attente : un manager y répond avant le suivant.',
    );
    expect(claimBlockedText([], [])).toBe('Aucun shift fini ces 15 derniers jours à signaler.');
  });

  it('tells the member where his claim stands, with the word of a refusal', () => {
    expect(claimAnswerText({ state: 'settled', answerNote: null })).toContain('Reçue de');
    expect(claimAnswerText({ state: 'not_retained', answerNote: 'Vente avant ton shift' })).toBe(
      'Réponse : « Vente avant ton shift »',
    );
    expect(claimAnswerText({ state: 'withdrawn', answerNote: null })).toBeNull();
    expect(pendingCountText(2)).toBe('2 en attente');
  });
});
