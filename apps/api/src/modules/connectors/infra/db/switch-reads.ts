import { CalendarDaySchema, PlatformSchema, type Platform, type PlatformAccountId } from '@impera/contracts';
import { and, eq, schema, sql, type Transaction } from '@impera/db';
import { z } from 'zod';

const { platformAccounts, salesFeedChecks, salesFeedModels } = schema;

/**
 * @public
 * What the switch of an account to the platform's net rests on (ADR 0050 § 8, CRM-03), as the sales feed knows it:
 * the account's platform, whether the owner linked one of the platform's models to it (its sales are then recorded
 * in its creator), and the latest reliability check of that platform (CRM-02), `null` before any.
 */
export interface SalesFeedSwitchFacts {
  readonly platform: Platform;
  readonly modelLinked: boolean;
  readonly lastCheck: {
    /** A match over one whole fortnight with no bot outside the agent nor model of the export unknown (`isCleanMatch`). */
    readonly clean: boolean;
    readonly fromDay: string;
    readonly toDay: string;
  } | null;
}

const AccountRowSchema = z.object({ platform: PlatformSchema });
const CheckRowSchema = z.object({ clean: z.boolean(), fromDay: CalendarDaySchema, toDay: CalendarDaySchema });

/**
 * The facts of `platformAccountId` in the caller's transaction and under its policies: `null` when the account is not
 * one the caller reads. The models' links and the checks are agency-level, out of RLS; the latest check is the one
 * `GET /v1/settings/sales-feeds/:platform/check` gives back.
 */
async function switchFactsOf(
  tx: Transaction,
  platformAccountId: PlatformAccountId,
): Promise<SalesFeedSwitchFacts | null> {
  const [account] = await tx
    .select({ platform: platformAccounts.platform })
    .from(platformAccounts)
    .where(eq(platformAccounts.id, platformAccountId));
  if (account === undefined) return null;
  const { platform } = AccountRowSchema.parse(account);
  const [model] = await tx
    .select({ platformModelId: salesFeedModels.platformModelId })
    .from(salesFeedModels)
    .where(
      and(eq(salesFeedModels.platformAccountId, platformAccountId), eq(salesFeedModels.platform, platform)),
    );
  const [check] = await tx
    .select({ clean: salesFeedChecks.clean, fromDay: salesFeedChecks.fromDay, toDay: salesFeedChecks.toDay })
    .from(salesFeedChecks)
    .where(eq(salesFeedChecks.platform, platform))
    .orderBy(sql`${salesFeedChecks.generatedAt} desc, ${salesFeedChecks.createdAt} desc`)
    .limit(1);
  return {
    platform,
    modelLinked: model !== undefined,
    lastCheck: check === undefined ? null : CheckRowSchema.parse(check),
  };
}

/** @public What the team's pay rules read of the sales feed before an account switches to `detected` (CRM-03). */
export const salesFeedSwitchReads = { switchFactsOf };
