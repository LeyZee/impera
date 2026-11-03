import {
  calendarDayAt,
  payPeriodLastDay,
  payPeriodOfDay,
  previousPayPeriod,
  type Currency,
  type PayPeriod,
  type PlatformAccountId,
  type SalesFeedCheckReport,
} from '@nirvana/contracts';

/**
 * The automatic check of the sales feed (CRM-04 b3): on the 2nd and the 17th, the fortnight just over, the register's
 * net against the platform's daily statistics, for the accounts paid on that net. Pure.
 */

/** An account paid on the platform's net over the whole fortnight, with the currency of its rules. */
export interface CheckedAccount {
  readonly platformAccountId: PlatformAccountId;
  readonly currency: Currency;
}

/** A day of an account where the register's net is not the platform's: never a fan, never a chatter. */
export interface MismatchDay {
  readonly day: string;
  readonly platformAccountId: PlatformAccountId;
  readonly currency: Currency;
  readonly registerNetMinor: number;
  readonly platformNetMinor: number;
  /** The platform's net minus the register's: positive when the register lacks money. */
  readonly differenceMinor: number;
}

/** The fortnight that ended before today, in the platform's zone: the one the 2nd and the 17th check. */
export function fortnightBefore(
  now: Date,
  timeZone: string,
): { readonly from: PayPeriod; readonly to: string } {
  const from = previousPayPeriod(payPeriodOfDay(calendarDayAt(now, timeZone)));
  return { from, to: payPeriodLastDay(from) };
}

/**
 * The days where the register's net and the statistics' differ, on the checked accounts only (a model reaches an
 * account by the owner's link). The net alone counts, and only where both sources give it: a day the statistics do not
 * report is not a mismatch here, the manual check of Réglages shows it. By day, then account.
 */
export function mismatchDays(
  report: SalesFeedCheckReport,
  modelAccounts: ReadonlyMap<string, string>,
  accounts: readonly CheckedAccount[],
): MismatchDay[] {
  const checked = new Map<string, CheckedAccount>(
    accounts.map((account) => [account.platformAccountId, account]),
  );
  const found: MismatchDay[] = [];
  for (const day of report.days) {
    const linkedTo = modelAccounts.get(day.platformModelId);
    const account = linkedTo === undefined ? undefined : checked.get(linkedTo);
    if (account === undefined) continue;
    const { platformAccountId, currency } = account;
    const registerNetMinor = day.register.net;
    const platformNetMinor = day.stats?.net ?? null;
    if (registerNetMinor === null || platformNetMinor === null || registerNetMinor === platformNetMinor)
      continue;
    found.push({
      day: day.date,
      platformAccountId,
      currency,
      registerNetMinor,
      platformNetMinor,
      differenceMinor: platformNetMinor - registerNetMinor,
    });
  }
  return found.sort((a, b) =>
    a.day !== b.day ? (a.day < b.day ? -1 : 1) : a.platformAccountId < b.platformAccountId ? -1 : 1,
  );
}
