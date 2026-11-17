import type { ProviderStatus } from '@impera/contracts';
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
  agoText,
  healthStats,
  PROBE_CHIP,
  probeDetail,
  quotaShare,
  quotaText,
  quotaTone,
  troubleTone,
  troubleToShow,
  inUseTone,
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
    probe: null,
    activity: null,
    quota: null,
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
    ).toBe('L’agent n’écrit plus : Impera ne peut plus lire la clé de Grok et aucun relais n’est branché.');
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

  it('never blames the provider for a key Impera can no longer decrypt', () => {
    const unreadable = {
      ...status('elevenlabs', 'needs_reconnect'),
      verifiedAt: '2026-10-17T19:00:00.000Z',
      isUnreadable: true,
    };
    const notice = verifyNotice('elevenlabs', unreadable, { ...unreadable });
    expect(notice).toBe(
      'Impera ne peut plus lire la clé enregistrée : ElevenLabs n’a pas été contacté. Colle la clé à nouveau.',
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

describe('the health of a service (ADR 0091 § 7)', () => {
  const now = new Date('2026-11-16T14:00:00Z');

  it('says when, on which model and how fast the last « Essai réel » answered', () => {
    expect(
      probeDetail({ at: '2026-11-16T13:57:00Z', outcome: 'answers', latencyMs: 640, model: 'Grok 4.7' }, now),
    ).toBe('il y a 3 min · Grok 4.7 · 0,6 s');
    expect(
      probeDetail(
        { at: '2026-11-16T13:59:30Z', outcome: 'budget_reached', latencyMs: null, model: null },
        now,
      ),
    ).toBe('à l’instant');
    expect(PROBE_CHIP.no_credit).toEqual({ text: 'Plus de crédit', tone: 'bad' });
    expect(PROBE_CHIP.rate_limited.tone).toBe('warn');
  });

  it('gives the day of the agent’s calls, and Mistral’s relays even when it was not needed', () => {
    const quiet = { calls: 0, troubled: 0, asFallback: 0, lastSuccessAt: null, lastTrouble: null };
    expect(healthStats('mistral', quiet, now).map((s) => s.value)).toEqual([
      'aucun sur 7 jours',
      'aucun appel',
      'pas sollicité',
    ]);
    const busy = {
      calls: 40,
      troubled: 12,
      asFallback: 0,
      lastSuccessAt: '2026-11-16T11:00:00Z',
      lastTrouble: null,
    };
    expect(healthStats('xai', busy, now)).toEqual([
      { label: 'Dernier appel réussi', value: 'il y a 3 h', tone: null },
      { label: 'Sur 24 h', value: '40 appels, 12 erreurs', tone: 'warn' },
    ]);
    expect(troubleTone('no_credit')).toBe('bad');
    expect(troubleTone('timeout')).toBe('warn');
  });

  it('reads ElevenLabs’ month: used, when it comes back, amber under 10 % left', () => {
    const quota = { used: 9_500, limit: 10_000, resetsAt: '2026-12-01T00:00:00Z', plan: 'free' as const };
    expect(quotaText(quota)).toEqual({
      used: '9 500 sur 10 000 caractères ce mois',
      resets: 'revient le 1er décembre',
    });
    expect(quotaShare(quota)).toBe(95);
    expect(quotaTone(quota)).toBe('warn');
    expect(quotaTone({ ...quota, used: 10_000 })).toBe('bad');
    expect(agoText('2026-11-14T13:00:00Z', now)).toBe('il y a 2 j');
  });
});

describe('a service that passes its check but cannot pay (ADR 0091 § 7)', () => {
  const connected = status('mistral', 'connected');
  const probe = {
    at: '2026-11-16T13:58:00Z',
    outcome: 'no_credit' as const,
    latencyMs: 300,
    model: 'Mistral Large 4',
  };
  const trouble = { at: '2026-11-16T13:58:00Z', kind: 'no_credit' as const };
  const activity = { calls: 1, troubled: 1, asFallback: 0, lastSuccessAt: null, lastTrouble: trouble };

  it('turns amber, and says the failure once when the essai is the latest word', () => {
    expect(dotOf({ ...connected, probe, activity }, false)).toBe('low');
    expect(troubleToShow({ ...connected, probe, activity })).toBeNull();
    expect(troubleToShow({ ...connected, activity })).toEqual(trouble);
    const answered = { ...probe, outcome: 'answers' as const, at: '2026-11-16T13:59:00Z' };
    expect(dotOf({ ...connected, probe: answered, activity }, false)).toBe('ok');
  });

  it('says its chip in the amber of its dot, and keeps red for a service no longer connected', () => {
    expect(inUseTone(connected, 'bad')).toBe('warn');
    expect(inUseTone(connected, 'ok')).toBe('ok');
    expect(inUseTone(status('mistral', 'needs_reconnect'), 'bad')).toBe('bad');
  });
});
