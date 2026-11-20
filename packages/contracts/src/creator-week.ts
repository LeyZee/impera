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
