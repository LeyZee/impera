import { z } from 'zod';

import { IsoDaySchema } from './agent-hours';
import { AvailabilityIdSchema, CreatorTaskIdSchema, SuggestionIdSchema } from './ids';
import { MinuteOfDaySchema } from './scheduling';
import { CalendarDaySchema } from './team-members';

/*
 * Her agenda (CR-05, ADR 0042 § 3 and § 4). Only two words on her screen: a **tâche** (timed, of a day, or of her
 * routine) and a **dispo** (time she opens to the agency); « créneau » belongs to the shifts (ADR 0049). What the agency
 * or the AI wants in it is a **suggestion**, which she accepts or declines; she never reads where one came from. Her
 * objects are `strict`: a field added by mistake (`origin`, `createdBy`) fails the contract instead of reaching her.
 */

export const CREATOR_TASK_KINDS = ['timed', 'day', 'routine'] as const;
export const CreatorTaskKindSchema = z.enum(CREATOR_TASK_KINDS);
export type CreatorTaskKind = z.infer<typeof CreatorTaskKindSchema>;

/** A sober colour per category (ADR 0042 § 4); « Réseaux » is filled by hand until the trend watch does it. */
export const CREATOR_TASK_CATEGORIES = [
  'shoot',
  'live',
  'post',
  'socials',
  'appointment',
  'personal',
] as const;
export const CreatorTaskCategorySchema = z.enum(CREATOR_TASK_CATEGORIES);
export type CreatorTaskCategory = z.infer<typeof CreatorTaskCategorySchema>;

export const CREATOR_TASK_CATEGORY_LABELS: Readonly<Record<CreatorTaskCategory, string>> = {
  shoot: 'Tournage',
  live: 'Live',
  post: 'Publication',
  socials: 'Réseaux',
  appointment: 'Rendez-vous',
  personal: 'Perso',
};

export const CreatorTaskTitleSchema = z.string().trim().min(1).max(80);
/** What the task is for, one sentence, never an invented figure (CR-05). */
export const CreatorTaskPurposeSchema = z.string().trim().min(1).max(160);

/** The longest a timed task or a dispo lasts: a day. */
export const CREATOR_TASK_MAX_MINUTES = 24 * 60;

/**
 * When a task happens: a start and an end (`timed`), a day (`day`), or weekdays of her routine (`routine`). A dispo or
 * a timed task crosses her midnight freely; a routine task is ticked on each of its weekdays.
 */
const When = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('timed'), startsAt: z.iso.datetime(), endsAt: z.iso.datetime() }),
  z.strictObject({ kind: z.literal('day'), day: CalendarDaySchema }),
  z.strictObject({
    kind: z.literal('routine'),
    weekdays: z.array(IsoDaySchema).min(1).max(7),
  }),
]);

const lastsAtMostADay = (when: z.infer<typeof When>): boolean => {
  if (when.kind !== 'timed') return true;
  const minutes = (Date.parse(when.endsAt) - Date.parse(when.startsAt)) / 60_000;
  return minutes > 0 && minutes <= CREATOR_TASK_MAX_MINUTES;
};
const distinctWeekdays = (when: z.infer<typeof When>): boolean =>
  when.kind !== 'routine' || new Set(when.weekdays).size === when.weekdays.length;

export const CreatorTaskWhenSchema = When.refine(lastsAtMostADay, {
  message: 'Une tâche à heures dure plus de 0 minute et au plus un jour',
}).refine(distinctWeekdays, { message: 'Chaque jour de la routine une seule fois' });
export type CreatorTaskWhen = z.infer<typeof CreatorTaskWhenSchema>;

/** One of her tasks, as she reads it. `essential` marks the agency's routine she accepted: it counts for her streak. */
export const CreatorTaskSchema = z.strictObject({
  id: CreatorTaskIdSchema,
  when: CreatorTaskWhenSchema,
  category: CreatorTaskCategorySchema,
  title: CreatorTaskTitleSchema,
  purpose: CreatorTaskPurposeSchema.nullable(),
  essential: z.boolean(),
  /** Minutes before a timed task she wants a reminder, `null` for none. */
  reminderMinutes: z.number().int().min(0).max(1440).nullable(),
});
export type CreatorTask = z.infer<typeof CreatorTaskSchema>;

