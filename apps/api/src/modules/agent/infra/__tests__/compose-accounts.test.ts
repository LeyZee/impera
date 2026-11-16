import { PersonaPracticeSchema } from '@impera/contracts';
import type { Brief, LlmGateway, VoiceInput } from '@impera/llm';
import { describe, expect, it } from 'vitest';

import type { AccountCuts, ShareableAccount } from '../../domain/accounts';
import { DEFAULT_GUARD_SETTINGS } from '../../domain/guards';
import { composeTurn, type ComposeTurnInput, type ComposerPersona } from '../compose';

// Fictive accounts and practice (ADR 0143 § 17): her real ones live in the CRM only.
const practice: ShareableAccount = { platform: 'instagram', username: 'demo_atelier', usage: 'practice' };
const lives: ShareableAccount = { platform: 'tiktok', username: 'demo.lives', usage: 'lives' };
const aerial = PersonaPracticeSchema.parse({
  name: 'Danse aérienne',
  terms: ['tissu aérien'],
  level: null,
  how_she_talks: 'Avec fierté.',
  vocabulary: null,
  what_she_respects: null,
  anecdotes: null,
  offers: 'Des ateliers pour débutants.',
  answers: null,
  never_says: null,
});
const PERSONA: ComposerPersona = {
  creatorName: 'Lina',
  personaSheet: 'Lina, 27 ans.',
  guardSettings: DEFAULT_GUARD_SETTINGS,
  practices: [aerial],
};
const NO_CUT: AccountCuts = { care: false, doNotContact: false, salesFrozen: false, openRisk: false };
const BRIEF: Brief = {
  intent: 'small_talk',
  sentiment: 'positive',
  factsProposed: [],
  kycMissing: [],
  risks: [],
  action: 'reply',
  replyBrief: 'Lui répondre.',
  toneHints: [],
};
const META = {
  provider: 'xai',
  model: 'grok-4.7',
  isFallback: false,
  latencyMs: 1,
  costUsd: 0,
  promptHash: 'h',
} as const;

function gateway(brief: Brief, bubbles: readonly string[], seen: VoiceInput[]): LlmGateway {
  const unused = () => Promise.reject(new Error('not used'));
  return {
    sense: unused,
    transcribe: unused,
    describeTrendCaptures: unused,
    describeDrop: unused,
    channelPost: unused,
    summarizeScript: unused,
    identifyScript: unused,
    readCard: unused,
    promptHashes: { creatorDrop: 'd', scriptSummary: 's', scriptIdentity: 'i' },
    brain: () => Promise.resolve({ ok: true, value: { output: brief, meta: META } }),
    voice: (input) => {
      seen.push(input);
      return Promise.resolve({ ok: true, value: { output: { bubbles: [...bubbles] }, meta: META } });
    },
    health: unused,
    judge: unused,
    testConnection: unused,
  };
}

async function turn(
  fanText: string,
  bubbles: readonly string[],
  over: Partial<NonNullable<ComposeTurnInput['accounts']>> = {},
  brief: Brief = BRIEF,
) {
  const seen: VoiceInput[] = [];
  const composed = await composeTurn(gateway(brief, bubbles, seen), PERSONA, {
    history: [{ from: 'fan', text: fanText }],
    fanText,
    media: [],
    fanNotes: '',
    situation: {
      now: new Date('2026-11-16T15:00:00Z'),
      timeZone: 'Europe/Paris',
      relationshipStartedAt: new Date('2026-11-01T00:00:00Z'),
      spentCents: 0,
    },
    accounts: {
      shareable: [practice, lives],
      usernames: [practice.username, lives.username, 'demo_perso'],
      cuts: NO_CUT,
      orientedRecently: false,
      ...over,
    },
  });
  return { composed, hints: seen[0]?.brief.toneHints ?? [] };
}

describe('her accounts in a turn (ADR 0143)', () => {
  it('gives the account code chose, and lets only its name and platform leave', async () => {
    const { composed, hints } = await turn('t’as un tiktok ?', ['Oui ! tape demo.lives sur tiktok 😊']);
    expect(composed.account).toEqual({ kind: 'give', account: lives, orient: false });
    expect(hints.join(' ')).toContain('demo.lives');
    expect(composed.isBlocked).toBe(false);
  });

  it('blocks any other name of hers, even on that turn', async () => {
    const { composed } = await turn('t’as un tiktok ?', ['tape demo.lives, et mon perso demo_perso']);
    expect(composed.violations).toContainEqual(
      expect.objectContaining({ code: 'contact_info', match: 'demo_perso' }),
    );
    expect(composed.isBlocked).toBe(true);
  });

  it('gives her stage name when he asks for no use she marked, and no name may leave', async () => {
    const { composed, hints } = await turn('c’est quoi ton insta perso ?', ['tape demo_atelier sur insta']);
    expect(composed.account).toEqual({ kind: 'stage_name' });
    expect(hints.join(' ')).toContain('nom de scène');
    expect(composed.isBlocked).toBe(true);
  });

  it('points a fan who wants to try her practice to its account, with what the sheet offers', async () => {
    const { composed, hints } = await turn('la danse aérienne j’aimerais trop essayer', [
      'Postule sur demo_atelier 😊',
    ]);
    expect(composed.account).toEqual({ kind: 'give', account: practice, orient: true });
    const hint = hints.join(' ');
    expect(hint).toContain('Des ateliers pour débutants.');
    expect(hint).toContain('n’est pas une acceptation');
    expect(hint).toContain('pas sexuel');
    expect(composed.isBlocked).toBe(false);
  });

  it('gives nothing under a cut, nor after a recent orientation', async () => {
    expect(
      (await turn('t’as un tiktok ?', ['coucou'], { cuts: { ...NO_CUT, salesFrozen: true } })).composed
        .account,
    ).toBeUndefined();
    expect(
      (await turn('la danse aérienne j’aimerais essayer', ['coucou'], { orientedRecently: true })).composed
        .account,
    ).toBeUndefined();
    const risky: Brief = { ...BRIEF, risks: ['harassment'] };
    expect((await turn('t’as un tiktok ?', ['coucou'], {}, risky)).composed.account).toBeUndefined();
  });

  it('refuses a yes when he asks to see her for real', async () => {
    const meet: Brief = { ...BRIEF, intent: 'asks_to_meet' };
    const yes = await turn('on se voit ?', ['Oui avec plaisir 😊'], {}, meet);
    expect(yes.composed.violations).toContainEqual(expect.objectContaining({ code: 'meeting_promise' }));
    const soft = await turn('on se voit ?', ['C’est trop tôt pour moi 🙈'], {}, meet);
    expect(soft.composed.isBlocked).toBe(false);
  });
});
