import {
  PLANNING_MAX_DAYS,
  SHIFT_MAX_MINUTES,
  SHIFT_TEMPLATE_HORIZON_DAYS,
  type PlanningConflict,
  type SchedulingSettings,
  type TeamMemberStatus,
  type TeamScope,
} from '@nirvana/contracts';

import {
  MemberCreatorConflict,
  MemberNotActive,
  MemberNotJoined,
  PlanningForbidden,
  PlanningRangeInvalid,
  ShiftEnded,
  ShiftRangeInvalid,
  ShiftStarted,
  ShiftTemplateDateInvalid,
} from './errors';
import {
  addDays,
  addMinutes,
  calendarDayIn,
  isoWeekday,
  minuteOf,
  onTheMinute,
  wallClockToInstant,
} from './time';

/** Planning rules (EQ-02, contract `scheduling.ts`), pure. */

/**
 * Until the owner saves their own (no `scheduling_settings` row): Imperium's grid of four 6-hour slots from midnight,
 * in Paris, and a quarter of an hour of margin around a chatter's shift (ADR 0025).
 */
export const DEFAULT_SCHEDULING_SETTINGS: SchedulingSettings = {
  timeZone: 'Europe/Paris',
  slotStartMinute: 0,
  slotLengthMinutes: 360,
  accessMarginMinutes: 15,
};

const MINUTE_MS = 60_000;

export interface ShiftTimes {
  readonly startsAt: Date;
  readonly endsAt: Date;
  /** When a person stopped it under way: no end margin then. */
  readonly stoppedAt: Date | null;
}

/** Only the owner and an active manager plan (ADR 0024). */
export function assertPlans(scope: TeamScope): void {
  if (scope !== 'owner' && scope !== 'agency') throw new PlanningForbidden();
}

/** What decides whether a member can take a shift: their status, their creators, and the day they join. */
export interface WorkingMember {
  readonly status: TeamMemberStatus;
  readonly creatorIds: readonly string[];
  /** Their first day: pay has no rate of theirs before it (EQ-01). */
  readonly joinedOn: string;
  /**
   * The agency's zone, never the member's: a shift's report falls in the fortnight of its first day there
   * (`shiftPeriod`), so a shift that day would be paid in a fortnight without their rate.
   */
  readonly agencyTimeZone: string;
}

/** A shift goes to an `active` member who works on its creator, and starts on the day they join or later. */
export function assertCanWork(member: WorkingMember, creatorId: string, startsAt: Date): void {
  if (member.status !== 'active') throw new MemberNotActive();
  if (!member.creatorIds.includes(creatorId)) throw new MemberCreatorConflict();
  assertJoined(member, startsAt);
}

/** No shift before the member's first day, read in the agency's zone (a moved shift keeps its member). */
export function assertJoined(
  member: Pick<WorkingMember, 'joinedOn' | 'agencyTimeZone'>,
  startsAt: Date,
): void {
  if (calendarDayIn(startsAt, member.agencyTimeZone) < member.joinedOn)
    throw new MemberNotJoined(member.joinedOn);
}

/** On the minute, ending after it starts, a day at most. */
export function assertShiftRange(startsAt: Date, endsAt: Date): void {
  const minutes = (endsAt.getTime() - startsAt.getTime()) / MINUTE_MS;
  if (!onTheMinute(startsAt) || !onTheMinute(endsAt) || minutes <= 0 || minutes > SHIFT_MAX_MINUTES) {
    throw new ShiftRangeInvalid();
  }
}

/** A new shift, or one moved before it starts, ends after now: the past is not written afterwards. */
export function assertEndsAhead(endsAt: Date, now: Date): void {
  if (endsAt.getTime() <= now.getTime()) throw new ShiftEnded();
}

/** `to` after `from`, `PLANNING_MAX_DAYS` at most. */
export function assertPlanningRange(from: Date, to: Date): void {
  const span = to.getTime() - from.getTime();
  if (span <= 0 || span > PLANNING_MAX_DAYS * 24 * 60 * MINUTE_MS) throw new PlanningRangeInvalid();
}

/** A template starts today at the earliest, in the grid's zone. */
export function assertTemplateStart(validFrom: string, today: string): void {
  if (validFrom < today) throw new ShiftTemplateDateInvalid();
}

/** `onShift`: the shift covers `at`, its start included and its end excluded. The caller keeps cancelled ones out. */
export function covers(shift: Pick<ShiftTimes, 'startsAt' | 'endsAt'>, at: Date): boolean {
  return shift.startsAt.getTime() <= at.getTime() && at.getTime() < shift.endsAt.getTime();
}

