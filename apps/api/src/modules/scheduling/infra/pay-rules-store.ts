import {
  AccountPayRulesIdSchema,
  CreatorIdSchema,
  CurrencySchema,
  EarningsSourceSchema,
  nextPayPeriod,
  PayPeriodSchema,
  payPeriodOfDay,
  PlatformAccountIdSchema,
  type PayPeriod,
  type PlatformAccountId,
} from '@impera/contracts';
import {
  and,
  enterCreator,
  eq,
  schema,
  SNAPSHOT_READ,
  withMember,
  withTenantMember,
  type Database,
  type Transaction,
} from '@impera/db';
import { z } from 'zod';

import {
  PayRulesConflict,
  PayRulesForbidden,
  PayRulesPeriodConflict,
  PlatformAccountNotFound,
} from '../domain/errors';
import {
  assertRulesStart,
  assertSourceSwitchable,
  checkedPeriodOf,
  switchablePeriodOf,
  type SwitchFacts,
} from '../domain/pay-rules';
import type { PayRulesStore, StoredAccount, StoredPayRules } from '../domain/ports';
import { calendarDayIn } from '../domain/time';

import type { EnqueuePayRecalculation } from './pay-reads';
import { agencyTimeZone, audit, creatorOfUnscoped, pgErrorOf, StoredAccountSchema } from './rows';

const { accountPayRules, platformAccounts } = schema;

const payRulesColumns = {
  id: accountPayRules.id,
  platformAccountId: accountPayRules.platformAccountId,
  creatorId: accountPayRules.creatorId,
  fromPeriod: accountPayRules.fromPeriod,
  currency: accountPayRules.currency,
  vatBps: accountPayRules.vatBps,
  platformFeeBps: accountPayRules.platformFeeBps,
  earningsSource: accountPayRules.earningsSource,
  createdAt: accountPayRules.createdAt,
};

const StoredPayRulesSchema = z.object({
  id: AccountPayRulesIdSchema,
  platformAccountId: PlatformAccountIdSchema,
  creatorId: CreatorIdSchema,
  fromPeriod: PayPeriodSchema,
  currency: CurrencySchema,
  vatBps: z.number().int(),
  platformFeeBps: z.number().int(),
  earningsSource: EarningsSourceSchema,
  createdAt: z.date(),
});

const toPayRules = (row: unknown): StoredPayRules => StoredPayRulesSchema.parse(row);

const newestFirst = (a: StoredPayRules, b: StoredPayRules): number =>
  b.fromPeriod.localeCompare(a.fromPeriod);

/** The period running at `now`, in the agency's zone. */
const currentPeriodIn = async (tx: Transaction, now: Date): Promise<PayPeriod> =>
  payPeriodOfDay(calendarDayIn(now, await agencyTimeZone(tx)));

/**
 * What the switch guard reads of the sales feed for an account, in the caller's transaction and under its policies
 * (the `connectors` module's `salesFeedSwitchReads`, given by the composition root): `null` for an account the caller
 * does not read.
 */
export type SwitchFactsRead = (
  tx: Transaction,
  platformAccountId: PlatformAccountId,
) => Promise<SwitchFacts | null>;

/**
 * Whether a period is closed at or after `period` (ADR 0084 § 2), in the caller's transaction: the `payroll` module's
 * `payReadsForPayRules.closedFrom`, given by the composition root.
 */
export type PeriodClosedFrom = (tx: Transaction, period: PayPeriod) => Promise<boolean>;

/**
 * The accounts' pay rules through `withTenantMember` in the account's creator (EQ-03): `team_read` lets the owner and
 * an active manager read them, `owner_insert` lets the owner alone add them, and the table refuses any change or
 * deletion. The period running now is read in the agency's zone, in the same transaction. Rules that start with a
 * period that has begun (an account's first, or the checked fortnight of ADR 0084) have pay compute each period they
 * touch again, up to the current one, once they are committed.
 */