/**
 * `POST /v1/creator-space/tasks` (creator): a task of hers. The id is drawn by her phone (UUID v7), so that a creation
 * replayed back online adds nothing: the same id with the same content answers the task, a different content 409.
 */
export const CreateCreatorTaskBodySchema = z.strictObject({
  id: CreatorTaskIdSchema,
  when: CreatorTaskWhenSchema,
  category: CreatorTaskCategorySchema,
  title: CreatorTaskTitleSchema,
  purpose: CreatorTaskPurposeSchema.nullable().default(null),
  reminderMinutes: z.number().int().min(0).max(1440).nullable().default(null),
});
export type CreateCreatorTaskBody = z.infer<typeof CreateCreatorTaskBodySchema>;

/** `PATCH /v1/creator-space/tasks/:id` (creator): moved, renamed, or its reminder changed. Never its `essential`. */
export const UpdateCreatorTaskBodySchema = z
  .strictObject({
    when: CreatorTaskWhenSchema,
    category: CreatorTaskCategorySchema,
    title: CreatorTaskTitleSchema,
    purpose: CreatorTaskPurposeSchema.nullable(),
    reminderMinutes: z.number().int().min(0).max(1440).nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Rien à changer' });
export type UpdateCreatorTaskBody = z.infer<typeof UpdateCreatorTaskBodySchema>;

/** A tick: the task done on one of her days. */
export const CreatorTickSchema = z.strictObject({
  taskId: CreatorTaskIdSchema,
  day: CalendarDaySchema,
  doneAt: z.iso.datetime(),
});
export type CreatorTick = z.infer<typeof CreatorTickSchema>;

/**
 * `POST /v1/creator-space/ticks` (creator): her ticks, one or the ones her phone kept offline. Replayed any number of
 * times, in any order, they add nothing twice (`applyTicks`). A tick for a day the task does not have is refused, and
 * so is one made more than 48 h ago, or a routine tick for another day than the one she ticked it in her zone
 * (422 `creator_tick_late_unprocessable`, ADR 0042 § 8).
 */
export const CreatorTicksBodySchema = z.strictObject({ ticks: z.array(CreatorTickSchema).min(1).max(200) });
export type CreatorTicksBody = z.infer<typeof CreatorTicksBodySchema>;

/** `DELETE /v1/creator-space/tasks/:id/ticks/:day` (creator): untick. Unticking a tick that is not there is no error. */
export const CreatorTickParamsSchema = z.strictObject({ id: CreatorTaskIdSchema, day: CalendarDaySchema });

/** A dispo: every week on a weekday, in her wall-clock time (a whole day when its end is its start), or once. */
export const AvailabilityWhenSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('weekly'),
      weekday: IsoDaySchema,
      startMinute: MinuteOfDaySchema,
      /**
       * The convention of `scheduling` (`calendar.ts`): an end at or before the start is the next day's, 22 h – 2 h is
       * `{ 1320, 120 }`, and an end equal to its start is a whole day.
       */
      endMinute: MinuteOfDaySchema,
    }),
    z.strictObject({ kind: z.literal('once'), startsAt: z.iso.datetime(), endsAt: z.iso.datetime() }),
  ])
  .refine(
    (when) =>
      when.kind === 'weekly' ||
      (Date.parse(when.endsAt) > Date.parse(when.startsAt) &&
        Date.parse(when.endsAt) - Date.parse(when.startsAt) <= CREATOR_TASK_MAX_MINUTES * 60_000),
    { message: 'Une dispo dure plus de 0 minute et au plus un jour' },
  );
export type AvailabilityWhen = z.infer<typeof AvailabilityWhenSchema>;

export const AvailabilitySchema = z.strictObject({ id: AvailabilityIdSchema, when: AvailabilityWhenSchema });
export type AvailabilityView = z.infer<typeof AvailabilitySchema>;

/** `POST /v1/creator-space/availabilities` (creator): a dispo, its id drawn by her phone like a task's. */
export const CreateAvailabilityBodySchema = AvailabilitySchema.extend({});
export type CreateAvailabilityBody = z.infer<typeof CreateAvailabilityBodySchema>;

