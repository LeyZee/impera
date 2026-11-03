import type {
  AiProvider,
  ProviderErrorKind,
  ProviderFact,
  ProviderSettings,
  ProviderVoice,
} from '@impera/contracts';

/** What a verifier learnt from the provider with a key that works. */
export interface VerifiedKey {
  readonly ok: true;
  readonly keyLabel: string | null;
  /** The sentence the Services line shows once connected (« Grok 4.7 écrit et décide »). */
  readonly summary: string;
  readonly facts: readonly ProviderFact[];
  readonly settings: ProviderSettings;
  readonly voices: readonly ProviderVoice[];
  /** Characters left this month when the provider counts them (ElevenLabs), else null. */
  readonly charactersLeft: number | null;
  /** Less than 10 % of the month's credit left. */
  readonly isLowCredit: boolean;
}

export interface RefusedKey {
  readonly ok: false;
  readonly kind: ProviderErrorKind;
  /** Model names the key can see, for `vision_model_missing`. */
  readonly availableModels?: readonly string[];
  /** For `missing_permission`: the provider's own permission name, when it says. */
  readonly permission?: string;
  /** For `unreachable`: a quota or rate limit (429) is not a provider that is down, and the screen says which. */
  readonly reason?: UnreachableReason;
}

export type UnreachableReason = 'rate_limited' | 'outage';

export type VerificationOutcome = VerifiedKey | RefusedKey;

/** One short read-only call per provider (infra/verifiers), returning a value, never throwing. */
export interface ProviderVerifier {
  readonly provider: AiProvider;
  verify(key: string, settings: ProviderSettings): Promise<VerificationOutcome>;
}
