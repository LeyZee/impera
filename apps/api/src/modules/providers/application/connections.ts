import {
  DomainError,
  err,
  ok,
  ProviderSettingsSchema,
  type AiProvider,
  type ProviderErrorKind,
  type ProviderRefusal,
  type ProviderSettings,
  type ProviderStatus,
  type Result,
} from '@nirvana/contracts';

import { DASHBOARD_PROVIDERS } from '../domain/catalog';
import {
  applyReverification,
  credentialFromVerification,
  markRefusedInProduction,
  toStatus,
  type StoredCredential,
} from '../domain/credential';
import { checkKeyShape } from '../domain/key-shape';
import { describeRefusal, describeVoiceAccount } from '../domain/messages';
import type { Clock, CredentialStore, KeyActor } from '../domain/ports';
import type { ProviderVerifier } from '../domain/verification';

import type { KeyCache } from './key-cache';

class ProviderNotSupported extends DomainError {
  constructor(provider: AiProvider) {
    super('provider_invalid', `Service inconnu : ${provider}`);
  }
}

export class ProviderNotConnected extends DomainError {
  constructor(provider: AiProvider) {
    super('provider_key_not_found', `Aucune clé enregistrée pour ${provider}`);
  }
}

class VoiceNotOnAccount extends DomainError {
  constructor() {
    super('provider_voice_invalid', 'Cette voix n’existe pas sur le compte ElevenLabs');
  }
}

class ProviderBusy extends DomainError {
  constructor(provider: AiProvider) {
    super('provider_conflict', `La clé de ${provider} vient de changer, réessaie`);
  }
}

/** A status write that lost to a concurrent change is re-read and re-applied this many times at most. */
const UPDATE_ATTEMPTS = 3;

export interface ConnectionsDeps {
  readonly store: CredentialStore;
  readonly verifiers: readonly ProviderVerifier[];
  readonly clock: Clock;
  /** Called after every change, so the in-memory key cache and the live stream follow at once. */
  readonly onChange?: (provider: AiProvider) => void | Promise<void>;
  /** Outside production only: whether the environment holds a key for this provider. */
  readonly hasEnvironmentKey?: (provider: AiProvider) => boolean;
}

/** A refusal as the sheet shows it, under the key field. */
export type ConnectRefusal = ProviderRefusal;

function verifierFor(deps: ConnectionsDeps, provider: AiProvider): ProviderVerifier {
  const verifier = deps.verifiers.find((v) => v.provider === provider);
  if (verifier === undefined) throw new ProviderNotSupported(provider);
  return verifier;
}

async function changed(deps: ConnectionsDeps, provider: AiProvider): Promise<void> {
  await deps.onChange?.(provider);
}

/**
 * The checks made before any call: a cut paste or a key meant for another service. The route runs them before it
 * asks for the password too, so an obvious mistake gets its answer at once (recette du 28/10).
 */
export function checkPastedKey(provider: AiProvider, rawKey: string): Result<string, ConnectRefusal> {
  const shape = checkKeyShape(provider, rawKey);
  if (shape.ok) return shape;
  const details = shape.error.kind === 'wrong_provider' ? { belongsTo: shape.error.belongsTo } : {};
  return err({ kind: shape.error.kind, message: describeRefusal(provider, shape.error.kind, details) });
}

/**
 * Connects or replaces a key. The key is saved only once the provider accepted it, so a refused replacement leaves
 * the key in place running (fiche P3-03, point 3).
 */
