import type { AiCreditEntry, AiCreditProvider, EVENT_PAYLOADS } from '@impera/contracts';
import type { z } from 'zod';

import type { UsageRow } from './usage';

/** The journal of calls, summed (ADR 0091 § 1). Read with the owner role: `llm_calls` is the app's, not a tenant's. */
export interface UsageReader {
  /** Every group of calls since `from`, by local day and hour of `timeZone`. */
  rows(from: Date, timeZone: string): Promise<readonly UsageRow[]>;
  lastCallAt(from: Date): Promise<Date | null>;
  /** What a provider's calls cost in USD strictly after `after`, billed calls without a cost at the cap's estimate. */
  spentSince(provider: AiCreditProvider, after: Date): Promise<number>;
}

export interface CreditActor {
  readonly userId: string;
  readonly ip: string;
}

export interface CreditLedger {
  list(): Promise<readonly AiCreditEntry[]>;
  /**
   * Idempotent on `id`: `existing` when the same line was already there; `conflict` with other values. `datedByClient`
   * false: the date is the server's moment of this request, so a replay is compared without it.
   */
  add(
    entry: AiCreditEntry,
    actor: CreditActor,
    datedByClient: boolean,
  ): Promise<
    { readonly kind: 'created' | 'existing'; readonly entry: AiCreditEntry } | { readonly kind: 'conflict' }
  >;
  /** False when there was no such line. */
  remove(id: string, actor: CreditActor): Promise<boolean>;
}

type CreditsLowPayload = z.infer<(typeof EVENT_PAYLOADS)['ai_credits_low']>;

/** `ai_credits_low` in the outbox, once per provider, level and latest line; true when it published. */
export interface CreditAlerts {
  /** `since`: the latest line's instant, no alert of the episode can be older. */
  publish(payload: CreditsLowPayload, since: Date): Promise<boolean>;
}

export interface Clock {
  now(): Date;
}
