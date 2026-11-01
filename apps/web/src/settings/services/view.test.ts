import type { ProviderStatus } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { GUIDES } from './guide';
import {
  checkedAgo,
  dotOf,
  dotOfNext,
  leadOf,
  nextAfter,
  normalizeKey,
  shortStateOf,
  verifyNotice,
} from './view';

function status(provider: ProviderStatus['provider'], state: ProviderStatus['state']): ProviderStatus {
  return {
    provider,
    state,
    source: state === 'not_connected' ? null : 'dashboard',
    keyLabel: null,
    verifiedAt: null,
    isUnreadable: false,
    message: 'Message',
    facts: [],
    settings: {},
    voices: [],
  };
}

describe('Services view rules', () => {
  it('says when a key was last checked', () => {
    const now = new Date('2026-10-17T20:00:00Z');
    expect(checkedAgo(null, now)).toBeNull();
    expect(checkedAgo('2026-10-17T19:59:40Z', now)).toBe('vérifié à l’instant');
    expect(checkedAgo('2026-10-17T19:48:00Z', now)).toBe('vérifié il y a 12 min');
    expect(checkedAgo('2026-10-17T17:00:00Z', now)).toBe('vérifié il y a 3 h');
  });

  it('says the agent writes no more when Grok is refused and no relay works, else who writes instead', () => {
    const refused = {
      kind: 'replace_key' as const,
      provider: 'xai' as const,
      lead: 'xAI refuse la clé. Seul Mistral, s’il est branché, écrit en attendant.',
      detail: 'd',
    };
    expect(leadOf(refused, [status('xai', 'needs_reconnect'), status('mistral', 'not_connected')])).toBe(
      'L’agent n’écrit plus : xAI refuse la clé de Grok et aucun relais n’est branché.',
    );
    expect(leadOf(refused, [status('xai', 'needs_reconnect'), status('mistral', 'needs_reconnect')])).toMatch(
      /^L’agent n’écrit plus/,
    );
    expect(leadOf(refused, [status('xai', 'needs_reconnect'), status('mistral', 'connected')])).toBe(
      'xAI refuse la clé. Mistral écrit à la place de Grok.',
    );
    expect(leadOf(refused, [status('xai', 'needs_reconnect'), status('venice', 'connected')])).toBe(
      'xAI refuse la clé. Venice écrit à la place de Grok.',
    );
    expect(
      leadOf(refused, [
        { ...status('xai', 'needs_reconnect'), isUnreadable: true },
        status('mistral', 'not_connected'),
      ]),
    ).toBe('L’agent n’écrit plus : Nirvana ne peut plus lire la clé de Grok et aucun relais n’est branché.');
    // Another service's action keeps the server's words.
    const google = { ...refused, provider: 'google' as const, lead: 'Google refuse la clé.' };
    expect(leadOf(google, [status('google', 'needs_reconnect')])).toBe('Google refuse la clé.');
  });

  it('gives the service the top explains a two-word state', () => {
    expect(shortStateOf(status('xai', 'needs_reconnect'))).toBe('Clé refusée');
    expect(shortStateOf({ ...status('xai', 'needs_reconnect'), isUnreadable: true })).toBe('Clé illisible');
    expect(shortStateOf(status('elevenlabs', 'low_credit'))).toBe('Crédit bas');
    expect(shortStateOf(status('xai', 'connected'))).toBeNull();
  });

  it('offers the next service still to connect, then « Terminé »', () => {
    const services = [
      status('xai', 'connected'),
      status('google', 'not_connected'),
      status('elevenlabs', 'not_connected'),
    ];
    expect(nextAfter(services, 'xai')).toEqual({ label: 'Continuer avec Gemini', provider: 'google' });
    expect(nextAfter([status('xai', 'connected')], 'xai')).toEqual({ label: 'Terminé', provider: null });
  });

  it('rings Grok in amber while it is missing, the others in grey', () => {
    expect(dotOf(status('xai', 'not_connected'), false)).toBe('must');
    expect(dotOf(status('google', 'not_connected'), false)).toBe('off');
    expect(dotOf(status('google', 'connected'), true)).toBe('busy');
    expect(dotOfNext({ kind: 'connect', provider: 'xai', lead: 'Connecte Grok', detail: 'd' })).toBe('must');
    expect(dotOfNext({ kind: 'all_set', lead: 'Tout est connecté', detail: 'd' })).toBe('ok');
  });

  it('reads a key from the development environment as working', () => {
    const fromEnvironment = (provider: ProviderStatus['provider']): ProviderStatus => ({
      ...status(provider, 'not_connected'),
      source: 'environment',
    });
    expect(dotOf(fromEnvironment('xai'), false)).toBe('ok');
    expect(dotOf(fromEnvironment('xai'), true)).toBe('busy');
    expect(
      nextAfter(
        [status('xai', 'connected'), fromEnvironment('google'), status('elevenlabs', 'not_connected')],
        'xai',
      ),
    ).toEqual({ label: 'Continuer avec ElevenLabs', provider: 'elevenlabs' });
    expect(nextAfter([status('xai', 'connected'), fromEnvironment('google')], 'xai')).toEqual({
      label: 'Terminé',
      provider: null,
    });
  });

  it('says when « Vérifier maintenant » could not reach the provider', () => {
    const before = { ...status('xai', 'connected'), verifiedAt: '2026-10-17T19:00:00.000Z' };
    expect(verifyNotice('xai', before, { ...before })).toBe(
      'xAI n’a pas répondu. L’état affiché est celui de la dernière vérification.',
    );
    expect(verifyNotice('google', before, { ...before })).toMatch(/^Google n’a pas répondu/);
    expect(verifyNotice('xai', before, { ...before, verifiedAt: '2026-10-17T20:00:00.000Z' })).toBeNull();
    // A refusal is an answer: it comes with its own verification time.
    expect(
      verifyNotice('xai', before, {
        ...before,
        state: 'needs_reconnect',
        verifiedAt: '2026-10-17T20:00:00.000Z',
      }),
    ).toBeNull();
  });

  it('never blames the provider for a key Nirvana can no longer decrypt', () => {
    const unreadable = {
      ...status('elevenlabs', 'needs_reconnect'),
      verifiedAt: '2026-10-17T19:00:00.000Z',
      isUnreadable: true,
    };
    const notice = verifyNotice('elevenlabs', unreadable, { ...unreadable });
    expect(notice).toBe(
      'Nirvana ne peut plus lire la clé enregistrée : ElevenLabs n’a pas été contacté. Colle la clé à nouveau.',
    );
    expect(notice).not.toMatch(/n’a pas répondu/);
  });

  it('says what really stops when a key is removed', () => {
    expect(GUIDES.xai.offConsequence).toBe(
      'Seul Mistral, s’il est branché, écrira tant que Grok n’est pas reconnecté.',
    );
    expect(GUIDES.google.offConsequence).toMatch(/Grok/);
    expect(GUIDES.elevenlabs.offConsequence).toMatch(/vocaux/);
    expect(GUIDES.mistral.offConsequence).toMatch(/relais/);
  });

  it('removes every space and line break from a pasted key', () => {
    expect(normalizeKey('  xai-ABC\n  DEF\t\r\nGHI  ')).toBe('xai-ABCDEFGHI');
    expect(normalizeKey(' \n ')).toBe('');
  });
});
