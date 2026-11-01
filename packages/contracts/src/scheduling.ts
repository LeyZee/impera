import { z } from 'zod';

import { PlatformSchema } from './enums';
import {
  CreatorIdSchema,
  LeaveRequestIdSchema,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  ShiftSwapRequestIdSchema,
  ShiftTemplateIdSchema,
  TeamMemberIdSchema,
} from './ids';
import { TimezoneSchema } from './persona';
import { CalendarDaySchema, MemberColorSchema } from './team-members';

/**
 * Planning (EQ-02, ADR 0023 § Modules, ADR 0025), under `/v1/scheduling`.
 *
 * Time. A shift is the half-open range [`startsAt`, `endsAt`) of two UTC instants (ADR 0011): it covers its start and
 * stops covering at its end, so a shift that ends at 06:00 and the next one that starts at 06:00 never overlap. A
 * screen shows the instants in the zone it chooses (the grid's, the reader's, the member's). Only the slots and the
 * templates speak in wall-clock time, in the grid's zone (`SchedulingSettings.timeZone`), and they become instants
 * when a template makes its shifts: a slot keeps its wall-clock hours across a change of time, so a 6-hour night slot
 * lasts 5 or 7 hours that night.
 *
 * Instants on the minute. `startsAt` and `endsAt` fall on a minute (seconds and milliseconds at zero), and a shift
 * lasts `SHIFT_MAX_MINUTES` at most: anything else answers 400 `shift_range_invalid`.
 *
 * Wall-clock times that do not exist or happen twice. A template's hour that falls in the spring gap (02:30 on the
 * last Sunday of March in Paris) becomes the first instant after the gap (03:00); an hour that happens twice in the
 * autumn becomes the first of the two. The `scheduling` module converts, and its tests hold both cases. A template
 * lasts `SHIFT_TEMPLATE_MAX_MINUTES` at most, so that a change of time never stretches one of its shifts past a day.
 *
 * On shift (`onShift`, glossary « En poste »). A member is on shift on an account at an instant `at` when they are
 * `active` and one of their shifts there, not cancelled, has `startsAt ≤ at < endsAt`. Their access window (ADR 0025,
 * EQ-13) widens it by `accessMarginMinutes` on each side, `startsAt − margin ≤ at < endsAt + margin`, with two
 * exceptions: a shift a person stopped while under way (`stoppedAt`, see `UpdateShiftBodySchema`) gets no margin
 * after its end, and a member who is not `active` has no window at all, whatever their shifts. A cancelled shift
 * counts for neither. The server computes both from the database at each request, never from a request and never
 * from a cache: a shift cancelled, moved, shortened or stopped counts as it now is from the next request on.
 *
 * Who reads which. The routing of a « sale » handover (EQ-13), `OnDuty` and `MyShifts.current` read `onShift`, without
 * the margin: a sale never goes to a chatter who is only in their margin. Only the creators' list of ADR 0025
 * (`shiftCreatorIds`) reads the window, per creator: a chatter whose window is open on any account of a creator keeps
 * that creator.
 *
 * One member, one account, one instant. The database decides it, not a read before the write: two exclusion
 * constraints (`btree_gist`, `tstzrange(starts_at, ends_at, '[)')`, cancelled shifts aside) keep a member off two
 * shifts at once and an account off two members at once, so two people planning at the same moment cannot both win.
 * A violation (23P01) answers 409 `shift_member_conflict` or `shift_account_conflict`; the server then reads the
 * shift in the way and gives it in `details.shiftId`.
 *
 * The past is kept. A shift that has ended (`endsAt ≤ now`) no longer changes: 409 `shift_ended_conflict`. A shift
 * under way may only be shortened, stopped or cancelled; any other change answers 409 `shift_started_conflict`. A new
 * shift ends after now. A cancelled shift is never sent back, and changing it answers `shift_not_found`.
 *
 * Creator and account. A shift and a template name both: the server checks that the account is the creator's
 * (`platform_account_not_found` otherwise), and the database holds the pair by a composite foreign key
 * `(platform_account_id, creator_id)` to `platform_accounts (id, creator_id)`, so that no row can open the wrong
 * creator in `shiftCreatorIds`.
 *
 * Leaves and swaps (ADR 0031). A leave is the member's, not a creator's: whole days of their own zone, asked by them,
 * approved or refused by the owner or an active manager (never by the member themselves), once no shift of theirs
 * covers it any more. While it is approved, no shift lands on them: by hand, by a template (the occurrence shows in
 * `conflicts` as `member_on_leave`) or by a swap. A swap is between chatters, without a manager (Charles, 27/10): a
 * chatter gives a shift that has not started to an active colleague of the same creator, or exchanges it for one of
 * theirs; the colleague accepts or declines, and an acceptance moves the shifts at once, under the rules of a shift set
 * by hand. The owner and an active manager see every swap and can revert one before either shift starts. The server
 * decides a leave's approval and every write that puts a shift on a member under one lock per member, so that an
 * approval and a new shift at the same moment cannot both win.
 */

