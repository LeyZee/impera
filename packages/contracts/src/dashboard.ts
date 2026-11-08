import { z } from 'zod';

import { AutomaticGateSchema } from './automatic';
import { PlatformSchema } from './enums';
import { HandoffCauseSchema } from './events';
import { ConversationIdSchema, CreatorIdSchema, FanIdSchema, TeamMemberIdSchema } from './ids';

/**
 * `GET /v1/dashboard`: what the Dashboard shows for one creator (maquette v6, revue 08). Read only; every figure is
 * computed by the server. Money is in euros, durations in minutes unless named otherwise, rates in % (0 to 100).
 * The captured sales (ventes, leviers, entonnoir) are left out until the Reveal connector observes purchases; the
 * sales read in a platform's register come in `revealSales` (CRM-04 lot c).
 */

export const DashboardPeriodSchema = z.enum(['day', 'week', 'month']);
export type DashboardPeriod = z.infer<typeof DashboardPeriodSchema>;

export const DashboardQuerySchema = z.object({
  creatorId: CreatorIdSchema,
  period: DashboardPeriodSchema.default('day'),
});

/** The single control of the agent: Automatique, Copilote, Arrêt. */
export const AgentModeSchema = z.enum(['auto', 'copilot', 'stop']);
export type AgentMode = z.infer<typeof AgentModeSchema>;

/**
 * `PUT /v1/agent/mode`: Arrêt sets her kill switch, Copilote lifts it and brings every conversation back to the
 * copilot, Automatique lifts it and puts every conversation in automatic, or is refused (409 `agent_mode_conflict`,
 * `details.missing`) while ADR 0019 keeps it locked. The answer is the mode now in force, as `GET /v1/dashboard`
 * gives it: Arrêt when the global switch stays on.
 */
export const SetAgentModeBodySchema = z.object({ creatorId: CreatorIdSchema, mode: AgentModeSchema });
export const AgentModeResultSchema = z.object({
  mode: AgentModeSchema,
  /** The global switch is on: Arrêt for every creator, whatever she asked, until an operator lifts it. */
  globalStop: z.boolean(),
});
export type AgentModeResult = z.infer<typeof AgentModeResultSchema>;

const percent = z.number().min(0).max(100);
const count = z.number().int().nonnegative();
const euros = z.number().nonnegative();
const at = z.iso.datetime();

export const DashboardToneSchema = z.enum(['ok', 'warn', 'bad']);

/** One line of « À traiter »: a conversation waiting for a human, the gravest first. */
export const DashboardTodoSchema = z.object({
  id: z.string().min(1),
  tone: DashboardToneSchema,
  /**
   * A handoff cause, a draft waiting for a chatter's approval, a send that failed for good, or his message left with
   * no answer, no draft and nothing under way for more than 30 minutes (P3-11), or the AI proposing to mark him
   * « fragile », which a human accepts or sets aside (ADR 0085 § 9, lot b2).
   */
  kind: z.union([
    HandoffCauseSchema,
    z.literal('awaiting_approval'),
    z.literal('send_failed'),
    z.literal('unanswered'),
    z.literal('fragile_proposed'),
  ]),
  /** The fan's name. */
  title: z.string().min(1),
  /** One sentence: why it waits for a human, and what the agent does meanwhile. */
  why: z.string().min(1),
  /** Since when it waits. */
  at,
  waitingMinutes: count,
  conversationId: ConversationIdSchema,
  fanId: FanIdSchema,
});
export type DashboardTodo = z.infer<typeof DashboardTodoSchema>;

/** One line of « À traiter » across the creators a person follows (SUIVI-09): whose conversation it is. */
export const CreatorTodoSchema = DashboardTodoSchema.extend({
  creatorId: CreatorIdSchema,
  creatorName: z.string().min(1),
});
export type CreatorTodo = z.infer<typeof CreatorTodoSchema>;

/** How many lines wait for one creator, and how many of them are grave (tone `bad`): the picker shows them (DASH-03). */
export const CreatorTodoCountSchema = z.object({
  creatorId: CreatorIdSchema,
  name: z.string().min(1),
  todos: count,
  grave: count,
});
export type CreatorTodoCount = z.infer<typeof CreatorTodoCountSchema>;

/**
 * `GET /v1/dashboard/todos`: « À traiter » of every creator the person follows (every creator for the owner, those of
 * the account otherwise), the gravest first then the longest waiting, and the count of each creator in her order.
 */
