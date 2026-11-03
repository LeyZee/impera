import {
  payPeriodAt,
  payRulesFor,
  type Currency,
  type EarningsSource,
  type PayPeriod,
  type Platform,
  type PlatformAccountId,
} from '@impera/contracts';

/** An account's dated rules as the automatic sales check reads them (CRM-04 b3), pure. */
export interface DatedAccountRules {
  readonly platformAccountId: PlatformAccountId;
  readonly platform: Platform;
  readonly currency: Currency;
  readonly fromPeriod: PayPeriod;
  readonly earningsSource: EarningsSource;
  readonly createdAt: Date;
}

/** An account the automatic check compares for a fortnight: its platform and the currency of its rules. */
export interface DetectedAccountForCheck {
  readonly platform: Platform;
  readonly platformAccountId: PlatformAccountId;
  readonly currency: Currency;
}

/**
 * The accounts paid on the platform's net over the whole of `period` (CRM-04 b3, Équipe's precision b): the rules in
 * force for `period` say `detected`, and they were written in an earlier period, in the agency's zone. An account
 * switched « à cheval », its first rules written during the period they start with, is not checked for that one:
 * part of it was worked before anyone saw the switch. Sorted by account.
 */
export function detectedForCheck(
  rules: readonly DatedAccountRules[],
  period: PayPeriod,
  timeZone: string,
): DetectedAccountForCheck[] {
  const byAccount = new Map<PlatformAccountId, DatedAccountRules[]>();
  for (const one of rules)
    byAccount.set(one.platformAccountId, [...(byAccount.get(one.platformAccountId) ?? []), one]);
  const found: DetectedAccountForCheck[] = [];
  for (const [platformAccountId, ofAccount] of byAccount) {
    const inForce = payRulesFor(ofAccount, period);
    if (inForce?.earningsSource !== 'detected') continue;
    if (payPeriodAt(inForce.createdAt, timeZone) >= period) continue;
    found.push({ platform: inForce.platform, platformAccountId, currency: inForce.currency });
  }
  return found.sort((a, b) => (a.platformAccountId < b.platformAccountId ? -1 : 1));
}
