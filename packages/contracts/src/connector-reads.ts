import { z } from 'zod';

import { PlatformSchema } from './enums';
import { CreatorIdSchema, PlatformAccountIdSchema, TeamMemberIdSchema } from './ids';
import { CurrencySchema } from './money';
import { SaleSellerSchema, SalesFeedReadingSchema, SalesTotalsRowSchema } from './sales-feed';

/**
 * The connectors' reads for another module's adapter (ADR 0026 § 1, ADR 0105 § 4: the MCP's `sales_list`,
 * `sales_by_chatter`, `platform_daily_stats_list`, `team_import_list`), as the person reading: the owner, or an active
 * manager for the creators of his list. Amounts are what the platform says, never computed again (ADR 0050 § 8), and
 * never the agency's nor the creator's share: no rate can be read back from them (ADR 0105 § 3).
 */

const count = z.number().int().min(0);
const signedCents = z.number().int();
const day = z.iso.date();

/** One row of the sales totals (CRM-04) without the shares: VAT included, VAT excluded and net only. */
export const SalesLineSchema = SalesTotalsRowSchema.omit({ agencyMinor: true, creatorMinor: true }).strict();
export type SalesLine = z.infer<typeof SalesLineSchema>;

/** A creator's sales from `from` to `to`, days both included, and how far each platform's register was read. */
export const SalesOfCreatorSchema = z.strictObject({
  creatorId: CreatorIdSchema,
  from: day,
  to: day,
  rows: z.array(SalesLineSchema),
  refundsWithoutSale: count,
  /** A day not read is never a day without a sale (ADR 0054). */
  readings: z.array(SalesFeedReadingSchema),
});
export type SalesOfCreator = z.infer<typeof SalesOfCreatorSchema>;

/** One seller's sales over the period, by platform and currency (each currency stays apart), without the shares. */
export const SalesByChatterRowSchema = z.strictObject({
  platform: PlatformSchema,
  currency: CurrencySchema,
  seller: SaleSellerSchema,
  /** The member's name in Impera for a member, `null` for the agent, an unlinked account or no seller. */
  sellerDisplayName: z.string().nullable(),
  sales: count,
  refunds: count,
  grossInclVatMinor: signedCents,
  grossExclVatMinor: signedCents,
  netMinor: signedCents,
});
export type SalesByChatterRow = z.infer<typeof SalesByChatterRowSchema>;

export const SalesByChatterOfCreatorSchema = SalesOfCreatorSchema.omit({ rows: true }).extend({
  rows: z.array(SalesByChatterRowSchema),
});
export type SalesByChatterOfCreator = z.infer<typeof SalesByChatterOfCreatorSchema>;

/** A creator account's day at the platform (ADR 0081 § 4): counters only, `null` while the platform has not computed it. */
export const PlatformDailyStatsDaySchema = z.strictObject({
  platform: PlatformSchema,
  platformAccountId: PlatformAccountIdSchema,
  day,
  newSubscribers: count,
  unsubscribes: count.nullable(),
  activeSubscribers: count,
  renewals: count.nullable(),
  ppvSent: count.nullable(),
  ppvPurchased: count,
  messagesSent: count.nullable(),
  messagesReceived: count.nullable(),
  readAt: z.iso.datetime(),
});
export type PlatformDailyStatsDay = z.infer<typeof PlatformDailyStatsDaySchema>;

export const DailyStatsOfCreatorSchema = z.strictObject({
  creatorId: CreatorIdSchema,
  from: day,
  to: day,
  days: z.array(PlatformDailyStatsDaySchema),
});
export type DailyStatsOfCreator = z.infer<typeof DailyStatsOfCreatorSchema>;

/**
 * The team imported from a platform as the base keeps it (ADR 0076), read without asking the platform: each account
 * linked in Impera and what the review counts. The platform's names and e-mails are never stored, so never here.
 */
export const TeamImportLinkedSchema = z.strictObject({
  platform: PlatformSchema,
  accounts: z.array(
    z.strictObject({
      platformChatterId: z.string().min(1),
      link: z.discriminatedUnion('kind', [
        z.strictObject({
          kind: z.literal('member'),
          memberId: TeamMemberIdSchema,
          memberDisplayName: z.string(),
        }),
        z.strictObject({ kind: z.literal('agent') }),
      ]),
      /** The platform removed the account, or no longer lists it (§ 5). */
      removed: z.boolean(),
    }),
  ),
  newCount: count,
  removalCount: count,
  abnormalRead: z.boolean(),
});
export type TeamImportLinked = z.infer<typeof TeamImportLinkedSchema>;