export const TodosAcrossCreatorsSchema = z.object({
  items: z.array(CreatorTodoSchema),
  creators: z.array(CreatorTodoCountSchema),
});
export type TodosAcrossCreators = z.infer<typeof TodosAcrossCreatorsSchema>;

/** One of her best fans over the period. */
export const DashboardFanSchema = z.object({
  id: FanIdSchema,
  name: z.string().min(1),
  /** The conversation of his latest purchase over the period: « Ouvrir dans Suivi » opens it. */
  conversationId: ConversationIdSchema,
  firstSeenAt: at,
  /** Paid over the period, and the part sold by the agent. */
  spent: euros,
  byAgent: euros,
  /** What she knows about him: his confirmed facts, a few at most. */
  notes: z.array(z.string().min(1)),
  /** The cause that froze him, while a human has his conversation. */
  alert: HandoffCauseSchema.optional(),
});
export type DashboardFan = z.infer<typeof DashboardFanSchema>;

/** Integer euro cents, a refund taken off: negative when the refunds of a period outweigh its sales. */
const signedCents = z.number().int();

/** The figures of a period's sales read in a platform's register, as `salesTotals` sums them (CRM-04). */
export const DashboardSalesFiguresSchema = z.object({
  sales: count,
  refunds: count,
  /** The « Chiffre d'affaires »: what the fans paid, VAT included, refunds taken off (Reveal's `revenueTtc`). */
  revenueMinor: signedCents,
  /** What the agency and the creator share (`netAmount`). */
  netMinor: signedCents,
  agencyMinor: signedCents,
  /** Her part (`modelRevenue`, ADR 0050 § 8). */
  creatorMinor: signedCents,
});
export type DashboardSalesFigures = z.infer<typeof DashboardSalesFiguresSchema>;

/**
 * Who sold, as the owner links the platform's chatters (ADR 0050 § 5): a member by his display name, the agent, a
 * chatter nobody linked yet, or no chatter at all.
 */
export const DashboardSalesSellerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('member'), memberId: TeamMemberIdSchema, name: z.string().min(1) }),
  z.object({ kind: z.literal('agent') }),
  z.object({ kind: z.literal('unlinked') }),
  z.object({ kind: z.literal('none') }),
]);
export type DashboardSalesSeller = z.infer<typeof DashboardSalesSellerSchema>;

/**
 * The period's sales read in the platform's register (CRM-04 lot c, ADR 0050), in euro cents: the platform's own
 * amounts summed by `salesTotals`, never computed again; dollars at pay's last ECB rate known (ADR 0033), left out
 * without one. Each day is the sale's, a refund taken off its sale's day.
 */
export const DashboardRevealSalesSchema = z.object({
  /** The platforms of her accounts linked to the register, in order: the screen names them, never one written in the code. */
  platforms: z.array(PlatformSchema).min(1),
  from: z.iso.date(),
  to: z.iso.date(),
  totals: DashboardSalesFiguresSchema,
  /**
   * The same figures by seller, the largest revenue first. Null for whoever is neither the owner nor an active
   * manager: a chatter never sees another's figures (ADR 0043 § 7).
   */
  bySeller: z.array(DashboardSalesFiguresSchema.extend({ seller: DashboardSalesSellerSchema })).nullable(),
  /** As `usdSales`: a dollar sale falls in the period, and the ECB day of its rate (`null`: not counted). */
  usd: z.object({ seen: z.boolean(), rate: z.object({ day: z.iso.date() }).nullable() }),
  /** Refunds of the period whose sale is older than the register: counted in no figure (CRM-02's note). */
  refundsWithoutSale: count,
  /**
   * Her platforms whose reading stopped (a 401 or 403: the key must be connected again in Réglages, ADR 0050 § 3), with
   * Réglages' sentence and the last read that went through: the figures stop there (recette 06/11, AGT-11).
   */
  stopped: z.array(
    z.object({ platform: PlatformSchema, message: z.string().min(1), lastReadAt: at.nullable() }),
  ),
});
export type DashboardRevealSales = z.infer<typeof DashboardRevealSalesSchema>;

