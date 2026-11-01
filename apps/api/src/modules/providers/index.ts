/** Public entry point of the `providers` module (ADR 0002, ADR 0016). Other modules import this file only. */
import type { AiProvider } from '@nirvana/contracts';
import { parseEncryptionKeys, type Database, type EncryptionKey } from '@nirvana/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import {
  connectProvider,
  disconnectProvider,
  listProviderStatuses,
  createRefusalReporter,
  reverifyAll,
  reverifyProvider,
  updateProviderSettings,
  type ConnectionsDeps,
} from './application/connections';
import { createKeyCache } from './application/key-cache';
import type { ProvidersApi } from './application/providers-api';
import type { Clock, CredentialStore } from './domain/ports';
import { createElevenLabsVerifier } from './infra/elevenlabs.verifier';
import { createGoogleVerifier } from './infra/google.verifier';
import type { FetchLike } from './infra/http';
import { createMemoryCredentialStore } from './infra/memory.store';
import { createMistralVerifier } from './infra/mistral.verifier';
import { createPostgresCredentialStore } from './infra/postgres.store';
import { createProvidersRoutes, type ProvidersRoutesOptions } from './infra/routes';
import { createXaiVerifier } from './infra/xai.verifier';

export { ProviderNotConnected } from './application/connections';
export { resealProviderCredentials } from './infra/postgres.store';
export { nextAction } from './domain/next-action';
export { createMemoryCredentialStore };

export interface ProvidersDeps {
  readonly store: CredentialStore;
  readonly fetch: FetchLike;
  readonly clock?: Clock;
  /** Null in production: there the dashboard is the only source of keys (ADR 0016). */
  readonly environmentKeys: ((provider: AiProvider) => string | undefined) | null;
  /** Called after each change, for the live stream of the Services section (SSE, fiche P3-03 point 5). */
  readonly onChange?: (provider: AiProvider) => void;
  /**
   * The API and the worker are separate processes in production: each reloads the saved keys this often, so a key
   * pasted in the dashboard or turned red by the job reaches the other one. Off when absent (tests).
   */
  readonly reloadEveryMs?: number;
  readonly onReloadError?: (error: unknown) => void;
}

export interface ProvidersModule extends ProvidersApi {
  readonly name: 'providers';
  /** The `ApiKeySource` handed to the LLM gateway and the speech client. */
  readonly apiKeySource: (provider: AiProvider) => string | undefined;
  /** Loads the saved keys into memory, then keeps reloading them; call once at start-up. */
  readonly start: () => Promise<void>;
  /** Stops the periodic reload, before the database closes. */
  readonly stop: () => void;
  /** `/v1/settings/providers`, behind the guard given here. */
  readonly routes: (options: ProvidersRoutesOptions) => FastifyPluginAsyncZod;
}

