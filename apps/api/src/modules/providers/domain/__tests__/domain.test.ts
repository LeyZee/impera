import { ProviderErrorKindSchema, type ProviderStatus } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { DASHBOARD_PROVIDERS } from '../catalog';
import {
  applyReverification,
  credentialFromVerification,
  markRefusedInProduction,
  toStatus,
} from '../credential';
import { checkKeyShape, detectProvider } from '../key-shape';
import { describeLowCredit, describeRefusal, describeVoiceAccount } from '../messages';
import { nextAction } from '../next-action';
import type { VerifiedKey } from '../verification';

const FAKE_XAI = 'xai-FAKEFAKEFAKEFAKEFAKEFAKE0000';
const FAKE_GOOGLE = 'AIzaFAKEFAKEFAKEFAKEFAKEFAKE000';
const FAKE_ELEVEN = 'sk_FAKEFAKEFAKEFAKEFAKEFAKE0000';
const NOW = new Date('2026-10-17T19:00:00Z');

const verified: VerifiedKey = {
  ok: true,
  keyLabel: 'nirvana-prod',
  summary: 'Grok 4.7 écrit et décide',
  facts: [{ label: 'Modèle', value: 'Grok 4.7' }],
  settings: {},
  voices: [],
  charactersLeft: null,
  isLowCredit: false,
};

function status(provider: ProviderStatus['provider'], state: ProviderStatus['state']): ProviderStatus {
  return { ...toStatus(provider, null, null), state };
}

describe('key shape', () => {
  it('recognises each console by its prefix', () => {
    expect(detectProvider(FAKE_XAI)).toBe('xai');
    expect(detectProvider(FAKE_GOOGLE)).toBe('google');
    expect(detectProvider(FAKE_ELEVEN)).toBe('elevenlabs');
    expect(detectProvider('mistral-like-key-without-prefix')).toBeUndefined();
  });

  it('refuses a cut paste and a key meant for another service, before any call', () => {
    expect(checkKeyShape('xai', 'xai-abc')).toEqual({ ok: false, error: { kind: 'too_short' } });
    expect(checkKeyShape('xai', FAKE_GOOGLE)).toEqual({
      ok: false,
      error: { kind: 'wrong_provider', belongsTo: 'google' },
    });
    expect(checkKeyShape('google', `  ${FAKE_GOOGLE}\n`)).toEqual({ ok: true, value: FAKE_GOOGLE });
    // Copied across a line break, or with a stray space inside.
    expect(checkKeyShape('xai', `${FAKE_XAI.slice(0, 12)}\n${FAKE_XAI.slice(12)}`)).toEqual({
      ok: true,
      value: FAKE_XAI,
    });
    expect(checkKeyShape('xai', `${FAKE_XAI.slice(0, 12)} ${FAKE_XAI.slice(12)}`)).toEqual({
      ok: true,
      value: FAKE_XAI,
    });
  });
});

