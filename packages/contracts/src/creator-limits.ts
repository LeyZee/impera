import { z } from 'zod';

import { CreatorIdSchema } from './ids';
import { CalendarDaySchema } from './team-members';

/**
 * What she tells the agency herself, from her Aujourd'hui (Charles, 21/11, two small screens): when she will be away,
 * and what she no longer does. Her words, kept as she wrote them, read by her team on shift: the chatter sees them on
 * his home, the owner updates her sheet from them. Nothing is ever deleted: she takes one back, it stays as taken back.
 */

/** An absence lasts this many days at most: a longer one is a conversation with the agency, not a form. */
export const ABSENCE_DAYS_MAX = 60;
/** Her note on an absence, and what she no longer does, in characters. */
export const LIMIT_TEXT_MAX = 200;

const days = (from: string, to: string): number => (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;

/** A replay sends the same id: written once (idempotence). */
const LimitIdSchema = z.uuid();

export const CreatorAbsenceSchema = z.strictObject({
  id: LimitIdSchema,
  startsOn: CalendarDaySchema,
  endsOn: CalendarDaySchema,
  note: z.string().max(LIMIT_TEXT_MAX).nullable(),
  createdAt: z.iso.datetime(),
});
export type CreatorAbsence = z.infer<typeof CreatorAbsenceSchema>;

export const CreatorStopSchema = z.strictObject({
  id: LimitIdSchema,
  what: z.string().min(1).max(LIMIT_TEXT_MAX),
  createdAt: z.iso.datetime(),
});
export type CreatorStop = z.infer<typeof CreatorStopSchema>;

/**
 * `GET /v1/creator-space/limits` (her) and `GET /v1/creators/:creatorId/limits` (her team): her absences not over yet,
 * the nearest first, and what she no longer does, the latest first. Taken back ones are never listed.
 */
export const CreatorLimitsSchema = z.strictObject({
  creatorId: CreatorIdSchema,
  /** Today in her zone: an absence that covers it is now. */
  today: CalendarDaySchema,
  absences: z.array(CreatorAbsenceSchema),
  stops: z.array(CreatorStopSchema),
});
export type CreatorLimits = z.infer<typeof CreatorLimitsSchema>;

const textOf = z
  .string()
  .trim()
  .transform((text) => text.replace(/\s+/gu, ' '));

/** `POST /v1/creator-space/absences` → 201 `CreatorAbsence`: from a day to a day, both included, today or later. */
export const NewAbsenceBodySchema = z
  .strictObject({
    id: LimitIdSchema,
    startsOn: CalendarDaySchema,
    endsOn: CalendarDaySchema,
    note: textOf.pipe(z.string().max(LIMIT_TEXT_MAX)).optional(),
  })
  .refine((a) => a.startsOn <= a.endsOn, { message: 'Le retour vient après le départ', path: ['endsOn'] })
  .refine((a) => days(a.startsOn, a.endsOn) <= ABSENCE_DAYS_MAX, {
    message: `${String(ABSENCE_DAYS_MAX)} jours au plus`,
    path: ['endsOn'],
  });
export type NewAbsenceBody = z.infer<typeof NewAbsenceBodySchema>;

/** `POST /v1/creator-space/stops` → 201 `CreatorStop`: one thing she no longer does, in her words. */
export const NewStopBodySchema = z.strictObject({
  id: LimitIdSchema,
  what: textOf.pipe(z.string().min(1).max(LIMIT_TEXT_MAX)),
});
export type NewStopBody = z.infer<typeof NewStopBodySchema>;

/** `POST /v1/creator-space/absences/:id/cancel` and `…/stops/:id/withdraw` → 204: taken back, kept. */
export const LimitParamsSchema = z.strictObject({ id: LimitIdSchema });

/** The day an absence starting today or later may start: none in the past. */
export const ABSENCE_IN_PAST_UNPROCESSABLE = 'absence_in_past_unprocessable';
