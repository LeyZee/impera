import { describe, expect, it } from 'vitest';

import {
  accountAsked,
  accountDecision,
  accountViolations,
  fixedSomething,
  meetingYes,
  usernamesIn,
  wantsToTry,
  withoutAllowedAccount,
  type AccountCuts,
} from '../accounts';
import { DEFAULT_GUARD_SETTINGS, checkVoiceOutput } from '../guards';

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

  it('finds a name with punctuation around it, or spread over its words (relecture Sécurité, 16/11)', () => {
    const names = ['nora_demo'];
    for (const text of [
      'c’est nora_demo.',
      'c’est nora_demo…',
      'tape nora_demo-',
      '(nora_demo)',
      'nora demo',
      'norademo',
      'nora-demo',
      'NORA . DEMO',
      'n0ra_dem0',
    ])
      expect(usernamesIn(text, names), text).toEqual(names);
    expect(usernamesIn('nora est demo', names)).toEqual([]);
    expect(usernamesIn('noradémoniaque', names)).toEqual([]);
  });
});

describe('the contact guard on an account (bounds 19 and 29)', () => {
  const names = [practice.username, lives.username, 'demo_perso'];
  const contacts = (bubbles: readonly string[]) =>
    checkVoiceOutput(bubbles, DEFAULT_GUARD_SETTINGS).filter((v) => v.code === 'contact_info');

  it('blocks any of her names but the one code allowed at this turn', () => {
    const answer = ['tape @demo_atelier sur insta 😊'];
    expect(accountViolations(answer, names, practice)).toEqual([]);
    expect(accountViolations(answer, names, lives)).toMatchObject([
      { code: 'contact_info', match: 'demo_atelier' },
    ]);
    expect(accountViolations(answer, names, null)).toHaveLength(1);
    expect(accountViolations(['et mon perso c’est Demo_Perso'], names, practice)).toHaveLength(1);
    // Another name at the end of a sentence, on the turn an account is allowed (relecture Sécurité, 16/11).
    expect(
      accountViolations(['tape @demo_atelier, et mon perso c’est demo_perso.'], names, practice),
    ).toMatchObject([{ code: 'contact_info', match: 'demo_perso' }]);
    expect(accountViolations(['mon perso : demo perso'], names, practice)).toHaveLength(1);
  });

  it('lets the allowed name and its platform pass the contact guard, and nothing else', () => {
    expect(contacts(['tape @demo_atelier sur insta 😊'])).not.toEqual([]);
    expect(contacts(withoutAllowedAccount(['tape @demo_atelier sur insta 😊'], practice))).toEqual([]);
    expect(
      contacts(withoutAllowedAccount(['mon insta c’est demo_atelier, ou mon snap'], practice)),
    ).not.toEqual([]);
    expect(
      contacts(withoutAllowedAccount(['tape demo_atelier sur insta, demo-atelier.com'], practice)),
    ).not.toEqual([]);
    expect(contacts(withoutAllowedAccount(['tape @demo_atelier sur insta'], lives))).not.toEqual([]);
    expect(withoutAllowedAccount(['tape @demo_atelier'], null)).toEqual(['tape @demo_atelier']);
  });

  it('refuses a yes to a meeting, never a soft no', () => {
    expect(meetingYes(['Oui avec plaisir 😊'])).toMatchObject([{ code: 'meeting_promise' }]);
    expect(meetingYes(['😏 ok quand tu veux'])).toHaveLength(1);
    expect(meetingYes(['carrément, un jour'])).toHaveLength(1);
    expect(meetingYes(['c’est trop tôt pour moi, j’ai besoin d’être en confiance'])).toEqual([]);
    expect(meetingYes(['oula pas si vite 😅'])).toEqual([]);
    expect(meetingYes([])).toEqual([]);
  });

  it('reads every bubble, a yes past an interjection, and a yes in so many words (relecture Sécurité, 16/11)', () => {
    for (const bubble of [
      'Oh oui carrément',
      'mais oui bb',
      'avec grand plaisir',
      'yes !',
      'évidemment 😘',
      'j’adorerais',
      'je dis pas non',
      'on se cale ça ?',
      'on s’organise ça',
      'bah ok',
    ])
      expect(meetingYes([bubble]), bubble).toHaveLength(1);
    expect(meetingYes(['hmm 😏', 'oui'])).toMatchObject([{ bubbleIndex: 1 }]);
    expect(meetingYes(['un jour peut-être, qui sait 😊'])).toEqual([]);
    expect(meetingYes(['mais non, c’est trop tôt pour moi'])).toEqual([]);
  });

  it('refuses an answer that fixes a date, a time, a place, a city or a price (bounds 22, 29)', () => {
    for (const bubble of [
      'samedi peut-être',
      'vers 20h',
      'à Lyon',
      'dans ma salle',
      'c’est 40 €',
      'trente euros la séance',
      'on se voit au parc',
      'je suis dans le sud',
      'je suis dans l’est',
      'en région parisienne',
      'le mois prochain peut-être',
      'on verra la semaine pro',
      'plutôt un week-end',
      'peut-être pendant les vacances',
      'je suis pas loin de chez toi',
      'près de la gare',
      'dans le coin',
      'dans le département',
      'je suis au nord',
      'à l’ouest',
    ])
      expect(fixedSomething(['coucou', bubble]), bubble).toMatchObject([
        { code: 'meeting_promise', bubbleIndex: 1 },
      ]);
    expect(
      fixedSomething(['trop tôt, j’ai besoin d’être en confiance', 'remplis le questionnaire 😊']),
    ).toEqual([]);
    expect(
      fixedSomething([
        'un jour peut-être',
        'plus tard 😊',
        'pas maintenant',
        'c’est trop tôt',
        'il est tard',
      ]),
    ).toEqual([]);
  });
});