describe('the single translation table', () => {
  it('has one French sentence per refusal and provider, never an HTTP code', () => {
    for (const provider of DASHBOARD_PROVIDERS) {
      for (const kind of ProviderErrorKindSchema.options) {
        const sentence = describeRefusal(provider, kind);
        expect(sentence.length).toBeGreaterThan(10);
        expect(sentence).not.toMatch(/\b(400|401|403|404|429|500)\b/);
      }
    }
  });

  it('says where a misplaced key belongs and which Gemini models the key sees', () => {
    expect(describeRefusal('xai', 'wrong_provider', { belongsTo: 'google' })).toBe(
      'Cette clé vient de Google : elle va dans Gemini.',
    );
    // « de » elides before a vowel.
    expect(describeRefusal('mistral', 'wrong_provider', { belongsTo: 'elevenlabs' })).toBe(
      'Cette clé vient d’ElevenLabs : elle va dans ElevenLabs.',
    );
    expect(describeRefusal('elevenlabs', 'wrong_provider')).toBe('Cette clé ne vient pas d’ElevenLabs.');
    expect(describeRefusal('xai', 'unauthorized')).toBe(
      'xAI ne reconnaît pas cette clé. Vérifie qu’elle est copiée en entier.',
    );
    expect(
      describeRefusal('google', 'vision_model_missing', {
        visionModel: 'gemini-3.8-flash',
        availableModels: ['gemini-3.5-flash'],
      }),
    ).toBe('gemini-3.8-flash n’est pas visible avec cette clé. Modèles trouvés : gemini-3.5-flash.');
    expect(describeRefusal('elevenlabs', 'missing_permission', { permission: 'voices_read' })).toBe(
      'La clé ne peut pas lire tout ce qu’il faut. Ajoute Voices en lecture à ses accès.',
    );
  });

  it('never vouches for a key it could not check: a quota and an outage each say what happened', () => {
    expect(describeRefusal('xai', 'unreachable', { reason: 'rate_limited' })).toBe(
      'xAI limite les appels pour l’instant (quota ou trop de requêtes). La clé n’a pas pu être vérifiée ; réessaie dans une minute.',
    );
    expect(describeRefusal('mistral', 'unreachable', { reason: 'outage' })).toBe(
      'Mistral ne répond pas normalement pour l’instant. La clé n’a pas pu être vérifiée ; réessaie dans une minute.',
    );
    for (const reason of [undefined, 'rate_limited', 'outage'] as const) {
      const sentence = describeRefusal('google', 'unreachable', reason === undefined ? {} : { reason });
      expect(sentence).not.toMatch(/pas en cause|clé est bonne|clé fonctionne/);
    }
  });

  it('counts low credit in voice notes', () => {
    expect(describeLowCredit(4_000)).toBe('Plus que 40 vocaux ce mois. Recharge avant d’en manquer.');
  });
});

describe('credential states', () => {
  const saved = credentialFromVerification('xai', FAKE_XAI, verified, NOW);

  it('stays as it is when the provider cannot be reached', () => {
    expect(applyReverification(saved, { ok: false, kind: 'unreachable' }, NOW)).toBe(saved);
  });

  it('turns red on a real refusal, at the check or on a production call', () => {
    expect(applyReverification(saved, { ok: false, kind: 'unauthorized' }, NOW).state).toBe(
      'needs_reconnect',
    );
    const refused = markRefusedInProduction(saved, 'unauthorized');
    expect(toStatus('xai', refused, 'dashboard').message).toBe(
      'xAI refuse la clé. Seul Mistral, s’il est branché, écrit en attendant.',
    );
  });

  it('says why the key stopped working, and what the agent does meanwhile', () => {
    const line = (kind: Parameters<typeof markRefusedInProduction>[1]) =>
      toStatus('xai', markRefusedInProduction(saved, kind), 'dashboard').message;
    expect(line('no_credit')).toBe(
      'Le compte xAI n’a plus de crédit. Seul Mistral, s’il est branché, écrit en attendant.',
    );
    expect(line('missing_permission')).toBe(
      'xAI refuse les appels de l’agent (accès ou plafond de dépenses). Seul Mistral, s’il est branché, écrit en attendant.',
    );
    expect(
      toStatus(
        'google',
        markRefusedInProduction({ ...saved, provider: 'google' }, 'api_not_enabled'),
        'dashboard',
      ).message,
    ).toBe(
      'Ce projet Google n’a pas accès à l’API Gemini. Recrée la clé depuis AI Studio. Grok regarde les médias en attendant.',
    );
  });

  it('tells a key Nirvana can no longer decrypt from a key the provider refuses', () => {
    const unreadable = {
      ...saved,
      key: null,
      state: 'needs_reconnect' as const,
      lastErrorKind: 'unauthorized' as const,
    };
    expect(toStatus('xai', unreadable, 'dashboard').message).toBe(
      'La clé Grok enregistrée ne peut plus être déchiffrée. Colle-la à nouveau. Seul Mistral, s’il est branché, écrit en attendant.',
    );
    expect(toStatus('xai', unreadable, 'dashboard').isUnreadable).toBe(true);
    expect(toStatus('xai', { ...unreadable, key: FAKE_XAI }, 'dashboard').isUnreadable).toBe(false);
  });

  it('never puts the key in the status', () => {
    expect(JSON.stringify(toStatus('xai', saved, 'dashboard'))).not.toContain(FAKE_XAI);
  });
});

