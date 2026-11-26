import { z } from 'zod';

import { ShootBriefSchema, SuggestionStateSchema } from './creator-tasks';
import {
  ContentRequestIdSchema,
  CreatorIdSchema,
  CreatorTaskIdSchema,
  ShootItemIdSchema,
  SuggestionIdSchema,
} from './ids';
import { CalendarDaySchema } from './team-members';

/*
 * Her week (ADR 0140): two « Jour de tournage » she accepts, each with what there is to shoot, and « Livrer ma
 * semaine », due on Sunday at 23 h in her zone. The code computes what is needed on real figures; the owner reads,
 * corrects and validates the week before it reaches her; she accepts it in one gesture. She never reads a draft, nor
 * how the week was computed.
 */

/**
 * What there is to shoot (ADR 0140 § 4), in the order a full week keeps them (§ 5): a script whose reserve is low
 * first, then the feed, the media of Relance, the agency's ideas, the stories. `mass_dm` and `idea` are in the
 * contract from the start; the week asks none of them until the Mass DM plan and the ideas join it.
 */
export const WEEK_NEEDS = ['script', 'feed_shoot', 'feed_video', 'mass_dm', 'idea', 'reveal_story'] as const;
export const WeekNeedSchema = z.enum(WEEK_NEEDS);
export type WeekNeed = z.infer<typeof WeekNeedSchema>;

/** What a « Jour de tournage » or « Livrer ma semaine » is, beside her other tasks (ADR 0140 § 7). */
export const WEEK_ROLES = ['shoot_day', 'delivery'] as const;
export const WeekRoleSchema = z.enum(WEEK_ROLES);
export type WeekRole = z.infer<typeof WeekRoleSchema>;

/** The titles of her week's tasks, as the glossary writes them. */
export const SHOOT_DAY_TITLE = 'Jour de tournage';
export const DELIVERY_TITLE = 'Livrer ma semaine';

/** The most shooting days a week holds: the agency asks 2, the owner may correct to 1 or 3. */
export const SHOOT_DAYS_MAX = 3;

export const ShootItemLabelSchema = z.string().trim().min(1).max(120);

/** One line of a shooting day as the code proposes it: what, how many, and how long the agency counts for it. */
export const WeekPlanItemSchema = z.strictObject({
  need: WeekNeedSchema,
  label: ShootItemLabelSchema,
  /** Her shooting sheet, written by the code from the category and the structure asked; `null` for none. */
  sheet: ShootBriefSchema.nullable(),
  /** The agency's estimate for the whole line, never shown to her. */
  minutes: z.number().int().min(1).max(600),
  /** How many of it: stories are one line for the week, « 5 stories ». */
  count: z.number().int().min(1).max(50),
  /** The script request the line answers (ADR 0055 § 4), `null` for any other need. */
  requestId: ContentRequestIdSchema.nullable(),
});
export type WeekPlanItem = z.infer<typeof WeekPlanItemSchema>;

export const WeekPlanDaySchema = z.strictObject({
  day: CalendarDaySchema,
  items: z.array(WeekPlanItemSchema).max(20),
});
export type WeekPlanDay = z.infer<typeof WeekPlanDaySchema>;

/** The stock the week was computed on, for the owner: boudoir sessions, public-feed videos and stories not yet out. */
export const WeekStockSchema = z.strictObject({
  sessions: z.number().int().min(0),
  videos: z.number().int().min(0),
  stories: z.number().int().min(0),
});
export type WeekStock = z.infer<typeof WeekStockSchema>;

/**
 * A week as the code proposes it and the owner corrects it (ADR 0140 § 2 to § 5): her shooting days, each with its
 * lines, what did not fit and moves to the week after (§ 5, the agency sees it), and the delivery's deadline.
 */
export const WeekPlanSchema = z
  .strictObject({
    shootDays: z.array(WeekPlanDaySchema).min(1).max(SHOOT_DAYS_MAX),
    deferred: z.array(WeekPlanItemSchema).max(40),
    /** Sunday 23 h in her zone (§ 9), as an instant. */
    dueAt: z.iso.datetime(),
    stock: WeekStockSchema,
    /** What one shooting day holds, in minutes (§ 5). */
    capacityMinutes: z.number().int().min(30).max(720),
  })
  .refine((plan) => new Set(plan.shootDays.map((day) => day.day)).size === plan.shootDays.length, {
    message: 'Chaque jour de tournage une seule fois',
    path: ['shootDays'],
  });
export type WeekPlan = z.infer<typeof WeekPlanSchema>;

export const CREATOR_WEEK_STATES = ['draft', 'validated'] as const;
export const CreatorWeekStateSchema = z.enum(CREATOR_WEEK_STATES);
export type CreatorWeekState = z.infer<typeof CreatorWeekStateSchema>;

