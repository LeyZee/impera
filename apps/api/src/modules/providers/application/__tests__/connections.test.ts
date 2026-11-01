import type { AiProvider } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import type { VerificationOutcome } from '../../domain/verification';
import { createMemoryCredentialStore } from '../../infra/memory.store';
import {
  connectProvider,
  disconnectProvider,
  listProviderStatuses,
  createRefusalReporter,
  reverifyProvider,
  updateProviderSettings,
  type ConnectionsDeps,
} from '../connections';
import { createKeyCache } from '../key-cache';

const OLD_KEY = 'xai-OLDFAKEOLDFAKEOLDFAKE0000';
const NEW_KEY = 'xai-NEWFAKENEWFAKENEWFAKE0000';

const works: VerificationOutcome = {
  ok: true,
  keyLabel: 'nirvana-prod',
  summary: 'Grok 4.7 écrit et décide',
  facts: [],
  settings: {},
  voices: [],
  charactersLeft: null,
  isLowCredit: false,
};

/** A fake xAI whose answer the test sets; it records every key it was shown. */
function setup(answer: { current: VerificationOutcome }) {
  const store = createMemoryCredentialStore();
  const changes: AiProvider[] = [];
  const deps: ConnectionsDeps = {
    store,
    clock: { now: () => new Date('2026-10-17T19:00:00Z') },
    verifiers: [{ provider: 'xai', verify: () => Promise.resolve(answer.current) }],
    onChange: (provider) => {
      changes.push(provider);
    },
  };
  return { deps, store, changes };
}

describe('connecting a key', () => {
  it('saves a key the provider accepts and shows what it found', async () => {
    const { deps, store, changes } = setup({ current: works });
    const result = await connectProvider(deps, 'xai', OLD_KEY);
    expect(result).toMatchObject({ ok: true, value: { state: 'connected', keyLabel: 'nirvana-prod' } });
    expect((await store.find('xai'))?.key).toBe(OLD_KEY);
    expect(changes).toEqual(['xai']);
  });

  it('answers a misplaced key without calling the provider', async () => {
    const { deps, store } = setup({ current: { ok: false, kind: 'unreachable' } });
    const result = await connectProvider(deps, 'xai', 'AIzaFAKEFAKEFAKEFAKEFAKEFAKE000');
    expect(result).toEqual({
      ok: false,
      error: { kind: 'wrong_provider', message: 'Cette clé vient de Google : elle va dans Gemini.' },
    });
    expect(await store.find('xai')).toBeNull();
  });

  it('keeps the old key running when the replacement is refused', async () => {
    const answer: { current: VerificationOutcome } = { current: works };
    const { deps, store } = setup(answer);
    await connectProvider(deps, 'xai', OLD_KEY);
    answer.current = { ok: false, kind: 'model_not_allowed' };
    const result = await connectProvider(deps, 'xai', NEW_KEY);
    expect(result.ok).toBe(false);
    expect((await store.find('xai'))?.key).toBe(OLD_KEY);
  });

  it('says a quota stopped the check, without vouching for the key', async () => {
    const { deps, store } = setup({ current: { ok: false, kind: 'unreachable', reason: 'rate_limited' } });
    const result = await connectProvider(deps, 'xai', NEW_KEY);
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'unreachable',
        message:
          'xAI limite les appels pour l’instant (quota ou trop de requêtes). La clé n’a pas pu être vérifiée ; réessaie dans une minute.',
      },
    });
    expect(await store.find('xai')).toBeNull();
  });
});

describe('after the connection', () => {
  it('ignores an unreachable provider but turns red on a refusal', async () => {
    const answer: { current: VerificationOutcome } = { current: works };
    const { deps } = setup(answer);
    await connectProvider(deps, 'xai', OLD_KEY);
    answer.current = { ok: false, kind: 'unreachable' };
    expect((await reverifyProvider(deps, 'xai')).state).toBe('connected');
    answer.current = { ok: false, kind: 'unauthorized' };
    expect((await reverifyProvider(deps, 'xai')).state).toBe('needs_reconnect');
  });

  it('turns red at once when a production call refuses the key it has used for a while', async () => {
    const { deps, store } = setup({ current: works });
    const cache = createKeyCache(store, null);
    await connectProvider(deps, 'xai', OLD_KEY);
    await cache.reload();
    expect(cache.lookup('xai')).toBe(OLD_KEY);
    await createRefusalReporter(deps, cache)('xai', 'unauthorized');
    await cache.reload();
    expect(cache.lookup('xai')).toBeUndefined();
    expect((await listProviderStatuses(deps))[0]).toMatchObject({ state: 'needs_reconnect' });
  });

  it('keeps a voice of the account, refuses any other, and forgets everything on disconnect', async () => {
    const { deps, store } = setup({ current: { ...works, voices: [{ id: 'v1', name: 'Messa' }] } });
    await connectProvider(deps, 'xai', OLD_KEY);
    const updated = await updateProviderSettings(deps, 'xai', { voice: { id: 'v1', name: 'Messa' } });
    expect(updated.settings.voice).toEqual({ id: 'v1', name: 'Messa' });
    await expect(updateProviderSettings(deps, 'xai', { voice: { id: 'v9', name: 'Autre' } })).rejects.toThrow(
      /n’existe pas/,
    );
    const status = await disconnectProvider(deps, 'xai');
    expect(status.state).toBe('not_connected');
    expect(await store.find('xai')).toBeNull();
  });
});

