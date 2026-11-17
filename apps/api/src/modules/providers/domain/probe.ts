import type { AiProvider, ProviderActivity, ProviderProbeOutcome, ProviderTrouble } from '@impera/contracts';

/**
 * The owner's « Essai réel » of a service (ADR 0091 § 7): one tiny real call, on his click only. The verifiers prove a
 * key with free reads; only a generation proves the account can still pay for one.
 */
export interface ProbeResult {
  readonly outcome: ProviderProbeOutcome;
  /** Null when no call was made (cap reached, no voice). */
  readonly latencyMs: number | null;
  /** The model tried, as the screen names it (« Grok 4.7 »); null when none was. */
  readonly model: string | null;
}

/** What the last « Essai réel » found, kept with the key until it is replaced. */
export interface StoredProbe extends ProbeResult {
  readonly at: Date;
}

/** One provider's tiny real call. Never throws: a failure is an outcome. */
export interface ProviderProbe {
  readonly provider: AiProvider;
  probe(key: string, voiceId: string | null): Promise<ProbeResult>;
}

/** What a service's real calls of the last 24 hours say (`llm_calls`), per provider. */
export interface ActivityReader {
  last24h(now: Date): Promise<ReadonlyMap<AiProvider, ProviderActivity>>;
}

/**
 * A journal outcome (`llm_calls.status`, `CallOutcome` of packages/llm) as the owner reads it, or null when it says
 * nothing of the connection: a model that refused a content or wrote a malformed answer is connected all the same.
 */
export function troubleOf(outcome: string): ProviderTrouble | null {
  switch (outcome) {
    case 'quota_exhausted':
      return 'no_credit';
    case 'auth':
      return 'key_refused';
    case 'unknown_model':
      return 'model_missing';
    case 'rate_limited':
      return 'rate_limited';
    case 'timeout':
      return 'timeout';
    case 'unavailable':
    case 'error':
      return 'not_answering';
    default:
      return null;
  }
}

/** A gateway test's outcome (`ConnectionTest.outcome`) as the « Essai réel » shows it. */
export function probeOutcomeOf(outcome: string): ProviderProbeOutcome {
  if (outcome === 'ok') return 'answers';
  if (outcome === 'budget_reached') return 'budget_reached';
  // `missing_key` cannot happen on a saved key; a model refusing « ok » or answering oddly still answered.
  if (outcome === 'missing_key') return 'key_refused';
  return troubleOf(outcome) ?? 'answers';
}
