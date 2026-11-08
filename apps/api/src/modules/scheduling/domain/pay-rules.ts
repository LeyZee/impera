import {
  earningsBaseOf,
  payPeriodOfDay,
  type EarningsSource,
  type PayPeriod,
  type Platform,
} from '@impera/contracts';

import { PayRulesPeriodInvalid, PayRulesSource } from './errors';

/** An account's pay rules (EQ-03, contract `pay-rules.ts`), pure. */

/** What new rules start with, and what their period is checked against (EQ-03, ADR 0084 § 2). */
export interface RulesStart {
  readonly currentPeriod: PayPeriod;
  /** The account has no rules yet. */
  readonly first: boolean;
  /** The fortnight a clean check lets `detected` rules start with although it began (`checkedPeriodOf`). */
  readonly checkedPeriod: PayPeriod | null;
  /** A period is closed at or after the one the rules start with: pay has counted it, its base never changes. */
  readonly closedFrom: boolean;
}

/**
 * New rules start with a period that has not begun, so that a period never changes rules under way; an account's
 * first rules alone may start with the current one, since nothing of that account could be declared before them.
 * Rules that read the platform's net may also start with the fortnight the platform's latest clean check covers,
 * begun or over (ADR 0084): Charles saw that very fortnight agree before any of it is paid, as long as no period is
 * closed from it on.
 */
export function assertRulesStart(
  rules: { readonly fromPeriod: PayPeriod; readonly earningsSource: EarningsSource },
  start: RulesStart,
): void {
  const { fromPeriod } = rules;
  if (fromPeriod > start.currentPeriod) return;
  if (start.first && fromPeriod === start.currentPeriod) return;
  if (rules.earningsSource === 'detected' && fromPeriod === start.checkedPeriod) {
    if (start.closedFrom) throw new PayRulesSource('period_closed');
    return;
  }
  throw new PayRulesPeriodInvalid();
}

/** What the switch of an account rests on, as the sales feed knows it (the `connectors` module's facts). */
export interface SwitchFacts {
  readonly platform: Platform;
  readonly modelLinked: boolean;
  readonly lastCheck: { readonly clean: boolean; readonly fromDay: string; readonly toDay: string } | null;
}

/**
 * The fortnight the platform's latest check covers when it is clean (ADR 0084 § 1), `null` otherwise. A clean check
 * covers one whole fortnight (`isCleanMatch`): its first day is a period.
 */
export function checkedPeriodOf(facts: SwitchFacts): PayPeriod | null {
  const check = facts.lastCheck;
  if (check?.clean !== true) return null;
  const period = payPeriodOfDay(check.fromDay);
  return period === check.fromDay ? period : null;
}

/**
 * The checked fortnight this account's `detected` rules may start with although it began (ADR 0084), before the
 * closings and the account's own rules are looked at: its platform gives a net, a model of it is linked to the
 * account, and the latest check is clean.
 */
export function switchablePeriodOf(facts: SwitchFacts): PayPeriod | null {
  if (earningsBaseOf(facts.platform, 'detected') !== 'platform_net' || !facts.modelLinked) return null;
  return checkedPeriodOf(facts);
}

/**
 * The switch guard (ADR 0050 § 8, CRM-03): `declared` always; `detected` only for an account that pay can read on its
 * platform's net, so that it is never paid nothing nor paid twice. Its platform gives a net (`earningsBaseOf`), one of
 * the platform's models is linked to it (its sales are recorded), and the platform's latest reliability check is a
 * clean match (CRM-02: one whole fortnight, no bot outside the agent, no model of the export unknown) over that very
 * fortnight (ADR 0084) or one that ends before `fromPeriod`: Charles saw the net agree before it pays. The latest check
 * alone counts: a newer one that does not agree withdraws the agreement of an older one.
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
  // A period is its first day (`YYYY-MM-DD`): the checked fortnight is the rules' first one, or ends before it.
  if (facts.lastCheck.toDay >= fromPeriod && fromPeriod !== checkedPeriodOf(facts)) {
    throw new PayRulesSource('check_not_before');
  }
}