describe('the line of a saved key (REG-08)', () => {
  it('shows the line of a working key as it is, never a sentence about the server (REG-08)', async () => {
    const { deps } = setup({ current: works });
    const result = await connectProvider(deps, 'xai', OLD_KEY);
    expect(result).toMatchObject({ ok: true, value: { message: 'Grok 4.7 écrit et décide' } });
  });
});

describe('picking another voice', () => {
  it('rewrites the line at once with the new voice', async () => {
    const voices = [
      { id: 'v1', name: 'Démo' },
      { id: 'v2', name: 'Autre démo' },
    ];
    const { deps } = setup({ current: works });
    const eleven: ConnectionsDeps = {
      ...deps,
      verifiers: [
        {
          provider: 'elevenlabs',
          verify: () =>
            Promise.resolve({
              ...works,
              summary: 'Voix de Démo · 920 vocaux ce mois',
              settings: { voice: voices[0] },
              voices,
              charactersLeft: 92_000,
            }),
        },
      ],
    };
    await connectProvider(eleven, 'elevenlabs', 'sk_FAKEFAKEFAKEFAKEFAKEFAKE0000');
    // The browser names the voice; the line takes the account's name for that id.
    const status = await updateProviderSettings(eleven, 'elevenlabs', {
      voice: { id: 'v2', name: 'Nom inventé' },
    });
    expect(status.message).toBe('Voix de Autre démo · 920 vocaux ce mois');
    expect(status.facts).toContainEqual({ label: 'Voix', value: 'Autre démo' });
  });
});

describe('a refusal reported for a key replaced since (recette, bug 2)', () => {
  /**
   * xAI refuses the old (leaked, revoked) key and accepts the new one; it counts the checks. The clock and the
   * process's key cache are the test's: the cache loads before the new key is pasted, as in the worker.
   */
  async function twoKeys() {
    const checked: string[] = [];
    let now = Date.parse('2026-10-17T19:00:00Z');
    const { deps, store } = setup({ current: works });
    const xai: ConnectionsDeps = {
      ...deps,
      clock: { now: () => new Date(now) },
      verifiers: [
        {
          provider: 'xai',
          verify: (key) => {
            checked.push(key);
            return Promise.resolve(key === OLD_KEY ? { ok: false, kind: 'unauthorized' } : works);
          },
        },
      ],
    };
    const cache = createKeyCache(store, null, () => now);
    await cache.reload();
    await connectProvider(xai, 'xai', NEW_KEY);
    checked.length = 0;
    const later = (ms: number) => {
      now += ms;
    };
    return { deps: xai, store, checked, cache, later };
  }

  it('leaves the new key green while this process has not reloaded it yet', async () => {
    const { deps, store, checked, cache } = await twoKeys();
    const report = createRefusalReporter(deps, cache);
    // The worker, still holding the revoked key for a few seconds, sees three refusals.
    await Promise.all([report('xai', 'unauthorized'), report('xai', 'unauthorized')]);
    await report('xai', 'unauthorized');
    expect(await store.find('xai')).toMatchObject({ key: NEW_KEY, state: 'connected' });
    // One check for the concurrent pair, none for the third: the accepted key is trusted for a minute.
    expect(checked).toEqual([NEW_KEY]);
  });

  it('checks again after a minute, and trusts the refusal once no call can still hold the old key', async () => {
    const { deps, store, checked, cache, later } = await twoKeys();
    await cache.reload();
    const report = createRefusalReporter(deps, cache);
    await report('xai', 'unauthorized');
    later(61_000);
    await report('xai', 'unauthorized');
    expect(checked).toEqual([NEW_KEY, NEW_KEY]);
    expect(await store.find('xai')).toMatchObject({ state: 'connected' });

    later(5 * 60_000);
    await report('xai', 'missing_permission');
    expect(checked).toHaveLength(2);
    expect(await store.find('xai')).toMatchObject({
      state: 'needs_reconnect',
      lastErrorKind: 'missing_permission',
    });
  });

  it('turns red on a spending limit the key check does not see (xAI answers its key endpoint, refuses calls)', async () => {
    const { deps, store } = setup({ current: works });
    const cache = createKeyCache(store, null);
    await connectProvider(deps, 'xai', OLD_KEY);
    await cache.reload();
    await createRefusalReporter(deps, cache)('xai', 'missing_permission');
    expect(await store.find('xai')).toMatchObject({
      state: 'needs_reconnect',
      lastErrorKind: 'missing_permission',
    });
  });

  it('concludes nothing when the provider cannot be reached to confirm', async () => {
    const { deps, store, cache } = await twoKeys();
    const unreachable: ConnectionsDeps = {
      ...deps,
      verifiers: [{ provider: 'xai', verify: () => Promise.resolve({ ok: false, kind: 'unreachable' }) }],
    };
    await createRefusalReporter(unreachable, cache)('xai', 'unauthorized');
    expect(await store.find('xai')).toMatchObject({ state: 'connected' });
  });

  it('decides again over a line changed meanwhile instead of dropping the refusal', async () => {
    const { deps, store } = setup({ current: works });
    const cache = createKeyCache(store, null);
    await connectProvider(deps, 'xai', OLD_KEY);
    await cache.reload();
    let lost = false;
    const racing: ConnectionsDeps = {
      ...deps,
      store: {
        ...store,
        update: (credential) => {
          if (lost) return store.update(credential);
          lost = true;
          return Promise.resolve(false);
        },
      },
    };
    await createRefusalReporter(racing, cache)('xai', 'unauthorized');
    expect(await store.find('xai')).toMatchObject({ state: 'needs_reconnect' });
  });

  it('ignores a service that has no saved key', async () => {
    const { deps, store } = setup({ current: works });
    await createRefusalReporter(deps, createKeyCache(store, null))('xai', 'unauthorized');
    expect(await store.find('xai')).toBeNull();
  });
});