/** `/v1/creators/:creatorId/weeks/:week` (owner; an active manager reads): her Monday. */
export const CreatorWeekParamsSchema = z.strictObject({
  creatorId: CreatorIdSchema,
  week: CalendarDaySchema,
});

/** `GET /v1/creators/:creatorId/weeks/:week`: the week the code proposed, and whether the owner validated it. */
export const AgencyCreatorWeekSchema = z.strictObject({
  week: CalendarDaySchema,
  state: CreatorWeekStateSchema,
  plan: WeekPlanSchema,
  computedAt: z.iso.datetime(),
  validatedAt: z.iso.datetime().nullable(),
});
export type AgencyCreatorWeek = z.infer<typeof AgencyCreatorWeekSchema>;

/**
 * `POST /v1/creators/:creatorId/weeks/:week/validate` (owner): the week as he corrected it (days moved, lines moved,
 * removed or reworded) goes to her agenda as suggestions. Replayed with the same plan, it answers the week; another
 * plan on a validated week is refused (409 `creator_week_validated_conflict`).
 */
export const ValidateCreatorWeekBodySchema = z.strictObject({ plan: WeekPlanSchema });
export type ValidateCreatorWeekBody = z.infer<typeof ValidateCreatorWeekBodySchema>;

/** One line of a shooting day as she reads it: no minutes, no origin. */
export const ShootItemSchema = z.strictObject({
  id: ShootItemIdSchema,
  need: WeekNeedSchema,
  label: ShootItemLabelSchema,
  sheet: ShootBriefSchema.nullable(),
  count: z.number().int().min(1).max(50),
  done: z.boolean(),
});
export type ShootItem = z.infer<typeof ShootItemSchema>;

/** One of her shooting days: still to accept (`suggested`), in her agenda (`accepted`, its task), or declined. */
export const HerShootDaySchema = z.strictObject({
  suggestionId: SuggestionIdSchema,
  taskId: CreatorTaskIdSchema.nullable(),
  state: SuggestionStateSchema,
  /** Her day, the task's once she moved it. */
  day: CalendarDaySchema,
  items: z.array(ShootItemSchema),
});
export type HerShootDay = z.infer<typeof HerShootDaySchema>;

/** One line of « Livrer ma semaine »: how many the week asks, how many of her drops arrived since Monday. */
export const DeliveryLineSchema = z.strictObject({
  need: WeekNeedSchema,
  asked: z.number().int().min(0),
  received: z.number().int().min(0),
});
export type DeliveryLine = z.infer<typeof DeliveryLineSchema>;

export const HerDeliverySchema = z.strictObject({
  suggestionId: SuggestionIdSchema,
  taskId: CreatorTaskIdSchema.nullable(),
  state: SuggestionStateSchema,
  dueAt: z.iso.datetime(),
  lines: z.array(DeliveryLineSchema),
  /** Every line received: done by her drops, never by a tick (ADR 0140 § 25). */
  delivered: z.boolean(),
});
export type HerDelivery = z.infer<typeof HerDeliverySchema>;

/** `GET /v1/creator-space/week?week=` (creator): her week once the owner validated it; empty before. */
export const CreatorWeekQuerySchema = z.strictObject({ week: CalendarDaySchema });
export const CreatorWeekSchema = z.strictObject({
  week: CalendarDaySchema,
  /** Something of it still waits for her answer: « Accepter ma semaine ». */
  toAccept: z.boolean(),
  shootDays: z.array(HerShootDaySchema),
  delivery: HerDeliverySchema.nullable(),
});
export type CreatorWeek = z.infer<typeof CreatorWeekSchema>;

/** `POST /v1/creator-space/week/accept` (creator): every task of her week still to decide, accepted as it is. Replayable. */
export const AcceptCreatorWeekBodySchema = z.strictObject({ week: CalendarDaySchema });
export type AcceptCreatorWeekBody = z.infer<typeof AcceptCreatorWeekBodySchema>;

/** `PUT /v1/creator-space/shoot-items/:id` (creator): a line shot, or taken back. */
export const ShootItemParamsSchema = z.strictObject({ id: ShootItemIdSchema });
export const ShootItemDoneBodySchema = z.strictObject({ done: z.boolean() });
export type ShootItemDoneBody = z.infer<typeof ShootItemDoneBodySchema>;

/** Refusals of her week's routes, beside the shared ones. */
export const CREATOR_WEEK_NOT_FOUND = 'creator_week_not_found';
export const CREATOR_WEEK_VALIDATED_CONFLICT = 'creator_week_validated_conflict';
/** A shooting day outside the week, or a delivery before the last of them. */
export const CREATOR_WEEK_PLAN_UNPROCESSABLE = 'creator_week_plan_unprocessable';
export const SHOOT_ITEM_NOT_FOUND = 'shoot_item_not_found';
/** A line of a shooting day ticked or taken back more than two days after it (ADR 0042 § 8). */
export const SHOOT_ITEM_LATE_UNPROCESSABLE = 'shoot_item_late_unprocessable';
/** A line of a day she has not accepted: she accepts the day first. */
export const SHOOT_ITEM_NOT_ACCEPTED_UNPROCESSABLE = 'shoot_item_not_accepted_unprocessable';

