import { describe, expect, it } from 'vitest';

import { accountAsked, accountDecision, usernamesIn, wantsToTry, type AccountCuts } from '../accounts';

// Fictive accounts (ADR 0143 § 7): her real ones live in the CRM only.
const practice = { platform: 'instagram', username: 'demo_atelier', usage: 'practice' } as const;
const lives = { platform: 'tiktok', username: 'demo.lives', usage: 'lives' } as const;
const NONE: AccountCuts = { care: false, doNotContact: false, salesFrozen: false, openRisk: false };
const base = {
  asked: null,
  interested: false,
  offers: true,
  shareable: [practice, lives],
  cuts: NONE,
  orientedRecently: false,
};

describe('accountAsked', () => {
  it('reads the use he looks for, or none', () => {
    expect(accountAsked('t’as un tiktok ?', false)).toBe('lives');
    expect(accountAsked('tu fais des lives ?', false)).toBe('lives');
    expect(accountAsked('c’est quoi ton insta perso', false)).toBe('personal');
    expect(accountAsked('ton insta pour la danse ?', true)).toBe('practice');
    expect(accountAsked('où je peux te suivre ?', false)).toBe('any');
    expect(accountAsked('tu es belle', false)).toBeNull();
  });

  it('reads a real wish to learn, not a passing mention', () => {
    expect(wantsToTry('j’aimerais trop essayer')).toBe(true);
    expect(wantsToTry('tu donnes des cours ?')).toBe(true);
    expect(wantsToTry('c’est joli')).toBe(false);
  });
});

describe('accountDecision (ADR 0143 § 8 to 16, bounds 18, 21, 23)', () => {
  it('gives only a marked account, for the use he looks for', () => {
    expect(accountDecision({ ...base, asked: 'lives' })).toEqual({
      kind: 'give',
      account: lives,
      orient: false,
    });
    expect(accountDecision({ ...base, asked: 'personal' })).toEqual({ kind: 'stage_name' });
    expect(accountDecision({ ...base, asked: 'any' })).toEqual({ kind: 'stage_name' });
    expect(accountDecision({ ...base, asked: 'lives', shareable: [] })).toEqual({ kind: 'stage_name' });
    expect(accountDecision(base)).toEqual({ kind: 'none' });
  });

  it('points a really interested fan to her practice’s account, once within the cooldown', () => {
    expect(accountDecision({ ...base, interested: true })).toEqual({
      kind: 'give',
      account: practice,
      orient: true,
    });
    expect(accountDecision({ ...base, interested: true, orientedRecently: true })).toEqual({ kind: 'none' });
    expect(accountDecision({ ...base, interested: true, offers: false })).toEqual({ kind: 'none' });
  });

  it('gives nothing in care, to a fan not to contact, with sales frozen, or with an open risk', () => {
    for (const cut of ['care', 'doNotContact', 'salesFrozen', 'openRisk'] as const)
      expect(
        accountDecision({ ...base, asked: 'lives', interested: true, cuts: { ...NONE, [cut]: true } }),
      ).toEqual({
        kind: 'none',
      });
  });
});

describe('usernamesIn (bound 19)', () => {
  it('finds her user names as whole words, case and @ aside', () => {
    expect(usernamesIn('Tape @Demo_Atelier sur insta', ['demo_atelier', 'demo.lives'])).toEqual([
      'demo_atelier',
    ]);
    expect(usernamesIn('demo_atelier2', ['demo_atelier'])).toEqual([]);
  });
});