export async function connectProvider(
  deps: ConnectionsDeps,
  provider: AiProvider,
  rawKey: string,
  by?: KeyActor,
): Promise<Result<ProviderStatus, ConnectRefusal>> {
  const verifier = verifierFor(deps, provider);
  const shape = checkPastedKey(provider, rawKey);
  if (!shape.ok) return shape;
  const previous = await deps.store.find(provider);
  const settings = previous?.settings ?? {};
  const outcome = await verifier.verify(shape.value, settings);
  if (!outcome.ok) {
    const details = {
      ...(outcome.availableModels === undefined ? {} : { availableModels: outcome.availableModels }),
      ...(outcome.permission === undefined ? {} : { permission: outcome.permission }),
      ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
      ...(settings.visionModel === undefined ? {} : { visionModel: settings.visionModel }),
    };
    return err({ kind: outcome.kind, message: describeRefusal(provider, outcome.kind, details) });
  }
  const credential = credentialFromVerification(provider, shape.value, outcome, deps.clock.now());
  await deps.store.save(credential, by);
  await changed(deps, provider);
  return ok(savedStatus(provider, credential));
}

/**
 * « Vérifier maintenant » and the 15-minute job. Only a real refusal turns the service red. The check takes
 * seconds: if the key was replaced or disconnected meanwhile, that change wins and the result is dropped.
 */
export async function reverifyProvider(deps: ConnectionsDeps, provider: AiProvider): Promise<ProviderStatus> {
  const stored = await deps.store.find(provider);
  if (stored === null) return statusOf(deps, provider, null);
  if (stored.key === null) return savedStatus(provider, stored);
  const outcome = await verifierFor(deps, provider).verify(stored.key, stored.settings);
  const next = applyReverification(stored, outcome, deps.clock.now());
  if (next === stored) return savedStatus(provider, stored);
  if (await deps.store.update(next)) {
    await changed(deps, provider);
    return savedStatus(provider, next);
  }
  const current = await deps.store.find(provider);
  return current === null ? statusOf(deps, provider, null) : savedStatus(provider, current);
}

export async function reverifyAll(deps: ConnectionsDeps): Promise<readonly ProviderStatus[]> {
  const saved = await deps.store.list();
  return Promise.all(saved.map((credential) => reverifyProvider(deps, credential.provider)));
}

/** How long a saved key the provider just accepted stays trusted against refusals reported for it. */
const CONFIRMED_KEY_TRUST_MS = 60_000;

/**
 * How long a call started with the previous key can still end in a refusal after the key changed: the longest
 * role timeout (90 s) times its attempts (1 + 2 retries), rounded up.
 */
const CALL_IN_FLIGHT_MS = 5 * 60_000;

export type RefusalReporter = (provider: AiProvider, kind: ProviderErrorKind) => Promise<void>;

/** The keys this process hands to the gateway, and when it last switched them (`KeyCache`). */
export type KeysInUse = Pick<KeyCache, 'lookup' | 'changedAt'>;

/**
 * The gateway saw a 401 or 403 on a real call (point 2). Each process reports its own refusals, so the refused key
 * is the one this process handed out:
 * - the saved key, handed out for longer than a call can last: the line turns red now, as the provider said;
 * - possibly the previous one (the key changed moments ago, or this process has not reloaded it yet): the saved key
 *   is checked once with the provider first. Accepted, the refusal was the old key's and nothing changes (that
 *   answer holds for a minute); refused, the line turns red with the provider's reason; unreachable, nothing is
 *   concluded and the 15-minute check will tell.
 * A credit or spending limit refused on calls but not on the key check (xAI, Google) thus still turns red.
 * One decision at a time per service, however many refusals arrive meanwhile.
 */
