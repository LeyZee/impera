import { z } from 'zod';

import { AgentHoursSchema } from './agent-hours';
import { AgentModeSchema } from './dashboard';
import { CreatorIdSchema, PlatformAccountIdSchema, TeamMemberIdSchema } from './ids';
import {
  PLANNING_MAX_DAYS,
  PlanningAccountSchema,
  PlanningMemberSchema,
  SchedulingSettingsSchema,
} from './scheduling';

/**
 * The shift calendar (CR-12, ADR 0045 § 1 and § 2, ADR 0048): who chats when, for everyone of the team.
 *
 * `GET /v1/scheduling/calendar?from=…&to=…[&creatorId=…][&memberId=…]`, a window of `PLANNING_MAX_DAYS` at most (a
 * month view needs 6 weeks). The database decides what each reader gets (`calendar_shifts`, `calendar_agent`):
 * - `agency`, the owner or an active manager: every shift, the agent of each creator, and `agency` (the accounts,
 *   the créneaux to fill, those the agent holds alone, each member's hours and the coverage of each account);
 * - `team`, an active chatter: every shift of the team and the agent, in reading, nothing more;
 * - `own`, a member who is not active (on leave, sick, travelling, suspended): his own shifts only, no agent.
 * A shift says who, on which creator, and when: never a leave, a rate, a country, a status or a report. The filters
 * narrow what is sent back, never what the reader may read.
 */
export const CALENDAR_VIEWS = ['agency', 'team', 'own'] as const;
export const CalendarViewSchema = z.enum(CALENDAR_VIEWS);
export type CalendarView = z.infer<typeof CalendarViewSchema>;

export const CalendarQuerySchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  creatorId: CreatorIdSchema.optional(),
  memberId: TeamMemberIdSchema.optional(),
});
export type CalendarQuery = z.infer<typeof CalendarQuerySchema>;

/** A shift as the calendar shows it: who, on which creator, and when. No id: the calendar reads, it never acts. */
export const CalendarShiftSchema = z.object({
  memberId: TeamMemberIdSchema,
  creatorId: CreatorIdSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
});
export type CalendarShift = z.infer<typeof CalendarShiftSchema>;

/**
 * The agent on one creator (ADR 0048 § 3): her clock, the mode in force (`stop` under the global stop or hers) and
 * when he answers (P3-14). `answers` is that, read on her clock within the window asked: the stretches he answers, in
 * order and joined, none under `stop`; the screens draw from it, so that no slot is read on a clock twice. Never the
 * follow-up quiet hours, the night, the persona, a prompt, the budget or a figure.
 */
export const CalendarAgentSchema = z.object({
  creatorId: CreatorIdSchema,
  timeZone: z.string().min(1),
  mode: AgentModeSchema,
  reply: AgentHoursSchema.shape.reply,
  answers: z.array(z.object({ startsAt: z.iso.datetime(), endsAt: z.iso.datetime() })),
});
export type CalendarAgent = z.infer<typeof CalendarAgentSchema>;

/**
 * A créneau of the grid on one account, at the agency's hours (`scheduling_settings`), with its stretches ahead that
 * no shift covers (`open`, in order, never empty): a créneau a shift holds in part is still to fill (EQ-01).
 */
export const CalendarSlotSchema = z.object({
  platformAccountId: PlatformAccountIdSchema,
  creatorId: CreatorIdSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  open: z.array(z.object({ startsAt: z.iso.datetime(), endsAt: z.iso.datetime() })).min(1),
});
export type CalendarSlot = z.infer<typeof CalendarSlotSchema>;

/** A member's planned hours in the window, in minutes (ADR 0045 § 1): the agency's alone. */
export const CalendarWorkloadSchema = z.object({
  memberId: TeamMemberIdSchema,
  minutes: z.number().int().min(0),
});

export type CalendarWorkload = z.infer<typeof CalendarWorkloadSchema>;

/**
 * « Couverture des comptes » (ADR 0048 § 1): how one account was held over the window, in minutes. The four add up to
 * the window's length (a week makes 168 h, 167 or 169 the week of a change of time). `agentAlone` counts Automatique
 * only: in Copilote each draft waits for a human, so an account with nobody on it is held by nobody.
 */
export const CalendarCoverageSchema = z.object({
  platformAccountId: PlatformAccountIdSchema,
  withAgent: z.number().int().min(0),
  chatterAlone: z.number().int().min(0),
  agentAlone: z.number().int().min(0),
  nobody: z.number().int().min(0),
});
export type CalendarCoverage = z.infer<typeof CalendarCoverageSchema>;

export const CalendarSchema = z.object({
  view: CalendarViewSchema,
  settings: SchedulingSettingsSchema,
  /** The creators the calendar names (every creator for `agency` and `team`), with their names for the rows. */
  creators: z.array(z.object({ id: CreatorIdSchema, name: z.string().min(1) })),
  /** The members named by `shifts`: id, name in the team and colour, nothing else. */
  members: z.array(PlanningMemberSchema),
  shifts: z.array(CalendarShiftSchema),
  /** Empty for `own`. */
  agent: z.array(CalendarAgentSchema),
  /** `null` but for `agency`. */
  agency: z
    .object({
      accounts: z.array(PlanningAccountSchema),
      /**
       * The créneaux ahead with a stretch nobody holds (`slotsToFill`, the one count Planning and EQ-14's departure
       * alert read too). A créneau without a shift whose open stretches the agent answers in Automatique is not one of
       * them (ADR 0048 § 1): it is in `aiAlone`.
       */
      toFill: z.array(CalendarSlotSchema),
      aiAlone: z.array(CalendarSlotSchema),
      workload: z.array(CalendarWorkloadSchema),
      coverage: z.array(CalendarCoverageSchema),
    })
    .nullable(),
});
export type Calendar = z.infer<typeof CalendarSchema>;

/** The longest window the calendar reads, in days: the 6 weeks of a month view. */
export const CALENDAR_MAX_DAYS = PLANNING_MAX_DAYS;

/**
 * The calendar link (CR-12, ADR 0045 § 5): a secret, read-only, revocable iCal address of the member's own shifts,
 * to add to Apple Agenda or Google Agenda. Only its SHA-256 is kept, so the address is given once, when it is made:
 * - `GET /v1/scheduling/calendar-link`: whether the account has a live link, and since when, never the address;
 * - `POST /v1/scheduling/calendar-link`: a new address, which revokes the one before;
 * - `DELETE /v1/scheduling/calendar-link`: the live address stops answering;
 * - `GET /v1/calendar-feed/<token>.ics`, without a session: the feed, `text/calendar`, the slot, the creator and the
 *   member's name in the team and nothing else; an unknown, revoked or departed link answers one same 404.
 */
export const CALENDAR_FEED_PREFIX = '/v1/calendar-feed/';
/** 256 random bits, base64url: 43 characters. */
export const CalendarLinkTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const CalendarLinkStateSchema = z.object({
  link: z.object({ createdAt: z.iso.datetime() }).nullable(),
});
export type CalendarLinkState = z.infer<typeof CalendarLinkStateSchema>;

/** The new address, as a path on the dashboard's origin: the token leaves the server once, here. */
export const CalendarLinkCreatedSchema = z.object({
  path: z.string().regex(/^\/v1\/calendar-feed\/[A-Za-z0-9_-]{43}\.ics$/),
  createdAt: z.iso.datetime(),
});
export type CalendarLinkCreated = z.infer<typeof CalendarLinkCreatedSchema>;