describe('ElevenLabs line', () => {
  it('names the voice and the voice notes left, or says none is picked', () => {
    expect(describeVoiceAccount({ id: 'v1', name: 'Démo' }, 92_000).summary).toBe(
      'Voix de Démo · 920 vocaux ce mois',
    );
    expect(describeVoiceAccount(undefined, 92_000).summary).toBe('920 vocaux ce mois · aucune voix choisie');
  });
});

describe('next action', () => {
  it('does not ask to connect a service whose key comes from the environment (development)', () => {
    const fromEnvironment = { ...status('xai', 'not_connected'), source: 'environment' as const };
    expect(
      nextAction([fromEnvironment, status('google', 'connected'), status('elevenlabs', 'connected')]).kind,
    ).toBe('all_set');
  });

  it('leads with the reason of the refusal', () => {
    const refused = {
      ...status('google', 'needs_reconnect'),
      message: 'Le compte Google n’a plus de crédit.',
    };
    expect(nextAction([status('xai', 'connected'), refused])).toMatchObject({
      kind: 'replace_key',
      lead: 'Le compte Google n’a plus de crédit.',
      detail: 'Remplace la clé, ou règle le souci chez Google puis « Vérifier maintenant ».',
    });
  });

  it('sends no one to the provider for a key Nirvana can no longer decrypt', () => {
    const unreadable = { ...status('elevenlabs', 'needs_reconnect'), isUnreadable: true };
    expect(nextAction([status('xai', 'connected'), unreadable])).toMatchObject({
      kind: 'replace_key',
      detail: 'Remplace la clé : rien n’est à régler chez ElevenLabs.',
    });
  });

  it('names no persona in the ElevenLabs texts', () => {
    expect(
      nextAction([
        status('xai', 'connected'),
        status('elevenlabs', 'not_connected'),
        status('mistral', 'not_connected'),
      ]),
    ).toMatchObject({ detail: 'Parle avec la voix de la créatrice.' });
    expect(describeVoiceAccount(undefined, 0).facts[1]?.value).toBe(
      'Aucune voix clonée trouvée. Crée la voix de la créatrice dans ElevenLabs, puis reviens.',
    );
  });

  it('asks for Grok first, as it stops the agent', () => {
    const action = nextAction(DASHBOARD_PROVIDERS.map((p) => status(p, 'not_connected')));
    expect(action).toMatchObject({ kind: 'connect', provider: 'xai', lead: 'Connecte Grok' });
  });

  it('puts a refused key before low credit, and low credit before a missing service', () => {
    expect(
      nextAction([
        status('xai', 'connected'),
        status('google', 'needs_reconnect'),
        status('elevenlabs', 'low_credit'),
      ]).kind,
    ).toBe('replace_key');
    expect(
      nextAction([
        status('xai', 'connected'),
        status('google', 'not_connected'),
        status('elevenlabs', 'low_credit'),
      ]).kind,
    ).toBe('top_up');
  });

  it('says when the last one is left, then that all is set', () => {
    expect(
      nextAction([
        status('xai', 'connected'),
        status('google', 'connected'),
        status('elevenlabs', 'not_connected'),
      ]),
    ).toMatchObject({
      provider: 'elevenlabs',
      detail: 'C’est le dernier. Tu peux aussi le faire plus tard.',
    });
    expect(nextAction(DASHBOARD_PROVIDERS.map((p) => status(p, 'connected'))).kind).toBe('all_set');
  });
});