export function createRefusalReporter(deps: ConnectionsDeps, keys: KeysInUse): RefusalReporter {
  const running = new Map<AiProvider, Promise<void>>();
  const trusted = new Map<AiProvider, { readonly revision: number; readonly until: number }>();

  async function refusalOf(
    stored: StoredCredential,
    key: string,
    reported: ProviderErrorKind,
    now: number,
  ): Promise<ProviderErrorKind | null> {
    const changedAt = keys.changedAt(stored.provider);
    const mayBeOldKey =
      keys.lookup(stored.provider) !== key ||
      (changedAt !== undefined && now - changedAt < CALL_IN_FLIGHT_MS);
    if (!mayBeOldKey) return reported;
    const trust = trusted.get(stored.provider);
    if (trust?.revision === stored.revision && trust.until > now) return null;
    const outcome = await verifierFor(deps, stored.provider).verify(key, stored.settings);
    if (outcome.ok) {
      trusted.set(stored.provider, { revision: stored.revision, until: now + CONFIRMED_KEY_TRUST_MS });
      return null;
    }
    return outcome.kind === 'unreachable' ? null : outcome.kind;
  }

  async function decide(provider: AiProvider, reported: ProviderErrorKind): Promise<void> {
    for (let attempt = 0; attempt < UPDATE_ATTEMPTS; attempt += 1) {
      const stored = await deps.store.find(provider);
      if (stored === null || stored.state === 'needs_reconnect' || stored.key === null) return;
      const kind = await refusalOf(stored, stored.key, reported, deps.clock.now().getTime());
      if (kind === null) return;
      if (await deps.store.update(markRefusedInProduction(stored, kind))) {
        await changed(deps, provider);
        return;
      }
      // A voice picked meanwhile: read the line again and decide over it.
    }
  }

  return (provider, kind) => {
    const pending = running.get(provider);
    if (pending !== undefined) return pending;
    const check = decide(provider, kind).finally(() => {
      running.delete(provider);
    });
    running.set(provider, check);
    return check;
  };
}

export async function disconnectProvider(
  deps: ConnectionsDeps,
  provider: AiProvider,
  by?: KeyActor,
): Promise<ProviderStatus> {
  await deps.store.remove(provider, by);
  await changed(deps, provider);
  return statusOf(deps, provider, null);
}

/** The voice picked after connecting ElevenLabs, or another Gemini model; never a key. */
export async function updateProviderSettings(
  deps: ConnectionsDeps,
  provider: AiProvider,
  settings: ProviderSettings,
): Promise<ProviderStatus> {
  for (let attempt = 0; attempt < UPDATE_ATTEMPTS; attempt += 1) {
    const stored = await deps.store.find(provider);
    if (stored === null) throw new ProviderNotConnected(provider);
    // The name shown on the line is the account's, never the one the request carries.
    const voice =
      settings.voice === undefined ? undefined : stored.voices.find((v) => v.id === settings.voice?.id);
    if (settings.voice !== undefined && voice === undefined) throw new VoiceNotOnAccount();
    const merged = ProviderSettingsSchema.parse({
      ...stored.settings,
      ...settings,
      ...(voice === undefined ? {} : { voice }),
    });
    // The line names the voice: picking another one rewrites it at once, not at the next check.
    const voiceLine =
      voice === undefined || stored.charactersLeft === null
        ? {}
        : describeVoiceAccount(voice, stored.charactersLeft);
    const next = { ...stored, ...voiceLine, settings: merged };
    if (await deps.store.update(next)) {
      await changed(deps, provider);
      return savedStatus(provider, next);
    }
  }
  throw new ProviderBusy(provider);
}

/**
 * The line of a saved key. Without CREDENTIALS_ENCRYPTION_KEYS (development only, production refuses to start) a pasted
 * key is lost at restart: the start-up log says so to whoever runs the server, never the line (REG-08).
 */
function savedStatus(provider: AiProvider, stored: StoredCredential): ProviderStatus {
  return toStatus(provider, stored, 'dashboard');
}

function statusOf(deps: ConnectionsDeps, provider: AiProvider, stored: null): ProviderStatus {
  const source = deps.hasEnvironmentKey?.(provider) === true ? 'environment' : null;
  return toStatus(provider, stored, source);
}

/** The Services section, in reading order. */
export async function listProviderStatuses(deps: ConnectionsDeps): Promise<readonly ProviderStatus[]> {
  const saved = await deps.store.list();
  return DASHBOARD_PROVIDERS.map((provider) => {
    const stored = saved.find((c) => c.provider === provider) ?? null;
    return stored === null ? statusOf(deps, provider, null) : savedStatus(provider, stored);
  });
}