/** Slot lengths that divide a day, so the slots tile it (4 × 6 h by default, like Imperium's grid). */
export const SHIFT_SLOT_LENGTHS_MINUTES = [60, 120, 180, 240, 360, 480, 720] as const;

/** The longest shift: beyond a day, it is a typing mistake. */
export const SHIFT_MAX_MINUTES = 24 * 60;

/** The longest template: an hour short of a day, so that the autumn change of time keeps its shifts within a day. */
export const SHIFT_TEMPLATE_MAX_MINUTES = SHIFT_MAX_MINUTES - 60;

/** The widest range one planning read covers (six weeks). */
export const PLANNING_MAX_DAYS = 42;

/** A minute of the day in the grid's zone, from midnight: 0 to 1439. */
export const MinuteOfDaySchema = z.number().int().min(0).max(1439);

/**
 * The owner's planning settings (`GET`, `PUT /v1/scheduling/settings`). Changing the slots moves no shift and no
 * template: they keep their hours.
 */
export const SchedulingSettingsSchema = z
  .object({
    /** The agency's zone: the slots and the templates speak in it, and the pay periods follow it (ADR 0023, EQ-03). */
    timeZone: TimezoneSchema,
    /** Where the day's first slot starts, in minutes after midnight; earlier than the end of that slot. */
    slotStartMinute: MinuteOfDaySchema,
    slotLengthMinutes: z.literal(SHIFT_SLOT_LENGTHS_MINUTES),
    /** ADR 0025: how long before and after their shift a chatter keeps their creators in Nirvana. */
    accessMarginMinutes: z.number().int().min(0).max(120),
  })
  .refine((settings) => settings.slotStartMinute < settings.slotLengthMinutes, {
    message: 'Le premier créneau commence moins d’une durée de créneau après minuit',
    path: ['slotStartMinute'],
  });
export type SchedulingSettings = z.infer<typeof SchedulingSettingsSchema>;

/** One slot of the day (`ShiftSlot`, never `slot` alone): an end at or before its start is the next day. */
export const ShiftSlotSchema = z.object({ startMinute: MinuteOfDaySchema, endMinute: MinuteOfDaySchema });
export type ShiftSlot = z.infer<typeof ShiftSlotSchema>;

const MINUTES_PER_DAY = 24 * 60;

/** The day's slots, in order from the first one: `{ 0, 360 }, { 360, 720 }…` with the defaults. */
export function shiftSlotsOf(
  settings: Pick<SchedulingSettings, 'slotStartMinute' | 'slotLengthMinutes'>,
): ShiftSlot[] {
  const count = MINUTES_PER_DAY / settings.slotLengthMinutes;
  return Array.from({ length: count }, (_, index) => {
    const startMinute = settings.slotStartMinute + index * settings.slotLengthMinutes;
    return {
      startMinute: startMinute % MINUTES_PER_DAY,
      endMinute: (startMinute + settings.slotLengthMinutes) % MINUTES_PER_DAY,
    };
  });
}

/** A member's shift on one account of a creator. A cancelled shift is never sent back. */
export const ShiftSchema = z.object({
  id: ShiftIdSchema,
  creatorId: CreatorIdSchema,
  platformAccountId: PlatformAccountIdSchema,
  memberId: TeamMemberIdSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  /** The template that made it, or `null` for a shift set by hand. */
  templateId: ShiftTemplateIdSchema.nullable(),
  /** When a person stopped it under way (it then ends at that minute, without the end margin), or `null`. */
  stoppedAt: z.iso.datetime().nullable(),
});
export type Shift = z.infer<typeof ShiftSchema>;

/**
 * `POST /v1/scheduling/shifts` (owner, active manager) → 201 `ShiftSchema`. The member is `active`, works on this
 * creator and is not on an approved leave then (409 `member_on_leave_conflict`), the account is hers, both instants
 * fall on a minute, the shift lasts `SHIFT_MAX_MINUTES` at most and ends after now. A member is never on two shifts at
 * once, and an account never has two members at once: either answers 409 with the shift in the way.
 */
