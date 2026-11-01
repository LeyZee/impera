import { type EarningsSource, type PayPeriod } from '@nirvana/contracts';

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

/** `detected` waits for the connector to record the sales (P6-01): an account in it would be paid nothing. */
export function assertSourceRecorded(source: EarningsSource): void {
  if (source === 'detected') throw new PayRulesSource();
}