/** The access window of ADR 0025: the margin on each side, none after the end of a stopped shift. */
export function accessWindow(shift: ShiftTimes, marginMinutes: number): { startsAt: Date; endsAt: Date } {
  return {
    startsAt: addMinutes(shift.startsAt, -marginMinutes),
    endsAt: shift.stoppedAt === null ? addMinutes(shift.endsAt, marginMinutes) : shift.endsAt,
  };
}

/**
 * A member's shifts as Aujourd'hui reads them (`MyShifts`): the one they are on, the next to start, and the latest
 * ended one whose end margin is still open. A stopped shift is never `ended`.
 */
export function myShiftsOf<T extends ShiftTimes>(
  shifts: readonly T[],
  now: Date,
  marginMinutes: number,
): { current: T | null; next: T | null; ended: T | null } {
  const at = now.getTime();
  const current = shifts.find((shift) => covers(shift, now)) ?? null;
  const next =
    shifts
      .filter((shift) => shift.startsAt.getTime() > at)
      .toSorted((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0] ?? null;
  const ended =
    shifts
      .filter(
        (shift) => shift.endsAt.getTime() <= at && at < accessWindow(shift, marginMinutes).endsAt.getTime(),
      )
      .toSorted((a, b) => b.endsAt.getTime() - a.endsAt.getTime())[0] ?? null;
  return { current, next, ended };
}

/** What a `PATCH` does to a shift, decided by where the shift stands at `now`. */
export type ShiftUpdate =
  | {
      readonly kind: 'plan';
      readonly memberId: string;
      readonly startsAt: Date;
      readonly endsAt: Date;
    }
  | { readonly kind: 'shorten'; readonly endsAt: Date }
  | { readonly kind: 'stop'; readonly endsAt: Date; readonly stoppedAt: Date }
  | { readonly kind: 'cancel' };

/**
 * Before its start, a shift takes another member or other times, under the rules of a new one. Under way, only an
 * earlier end: one still after now shortens it, one at or before now stops it at the minute of `now` (cancels it, if
 * that minute is its first). Ended, it no longer changes.
 */
export function decideUpdate(
  shift: { readonly memberId: string; readonly startsAt: Date; readonly endsAt: Date },
  change: { readonly memberId?: string; readonly startsAt?: Date; readonly endsAt?: Date },
  now: Date,
): ShiftUpdate {
  if (shift.endsAt.getTime() <= now.getTime()) throw new ShiftEnded();
  if (shift.startsAt.getTime() > now.getTime()) {
    const planned = {
      memberId: change.memberId ?? shift.memberId,
      startsAt: change.startsAt ?? shift.startsAt,
      endsAt: change.endsAt ?? shift.endsAt,
    };
    assertShiftRange(planned.startsAt, planned.endsAt);
    assertEndsAhead(planned.endsAt, now);
    return { kind: 'plan', ...planned };
  }
  const otherMember = change.memberId !== undefined && change.memberId !== shift.memberId;
  const otherStart = change.startsAt !== undefined && change.startsAt.getTime() !== shift.startsAt.getTime();
  if (otherMember || otherStart || change.endsAt === undefined) throw new ShiftStarted();
  if (change.endsAt.getTime() >= shift.endsAt.getTime()) throw new ShiftStarted();
  if (change.endsAt.getTime() > now.getTime()) {
    assertShiftRange(shift.startsAt, change.endsAt);
    return { kind: 'shorten', endsAt: change.endsAt };
  }
  const stopMinute = minuteOf(now);
  if (stopMinute.getTime() <= shift.startsAt.getTime()) return { kind: 'cancel' };
  return { kind: 'stop', endsAt: stopMinute, stoppedAt: now };
}

/** A shift that has ended is not cancelled afterwards. */
export function assertCancellable(shift: { readonly endsAt: Date }, now: Date): void {
  if (shift.endsAt.getTime() <= now.getTime()) throw new ShiftEnded();
}

/** The weekly rule of a template, in wall-clock minutes of the grid's zone. */
export interface TemplateRule {
  readonly weekday: number;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly validFrom: string;
  readonly validUntil: string | null;
}

export interface Occurrence {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/**
 * The template's shifts that start on the days `fromDay` to `toDay` (both included), as instants. A slot keeps its
 * wall-clock hours across a change of time (5 or 7 hours that night); an occurrence that the spring gap swallows
 * whole (its start and end both in the gap) does not exist.
 */
export function occurrences(
  template: TemplateRule,
  fromDay: string,
  toDay: string,
  timeZone: string,
): Occurrence[] {
  const first = fromDay > template.validFrom ? fromDay : template.validFrom;
  const last = template.validUntil !== null && template.validUntil < toDay ? template.validUntil : toDay;
  const found: Occurrence[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) {
    if (isoWeekday(day) !== template.weekday) continue;
    const startsAt = wallClockToInstant(day, template.startMinute, timeZone);
    const endDay = template.endMinute <= template.startMinute ? addDays(day, 1) : day;
    const endsAt = wallClockToInstant(endDay, template.endMinute, timeZone);
    if (endsAt.getTime() > startsAt.getTime()) found.push({ startsAt, endsAt });
  }
  return found;
}

/** When a template's first shift would start: what its member must have joined by (`assertCanWork`). */
export function firstStartOf(template: TemplateRule, timeZone: string): Date {
  const [first] = occurrences(template, template.validFrom, addDays(template.validFrom, 6), timeZone);
  return first?.startsAt ?? wallClockToInstant(template.validFrom, template.startMinute, timeZone);
}

/**
 * The shifts a template makes ahead, from today for `SHIFT_TEMPLATE_HORIZON_DAYS` days in the grid's zone, those not
 * yet ended. Making them again is harmless: `(template_id, template_starts_at)` is unique, cancelled shifts included.
 */
export function occurrencesAhead(template: TemplateRule, now: Date, timeZone: string): Occurrence[] {
  const today = calendarDayIn(now, timeZone);
  return occurrences(template, today, addDays(today, SHIFT_TEMPLATE_HORIZON_DAYS - 1), timeZone).filter(
    (occurrence) => occurrence.endsAt.getTime() > now.getTime(),
  );
}

/** The key that makes a template's shift once: its template and its start. */
export function occurrenceKey(templateId: string, startsAt: Date): string {
  return `${templateId}@${startsAt.toISOString()}`;
}

export interface PlannedShift {
  readonly id: string;
  readonly memberId: string;
  readonly platformAccountId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface PlanningTemplate extends TemplateRule {
  readonly id: string;
  readonly memberId: string;
  readonly platformAccountId: string;
}

/** A member's leave as the planning reads it: what it covers (`leaveCover`, `domain/leaves.ts`). */
export interface CoveringLeave {
  readonly id: string;
  readonly memberId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

interface ConflictTimes {
  readonly templateId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export type Conflict =
  | (ConflictTimes & {
      readonly reason: Exclude<PlanningConflict['reason'], 'member_on_leave'>;
      readonly shiftId: string;
    })
  | (ConflictTimes & { readonly reason: 'member_on_leave'; readonly leaveRequestId: string });

const overlaps = (a: Occurrence, b: Occurrence): boolean =>
  a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();

/**
 * The occurrences of the templates, in [`from`, `to`) and not yet ended, that have no shift, with what stands in
 * their way: their member's leave (`member_on_leave`, ADR 0031: a shift to fill), another shift of their member
 * (`member_busy`) or of their account (`account_taken`). An occurrence with no shift and nothing in its way is only
 * not made yet (beyond the horizon), not a conflict. `made` holds the keys of the shifts the templates already made,
 * cancelled ones included.
 */
export function conflictsOf(
  templates: readonly PlanningTemplate[],
  made: ReadonlySet<string>,
  shifts: readonly PlannedShift[],
  range: { readonly from: Date; readonly to: Date },
  now: Date,
  timeZone: string,
  leaves: readonly CoveringLeave[],
): Conflict[] {
  const fromDay = addDays(calendarDayIn(range.from, timeZone), -1);
  const toDay = calendarDayIn(range.to, timeZone);
  const window = { startsAt: range.from, endsAt: range.to };
  const conflicts: Conflict[] = [];
  for (const template of templates) {
    for (const occurrence of occurrences(template, fromDay, toDay, timeZone)) {
      if (!overlaps(occurrence, window) || occurrence.endsAt.getTime() <= now.getTime()) continue;
      if (made.has(occurrenceKey(template.id, occurrence.startsAt))) continue;
      const away = leaves.find(
        (leave) => leave.memberId === template.memberId && overlaps(leave, occurrence),
      );
      if (away !== undefined) {
        conflicts.push({
          ...occurrence,
          templateId: template.id,
          reason: 'member_on_leave',
          leaveRequestId: away.id,
        });
        continue;
      }
      const busy = shifts.find(
        (shift) => shift.memberId === template.memberId && overlaps(shift, occurrence),
      );
      const taken = shifts.find(
        (shift) => shift.platformAccountId === template.platformAccountId && overlaps(shift, occurrence),
      );
      const inTheWay = busy ?? taken;
      if (inTheWay === undefined) continue;
      conflicts.push({
        templateId: template.id,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        reason: busy === undefined ? 'account_taken' : 'member_busy',
        shiftId: inTheWay.id,
      });
    }
  }
  return conflicts.toSorted((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