describe('a check running while the key changes', () => {
  /** xAI answers at once for a new key, and only when the test says so for the old one (a slow provider). */
  async function slowCheck() {
    const { deps, store } = setup({ current: works });
    await connectProvider(deps, 'xai', OLD_KEY);
    let answerOldKey: (outcome: VerificationOutcome) => void = () => undefined;
    const slow: ConnectionsDeps = {
      ...deps,
      verifiers: [
        {
          provider: 'xai',
          verify: (key) =>
            key === OLD_KEY
              ? new Promise<VerificationOutcome>((resolve) => {
                  answerOldKey = resolve;
                })
              : Promise.resolve(works),
        },
      ],
    };
    const check = reverifyProvider(slow, 'xai');
    await Promise.resolve();
    return {
      deps: slow,
      store,
      check,
      answerOldKey: (outcome: VerificationOutcome) => {
        answerOldKey(outcome);
      },
    };
  }

  it('does not bring back a key disconnected meanwhile', async () => {
    const { deps, store, check, answerOldKey } = await slowCheck();
    await disconnectProvider(deps, 'xai');
    answerOldKey({ ok: false, kind: 'unauthorized' });
    expect((await check).state).toBe('not_connected');
    expect(await store.find('xai')).toBeNull();
  });

  it('does not overwrite a key replaced meanwhile', async () => {
    const { deps, store, check, answerOldKey } = await slowCheck();
    await connectProvider(deps, 'xai', NEW_KEY);
    answerOldKey({ ok: false, kind: 'unauthorized' });
    expect((await check).state).toBe('connected');
    expect(await store.find('xai')).toMatchObject({ key: NEW_KEY, state: 'connected' });
  });
});

describe('key cache', () => {
  it('uses the environment only when given one and nothing is saved', async () => {
    const store = createMemoryCredentialStore();
    const dev = createKeyCache(store, (p) => (p === 'xai' ? 'env-key' : undefined));
    const production = createKeyCache(store, null);
    await dev.reload();
    await production.reload();
    expect(dev.lookup('xai')).toBe('env-key');
    expect(production.lookup('xai')).toBeUndefined();
  });

  it('lists the four services in reading order, the environment marked as such', async () => {
    const { deps } = setup({ current: works });
    const statuses = await listProviderStatuses({ ...deps, hasEnvironmentKey: (p) => p === 'google' });
    expect(statuses.map((s) => [s.provider, s.source])).toEqual([
      ['xai', null],
      ['google', 'environment'],
      ['mistral', null],
      ['elevenlabs', null],
    ]);
  });
});