/**
 * A suggestion as she reads it, still to decide: what it proposes, when if it found room in one of her dispos, and the
 * week it is for (her Monday). Never where it came from, nor who wrote it.
 */
export const CreatorSuggestionSchema = z.strictObject({
  id: SuggestionIdSchema,
  /** `null` for a timed suggestion that found no room: she places it herself, in « Ma semaine ». */
  when: CreatorTaskWhenSchema.nullable(),
  /** Her Monday of the week it is for. */
  week: CalendarDaySchema,
  /** How long a timed suggestion lasts, kept when it is undated. */
  minutes: z.number().int().min(1).max(CREATOR_TASK_MAX_MINUTES).nullable(),
  category: CreatorTaskCategorySchema,
  title: CreatorTaskTitleSchema,
  purpose: CreatorTaskPurposeSchema.nullable(),
  essential: z.boolean(),
});
export type CreatorSuggestion = z.infer<typeof CreatorSuggestionSchema>;

/**
 * `POST /v1/creator-space/suggestions/:id/accept` (creator): as it is, or moved (`when`, required when undated). Moved, it
 * keeps its kind: a timed suggestion stays timed, a routine stays a routine (422 `creator_suggestion_kind_unprocessable`).
 */
export const AcceptSuggestionBodySchema = z.strictObject({ when: CreatorTaskWhenSchema.optional() });
export type AcceptSuggestionBody = z.infer<typeof AcceptSuggestionBodySchema>;

/** `POST /v1/creator-space/suggestions/:id/decline` (creator): with a reason if she likes. */
export const DeclineSuggestionBodySchema = z.strictObject({
  reason: z.string().trim().min(1).max(200).optional(),
});
export type DeclineSuggestionBody = z.infer<typeof DeclineSuggestionBodySchema>;

/** Her streak (ADR 0042 § 3), computed by the server in her zone. */
export const CreatorStreakSchema = z.strictObject({
  days: z.number().int().min(0),
  jokerUsed: z.boolean(),
  atRisk: z.boolean(),
  milestone: z.union([z.literal(7), z.literal(14), z.literal(30), z.literal(50), z.literal(100)]).nullable(),
  next: z.union([z.literal(7), z.literal(14), z.literal(30), z.literal(50), z.literal(100)]).nullable(),
});
export type CreatorStreak = z.infer<typeof CreatorStreakSchema>;

/** The most days one read of her agenda covers: six weeks, a month view and its edges. */
export const CREATOR_AGENDA_MAX_DAYS = 42;

/** `GET /v1/creator-space/agenda?from=&to=` (creator): her days `from` to `to`, both included, in her zone. */
export const CreatorAgendaQuerySchema = z
  .strictObject({ from: CalendarDaySchema, to: CalendarDaySchema })
  .refine(
    ({ from, to }) =>
      from <= to && (Date.parse(to) - Date.parse(from)) / 86_400_000 < CREATOR_AGENDA_MAX_DAYS,
    { message: `De 1 à ${String(CREATOR_AGENDA_MAX_DAYS)} jours` },
  );
export type CreatorAgendaQuery = z.infer<typeof CreatorAgendaQuerySchema>;

export const CreatorAgendaSchema = z.strictObject({
  /** Her zone, which every day of the answer is read in. */
  timeZone: z.string(),
  today: CalendarDaySchema,
  /** Her timed tasks and tasks of a day that meet the days read, and all her routine. */
  tasks: z.array(CreatorTaskSchema),
  ticks: z.array(CreatorTickSchema),
  availabilities: z.array(AvailabilitySchema),
  /** Her suggestions still to decide, of the weeks the days read meet. */
  suggestions: z.array(CreatorSuggestionSchema),
  streak: CreatorStreakSchema,
});
export type CreatorAgenda = z.infer<typeof CreatorAgendaSchema>;

export const SUGGESTION_STATES = ['suggested', 'accepted', 'declined'] as const;
export const SuggestionStateSchema = z.enum(SUGGESTION_STATES);

