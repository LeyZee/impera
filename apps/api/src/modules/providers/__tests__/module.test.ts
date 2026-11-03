import { describe, expect, it } from 'vitest';

import { createMemoryCredentialStore, createProvidersModule, nextAction, ProviderNotConnected } from '..';
import type { FetchLike } from '../infra/http';

const XAI_KEY = 'xai-FAKEFAKEFAKEFAKEFAKEFAKE0000';

/** Plays xAI only: the key is good until `revoked` flips. */
function fakeXai(state: { revoked: boolean }): FetchLike {
  return (url) => {
    const status = url.endsWith('/v1/api-key') && !state.revoked ? 200 : 401;
    const body = status === 200 ? { name: 'impera', acls: ['api-key:model:*'] } : { error: 'bad key' };
    return Promise.resolve({ status, text: () => Promise.resolve(JSON.stringify(body)) });
  };
}

describe('providers module', () => {
  it('hands the gateway a connected key, and stops once the key is refused', async () => {
    const state = { revoked: false };
    const module = createProvidersModule({
      store: createMemoryCredentialStore(),
      fetch: fakeXai(state),
      environmentKeys: null,
    });
    await module.start();
    expect(module.apiKeySource('xai')).toBeUndefined();
    expect(nextAction(await module.list())).toMatchObject({ kind: 'connect', provider: 'xai' });

    expect(await module.connect('xai', XAI_KEY)).toMatchObject({ ok: true, value: { state: 'connected' } });
    expect(module.apiKeySource('xai')).toBe(XAI_KEY);

    state.revoked = true;
    const [status] = await module.reverifyAll();
    expect(status).toMatchObject({ provider: 'xai', state: 'needs_reconnect' });
    expect(module.apiKeySource('xai')).toBeUndefined();
  });

  it('falls back to the environment outside production', async () => {
    const module = createProvidersModule({
      store: createMemoryCredentialStore(),
      fetch: fakeXai({ revoked: false }),
      environmentKeys: (provider) => (provider === 'google' ? 'AIza-env' : undefined),
    });
    await module.start();
    expect(module.apiKeySource('google')).toBe('AIza-env');
    expect((await module.list()).find((s) => s.provider === 'google')?.source).toBe('environment');
  });

  it('refuses settings for a service that is not connected', async () => {
    const module = createProvidersModule({
      store: createMemoryCredentialStore(),
      fetch: fakeXai({ revoked: false }),
      environmentKeys: null,
    });
    await expect(module.updateSettings('google', { visionModel: 'gemini-3.8-flash' })).rejects.toBeInstanceOf(
      ProviderNotConnected,
    );
  });
});