export const CreateShiftBodySchema = z.object({
  creatorId: CreatorIdSchema,
  platformAccountId: PlatformAccountIdSchema,
  memberId: TeamMemberIdSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
});
export type CreateShiftBody = z.infer<typeof CreateShiftBodySchema>;

/**
 * `PATCH /v1/scheduling/shifts/:shiftId` (owner, active manager) → 200 `ShiftSchema`, or 204 without a body when the
 * change cancels the shift. Before it starts: another member, or other times, under the rules of a new shift. Under
 * way: only an earlier `endsAt`. One still after now shortens it; one at or before now stops it, at the minute of the
 * request: `stoppedAt` is set and the access window closes with the shift, without the end margin. A shift stopped in
 * the minute it started is cancelled instead, like a `DELETE`, and answers 204: a cancelled shift is never sent back.
 * Ended: 409 `shift_ended_conflict`. A template's shift changed by hand stays changed. A shift that has its report
 * (EQ-03) is not cancelled: 409 `shift_report_exists_conflict` (`SHIFT_REPORT_ERROR_CODES`, `details.shiftReportId`).
 */
export const UpdateShiftBodySchema = z
  .object({ memberId: TeamMemberIdSchema, startsAt: z.iso.datetime(), endsAt: z.iso.datetime() })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Rien à changer');
export type UpdateShiftBody = z.infer<typeof UpdateShiftBodySchema>;

/*
 * `DELETE /v1/scheduling/shifts/:shiftId` (owner, active manager) → 204: the shift, not yet ended, is cancelled, kept
 * in the audit trail, and its template never makes it again. Its access window closes at the next request. A shift
 * that has its report (EQ-03) is not cancelled: 409 `shift_report_exists_conflict` (`details.shiftReportId`).
 */

/** How long a template lasts in wall-clock minutes, an end at or before the start being the next day. */
export function templateLengthMinutes(template: {
  readonly startMinute: number;
  readonly endMinute: number;
}): number {
  return (template.endMinute - template.startMinute + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * A weekly shift: every `weekday` from `validFrom`, from `startMinute` to `endMinute` in the grid's zone (an end at
 * or before the start is the next day). A template is never edited: it is ended, and a new one starts.
 */
export const ShiftTemplateSchema = z.object({
  id: ShiftTemplateIdSchema,
  creatorId: CreatorIdSchema,
  platformAccountId: PlatformAccountIdSchema,
  memberId: TeamMemberIdSchema,
  /** ISO weekday in the grid's zone: 1 Monday … 7 Sunday. */
  weekday: z.number().int().min(1).max(7),
  startMinute: MinuteOfDaySchema,
  endMinute: MinuteOfDaySchema,
  validFrom: CalendarDaySchema,
  /** Its last day, or `null` while it runs. */
  validUntil: CalendarDaySchema.nullable(),
});
export type ShiftTemplate = z.infer<typeof ShiftTemplateSchema>;

/** `GET /v1/scheduling/shift-templates` (owner, active manager): the templates still running, of every creator. */
export const ShiftTemplateListSchema = z.object({ templates: z.array(ShiftTemplateSchema) });

/**
 * `POST /v1/scheduling/shift-templates` (owner, active manager) → 201 `ShiftTemplateSchema`, from today at the
 * earliest in the grid's zone. Its shifts are made ahead (`SHIFT_TEMPLATE_HORIZON_DAYS`) by a job that can run again
 * without making one twice; an occurrence that would overlap another shift is not made, and the planning shows it in
 * `conflicts`.
 */
export const CreateShiftTemplateBodySchema = z
  .object({
    creatorId: CreatorIdSchema,
    platformAccountId: PlatformAccountIdSchema,
    memberId: TeamMemberIdSchema,
    weekday: z.number().int().min(1).max(7),
    startMinute: MinuteOfDaySchema,
    endMinute: MinuteOfDaySchema,
    validFrom: CalendarDaySchema,
  })
  .refine((body) => body.startMinute !== body.endMinute, {
    message: 'Un modèle doit commencer et finir à des heures différentes',
    path: ['endMinute'],
  })
  .refine((body) => templateLengthMinutes(body) <= SHIFT_TEMPLATE_MAX_MINUTES, {
    message: 'Un modèle dure 23 heures au plus',
    path: ['endMinute'],
  });
export type CreateShiftTemplateBody = z.infer<typeof CreateShiftTemplateBodySchema>;

/*
 * `DELETE /v1/scheduling/shift-templates/:templateId` (owner, active manager) → 204: the template ends today, and its
 * shifts that have not started are cancelled with it.
 */

/** How far ahead a template's shifts exist. */
export const SHIFT_TEMPLATE_HORIZON_DAYS = 28;

/** An account the reader can see on the planning, with its creator's name for the rows. */
export const PlanningAccountSchema = z.object({
  id: PlatformAccountIdSchema,
  creatorId: CreatorIdSchema,
  creatorName: z.string().min(1),
  platform: PlatformSchema,
  handle: z.string().min(1),
});
export type PlanningAccount = z.infer<typeof PlanningAccountSchema>;

/** A member as the planning names them: on a shift, in a template, or in a conflict. */
export const PlanningMemberSchema = z.object({
  id: TeamMemberIdSchema,
  displayName: z.string().min(1),
  color: MemberColorSchema.nullable(),
});
export type PlanningMember = z.infer<typeof PlanningMemberSchema>;

/**
 * Why an occurrence of a template has no shift: its member is busy elsewhere, its account already has someone, or its
 * member is on an approved leave (ADR 0031; the slot is to be filled by someone else).
 */
export const PLANNING_CONFLICT_REASONS = ['member_busy', 'account_taken', 'member_on_leave'] as const;
export const PlanningConflictReasonSchema = z.enum(PLANNING_CONFLICT_REASONS);

const TemplateOccurrenceSchema = z.object({
  templateId: ShiftTemplateIdSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
});

export const PlanningConflictSchema = z.discriminatedUnion('reason', [
  TemplateOccurrenceSchema.extend({
    reason: z.enum(['member_busy', 'account_taken']),
    /** The shift in the way. */
    shiftId: ShiftIdSchema,
  }),
  TemplateOccurrenceSchema.extend({
    reason: z.literal('member_on_leave'),
    /** The approved leave that covers the occurrence. */
    leaveRequestId: LeaveRequestIdSchema,
  }),
]);
export type PlanningConflict = z.infer<typeof PlanningConflictSchema>;

/**
 * `GET /v1/scheduling/planning?from=…&to=…[&creatorId=…]`: the shifts that overlap [`from`, `to`), at most
 * `PLANNING_MAX_DAYS`. The owner and an active manager read every creator: every account, every member named by a
 * shift or a template, and the conflicts. Any other member (a chatter, a manager who is not `active`) reads their own
 * shifts only: `shifts` holds theirs, `accounts` the accounts those shifts are on, `members` themselves alone, and
 * `conflicts` stays empty. A colleague's name never reaches a chatter through the planning.
 */
export const PlanningQuerySchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  creatorId: CreatorIdSchema.optional(),
});
export type PlanningQuery = z.infer<typeof PlanningQuerySchema>;

