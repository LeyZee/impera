import { earningsBaseOf, type EarningsSource, type PayPeriod, type Platform } from '@impera/contracts';

import { PayRulesPeriodInvalid, PayRulesSource } from './errors';

/** An account's pay rules (EQ-03, contract `pay-rules.ts`), pure. */

/**
 * New rules start with a period that has not begun, so that a period never changes rules under way; an account's
 * first rules alone may start with the current one, since nothing of that account could be declared before them.
 */
export function assertRulesStart(fromPeriod: PayPeriod, currentPeriod: PayPeriod, first: boolean): void {
  if (fromPeriod > currentPeriod) return;
  if (first && fromPeriod === currentPeriod) return;
  throw new PayRulesPeriodInvalid();
}

/** What the switch of an account rests on, as the sales feed knows it (the `connectors` module's facts). */
export interface SwitchFacts {
  readonly platform: Platform;
  readonly modelLinked: boolean;
  readonly lastCheck: { readonly clean: boolean; readonly fromDay: string; readonly toDay: string } | null;
}

/**
 * The switch guard (ADR 0050 § 8, CRM-03): `declared` always; `detected` only for an account that pay can read on its
 * platform's net, so that it is never paid nothing nor paid twice. Its platform gives a net (`earningsBaseOf`), one of
 * the platform's models is linked to it (its sales are recorded), and the platform's latest reliability check is a
 * clean match (CRM-02: one whole fortnight, no bot outside the agent, no model of the export unknown) over a
 * fortnight that ends before `fromPeriod`: Charles saw the net agree before it pays. The latest check alone counts: a
 * newer one that does not agree withdraws the agreement of an older one.
 */
export function assertSourceSwitchable(
  source: EarningsSource,
  fromPeriod: PayPeriod,
  facts: SwitchFacts,
): void {
  if (source === 'declared') return;
  if (earningsBaseOf(facts.platform, source) !== 'platform_net')
    throw new PayRulesSource('platform_without_net');
  if (!facts.modelLinked) throw new PayRulesSource('model_unlinked');
  if (facts.lastCheck === null) throw new PayRulesSource('check_missing');
  if (!facts.lastCheck.clean) throw new PayRulesSource('check_not_clean');
  // A period is its first day (`YYYY-MM-DD`): the checked fortnight ends the day before it at the latest.
  if (facts.lastCheck.toDay >= fromPeriod) throw new PayRulesSource('check_not_before');
}
