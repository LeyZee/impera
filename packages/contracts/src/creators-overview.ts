import { z } from 'zod';

import { DropCategorySchema } from './content-drops';
import { AgentModeSchema } from './dashboard';
import { CreatorIdSchema, TeamMemberIdSchema } from './ids';

/**
 * `GET /v1/dashboard/creators`: one card per creator for the list of Créatrices (« ok liste-créatrices », Charles,
 * 06/11): what the agency needs to know of her before opening her sheet. Read only, computed by the server, each
 * creator read in a transaction of her own (RLS). The owner gets every creator not archived, anyone else the creators
 * of their account; a reader whose scope is his own gets her agent's mode alone (ADR 0043 § 7). Never a fan, never
 * the agency's percentage.
 */

const count = z.number().int().nonnegative();
/** Integer euro cents, a refund taken off: negative when the refunds outweigh the sales. */
const signedCents = z.number().int();

/**
 * The sales of her fortnight, the 1st to the 15th or the 16th to the end of the month in her zone, up to today: the
 * register's own totals (`salesFeedTotals.totalsOf`), never summed again. Null while none of her accounts is linked
 * to the register.
 */
export const CreatorOverviewSalesSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  sales: count,
  refunds: count,
  /** The « Chiffre d'affaires »: what the fans paid, VAT included, refunds taken off. */
  revenueMinor: signedCents,
  /** A sale in dollars fell in the fortnight and no ECB rate is known yet: it is not counted. */
  usdLeftOut: z.boolean(),
});
export type CreatorOverviewSales = z.infer<typeof CreatorOverviewSalesSchema>;

/** A member on shift on one of her accounts now, without the margin: his display name, and when his shift ends. */
export const CreatorOverviewShiftSchema = z.object({
  memberId: TeamMemberIdSchema,
  name: z.string().min(1),
  endsAt: z.iso.datetime(),
});
export type CreatorOverviewShift = z.infer<typeof CreatorOverviewShiftSchema>;

/** What the agency waits for from her: content requests open with nothing dropped yet, and the first one due. */
export const CreatorOverviewRequestsSchema = z.object({
  open: count,
  next: z
    .object({
      category: DropCategorySchema,
      dueOn: z.iso.date(),
      /** Its day is over in her zone. */
      late: z.boolean(),
    })
    .nullable(),
});
export type CreatorOverviewRequests = z.infer<typeof CreatorOverviewRequestsSchema>;

export const CreatorOverviewSchema = z.object({
  creatorId: CreatorIdSchema,
  mode: AgentModeSchema,
  /** Null when no account is linked to the register, and for a reader whose scope is his own. */
  sales: CreatorOverviewSalesSchema.nullable(),
  /** Null for a reader whose scope is his own; empty when nobody is on shift. */
  onShift: z.array(CreatorOverviewShiftSchema).nullable(),
  /** Null for a reader whose scope is his own. */
  requests: CreatorOverviewRequestsSchema.nullable(),
});
export type CreatorOverview = z.infer<typeof CreatorOverviewSchema>;

export const CreatorsOverviewSchema = z.object({ creators: z.array(CreatorOverviewSchema) });
export type CreatorsOverview = z.infer<typeof CreatorsOverviewSchema>;