export const PlanningSchema = z.object({
  settings: SchedulingSettingsSchema,
  accounts: z.array(PlanningAccountSchema),
  members: z.array(PlanningMemberSchema),
  shifts: z.array(ShiftSchema),
  conflicts: z.array(PlanningConflictSchema),
});
export type Planning = z.infer<typeof PlanningSchema>;

/**
 * Who is on shift right now on one account (`GET /v1/scheduling/on-duty`, owner and active manager): `onShift`, without
 * the margin.
 */
export const OnDutySchema = z.object({
  creatorId: CreatorIdSchema,
  platformAccountId: PlatformAccountIdSchema,
  member: PlanningMemberSchema,
  shiftId: ShiftIdSchema,
  endsAt: z.iso.datetime(),
});
export type OnDuty = z.infer<typeof OnDutySchema>;

export const OnDutyListSchema = z.object({ onDuty: z.array(OnDutySchema) });

/**
 * A member's own shift, for Aujourd'hui: its creator's name (a chatter does not read the creators' list, ADR 0025),
 * the account to open in the platform (the chatter chats there, never in Nirvana), and the access window the server
 * computed for it (`accessEndsAt` is `endsAt` for a stopped shift).
 */
export const MyShiftSchema = ShiftSchema.extend({
  creatorName: z.string().min(1),
  platform: PlatformSchema,
  handle: z.string().min(1),
  accessStartsAt: z.iso.datetime(),
  accessEndsAt: z.iso.datetime(),
});
export type MyShift = z.infer<typeof MyShiftSchema>;

/**
 * `GET /v1/scheduling/my-shifts` (any team member), for Aujourd'hui and Suivi. `current` is the shift the member is on
 * now, `onShift` without the margin (`startsAt ≤ now < endsAt`): « En poste ». `next` is the earliest shift that starts
 * after now, even when its start margin is already open: « Bientôt en poste ». `ended` is the latest shift that has
 * ended while its end margin is still open (`endsAt ≤ now < accessEndsAt`): its creator stays open until
 * `accessEndsAt`, through the creators' list of ADR 0025, but no sale is routed to the member. A stopped shift is never
 * `ended`, its window having closed with it; `ended` and `current` may both be set when two shifts follow one another.
 * All three `null` for an account that is not in the team, and for a member who is not `active`.
 */
