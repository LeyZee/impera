import type {
  AiProvider,
  ProviderActivity,
  ProviderConnectionState,
  ProviderErrorKind,
  ProviderFact,
  ProviderSettings,
  ProviderStatus,
  ProviderVoice,
} from '@impera/contracts';

import { profileOf } from './catalog';
import { describeLowCredit, describeRefusedLine } from './messages';
import type { ProbeResult, StoredProbe } from './probe';
import type { AccountQuota, VerificationOutcome, VerifiedKey } from './verification';

/** A saved key with what its last verification found. The key itself never leaves the module. */
export interface StoredCredential {
  readonly provider: AiProvider;
  /**
   * `null` when the row no longer decrypts (its encryption key was dropped from CREDENTIALS_ENCRYPTION_KEYS too
   * early). Such a row is never verified nor rewritten: putting the old encryption key back recovers it.
   */
  readonly key: string | null;
  readonly keyLabel: string | null;
  readonly summary: string;
  readonly facts: readonly ProviderFact[];
  readonly settings: ProviderSettings;
  readonly voices: readonly ProviderVoice[];
  readonly state: Exclude<ProviderConnectionState, 'not_connected'>;
  readonly verifiedAt: Date;
  readonly charactersLeft: number | null;
  /** ElevenLabs' month as its last check read it (ADR 0091 § 7). */
  readonly quota: AccountQuota | null;
  /** The last « Essai réel », null before the first one and once the key is replaced. */
  readonly probe: StoredProbe | null;
  readonly lastErrorKind: ProviderErrorKind | null;
  /** The row's version as read; a status write only lands if the row is still at this version (store `update`). */
  readonly revision: number;
}

/** A credential about to be saved by a connection: its key is known. */
export type NewCredential = StoredCredential & { readonly key: string };

/** What a verification says about a key, everything but the key, its settings and its version. */
type VerifiedFields = Omit<StoredCredential, 'provider' | 'key' | 'settings' | 'revision' | 'probe'>;

function verifiedFields(verified: VerifiedKey, now: Date): VerifiedFields {
  return {
    keyLabel: verified.keyLabel,
    summary: verified.summary,
    facts: verified.facts,
    voices: verified.voices,
    state: verified.isLowCredit ? 'low_credit' : 'connected',
    verifiedAt: now,
    charactersLeft: verified.charactersLeft,
    quota: verified.quota,
    lastErrorKind: null,
  };
}

export function credentialFromVerification(
  provider: AiProvider,
  key: string,
  verified: VerifiedKey,
  now: Date,
): NewCredential {
  return {
    provider,
    key,
    settings: verified.settings,
    revision: 0,
    probe: null,
    ...verifiedFields(verified, now),
  };
}

/**
 * Keeps what an « Essai réel » found. A key refused on that real call turns the service red at once, as a refusal seen
 * in production does; any other outcome leaves the state to the checks.
 */
export function applyProbe(stored: StoredCredential, result: ProbeResult, now: Date): StoredCredential {
  const probed = { ...stored, probe: { ...result, at: now } };
  return result.outcome === 'key_refused' ? markRefusedInProduction(probed, 'unauthorized') : probed;
}

/**
 * Applies a periodic re-verification. A key that stopped working goes to `needs_reconnect`; an unreachable provider
 * changes nothing, since it says nothing about the key.
 */
export function applyReverification(
  stored: StoredCredential,
  outcome: VerificationOutcome,
  now: Date,
): StoredCredential {
  if (outcome.ok) return { ...stored, ...verifiedFields(outcome, now) };
  if (outcome.kind === 'unreachable') return stored;
  // A refusal is an answer too: « vérifié il y a… » counts from it, and the page can tell it from no answer at all.
  return { ...stored, state: 'needs_reconnect', lastErrorKind: outcome.kind, verifiedAt: now };
}

/** A real production call was refused (401/403): the service turns red at once, without waiting for the next check. */
export function markRefusedInProduction(stored: StoredCredential, kind: ProviderErrorKind): StoredCredential {
  return { ...stored, state: 'needs_reconnect', lastErrorKind: kind };
}

/** The line of the Services section. `null` means nothing is saved for this provider. */
export function toStatus(
  provider: AiProvider,
  stored: StoredCredential | null,
  source: 'dashboard' | 'environment' | null,
  activity: ProviderActivity | null = null,
): ProviderStatus {
  const profile = profileOf(provider);
  if (stored === null) {
    return {
      provider,
      state: 'not_connected',
      source,
      keyLabel: null,
      verifiedAt: null,
      isUnreadable: false,
      message:
        source === 'environment' ? 'Clé lue depuis l’environnement de développement' : profile.withoutIt,
      facts: [],
      settings: {},
      voices: [],
      probe: null,
      activity: source === 'environment' ? activity : null,
      quota: null,
    };
  }
  const message =
    stored.state === 'needs_reconnect'
      ? describeRefusedLine(provider, stored.lastErrorKind, stored.key === null)
      : stored.state === 'low_credit' && stored.charactersLeft !== null
        ? describeLowCredit(stored.charactersLeft)
        : stored.summary;
  return {
    provider,
    state: stored.state,
    source,
    keyLabel: stored.keyLabel,
    verifiedAt: stored.verifiedAt.toISOString(),
    isUnreadable: stored.key === null,
    message,
    facts: [...stored.facts],
    settings: stored.settings,
    voices: [...stored.voices],
    probe:
      stored.probe === null
        ? null
        : {
            at: stored.probe.at.toISOString(),
            outcome: stored.probe.outcome,
            latencyMs: stored.probe.latencyMs,
            model: stored.probe.model,
          },
    activity,
    quota:
      stored.quota === null || stored.charactersLeft === null
        ? null
        : {
            used: Math.max(0, stored.quota.limit - stored.charactersLeft),
            limit: stored.quota.limit,
            resetsAt: stored.quota.resetsAt?.toISOString() ?? null,
            plan: stored.quota.plan,
          },
  };
}