/** Where a suggestion came from, for the agency only: she never reads it. */
export const SUGGESTION_ORIGINS = ['agency', 'ai'] as const;
export const SuggestionOriginSchema = z.enum(SUGGESTION_ORIGINS);

/**
 * `POST /v1/creators/:creatorId/suggestions` (owner, active manager): a suggestion for her agenda, its id drawn by the
 * screen. A timed one falls where it asks only inside one of her dispos and over none of her timed tasks; otherwise it
 * stays undated, in « Ma semaine » of its week. A routine suggestion is essential once she accepts it. A task she
 * declined that week or the week before answers 409 `creator_suggestion_declined_recently_conflict`.
 */
export const CreateSuggestionBodySchema = z.strictObject({
  id: SuggestionIdSchema,
  when: CreatorTaskWhenSchema,
  category: CreatorTaskCategorySchema,
  title: CreatorTaskTitleSchema,
  purpose: CreatorTaskPurposeSchema.nullable().default(null),
});
export type CreateSuggestionBody = z.infer<typeof CreateSuggestionBodySchema>;

/**
 * What became of an accepted suggestion, for the agency (CR-05 lot c): the task as she keeps it (moved if she moved
 * it), the days she ticked it (of the suggestion's week for her routine), and whether she removed it since.
 */
export const SuggestionFollowUpSchema = z.strictObject({
  when: CreatorTaskWhenSchema,
  doneDays: z.number().int().min(0),
  removed: z.boolean(),
});
export type SuggestionFollowUp = z.infer<typeof SuggestionFollowUpSchema>;

/** A suggestion as the agency reads it: what she did of it, and her reason only when she gave one. */
export const AgencySuggestionSchema = CreatorSuggestionSchema.extend({
  origin: SuggestionOriginSchema,
  state: SuggestionStateSchema,
  reason: z.string().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  /** `null` until she accepts it. */
  task: SuggestionFollowUpSchema.nullable(),
});
export type AgencySuggestion = z.infer<typeof AgencySuggestionSchema>;

/** `GET /v1/creators/:creatorId/suggestions?week=` (owner, active manager): the suggestions of one of her weeks. */
export const AgencySuggestionsQuerySchema = z.strictObject({ week: CalendarDaySchema });
export const AgencySuggestionListSchema = z.strictObject({ items: z.array(AgencySuggestionSchema) });
export type AgencySuggestionList = z.infer<typeof AgencySuggestionListSchema>;

/** Refusals of her agenda's routes, beside the shared ones (`*_not_found`, `*_conflict`). */
export const CREATOR_TASK_NOT_FOUND = 'creator_task_not_found';
export const CREATOR_TASK_CHANGED_CONFLICT = 'creator_task_changed_conflict';
export const CREATOR_TICK_DAY_UNPROCESSABLE = 'creator_tick_day_unprocessable';
export const CREATOR_TICK_LATE_UNPROCESSABLE = 'creator_tick_late_unprocessable';
export const AVAILABILITY_NOT_FOUND = 'availability_not_found';
export const SUGGESTION_NOT_FOUND = 'creator_suggestion_not_found';
export const SUGGESTION_DECIDED_CONFLICT = 'creator_suggestion_decided_conflict';
export const SUGGESTION_UNDATED_UNPROCESSABLE = 'creator_suggestion_undated_unprocessable';
export const SUGGESTION_KIND_UNPROCESSABLE = 'creator_suggestion_kind_unprocessable';
export const SUGGESTION_ID_CONFLICT = 'creator_suggestion_id_conflict';
export const SUGGESTION_DECLINED_RECENTLY_CONFLICT = 'creator_suggestion_declined_recently_conflict';

/** The answer of `POST /v1/creator-space/ticks`: how many ticks were new, and her streak now. */
export const CreatorTicksResultSchema = z.strictObject({
  added: z.number().int().min(0),
  streak: CreatorStreakSchema,
});
export type CreatorTicksResult = z.infer<typeof CreatorTicksResultSchema>;

/** The answer of an untick: her streak now. */
export const CreatorStreakResultSchema = z.strictObject({ streak: CreatorStreakSchema });
export type CreatorStreakResult = z.infer<typeof CreatorStreakResultSchema>;