export const MyShiftsSchema = z.object({
  current: MyShiftSchema.nullable(),
  next: MyShiftSchema.nullable(),
  ended: MyShiftSchema.nullable(),
});
export type MyShifts = z.infer<typeof MyShiftsSchema>;

/** The longest leave asked at once, in days: beyond, it is a typing mistake, or a status for the owner to set. */
export const LEAVE_MAX_DAYS = 31;

/** The widest range one read of the leaves covers. */
export const LEAVE_QUERY_MAX_DAYS = 366;

/**
 * `pending` until the agency decides: `approved` or `refused`. The member `withdrawn` their pending request; the owner
 * or an active manager `cancelled` an approved leave before its end. A cancelled leave counts until its `cancelledAt`
 * and no longer: nothing when it had not started, the days already taken when it had (ADR 0031).
 */
export const LEAVE_REQUEST_STATUSES = ['pending', 'approved', 'refused', 'withdrawn', 'cancelled'] as const;
export const LeaveRequestStatusSchema = z.enum(LEAVE_REQUEST_STATUSES);
export type LeaveRequestStatus = z.infer<typeof LeaveRequestStatusSchema>;

/** A trimmed free text of 500 characters at most; empty means none. Never a fan's data. */
const NoteSchema = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((value) => (value === undefined || value === null || value === '' ? null : value));

/** Days between two calendar days, `to` excluded. */
function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

/**
 * A member's leave (ADR 0031): from `firstDay` to `lastDay` included, days of the zone the member had when they asked
 * (`timeZone`). The server fixes the instants when it records the request, from midnight of `firstDay` to midnight
 * after `lastDay` in that zone, so that a later change of zone never moves it.
 */