export function createProvidersModule(deps: ProvidersDeps): ProvidersModule {
  const cache = createKeyCache(deps.store, deps.environmentKeys);
  const connections: ConnectionsDeps = {
    store: deps.store,
    clock: deps.clock ?? { now: () => new Date() },
    verifiers: [
      createXaiVerifier({ fetch: deps.fetch }),
      createGoogleVerifier({ fetch: deps.fetch, compareWith: 'gemini-4-argon' }),
      createElevenLabsVerifier({ fetch: deps.fetch }),
      createMistralVerifier({ fetch: deps.fetch }),
    ],
    onChange: async (provider) => {
      await cache.reload();
      deps.onChange?.(provider);
    },
    hasEnvironmentKey: (provider) => deps.environmentKeys?.(provider) !== undefined,
  };
  const reportRefusedKey = createRefusalReporter(connections, cache);
  const api: ProvidersApi = {
    list: () => listProviderStatuses(connections),
    connect: (provider, key, by) => connectProvider(connections, provider, key, by),
    reverify: (provider) => reverifyProvider(connections, provider),
    reverifyAll: () => reverifyAll(connections),
    reportRefusedKey,
    updateSettings: (provider, settings) => updateProviderSettings(connections, provider, settings),
    disconnect: (provider, by) => disconnectProvider(connections, provider, by),
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    ...api,
    name: 'providers',
    apiKeySource: (provider) => cache.lookup(provider),
    async start() {
      const { reloadEveryMs } = deps;
      if (reloadEveryMs !== undefined && timer === undefined) {
        timer = setInterval(() => {
          cache.reload().catch((error: unknown) => deps.onReloadError?.(error));
        }, reloadEveryMs);
        timer.unref();
      }
      await cache.reload();
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
    routes: (options) => createProvidersRoutes(api, options),
  };
}

export interface ProvidersStartOptions {
  /** The admin connection (`provider_credentials` is revoked from the application role). */
  readonly adminDb: Database;
  /**
   * CREDENTIALS_ENCRYPTION_KEYS. Required in production (config.ts); without it, in development, keys are kept in
   * memory and lost at restart.
   */
  readonly encryptionKeys: string | undefined;
  /** Development keys from the environment, null in production (ADR 0016). */
  readonly environmentKeys: Partial<Record<AiProvider, string | undefined>> | null;
  /**
   * The saved keys could not be loaded (the environment keys still apply, the next reload tries again), one of them
   * no longer decrypts (`UnreadableProviderKey`), or they are kept in memory only (`ProviderKeysInMemory`).
   */
  readonly onLoadError: (error: unknown) => void;
}

const KEY_RELOAD_MS = 30_000;

/** A saved key none of CREDENTIALS_ENCRYPTION_KEYS opens: an encryption key was dropped before the re-encryption. */
class UnreadableProviderKey extends Error {
  constructor(provider: AiProvider) {
    super(
      `la clé ${provider} enregistrée ne se déchiffre plus avec CREDENTIALS_ENCRYPTION_KEYS : remets l'ancienne clé de chiffrement (runbooks/rotate-secrets.md) ou recolle la clé`,
    );
    this.name = 'UnreadableProviderKey';
  }
}

/** Development without CREDENTIALS_ENCRYPTION_KEYS: said once at start-up, as keys pasted then vanish at restart. */
class ProviderKeysInMemory extends Error {
  constructor() {
    super(
      'CREDENTIALS_ENCRYPTION_KEYS absente : les clés collées dans Réglages restent en mémoire et disparaissent au redémarrage',
    );
    this.name = 'ProviderKeysInMemory';
  }
}

/** The module as the composition root builds it: Postgres store when there is an encryption key, keys loaded. */
export async function startProvidersModule(options: ProvidersStartOptions): Promise<ProvidersModule> {
  const environment = options.environmentKeys;
  if (options.encryptionKeys === undefined) options.onLoadError(new ProviderKeysInMemory());
  const module = createProvidersModule({
    store:
      options.encryptionKeys === undefined
        ? createMemoryCredentialStore()
        : createPostgresCredentialStore({
            adminDb: options.adminDb,
            keys: parseEncryptionKeys(options.encryptionKeys, 'CREDENTIALS_ENCRYPTION_KEYS'),
            onUnreadable: (provider) => {
              options.onLoadError(new UnreadableProviderKey(provider));
            },
          }),
    fetch,
    environmentKeys: environment === null ? null : (provider) => environment[provider],
    reloadEveryMs: KEY_RELOAD_MS,
    onReloadError: options.onLoadError,
  });
  await module.start().catch(options.onLoadError);
  return module;
}

/**
 * `pnpm ops:check-keys` (ADR 0028 § 7): how many saved AI service keys the given encryption keys open, read only,
 * no call to any provider.
 */
export async function checkProviderKeys(
  adminDb: Database,
  keys: readonly EncryptionKey[],
): Promise<{ readonly total: number; readonly unreadable: readonly AiProvider[] }> {
  const saved = await createPostgresCredentialStore({ adminDb, keys }).list();
  return {
    total: saved.length,
    unreadable: saved
      .filter((credential) => credential.key === null)
      .map((credential) => credential.provider),
  };
}
