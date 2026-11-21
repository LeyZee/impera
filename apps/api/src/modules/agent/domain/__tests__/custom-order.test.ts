import { describe, expect, it } from 'vitest';

import {
  checkNoCommitment,
  CUSTOM_ORDER_DECLINE_BRIEF,
  CUSTOM_ORDER_OPEN_BRIEF,
  CUSTOM_ORDER_WAIT_BRIEF,
  customOrderDecision,
  customOrderStop,
  type CustomOrderContext,
} from '../custom-order';

const asks: CustomOrderContext = {
  asksForService: true,
  chatterOnShift: false,
  orderOpen: false,
  risks: [],
  flags: { ageConfirmedAt: '2026-10-01T10:00:00Z' },
};

describe('customOrderDecision (ADR 0090 § A)', () => {
  it('does nothing when he asks for no custom order', () => {
    expect(customOrderDecision({ ...asks, asksForService: false })).toEqual({ kind: 'none' });
  });

  it('hands him to the chatter on shift', () => {
    expect(customOrderDecision({ ...asks, chatterOnShift: true })).toEqual({ kind: 'handoff' });
  });

  it('with nobody on shift, answers committing to nothing and opens the order', () => {
    expect(customOrderDecision(asks)).toEqual({ kind: 'reply', brief: CUSTOM_ORDER_WAIT_BRIEF, opens: true });
  });

  it('never opens a second order while one waits, even with a chatter on shift', () => {
    expect(customOrderDecision({ ...asks, orderOpen: true, chatterOnShift: true })).toEqual({
      kind: 'reply',
      brief: CUSTOM_ORDER_OPEN_BRIEF,
      opens: false,
    });
  });

  it('takes no order when nothing may be sold to him', () => {
    const declined = { kind: 'reply', brief: CUSTOM_ORDER_DECLINE_BRIEF, opens: false };
    expect(customOrderDecision({ ...asks, risks: ['distress'], chatterOnShift: true })).toEqual(declined);
    expect(
      customOrderDecision({
        ...asks,
        flags: { salesFrozen: { reason: 'operator', since: '2026-10-10T10:00:00Z' } },
      }),
    ).toEqual(declined);
    expect(customOrderDecision({ ...asks, flags: { doNotContact: true } })).toEqual(declined);
  });

  it('declines softly what she never does, never « je vais y réfléchir » (audit du 16/11, M3)', () => {
    expect(customOrderDecision({ ...asks, neverDoes: true, chatterOnShift: true })).toEqual({
      kind: 'reply',
      brief: CUSTOM_ORDER_DECLINE_BRIEF,
      opens: false,
    });
  });

  it('opens no order and calls no chatter while his age is not confirmed (audit du 16/11, M3)', () => {
    expect(customOrderDecision({ ...asks, ageConfirmed: false, chatterOnShift: true })).toEqual({
      kind: 'reply',
      brief: CUSTOM_ORDER_WAIT_BRIEF,
      opens: false,
    });
    expect(customOrderDecision({ ...asks, ageConfirmed: true })).toMatchObject({ opens: true });
  });

  it('with his limits unknown, commits to nothing and opens nothing', () => {
    expect(customOrderDecision({ ...asks, flags: undefined, chatterOnShift: true })).toEqual({
      kind: 'reply',
      brief: CUSTOM_ORDER_WAIT_BRIEF,
      opens: false,
    });
  });

  it('keeps every brief free of a yes, a price or a delay', () => {
    for (const brief of [CUSTOM_ORDER_WAIT_BRIEF, CUSTOM_ORDER_OPEN_BRIEF, CUSTOM_ORDER_DECLINE_BRIEF]) {
      expect(brief).toContain('sans rien promettre');
    }
  });
});

describe('checkNoCommitment', () => {
  it.each([
    ['ok je te fais ça 😘'],
    ['Oui je peux te la faire'],
    ['c’est d’accord'],
    ['je te prépare ça'],
    ['je te l’envoie demain'],
    ['ce soir si tu veux'],
    ['dans 2 jours max'],
    ['d’ici vendredi'],
    ['ça te coûtera un peu plus'],
    ['50 € et c’est à toi'],
  ])('blocks a commitment: %s', (text) => {
    expect(checkNoCommitment([text]).map((v) => v.code)).toEqual(['no_commitment']);
    expect(checkNoCommitment([text])[0]?.severity).toBe('blocking');
  });

  it.each([
    ['oh j’adore l’idée 🙈', 'laisse-moi y réfléchir, je te redis'],
    ['c’est mignon que tu me demandes ça', 'je garde ça dans un coin de ma tête'],
    ['je note 😏 et sinon ta journée ?'],
  ])('lets a waiting answer pass: %s', (...bubbles) => {
    expect(checkNoCommitment(bubbles)).toEqual([]);
  });

  it('reads the whole message as well', () => {
    expect(checkNoCommitment(['je te la fais', 'pour toi'])).not.toEqual([]);
  });
});

describe('customOrderStop (ADR 0159 § A.1)', () => {
  const adult = { risks: [], flags: { ageConfirmedAt: '2026-10-01T10:00:00Z' } } as const;

  it('lets his order go on when nothing stops it', () => {
    expect(customOrderStop(adult)).toBe('none');
  });

  it('sells nothing to a fan whose sales are frozen, who must not be written to, or at risk', () => {
    expect(
      customOrderStop({
        ...adult,
        flags: { ...adult.flags, salesFrozen: { reason: 'operator', since: '2026-11-01T00:00:00Z' } },
      }),
    ).toBe('no_sale');
    expect(customOrderStop({ ...adult, flags: { ...adult.flags, doNotContact: true } })).toBe('no_sale');
    expect(customOrderStop({ ...adult, risks: ['money_trouble'] })).toBe('no_sale');
  });

  it('declines what she never does', () => {
    expect(customOrderStop({ ...adult, neverDoes: true })).toBe('never_does');
  });

  it('opens nothing while his limits are unknown or his age is not confirmed', () => {
    expect(customOrderStop({ risks: [], flags: undefined })).toBe('hold');
    expect(customOrderStop({ ...adult, ageConfirmed: false })).toBe('hold');
  });

  it('puts no sale above his age: a frozen fan is declined, never kept waiting', () => {
    expect(customOrderStop({ risks: ['distress'], flags: undefined })).toBe('no_sale');
  });
});

describe('checkNoCommitment, a tip (ADR 0159 § A.4)', () => {
  it('blocks a tip asked for his order', () => {
    expect(checkNoCommitment(['envoie un petit pourboire et je vois 😏']).map((v) => v.code)).toEqual([
      'no_commitment',
    ]);
    expect(checkNoCommitment(['a few tips and it’s yours'])).not.toEqual([]);
  });
});
