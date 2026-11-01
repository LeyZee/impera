import { collectiveGoalWindow, payPeriodNotBegun, type PayPeriod } from '@nirvana/contracts';

import { CollectiveGoalLate, PayRuleStarted, PayrollForbidden } from './errors';
import type { PayReader } from './ports';

/**
 * The team's rules (EQ-04, ADR 0032): individual tiers, the collective goal and the minimum payout, their pure rules.
 * The transactions that apply them live in `infra/rule-store.ts`.
 */

/** Only the owner sets the team's rules (the policies say the same). */
export function assertSetsTeamRules(reader: Pick<PayReader, 'scope'>): void {
  if (reader.scope !== 'owner') throw new PayrollForbidden({ ownerOnly: true });
}

/**
 * Tiers or a goal may still reach `period`: it is after the team's last closing. A statement is validated only on a
 * closed period, the closing written in the same transaction, so this is the database's `pay_period_settled` read
 * from the closings: no statement of `period` or a later one is validated.
 */
export function rulesOpenFor(lastClosed: PayPeriod | null, period: PayPeriod): boolean {
  return lastClosed === null || period > lastClosed;
}

type Flat = Readonly<Record<string, string | number>>;

/**
 * The same tiers, in the same order, field by field: a tier comes back from `jsonb` with its keys in another order,
 * so a text comparison would call a retry a conflict.
 */
export function sameTiers(a: readonly Flat[], b: readonly Flat[]): boolean {
  return (
    a.length === b.length &&
    a.every((tier, index) => {
      const other = b[index];
      if (other === undefined) return false;
      const keys = Object.keys(tier);
      return (
        keys.length === Object.keys(other).length &&
        keys.every((key) => Object.hasOwn(other, key) && tier[key] === other[key])
      );
    })
  );
}

/**
 * The periods whose drafts a rule changes: those holding a draft from `from` on, in order, once each. A period
 * without a draft gets one from the job its first report, bonus or carry-over enqueued.
 */
export function draftPeriodsFrom(drafts: readonly PayPeriod[], from: PayPeriod | null): PayPeriod[] {
  return [...new Set(drafts)].filter((period) => from === null || period >= from).sort();
}

/** A goal changes its own period once it has begun: it may pay a chatter who has nothing else there. */
export function goalPeriods(period: PayPeriod, current: PayPeriod): PayPeriod[] {
  return period <= current ? [period] : [];
}

/**
 * PAIE-22: tiers and the payout minimum start with a period that has not begun (its first day today at the earliest,
 * in the agency's zone), as a commission rate does. `today` is the server's, never the client's.
 */
export function assertRuleStarts(period: PayPeriod, today: string): void {
  if (!payPeriodNotBegun(period, today)) throw new PayRuleStarted(period);
}

/**
 * PAIE-22: the goal of a period may still be set up to its 3rd day, the screen warning that the period has begun; after
 * that, it is refused.
 */
export function assertGoalOpen(period: PayPeriod, today: string): void {
  if (collectiveGoalWindow(period, today) === 'closed') throw new CollectiveGoalLate(period);
}
