import { describe, expect, it } from 'vitest';

import { checkVoiceOutput, DEFAULT_GUARD_SETTINGS, type GuardContext } from '../guards';
import {
  ACCOUNT_TOKENS,
  asksHerInstagram,
  maskOwnHandles,
  openAccountsForVoice,
  ownAccountsOpenedBy,
  resolveAccountTokens,
  speaksOfLives,
} from '../own-accounts';
import { guardContextOf } from '../turn-history';

// Invented handles only (CLAUDE.md): never a real account, in a test or anywhere in the repository.
const INSTA = 'exemple.insta_fictif';
const TIKTOK = 'exemple_tiktok_fictif';
const settings = { ...DEFAULT_GUARD_SETTINGS, ownAccounts: { instagram: INSTA, tiktok: TIKTOK } };

/** The codes her answer gets after his messages, as the composer reads them. */
function contactCodes(fanTexts: readonly string[], bubbles: string[], extra: GuardContext = {}): string[] {
  const context = {
    ...guardContextOf(fanTexts.map((text) => ({ from: 'fan' as const, text }))),
    ...extra,
  };
  return checkVoiceOutput(bubbles, settings, context)
    .filter((v) => v.code === 'contact_info')
    .map((v) => v.code);
}

describe('her own accounts (Charles 27/11)', () => {
  it('reads his asks for her Instagram, her wishlist or a cam, in four languages', () => {
    for (const text of [
      't’as insta ?',
      'c’est quoi ton insta',
      'je peux voir ta wishlist ?',
      'elle est où ta liste de souhaits',
      'tu fais des cams ?',
      'on peut faire une webcam',
      'what’s your ig',
      'can I see your wishlist',
      'dame tu insta',
      'tienes lista de deseos?',
      'hai instagram?',
      'fammi vedere la tua lista dei desideri',
    ])
      expect(asksHerInstagram(text), text).toBe(true);
    for (const text of ['je scrollais insta hier', 'bonne nuit', 'tu fais quoi ce soir'])
      expect(asksHerInstagram(text), text).toBe(false);
  });

  it('reads her lives, not the English verb', () => {
    for (const text of [
      't’étais en live hier ?',
      'j’adore tes lives',
      'when do you go live',
      'sei in diretta?',
    ])
      expect(speaksOfLives(text), text).toBe(true);
    for (const text of ['where do you live?', 'i live in a small town', 'je regarde un film'])
      expect(speaksOfLives(text), text).toBe(false);
  });

  it('lets exactly her Instagram through when he asks for her wishlist or a cam', () => {
    expect(
      contactCodes(['je peux voir ta wishlist ?'], [`elle est en story à la une sur mon insta, @${INSTA}`]),
    ).toEqual([]);
    expect(contactCodes(['tu fais des cams ?'], [`passe sur mon insta ${INSTA.toUpperCase()}`])).toEqual([]);
    expect(contactCodes(['t’as insta ?'], ['mon insta c’est', `@${INSTA}.`])).toEqual([]);
  });

  it('lets exactly her TikTok through in a live context', () => {
    expect(contactCodes(['j’ai raté ton live 😢'], [`suis-moi sur tiktok @${TIKTOK}`])).toEqual([]);
    expect(contactCodes(['coucou'], [`j’étais en live hier soir, mon tiktok c’est @${TIKTOK}`])).toEqual([]);
  });

  it('blocks her Instagram volunteered, without his ask', () => {
    expect(contactCodes(['coucou ça va ?'], [`mon insta c’est @${INSTA}`])).toContain('contact_info');
    expect(contactCodes(['j’ai raté ton live'], [`mon insta c’est @${INSTA}`])).toContain('contact_info');
  });

  it('blocks her TikTok outside a live context', () => {
    expect(contactCodes(['t’as insta ?'], [`mon tiktok c’est @${TIKTOK}`])).toContain('contact_info');
  });

  it('blocks a look-alike of her handle: one letter more, one changed, a shortened link, a link to it', () => {
    const ask = ['je peux voir ta wishlist ?'];
    expect(contactCodes(ask, [`mon insta c’est @${INSTA}x`])).toContain('contact_info');
    expect(contactCodes(ask, [`mon insta c’est @${INSTA.replace('i', 'l')}`])).toContain('contact_info');
    expect(contactCodes(ask, [`mon insta c’est @x${INSTA}`])).toContain('contact_info');
    expect(contactCodes(ask, [`mon insta : instagram.com/${INSTA}`])).toContain('contact_info');
    expect(contactCodes(ask, [`https://instagram.com/${INSTA}`])).toContain('contact_info');
    expect(contactCodes(ask, ['mon insta : bit.ly/3abcd']).length).toBeGreaterThan(0);
  });

  it('blocks any other handle or platform, even beside hers', () => {
    const ask = ['tu fais des cams ?'];
    expect(contactCodes(ask, ['mon insta c’est @autre.compte_fictif'])).toContain('contact_info');
    expect(contactCodes(ask, [`mon insta c’est @${INSTA}, ou lina.xx`])).toContain('contact_info');
    expect(contactCodes(ask, [`@${INSTA}`, 'ajoute-moi sur snap'])).toContain('contact_info');
    expect(contactCodes(ask, [`@${INSTA} sinon viens sur telegram`])).toContain('contact_info');
    expect(contactCodes(ask, [`@${INSTA} ou écris-moi sur whatsapp`])).toContain('contact_info');
    expect(contactCodes(ask, [`@${INSTA} ou appelle le 06 12 34 56 78`])).toContain('contact_info');
    expect(contactCodes(ask, [`mon snap c’est @${INSTA}`])).toContain('contact_info');
    expect(contactCodes(['j’adore tes lives'], [`mon telegram c’est @${TIKTOK}`])).toContain('contact_info');
  });

  it('keeps her plain words about a network as before', () => {
    expect(contactCodes(['t’as insta ?'], ['je poste sur insta vers 21h30'])).toEqual([]);
    expect(contactCodes(['coucou'], ['je scrollais tiktok'])).toEqual([]);
    // « mon insta » with no handle still reads as before: her own account named, blocked.
    expect(contactCodes(['coucou'], ['mon insta est en privé'])).toContain('contact_info');
  });

  it('gives nothing under care or a trap, nor without her handles', () => {
    const ask = ['je peux voir ta wishlist ?'];
    expect(contactCodes(ask, [`mon insta c’est @${INSTA}`], { ownAccountsOpen: { closed: true } })).toContain(
      'contact_info',
    );
    expect(
      checkVoiceOutput([`mon insta c’est @${INSTA}`], DEFAULT_GUARD_SETTINGS, {
        ownAccountsOpen: { instagram: true },
      }).map((v) => v.code),
    ).toContain('contact_info');
  });

  it('tells the voice only which accounts his messages open, never a handle', () => {
    const handles = { instagram: INSTA, tiktok: TIKTOK };
    expect(openAccountsForVoice(handles, ownAccountsOpenedBy(['ta wishlist stp']))).toEqual(['instagram']);
    expect(openAccountsForVoice(handles, ownAccountsOpenedBy(['ton prochain live c’est quand ?']))).toEqual([
      'tiktok',
    ]);
    expect(openAccountsForVoice(handles, ownAccountsOpenedBy(['salut']))).toEqual([]);
    expect(openAccountsForVoice(handles, { instagram: true, closed: true })).toEqual([]);
    expect(openAccountsForVoice({ tiktok: TIKTOK }, { instagram: true })).toEqual([]);
    expect(openAccountsForVoice(undefined, { instagram: true })).toEqual([]);
  });

  it('puts her handle in place of the token of an open account, after the voice (Sécurité, 27/11)', () => {
    const handles = { instagram: INSTA, tiktok: TIKTOK };
    expect(
      resolveAccountTokens([`mon insta c’est ${ACCOUNT_TOKENS.instagram} 😘`], handles, { instagram: true }),
    ).toEqual([`mon insta c’est @${INSTA} 😘`]);
    expect(resolveAccountTokens([`@${ACCOUNT_TOKENS.instagram}`], handles, { instagram: true })).toEqual([
      `@${INSTA}`,
    ]);
    expect(resolveAccountTokens([`j’étais en live, ${ACCOUNT_TOKENS.tiktok}`], handles, {})).toEqual([
      `j’étais en live, @${TIKTOK}`,
    ]);
  });

  it('leaves the token of a closed account, or of one with no handle typed, and the guard blocks it', () => {
    const closed = resolveAccountTokens([`mon insta ${ACCOUNT_TOKENS.instagram}`], { instagram: INSTA }, {});
    expect(closed).toEqual([`mon insta ${ACCOUNT_TOKENS.instagram}`]);
    const none = resolveAccountTokens(
      [`mon insta ${ACCOUNT_TOKENS.instagram}`],
      { tiktok: TIKTOK },
      { instagram: true },
    );
    expect(none).toEqual([`mon insta ${ACCOUNT_TOKENS.instagram}`]);
    for (const bubbles of [closed, none, ['tiens {{son_snap}}']])
      expect(
        checkVoiceOutput(bubbles, settings, { ownAccountsOpen: { instagram: true } }).map((v) => v.code),
      ).toContain('contact_info');
  });

  it('masks her handles wherever they are written, and in a guard’s match', () => {
    const handles = { instagram: INSTA, tiktok: TIKTOK };
    expect(maskOwnHandles(`suis-moi @${INSTA.toUpperCase()}. et ${TIKTOK}`, handles)).toBe(
      `suis-moi ${ACCOUNT_TOKENS.instagram}. et ${ACCOUNT_TOKENS.tiktok}`,
    );
    expect(maskOwnHandles(`@${INSTA}x`, handles)).toBe(`@${INSTA}x`);
    const matches = checkVoiceOutput([`mon insta c’est @${INSTA}`], settings, {})
      .map((v) => v.match ?? '')
      .join(' ');
    expect(matches).not.toContain(INSTA);
  });
});
