import {
  bonusTiersFor,
  collectiveGoalFor,
  mayValidateStatement,
  type CommissionStatement,
  type ExchangeRates,
  type PageQuery,
  type PayPeriod,
  type PayPeriodClosing,
  type PayPeriodPage,
  type PayrollEntries,
  type PayrollPeriod,
  type PayrollSettings,
  type UserId,
} from '@nirvana/contracts';

import { redactAuthors } from '../domain/authors';
import { blockFor } from '../domain/period-blocks';
import type { PayReader, PayrollReadStore, StoredStatement } from '../domain/ports';

/**
 * The team in a statement. Its net is the agency's figure: a member reading their own statement sees only how far the
 * team got toward the period's collective goal, and nothing without one (EQ-04, default until Charles decides
 * otherwise).
 */
function teamOf({ statement, team }: StoredStatement, reader: PayReader): CommissionStatement['team'] {
  if (reader.scope !== 'self') return team;
  return statement.rules.collectiveGoal === null ? null : { netMinor: null, collective: team.collective };
}

/** A member reads of a closing only its date, as in the list of periods: never who closed it nor its rates. */
const closingFor = (closing: PayPeriodClosing | null, reader: PayReader): PayPeriodClosing | null =>
  closing === null || reader.scope !== 'self' ? closing : { ...closing, closedBy: null, exchangeRates: null };

const toStatement = (stored: StoredStatement, reader: PayReader): CommissionStatement => ({
  ...stored.statement,
  ...redactAuthors(reader.scope, stored.statement),
  team: teamOf(stored, reader),
  canValidate: mayValidateStatement(stored.statement, reader),
});

export interface PayrollReads {
  /** `GET /v1/payroll/periods/:period` (EQ-04): the period as its reader may see it. */
  period(userId: UserId, period: PayPeriod): Promise<PayrollPeriod>;
  /** `GET /v1/payroll/periods` (EQ-05): the periods the reader has statements in, the most recent first. */
  periods(userId: UserId, page: PageQuery): Promise<PayPeriodPage>;
  /** `GET /v1/payroll/entries?period=` (EQ-05): the period's bonuses, penalties and adjustments, cancelled included. */
  entries(userId: UserId, period: PayPeriod): Promise<PayrollEntries>;
  /** `GET /v1/payroll/settings`: the minimum payout, the default before the owner sets one. */
  settings(userId: UserId): Promise<PayrollSettings>;
  /** `GET /v1/payroll/exchange-rates`: the latest rate the job read, `null` before the first one; the agency's only. */
  exchangeRates(userId: UserId): Promise<ExchangeRates>;
}

export function createPayrollReads(store: PayrollReadStore, now: () => Date): PayrollReads {
  const hasEnded = (window: { readonly endsAt: string }): boolean =>
    new Date(window.endsAt).getTime() <= now().getTime();
  return {
    async period(userId: UserId, period: PayPeriod): Promise<PayrollPeriod> {
      const view = await store.period(userId, period);
      return {
        period,
        window: view.window,
        ended: view.window !== null && hasEnded(view.window),
        closing: closingFor(view.closing, view.reader),
        beforeFirstClosing: view.firstClosed !== null && period < view.firstClosed,
        blocked: blockFor(view.blocked, view.reader),
        statements: view.statements.map((statement) => toStatement(statement, view.reader)),
        bonusTiers: bonusTiersFor(view.bonusTierSets, period),
        collectiveGoal: collectiveGoalFor(view.collectiveGoals, period),
        settings: view.settings,
      };
    },
    async periods(userId, page) {
      const { items, nextCursor } = await store.periods(userId, page);
      return { items: items.map((item) => ({ ...item, ended: hasEnded(item.window) })), nextCursor };
    },
    entries: (userId, period) => store.entries(userId, period),
    settings: (userId) => store.settings(userId),
    exchangeRates: (userId) => store.exchangeRates(userId),
  };
}
