import type { VoiceInput } from '@impera/llm';
import { describe, expect, it } from 'vitest';

import { fakeGateway, type GatewaySeen } from '../../../../__tests__/support/llm';
import { DEFAULT_GUARD_SETTINGS } from '../../domain/guards';
import { composeTurn, type ComposerPersona, type ComposeTurnInput } from '../compose';

/**
 * Her own accounts through the whole turn (Charles 27/11): the voice receives the one his message opens, and the guard
 * lets exactly that handle out. Invented persona and handles only.
 */

const NOW = new Date('2026-11-27T20:00:00Z');
const INSTA = 'exemple.insta_fictif';
const TIKTOK = 'exemple_tiktok_fictif';

const PERSONA: ComposerPersona = {
  creatorName: 'Elena',
  personaSheet: 'Fiche de démonstration : Elena, étudiante inventée.',
  guardSettings: { ...DEFAULT_GUARD_SETTINGS, ownAccounts: { instagram: INSTA, tiktok: TIKTOK } },
  playsJealous: false,
  spokenLanguages: ['french'],
  languageExamples: {},
};

const inputOf = (fanText: string): ComposeTurnInput => ({
  history: [
    { from: 'fan', text: 'Salut', at: new Date(NOW.getTime() - 3_600_000) },
    // An earlier answer of hers that gave her Instagram: the prompts read its token, never the handle.
    { from: 'creator', text: `Coucou toi, c’est @${INSTA}`, at: new Date(NOW.getTime() - 3_500_000) },
    { from: 'fan', text: fanText, at: NOW },
  ],
  fanText,
  media: [],
  fanNotes: '',
  situation: {
    now: NOW,
    timeZone: 'Europe/Paris',
    relationshipStartedAt: new Date('2026-11-20T10:00:00Z'),
    spentCents: 0,
  },
  trace: { creatorId: 'creator-demo', conversationId: 'conversation-demo', draftId: 'draft-demo' },
  random: () => 0,
});

async function turn(fanText: string, bubbles: string[], persona: ComposerPersona = PERSONA) {
  const seen: GatewaySeen = { voiceCalls: 0, traces: [], voiceInputs: [], brainInputs: [] };
  const composed = await composeTurn(fakeGateway({ voice: { bubbles } }, seen), persona, inputOf(fanText));
  const voice: VoiceInput | undefined = seen.voiceInputs?.[0];
  // Everything the models were asked, prompts included: they are built from these inputs only.
  const asked = JSON.stringify([seen.voiceInputs, seen.brainInputs]);
  return { composed, voice, asked };
}

const contactOf = (violations: readonly { readonly code: string }[]) =>
  violations.filter((v) => v.code === 'contact_info');

describe('her own accounts in a turn (Charles 27/11, Sécurité)', () => {
  it('tells the voice her Instagram is open, never its handle; code puts it in the draft', async () => {
    const { composed, voice, asked } = await turn('je peux voir ta wishlist ?', [
      'elle est à la une sur mon insta {{son_instagram}}',
    ]);
    expect(voice?.openAccounts).toEqual(['instagram']);
    expect(asked).not.toContain(INSTA);
    expect(asked).not.toContain(TIKTOK);
    expect(asked).toContain('{{son_instagram}}');
    expect(composed.bubbles.join(' ')).toContain(`@${INSTA}`);
    expect(contactOf(composed.violations)).toEqual([]);
    expect(composed.isBlocked).toBe(false);
  });

  it('tells the voice her TikTok is open when he speaks of her lives', async () => {
    const { composed, voice, asked } = await turn('ton prochain live c’est quand ?', [
      'bientôt 😏 suis-moi sur tiktok {{son_tiktok}}',
    ]);
    expect(voice?.openAccounts).toEqual(['tiktok']);
    expect(asked).not.toContain(TIKTOK);
    expect(composed.bubbles.join(' ')).toContain(`@${TIKTOK}`);
    expect(composed.isBlocked).toBe(false);
  });

  it('blocks the token of an account he did not open: rewritten, then a human, never sent as is', async () => {
    const { composed, voice } = await turn('tu fais quoi ce soir ?', [
      'viens sur mon insta {{son_instagram}}',
    ]);
    expect(voice?.openAccounts).toBeUndefined();
    expect(contactOf(composed.violations).length).toBeGreaterThan(0);
    expect(composed.isBlocked).toBe(true);
    expect(composed.bubbles.join(' ')).not.toContain(INSTA);
  });

  it('blocks a token with no handle typed', async () => {
    const without: ComposerPersona = {
      ...PERSONA,
      guardSettings: { ...PERSONA.guardSettings, ownAccounts: { tiktok: TIKTOK } },
    };
    const { composed, voice } = await turn(
      'je peux voir ta wishlist ?',
      ['mon insta {{son_instagram}}'],
      without,
    );
    expect(voice?.openAccounts).toBeUndefined();
    expect(composed.isBlocked).toBe(true);
  });
});