export const LeaveRequestSchema = z.object({
  id: LeaveRequestIdSchema,
  memberId: TeamMemberIdSchema,
  firstDay: CalendarDaySchema,
  lastDay: CalendarDaySchema,
  timeZone: TimezoneSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  /** What the member wrote with the request. */
  note: z.string().nullable(),
  status: LeaveRequestStatusSchema,
  /** When it was approved or refused; `null` while pending, and for a request withdrawn before any decision. */
  decidedAt: z.iso.datetime().nullable(),
  /**
   * When it was withdrawn or cancelled; `null` otherwise. `startsAt` and `endsAt` never change: a leave cancelled
   * while under way covers [`startsAt`, `cancelledAt`).
   */
  cancelledAt: z.iso.datetime().nullable(),
  /** What the person who refused or cancelled it wrote, for the member. */
  decisionNote: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type LeaveRequest = z.infer<typeof LeaveRequestSchema>;

/**
 * `POST /v1/scheduling/leave-requests` (any team member who has not left, for themselves) → 201 `LeaveRequestSchema`,
 * or 200 when the same `id` was already recorded with the same days and note (`leave_request_conflict` otherwise).
 * `id` is made by the client when the form opens, so a retry records one request. `firstDay` is today or later in the
 * member's zone (`leave_date_invalid` otherwise). A pending or approved leave of theirs that overlaps answers 409
 * `leave_overlap_conflict` with `details.leaveRequestId`.
 */
export const CreateLeaveRequestBodySchema = z
  .object({
    id: LeaveRequestIdSchema,
    firstDay: CalendarDaySchema,
    lastDay: CalendarDaySchema,
    note: NoteSchema,
  })
  .refine((body) => body.lastDay >= body.firstDay, {
    message: 'Le dernier jour vient après le premier',
    path: ['lastDay'],
  })
  .refine((body) => daysBetween(body.firstDay, body.lastDay) < LEAVE_MAX_DAYS, {
    message: `Un congé dure ${String(LEAVE_MAX_DAYS)} jours au plus`,
    path: ['lastDay'],
  });
export type CreateLeaveRequestBody = z.input<typeof CreateLeaveRequestBodySchema>;

/**
 * `POST /v1/scheduling/leave-requests/:leaveRequestId/decision` (owner, active manager) → `LeaveRequestSchema`. Only a
 * pending request is decided (`leave_decided_conflict` otherwise). A manager never decides their own leave
 * (`leave_own_decision_forbidden`); the owner decides theirs, since nobody decides for them. Approving answers 409
 * `leave_shifts_conflict`, with `details.shiftIds`, while shifts of the member that are not cancelled still overlap the
 * leave: give them to someone else or cancel them first, so that no account is left without anyone unseen. Approving
 * also lapses the open swap proposals that would give the member a shift during the leave.
 */
export const DecideLeaveRequestBodySchema = z.object({
  decision: z.enum(['approve', 'refuse']),
  note: NoteSchema,
});
export type DecideLeaveRequestBody = z.input<typeof DecideLeaveRequestBodySchema>;

/*
 * `DELETE /v1/scheduling/leave-requests/:leaveRequestId` → 204. The member withdraws their own pending request; the
 * owner or an active manager cancels an approved leave that has not ended, and the member can be planned again from
 * then on. Either way `cancelledAt` is set, and `decidedAt` keeps the approval. A request in any other state answers
 * `leave_decided_conflict`. Nothing is deleted: the row keeps its status.
 */

/**
 * `GET /v1/scheduling/leave-requests?from=…&to=…`: the requests whose leave overlaps [`from`, `to`), at most
 * `LEAVE_QUERY_MAX_DAYS`, withdrawn ones aside. The owner and an active manager read every member's, and `members`
 * names them; any other member reads their own, and `members` holds themselves alone.
 */
export const LeaveRequestQuerySchema = z.object({ from: z.iso.datetime(), to: z.iso.datetime() });
export type LeaveRequestQuery = z.infer<typeof LeaveRequestQuerySchema>;

export const LeaveRequestListSchema = z.object({
  leaveRequests: z.array(LeaveRequestSchema),
  members: z.array(PlanningMemberSchema),
});
export type LeaveRequestList = z.infer<typeof LeaveRequestListSchema>;

/** How long a swap that was answered, withdrawn, lapsed or reverted stays in the lists. */
export const SHIFT_SWAP_RECENT_DAYS = 14;

/**
 * `proposed` until the colleague answers: `accepted` (the shifts have moved) or `declined`. The requester, or the
 * owner or an active manager, `withdrawn` a proposal; it `lapsed` when one of its shifts started, was cancelled,
 * changed hands or hours first, or when another swap on the same shift was accepted. The owner or an active manager `reverted`
 * an accepted swap: the shifts went back to their members.
 */
export const SHIFT_SWAP_STATUSES = [
  'proposed',
  'accepted',
  'declined',
  'withdrawn',
  'lapsed',
  'reverted',
] as const;
export const ShiftSwapStatusSchema = z.enum(SHIFT_SWAP_STATUSES);
export type ShiftSwapStatus = z.infer<typeof ShiftSwapStatusSchema>;

/**
 * A chatter's swap (ADR 0031): `shiftId`, theirs, goes to `targetMemberId`; with `targetShiftId`, that colleague's
 * shift comes back to them (an exchange), without it the shift is given. The swap keeps what it noted when it was
 * proposed, each shift's creator and hours: a screen says a swap that ended from them (« Ton shift du jeu. 23 h – 5 h
 * sur Nora : refusé »), since the shift itself may no longer be readable.
 */
export const ShiftSwapRequestSchema = z.object({
  id: ShiftSwapRequestIdSchema,
  requesterId: TeamMemberIdSchema,
  shiftId: ShiftIdSchema,
  creatorId: CreatorIdSchema,
  shiftStartsAt: z.iso.datetime(),
  shiftEndsAt: z.iso.datetime(),
  targetMemberId: TeamMemberIdSchema,
  targetShiftId: ShiftIdSchema.nullable(),
  /** With `targetShiftId`, its creator and hours as noted; `null` for a shift given. */
  targetCreatorId: CreatorIdSchema.nullable(),
  targetShiftStartsAt: z.iso.datetime().nullable(),
  targetShiftEndsAt: z.iso.datetime().nullable(),
  /** What the requester wrote to the colleague. */
  message: z.string().nullable(),
  status: ShiftSwapStatusSchema,
  /** When it stopped being `proposed`: answered, withdrawn or lapsed; `null` while proposed. */
  resolvedAt: z.iso.datetime().nullable(),
  /** When the owner or an active manager reverted it; `resolvedAt` keeps the acceptance. */
  revertedAt: z.iso.datetime().nullable(),
  /**
   * `withdrawn` by the owner or an active manager rather than by its requester: the screen says « retirée par
   * l'agence », never by whom. `false` for any other status.
   */
  withdrawnByAgency: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type ShiftSwapRequest = z.infer<typeof ShiftSwapRequestSchema>;

/**
 * `GET /v1/scheduling/swap-requests`: the proposed swaps, and those resolved in the last `SHIFT_SWAP_RECENT_DAYS`. A
 * member reads the swaps they make or receive; the owner and an active manager read every one, which is how they hear
 * of them until EQ-12 notifies. `shifts` holds the shifts the swaps name that the reader may read now, as they are
 * (cancelled ones aside): both shifts of a proposed or accepted swap, and otherwise the reader's own (every one for
 * the owner and an active manager). An ended swap is said from what it noted, never from its shift. `accounts` holds
 * the accounts of every creator the swaps name (her name is there even when no shift is), and `members` every member
 * they name, by display name and colour only: a chatter's policies show them their own row alone, so the server reads
 * these three columns outside them, for the members of the swaps the policies let the reader read (ADR 0031).
 */
export const ShiftSwapListSchema = z.object({
  swapRequests: z.array(ShiftSwapRequestSchema),
  shifts: z.array(ShiftSchema),
  accounts: z.array(PlanningAccountSchema),
  members: z.array(PlanningMemberSchema),
});
export type ShiftSwapList = z.infer<typeof ShiftSwapListSchema>;

/**
 * `GET /v1/scheduling/swap-candidates?shiftId=…` (the shift's member, for a shift of theirs that has not started): the
 * colleagues who could take it, active members who work on its creator and are not on an approved leave then, with
 * their shifts that have not started, within `SHIFT_TEMPLATE_HORIZON_DAYS`, on creators the requester works on (what
 * an exchange could give back). A display name, a colour and shifts: the one door through which a chatter reads a
 * colleague's planning (ADR 0031), never a rate, a country or a status. A leave is never said, only its effect (the
 * colleague is not listed). `freeThen` is `false` when the colleague already has a shift that overlaps the one offered,
 * on any creator: they can only take it in exchange for that shift, when it is in `shifts`; which shift and where is
 * never said. The server checks under the policies that the shift is the reader's and ahead, then reads the rest
 * outside them, bounded to these fields.
 */
export const SwapCandidatesQuerySchema = z.object({ shiftId: ShiftIdSchema });

export const SwapCandidatesSchema = z.object({
  candidates: z.array(
    z.object({ member: PlanningMemberSchema, freeThen: z.boolean(), shifts: z.array(ShiftSchema) }),
  ),
  accounts: z.array(PlanningAccountSchema),
});
export type SwapCandidates = z.infer<typeof SwapCandidatesSchema>;

/**
 * `POST /v1/scheduling/swap-requests` (the member whose shift it is) → 201 `ShiftSwapRequestSchema`, or 200 when the
 * same `id` was already recorded with the same values (`shift_swap_conflict` otherwise). The shift is theirs and has
 * not started (`shift_not_found`, `shift_started_conflict`); the colleague is someone else (`shift_swap_self_invalid`),
 * `active` (`member_left_conflict`) and works on the shift's creator; with `targetShiftId`, that shift is the
 * colleague's, has not started, and its creator is one the requester works on (`member_creator_conflict` otherwise).
 * Nobody would end up on two shifts at once (`shift_member_conflict`): the colleague has no other shift that overlaps
 * the one offered, on any creator (no `details.shiftId`, the shift is not the requester's), and the shift given back
 * overlaps no other shift of the requester (`details.shiftId`, theirs). The same proposal still open answers 409
 * `shift_swap_open_conflict` with `details.shiftSwapRequestId`. Several colleagues may be asked for the same shift: the
 * first acceptance wins, the others lapse.
 */
export const CreateShiftSwapRequestBodySchema = z.object({
  id: ShiftSwapRequestIdSchema,
  shiftId: ShiftIdSchema,
  targetMemberId: TeamMemberIdSchema,
  targetShiftId: ShiftIdSchema.nullable(),
  message: NoteSchema,
});
export type CreateShiftSwapRequestBody = z.input<typeof CreateShiftSwapRequestBodySchema>;

/**
 * `POST /v1/scheduling/swap-requests/:shiftSwapRequestId/answer` (the colleague asked, alone) → `ShiftSwapRequestSchema`.
 * Only a proposed swap is answered (`shift_swap_answered_conflict`). Accepting moves both shifts in one transaction,
 * under the rules of a shift set by hand: neither has started nor changed hands or hours since the proposal (otherwise the swap
 * lapses and answers 409 `shift_swap_lapsed_conflict`), and the move puts nobody on two shifts at once, no account under
 * two members, no shift on a member on an approved leave (`shift_member_conflict`, `shift_account_conflict`,
 * `member_on_leave_conflict`, without `details` when the leave is the requester's, and the swap stays proposed).
 * `shift_member_conflict` names in `details.shiftId` only a shift of the colleague's own: when the shift in the way is
 * the requester's, it comes without `details`, since a colleague's shift is never named (ADR 0031). The other
 * proposals on these shifts can no longer be accepted, and lapse just after (ADR 0031).
 */
export const AnswerShiftSwapRequestBodySchema = z.object({ answer: z.enum(['accept', 'decline']) });
export type AnswerShiftSwapRequestBody = z.infer<typeof AnswerShiftSwapRequestBodySchema>;

/*
 * `DELETE /v1/scheduling/swap-requests/:shiftSwapRequestId` → 204. The requester, the owner or an active manager
 * withdraws a proposed swap. The owner or an active manager reverts an accepted one while neither shift has started and
 * both are still with the members the swap gave them to (`shift_swap_revert_conflict` otherwise): each shift goes back,
 * under the same rules as an acceptance. A swap in any other state answers `shift_swap_answered_conflict`; the
 * colleague asked never deletes one, they decline it.
 */

/**
 * The error codes of `/v1/scheduling`, for the screens to say them in French (the suffix gives the status, api.md):
 * `shift_not_found` 404 ; `shift_template_not_found` 404 ; `member_not_found` 404 ; `creator_not_found` 404 ;
 * `platform_account_not_found` 404, an account that is not this creator's ; `member_left_conflict` 409, a member who
 * is not `active` gets no shift ; `member_creator_conflict` 409, the member does not work on this creator ;
 * `member_not_joined_conflict` 409, a shift that starts before the member's `joinedOn`, in their zone (`details.joinedOn`) ;
 * `shift_member_conflict` 409, the member already has a shift then ; `shift_account_conflict` 409, the account already
 * has a member then (both with `details.shiftId`, the shift in the way) ; `shift_ended_conflict` 409, a shift that
 * has ended, or a new one that would end at or before now ; `shift_started_conflict` 409, a change other than an
 * earlier end on a shift under way ; `shift_range_invalid` 400, an end at or before the start, a shift longer than
 * `SHIFT_MAX_MINUTES`, or an instant that does not fall on a minute ; `planning_range_invalid` 400,
 * `to` at or before `from`, or more than `PLANNING_MAX_DAYS` (`LEAVE_QUERY_MAX_DAYS` for the leaves) ;
 * `shift_template_date_invalid` 400, a template that starts before today. Leaves and swaps (ADR 0031) :
 * `member_on_leave_conflict` 409, a shift on a member during their approved leave ; `leave_request_not_found` 404 ;
 * `leave_request_conflict` 409, the same `id` with other values ; `leave_overlap_conflict` 409, another pending or
 * approved leave of the member then (`details.leaveRequestId`) ; `leave_decided_conflict` 409, a request no longer
 * pending, or a leave that cannot be cancelled any more ; `leave_shifts_conflict` 409, shifts still on the member during
 * the leave (`details.shiftIds`) ; `leave_own_decision_forbidden` 403, a manager deciding their own leave ; `leave_date_invalid` 400, a leave that starts
 * before today in the member's zone ; `shift_swap_not_found` 404 ; `shift_swap_conflict` 409, the same `id` with other
 * values ; `shift_swap_open_conflict` 409, the same proposal still open (`details.shiftSwapRequestId`) ;
 * `shift_swap_answered_conflict` 409, a swap no longer proposed ; `shift_swap_lapsed_conflict` 409, a shift started,
 * was cancelled, or changed hands or hours since the proposal ; `shift_swap_revert_conflict` 409, an accepted swap that can no
 * longer go back ; `shift_swap_self_invalid` 400, a swap with oneself.
 */
export const SCHEDULING_ERROR_CODES = [
  'shift_not_found',
  'shift_template_not_found',
  'member_not_found',
  'creator_not_found',
  'platform_account_not_found',
  'member_left_conflict',
  'member_creator_conflict',
  'member_not_joined_conflict',
  'shift_member_conflict',
  'shift_account_conflict',
  'shift_ended_conflict',
  'shift_started_conflict',
  'shift_range_invalid',
  'planning_range_invalid',
  'shift_template_date_invalid',
  'member_on_leave_conflict',
  'leave_request_not_found',
  'leave_request_conflict',
  'leave_overlap_conflict',
  'leave_decided_conflict',
  'leave_shifts_conflict',
  'leave_own_decision_forbidden',
  'leave_date_invalid',
  'shift_swap_not_found',
  'shift_swap_conflict',
  'shift_swap_open_conflict',
  'shift_swap_answered_conflict',
  'shift_swap_lapsed_conflict',
  'shift_swap_revert_conflict',
  'shift_swap_self_invalid',
] as const;
export type SchedulingErrorCode = (typeof SCHEDULING_ERROR_CODES)[number];
