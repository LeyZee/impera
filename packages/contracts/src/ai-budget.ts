import { z } from 'zod';

/**
 * Réglages › Modèles IA › Budget IA (choix de Charles 12/11): the day's AI budget and the trend watch's own cap,
 * which the owner sets instead of the code's constants (`DEFAULT_LLM_CONFIG.dailyBudget`). In euro cents; `null` in
 * a body means the default.
 *
 * Bounds: the day's budget from 1 € to 200 €, the trend watch's cap from 0,10 € to 20 €, never above the day's
 * budget (it is counted inside it).
 */
export const AI_BUDGET_DAILY_MIN_MINOR = 100;
export const AI_BUDGET_DAILY_MAX_MINOR = 20_000;
export const AI_BUDGET_TREND_WATCH_MIN_MINOR = 10;
export const AI_BUDGET_TREND_WATCH_MAX_MINOR = 2_000;

const dailyMinor = z.number().int().min(AI_BUDGET_DAILY_MIN_MINOR).max(AI_BUDGET_DAILY_MAX_MINOR);
const trendWatchMinor = z
  .number()
  .int()
  .min(AI_BUDGET_TREND_WATCH_MIN_MINOR)
  .max(AI_BUDGET_TREND_WATCH_MAX_MINOR);
const spentMinor = z.number().int().nonnegative();

/** `PUT /v1/settings/ai-budget`: both values at once, `null` for the default. */
export const PutAiBudgetBodySchema = z.strictObject({
  dailyCapMinor: dailyMinor.nullable(),
  trendWatchCapMinor: trendWatchMinor.nullable(),
});
export type PutAiBudgetBody = z.infer<typeof PutAiBudgetBodySchema>;

/** `GET` and `PUT /v1/settings/ai-budget`: what applies now, the defaults, and the day's spend against it. */
export const AiBudgetSchema = z.strictObject({
  /** The day's budget in force: the owner's, or the default. */
  dailyCapMinor: dailyMinor,
  trendWatchCapMinor: trendWatchMinor,
  /** What applies when the owner sets nothing (or goes back to it). */
  defaults: z.strictObject({ dailyCapMinor: dailyMinor, trendWatchCapMinor: trendWatchMinor }),
  /** Whether each value is the owner's own, or the default. */
  isCustom: z.strictObject({ dailyCap: z.boolean(), trendWatchCap: z.boolean() }),
  /** The share of the day's budget that raises the alert, in cents. */
  alertAtMinor: spentMinor,
  /** Spent since midnight (Europe/Paris), every call; and the trend watch's own share of it. */
  spentTodayMinor: spentMinor,
  trendWatchSpentTodayMinor: spentMinor,
  /** `reached`: nothing more is generated until midnight. */
  state: z.enum(['ok', 'alert', 'reached']),
  /** The last change, `null` while the defaults were never touched. */
  updatedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type AiBudget = z.infer<typeof AiBudgetSchema>;

/** The error code of `PUT`: `ai_budget_unprocessable`, the trend watch's cap is above the day's budget. */
export const AI_BUDGET_UNPROCESSABLE = 'ai_budget_unprocessable';