export const DashboardSchema = z.object({
  creator: z.object({ id: CreatorIdSchema, name: z.string().min(1), timezone: z.string().min(1), now: at }),
  period: DashboardPeriodSchema,
  mode: AgentModeSchema,
  /** The global switch is on: Arrêt for every creator, whatever she sets, as `PUT /v1/agent/mode` answers it. */
  globalStop: z.boolean(),
  /** Automatique opens only when nothing is missing. */
  automatic: AutomaticGateSchema,
  /** Taux en réel: drafts approved without an edit among the last 200 decided, for the active voice version. */
  liveRate: z.object({
    rate: percent.nullable(),
    target: percent,
    decided: count,
    /** The same rate as it stood three weeks ago, for the trend. */
    threeWeeksAgo: percent.nullable(),
  }),
  reveal: z.object({
    connected: z.boolean(),
    lastReadAt: at.nullable(),
    /**
     * Connected, but the last read is older than three of the account's polls: the session holds and nobody reads
     * (worker stopped, polls failing). The screen says « en retard », not « connectée ».
     */
    late: z.boolean(),
    conversations: count,
  }),
  voice: z.object({
    ok: z.boolean(),
    /**
     * No key for the voice's model nor for its fallback (Services or environment): `ok` is false too, and the screen
     * says « Clé manquante » rather than a breakdown.
     */
    keyMissing: z.boolean(),
    /** Median time the voice took to write, today, in milliseconds. */
    medianWriteMs: count.nullable(),
    /** Hours of the last 7 days with at least one failed voice call. */
    outagesLast7d: count,
  }),
  /**
   * Stuck jobs: given up on (attempts spent), or due for 15 minutes under a name no worker task takes. Work that will
   * not happen until someone looks (operations.md). `dead` counts the ones that stop her agent: hers, and the reading
   * of the Reveal accounts (`AGENT_SYSTEM_JOBS`); `null` when they could not be read. `stuck` names each, by its
   * `JOB_LABELS`, with `agency` for a job of no creator that does not stop her: listed for the owner alone, never
   * counted in her health (recette 05/11, PRO-10).
   */
  jobs: z.object({
    dead: count.nullable(),
    stuck: z.array(z.object({ label: z.string().min(1), count: count.min(1), agency: z.boolean() })),
  }),
  replies: z.object({
    /** Median time between a fan's message and her answer, over the period. */
    medianReplyMinutes: z.number().nonnegative().nullable(),
    fansWaitingOver10Min: count,
    conversationsOpen: count,
  }),
  guards: z.object({
    /** Handoffs of her day, by cause: every cause, 0 included. */
    today: z.record(HandoffCauseSchema, count),
    /** Urgent and important Telegram alerts of her night (or of the last one, by day); null when Telegram is off. */
    telegramAlertsTonight: count.nullable(),
  }),
  /**
   * Whether a Telegram group gets her urgent alerts, as Réglages › Telegram computes it. Null when Telegram is off
   * (no encryption key): the screen sends to Réglages › Telegram instead of saying no urgent alert gets through.
   */
  telegramCoverage: z.object({ urgentReachable: z.boolean() }).nullable(),
  budget: z.object({
    /**
     * The day's AI spend, every creator together: the cap is one for the whole CRM. Null for a creator: the agency's
     * spend is not hers (ADR 0023).
     */
    spentToday: euros.nullable(),
    cap: euros,
    alertAt: euros,
    /** Null until sales are observed. */
    costPerEuroSold: z.number().nonnegative().nullable(),
  }),
  todos: z.array(DashboardTodoSchema),
  /**
   * Best fans first, by what they spent over the period in euros: sales in dollars converted at the last ECB rate known,
   * the one pay keeps (ADR 0033); a ranking, never a payout.
   */
  fans: z.array(DashboardFanSchema),
  /**
   * The dollar sales of the period, for the sentence under the best fans (choix de Charles, 28/10). `seen`: at least one
   * paid message in dollars falls in the period. `rate`: the ECB day of the rate they were converted at, `null` when no
   * rate is known yet, and then they are not counted.
   */
  usdSales: z.object({ seen: z.boolean(), rate: z.object({ day: z.iso.date() }).nullable() }),
  /**
   * The sales read in the platform's register (CRM-04 lot c), once one of her accounts is linked to it; null before,
   * and for the creator herself, who reads her own screen (CRM-04 lot d) and never sees who sold (ADR 0042 § 2).
   */
  revealSales: DashboardRevealSalesSchema.nullable(),
});
export type Dashboard = z.infer<typeof DashboardSchema>;