/*
 * Her day (ADR 0140, second avenant du 20/11/2026): what she posts each day, as lists to tick, never published for her. The
 * essentials of the day lead (her story and her video on Reveal, her story that leads to Reveal on Instagram); the
 * rest is a bonus, never in red. The rhythm is the code's (Charles, 20/11), the same for every creator until her own
 * settings come.
 */

/** A line of her day, in the order she reads them: the essentials, then Instagram, then Telegram. */
export const DAY_ITEMS = [
  'reveal_story',
  'reveal_video',
  'insta_cta_story',
  'insta_stories',
  'insta_posts',
  'insta_reel',
  'telegram_posts',
  'telegram_video',
] as const;
export const DayItemSchema = z.enum(DAY_ITEMS);
export type DayItem = z.infer<typeof DayItemSchema>;

export const DAY_PLATFORMS = ['reveal', 'instagram', 'telegram'] as const;
export const DayPlatformSchema = z.enum(DAY_PLATFORMS);
export type DayPlatform = z.infer<typeof DayPlatformSchema>;

/** The most a line asks in a day: a count she taps up to. */
export const DAY_TARGET_MAX = 10;

export const DayLineSchema = z.strictObject({
  item: DayItemSchema,
  platform: DayPlatformSchema,
  label: z.string().min(1).max(80),
  /** What it is and why, in her words: a sentence or two. */
  sheet: z.string().min(1).max(400),
  target: z.number().int().min(1).max(DAY_TARGET_MAX),
  done: z.number().int().min(0).max(DAY_TARGET_MAX),
  /** One of the essentials of the day: shown first. */
  essential: z.boolean(),
});
export type DayLine = z.infer<typeof DayLineSchema>;

/** `GET /v1/creator-space/day?day=` (creator): her day, today in her zone without `day`. */
export const CreatorDayQuerySchema = z.strictObject({ day: CalendarDaySchema.optional() });
export const HerDaySchema = z.strictObject({
  day: CalendarDaySchema,
  /** Today in her zone: a day before yesterday is read, never ticked. */
  today: CalendarDaySchema,
  lines: z.array(DayLineSchema),
});
export type HerDay = z.infer<typeof HerDaySchema>;

/** `PUT /v1/creator-space/day/:day/items/:item` (creator): how many of the line she did that day, from 0. Replayable. */
export const DayItemParamsSchema = z.strictObject({ day: CalendarDaySchema, item: DayItemSchema });
export const DayItemDoneBodySchema = z.strictObject({ done: z.number().int().min(0).max(DAY_TARGET_MAX) });
export type DayItemDoneBody = z.infer<typeof DayItemDoneBodySchema>;

/** A line of a day other than today or yesterday in her zone: her day does not change after the fact. */
export const DAY_ITEM_LATE_UNPROCESSABLE = 'day_item_late_unprocessable';

/*
 * « Où elle en est » (Charles, 21/11, trous béants n° 11): her agency reads what she ticked of each day of a week and
 * how far her validated week went (lines shot, delivery received), as she reads them herself, never more.
 */

/** One day of « Où elle en est »: her essentials and her whole day, done against asked. */
export const ProgressDaySchema = z.strictObject({
  day: CalendarDaySchema,
  essentialsDone: z.number().int().min(0),
  essentialsAsked: z.number().int().min(0),
  done: z.number().int().min(0),
  asked: z.number().int().min(0),
  /** After today in her zone: nothing to read yet. */
  ahead: z.boolean(),
});
export type ProgressDay = z.infer<typeof ProgressDaySchema>;

/** `/v1/creators/:creatorId/progress?week=` (owner; an active manager reads): any day of the week reads her week. */
export const CreatorProgressParamsSchema = z.strictObject({ creatorId: CreatorIdSchema });

/** `GET /v1/creators/:creatorId/progress?week=`: her seven days from her Monday, and her validated week's progress. */
export const CreatorProgressSchema = z.strictObject({
  week: CalendarDaySchema,
  today: CalendarDaySchema,
  days: z.array(ProgressDaySchema).length(7),
  /** The lines of her shooting days shot, against those of the days not declined; `null` without a validated week. */
  shoot: z.strictObject({ done: z.number().int().min(0), asked: z.number().int().min(0) }).nullable(),
  /** « Livrer ma semaine » as she reads it; `null` without one. */
  delivery: HerDeliverySchema.nullable(),
});
export type CreatorProgress = z.infer<typeof CreatorProgressSchema>;