export function createDrizzlePayRulesStore(
  db: Database,
  adminDb: Database,
  reads: {
    readonly switchFactsOf: SwitchFactsRead;
    readonly periodClosedFrom: PeriodClosedFrom;
    readonly enqueuePayRecalculation: EnqueuePayRecalculation;
  },
): PayRulesStore {
  const { switchFactsOf, periodClosedFrom, enqueuePayRecalculation } = reads;

  /** The fortnight the owner may switch an account from although it began (ADR 0084), as the list gives it. */
  const checkedPeriodFor = async (
    tx: Transaction,
    account: StoredAccount,
    rules: readonly StoredPayRules[],
  ): Promise<PayPeriod | null> => {
    const facts = await switchFactsOf(tx, account.id);
    const period = facts === null ? null : switchablePeriodOf(facts);
    if (period === null || rules.some((one) => one.fromPeriod === period)) return null;
    return (await periodClosedFrom(tx, period)) ? null : period;
  };

  return {
    list: (actor, creatorIds, now) =>
      withMember(
        db,
        actor,
        async (tx, scope) => {
          if (scope !== 'owner' && scope !== 'agency') {
            throw new PayRulesForbidden(
              'Seuls le propriétaire et les managers actifs lisent les règles de paie',
            );
          }
          const currentPeriod = await currentPeriodIn(tx, now);
          const accounts: {
            account: StoredAccount;
            rules: StoredPayRules[];
            checkedPeriod: PayPeriod | null;
          }[] = [];
          for (const creatorId of creatorIds) {
            await enterCreator(tx, creatorId, creatorIds);
            const rows = await tx
              .select({
                id: platformAccounts.id,
                creatorId: platformAccounts.creatorId,
                platform: platformAccounts.platform,
                handle: platformAccounts.handle,
              })
              .from(platformAccounts);
            const rules = (await tx.select(payRulesColumns).from(accountPayRules)).map(toPayRules);
            for (const row of rows) {
              const account = StoredAccountSchema.parse(row);
              const own = rules.filter((one) => one.platformAccountId === account.id).toSorted(newestFirst);
              accounts.push({
                account,
                rules: own,
                // The owner alone sets rules: a manager is never offered a fortnight to switch from.
                checkedPeriod: scope === 'owner' ? await checkedPeriodFor(tx, account, own) : null,
              });
            }
          }
          return { currentPeriod, accounts };
        },
        SNAPSHOT_READ,
      ),

    create: async (actor, rules, now) => {
      const creatorId = await creatorOfUnscoped(adminDb, platformAccounts, rules.platformAccountId);
      if (creatorId === null) throw new PlatformAccountNotFound();
      return withTenantMember(db, creatorId, actor.userId, async (tx, scope) => {
        if (scope !== 'owner') throw new PayRulesForbidden('Seul le propriétaire pose les règles de paie');
        const [existing] = await tx
          .select(payRulesColumns)
          .from(accountPayRules)
          .where(eq(accountPayRules.id, rules.id));
        if (existing !== undefined) {
          const same =
            existing.platformAccountId === rules.platformAccountId &&
            existing.fromPeriod === rules.fromPeriod &&
            existing.currency === rules.currency &&
            existing.vatBps === rules.vatBps &&
            existing.platformFeeBps === rules.platformFeeBps &&
            existing.earningsSource === rules.earningsSource;
          if (!same) throw new PayRulesConflict();
          return { rules: toPayRules(existing), created: false };
        }
        let checkedPeriod: PayPeriod | null = null;
        if (rules.earningsSource === 'detected') {
          // The switch guard (ADR 0050 § 8, CRM-03), read in this transaction: the account was found in its creator.
          const facts = await switchFactsOf(tx, rules.platformAccountId);
          if (facts === null) throw new PlatformAccountNotFound();
          assertSourceSwitchable(rules.earningsSource, rules.fromPeriod, facts);
          checkedPeriod = checkedPeriodOf(facts);
        }
        const sameAccount = await tx
          .select({ id: accountPayRules.id, fromPeriod: accountPayRules.fromPeriod })
          .from(accountPayRules)
          .where(eq(accountPayRules.platformAccountId, rules.platformAccountId));
        const taken = sameAccount.find((one) => one.fromPeriod === rules.fromPeriod);
        if (taken !== undefined) throw new PayRulesPeriodConflict(taken.id);
        const currentPeriod = await currentPeriodIn(tx, now);
        const begun = rules.fromPeriod <= currentPeriod;
        assertRulesStart(rules, {
          currentPeriod,
          first: sameAccount.length === 0,
          checkedPeriod,
          // Read only when it decides: rules from a period that has begun, the checked one (ADR 0084 § 2).
          closedFrom:
            begun && rules.fromPeriod === checkedPeriod
              ? await periodClosedFrom(tx, rules.fromPeriod)
              : false,
        });
        try {
          await tx.transaction((savepoint) =>
            savepoint.insert(accountPayRules).values({ ...rules, creatorId, createdBy: actor.userId }),
          );
        } catch (error) {
          const failure = pgErrorOf(error);
          if (failure?.code !== '23505') throw error;
          if (failure.constraint !== 'account_pay_rules_account_period_unique') throw new PayRulesConflict();
          const [raced] = await tx
            .select({ id: accountPayRules.id })
            .from(accountPayRules)
            .where(
              and(
                eq(accountPayRules.platformAccountId, rules.platformAccountId),
                eq(accountPayRules.fromPeriod, rules.fromPeriod),
              ),
            );
          throw new PayRulesPeriodConflict(raced?.id ?? rules.id);
        }
        await audit(
          tx,
          actor,
          'account_pay_rules.create',
          { kind: 'account_pay_rules', id: rules.id },
          {
            platformAccountId: rules.platformAccountId,
            fromPeriod: rules.fromPeriod,
            currency: rules.currency,
            vatBps: rules.vatBps,
            platformFeeBps: rules.platformFeeBps,
            earningsSource: rules.earningsSource,
          },
        );
        // A period under way or over now reads these rules: its drafts are computed again (ADR 0084 § 3).
        if (begun) {
          for (let period = rules.fromPeriod; period <= currentPeriod; period = nextPayPeriod(period)) {
            await enqueuePayRecalculation(tx, period);
          }
        }
        const [created] = await tx
          .select(payRulesColumns)
          .from(accountPayRules)
          .where(eq(accountPayRules.id, rules.id));
        if (created === undefined) throw new PayRulesConflict();
        return { rules: toPayRules(created), created: true };
      });
    },
  };
}
