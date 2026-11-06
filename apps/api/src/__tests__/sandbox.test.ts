import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from '../logger';
import {
  guardFetch,
  installSandboxGuard,
  isLoopbackUrl,
  sandboxOf,
  SandboxBlockedCall,
  sdkBaseUrlsOf,
} from '../sandbox';

import { testConfig } from './support/config';

/** ADR 0075: the recette sandbox, on a developer's machine only, with nothing leaving it. */

describe('the sandbox configuration', () => {
  it('is off unless asked', () => {
    expect(sandboxOf(testConfig())).toBeNull();
  });

  it('aims every service at the local fake world, on its own path', () => {
    const sandbox = sandboxOf(testConfig({ IMPERA_SANDBOX: '1' }));
    expect(sandbox?.world).toBe('http://127.0.0.1:4010');
    expect(sandbox?.baseUrls).toEqual({
      xai: 'http://127.0.0.1:4010/xai',
      google: 'http://127.0.0.1:4010/google',
      mistral: 'http://127.0.0.1:4010/mistral',
      elevenlabs: 'http://127.0.0.1:4010/elevenlabs',
      revealCrm: 'http://127.0.0.1:4010/reveal-crm',
    });
    expect(sandbox === null ? null : sdkBaseUrlsOf(sandbox)).toEqual({
      xai: 'http://127.0.0.1:4010/xai/v1',
      google: 'http://127.0.0.1:4010/google/v1beta',
      mistral: 'http://127.0.0.1:4010/mistral/v1',
    });
  });

  it('is refused in production', () => {
    expect(() =>
      testConfig({
        NODE_ENV: 'production',
        IMPERA_SANDBOX: '1',
        AUTH_SECRET: 'a-real-secret-a-real-secret-a-real-secret',
        CREDENTIALS_ENCRYPTION_KEYS: 'v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        SESSION_ENCRYPTION_KEYS: 'v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        EXTENSION_DEVICE_TOKEN: 'a-device-token-a-device-token-a-device',
      }),
    ).toThrow(/IMPERA_SANDBOX is for development only/);
  });

  it.each([
    ['AUTH_BASE_URL', 'https://crm.example.test'],
    ['WEB_ORIGIN', 'https://crm.example.test'],
    ['IMPERA_SANDBOX_URL', 'http://192.168.1.20:4010'],
    ['S3_ENDPOINT', 'https://objects.example.test'],
  ])('is refused when %s is not on this machine', (field, value) => {
    const s3 =
      field === 'S3_ENDPOINT'
        ? { S3_REGION: 'local', S3_BUCKET: 'media', S3_ACCESS_KEY_ID: 'id', S3_SECRET_ACCESS_KEY: 'secret' }
        : {};
    expect(() => testConfig({ IMPERA_SANDBOX: '1', [field]: value, ...s3 })).toThrow(
      new RegExp(`${field} must be an address on this machine`),
    );
  });

  it('knows this machine from anywhere else', () => {
    expect(isLoopbackUrl('http://localhost:5173')).toBe(true);
    expect(isLoopbackUrl('http://127.0.0.1:4010/xai')).toBe(true);
    expect(isLoopbackUrl('http://[::1]:4010')).toBe(true);
    expect(isLoopbackUrl('https://api.x.ai')).toBe(false);
    expect(isLoopbackUrl('http://127.0.0.1.example.test')).toBe(false);
    expect(isLoopbackUrl('file:///etc/passwd')).toBe(false);
    expect(isLoopbackUrl('pas une adresse')).toBe(false);
  });
});

describe('the sandbox guard on fetch', () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it('lets this machine through and fails anywhere else as a network error, without calling it', async () => {
    const inner = vi.fn<typeof fetch>(() => Promise.resolve(new Response('ok')));
    const blocked: string[] = [];
    const guarded = guardFetch(inner, (host) => blocked.push(host));

    await expect(guarded('http://127.0.0.1:4010/__')).resolves.toBeInstanceOf(Response);
    for (const target of [
      'https://api.x.ai/v1/api-key',
      new URL('https://api.reveal.me/v1/sales'),
      new Request('https://api.telegram.org/botX/getMe'),
    ]) {
      const call = guarded(target);
      await expect(call).rejects.toThrow(TypeError);
      const failure: unknown = await call.catch((error: unknown) => error);
      expect(failure instanceof TypeError && failure.cause instanceof SandboxBlockedCall).toBe(true);
    }
    expect(inner).toHaveBeenCalledTimes(1);
    expect(blocked).toEqual(['api.x.ai', 'api.reveal.me', 'api.telegram.org']);
  });

  it('goes on the process’s fetch and comes off again', async () => {
    const sandbox = sandboxOf(testConfig({ IMPERA_SANDBOX: '1' }));
    if (sandbox === null) throw new Error('sandbox expected');
    const remove = installSandboxGuard(sandbox, createLogger({ LOG_LEVEL: 'silent' }));
    await expect(fetch('https://api.pwnedpasswords.com/range/ABCDE')).rejects.toThrow(TypeError);
    remove();
    expect(globalThis.fetch).toBe(original);
  });
});
