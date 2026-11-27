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
    { from: 'creator', text: 'Coucou toi', at: new Date(NOW.getTime() - 3_500_000) },
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

async function turn(fanText: string, bubbles: string[]) {
  const seen: GatewaySeen = { voiceCalls: 0, traces: [], voiceInputs: [] };
  const composed = await composeTurn(fakeGateway({ voice: { bubbles } }, seen), PERSONA, inputOf(fanText));
  const voice: VoiceInput | undefined = seen.voiceInputs?.[0];
  return { composed, voice };
}

describe('her own accounts in a turn (Charles 27/11)', () => {
  it('gives the voice her Instagram when he asks for her wishlist, and lets exactly it out', async () => {
    const { composed, voice } = await turn('je peux voir ta wishlist ?', [
      `elle est à la une sur mon insta @${INSTA}`,
    ]);
    expect(voice?.herAccounts).toEqual([{ platform: 'instagram', handle: INSTA }]);
    expect(composed.violations.filter((v) => v.code === 'contact_info')).toEqual([]);
  });

  it('gives the voice her TikTok when he speaks of her lives', async () => {
    const { voice } = await turn('ton prochain live c’est quand ?', ['bientôt 😏']);
    expect(voice?.herAccounts).toEqual([{ platform: 'tiktok', handle: TIKTOK }]);
  });

  it('gives nothing when he asks nothing, and blocks her Instagram volunteered', async () => {
    const { composed, voice } = await turn('tu fais quoi ce soir ?', [`viens sur mon insta @${INSTA}`]);
    expect(voice?.herAccounts).toBeUndefined();
    expect(composed.violations.some((v) => v.code === 'contact_info')).toBe(true);
  });
});
