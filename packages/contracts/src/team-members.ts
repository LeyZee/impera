import { z } from 'zod';

import {
  CommissionPresetIdSchema,
  CreatorIdSchema,
  TeamMemberIdSchema,
  TeamMemberNoteIdSchema,
  UserIdSchema,
} from './ids';
import { TimezoneSchema } from './persona';
import {
  BasisPointsSchema,
  CountryCodeSchema,
  KnownCountryCodeSchema,
  TeamMemberStatusSchema,
  TeamRoleSchema,
} from './team';

/**
 * Équipe › Membres (EQ-01, ADR 0023, ADR 0024), under `/v1/team`. Paid by commission only, never by the hour. The
 * e-mail stays in `user` (Better Auth): the add panel types it for the invitation, the server joins it on read.
 */

/** A calendar day, `YYYY-MM-DD`: an arrival, the first day of a rate. */
export const CalendarDaySchema = z.iso.date();

/** The member's colour on the planning, as `team_members_color_check` takes it: `#FF0000` is written `#ff0000`. */
export const MemberColorSchema = z
  .string()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, 'Une couleur s’écrit #rrggbb');

const NameSchema = z.string().trim().min(1).max(80);

/** A named rate the owner offers in one gesture (values are settings, never in the code). */
export const CommissionPresetSchema = z.object({
  id: CommissionPresetIdSchema,
  name: z.string().min(1).max(60),
  rateBps: BasisPointsSchema,
  effectiveFrom: CalendarDaySchema,
});
export type CommissionPreset = z.infer<typeof CommissionPresetSchema>;

/** `GET /v1/team/commission-presets`: the presets in force today, one per name. */
export const CommissionPresetListSchema = z.object({ presets: z.array(CommissionPresetSchema) });

/**
 * `POST /v1/team/commission-presets` (owner only, the database refuses anyone else) → `CommissionPresetSchema`: a new
 * preset, or a new rate for an existing name from a day on, never before today (`commission_date_invalid`). The members
 * already on the old rate keep it: their own rates are rows of their own.
 */
export const CreateCommissionPresetBodySchema = z.object({
  name: z.string().trim().min(1).max(60),
  rateBps: BasisPointsSchema,
  effectiveFrom: CalendarDaySchema,
});
export type CreateCommissionPresetBody = z.infer<typeof CreateCommissionPresetBodySchema>;

/**
 * A member's rate from a day on (`member_commission_rates`, added only). `teamShareBps` is a manager's share of the
 * team's net, `null` for a chatter.
 */
export const CommissionRateSchema = z.object({
  rateBps: BasisPointsSchema,
  teamShareBps: BasisPointsSchema.nullable(),
  presetId: CommissionPresetIdSchema.nullable(),
  effectiveFrom: CalendarDaySchema,
});
export type CommissionRate = z.infer<typeof CommissionRateSchema>;

/** One member as Équipe › Membres shows him: an owner and an active manager read everyone, a member his own row. */
export const TeamMemberSchema = z.object({
  id: TeamMemberIdSchema,
  userId: UserIdSchema,
  email: z.email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  displayName: z.string().min(1),
  teamRole: TeamRoleSchema,
  status: TeamMemberStatusSchema,
  country: CountryCodeSchema,
  timeZone: TimezoneSchema,
  color: MemberColorSchema.nullable(),
  joinedOn: CalendarDaySchema,
  creatorIds: z.array(CreatorIdSchema),
  /** The rate in force today; `null` before the first one starts. */
  commission: CommissionRateSchema.nullable(),
  /** No password yet: the invitation link has not been used (EQ-10). */
  invitationPending: z.boolean(),
  /**
   * When the pending link stops working, for « Lien valable jusqu'à… » or « Lien expiré » ; `null` with no link out
   * (none made yet, or already used).
   */
  invitationExpiresAt: z.iso.datetime().nullable(),
});
export type TeamMember = z.infer<typeof TeamMemberSchema>;

/** `GET /v1/team/members`: chatters and managers alike, the screen splits them. */
export const TeamMemberListSchema = z.object({ members: z.array(TeamMemberSchema) });

/**
 * The rate given when adding a member, or later from a day on: a preset, or typed by hand. Each branch is strict, so
 * a body that sends both is refused instead of losing one of them.
 */
export const CommissionChoiceSchema = z.union([
  z.strictObject({ presetId: CommissionPresetIdSchema }),
  z.strictObject({ rateBps: BasisPointsSchema }),
]);

/**
 * `POST /v1/team/members` (owner) → `TeamMemberSchema`: creates the account (no password), the record and the first
 * rate, from `joinedOn`, in one transaction; 409 `member_conflict` when an account already has this e-mail. The panel then asks
 * `POST …/:memberId/invitation-link` for the link to share (EQ-10). The time zone the screen offers follows the
 * country, and stays editable.
 */
export const CreateTeamMemberBodySchema = z
  .object({
    email: z.email(),
    firstName: NameSchema,
    lastName: NameSchema,
    displayName: NameSchema,
    teamRole: TeamRoleSchema,
    country: KnownCountryCodeSchema,
    timeZone: TimezoneSchema,
    color: MemberColorSchema.nullable().default(null),
    joinedOn: CalendarDaySchema,
    creatorIds: z.array(CreatorIdSchema).default([]),
    commission: CommissionChoiceSchema,
    /** A manager's share of the team's net; refused for a chatter. */
    teamShareBps: BasisPointsSchema.nullable().default(null),
  })
  .refine((body) => body.teamRole === 'manager' || body.teamShareBps === null, {
    message: 'Seul un manager a une part du net de l’équipe',
    path: ['teamShareBps'],
  });
export type CreateTeamMemberBody = z.infer<typeof CreateTeamMemberBodySchema>;

/**
 * `PATCH /v1/team/members/:memberId` (owner): what changes; the rest stays. Status, rate and role have their own
 * routes: a role is dated (`SetTeamRoleBodySchema`), so a `teamRole` here is refused (`request_invalid`), like any key
 * this route does not know.
 */
export const UpdateTeamMemberBodySchema = z
  .strictObject({
    firstName: NameSchema,
    lastName: NameSchema,
    displayName: NameSchema,
    country: KnownCountryCodeSchema,
    timeZone: TimezoneSchema,
    color: MemberColorSchema.nullable(),
    creatorIds: z.array(CreatorIdSchema),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Rien à changer');
export type UpdateTeamMemberBody = z.infer<typeof UpdateTeamMemberBodySchema>;

/**
 * `PUT /v1/team/members/:memberId/status` (owner): `left` empties the member's creators and ends his sessions in the
 * same transaction; the whole departure is EQ-14.
 */
export const ChangeTeamMemberStatusBodySchema = z.object({ status: TeamMemberStatusSchema });

/**
 * `POST /v1/team/members/:memberId/commission` (owner only, the database refuses anyone else): from the first day of a
 * period, the 1st or the 16th of a month, never before today (`commission_date_invalid`): a period is paid at one rate
 * (Charles, 28/10). The first rate, given with the member, starts the day he joins. A share of the team's net for a chatter answers `team_share_invalid`; a second rate from the same day
 * answers `commission_rate_conflict`, since a rate is never changed.
 */
export const SetCommissionRateBodySchema = z.object({
  commission: CommissionChoiceSchema,
  teamShareBps: BasisPointsSchema.nullable().default(null),
  effectiveFrom: CalendarDaySchema,
});
export type SetCommissionRateBody = z.infer<typeof SetCommissionRateBodySchema>;

/** `GET /v1/team/members/:memberId/commission`: every rate, newest first. */
export const CommissionRateHistorySchema = z.object({ rates: z.array(CommissionRateSchema) });

/**
 * A member's team role from a day on (`member_roles`, added only): the role of a day is the latest one effective on
 * that day. The first one starts the day he joins.
 */
export const TeamRoleChangeSchema = z.object({
  teamRole: TeamRoleSchema,
  effectiveFrom: CalendarDaySchema,
});
export type TeamRoleChange = z.infer<typeof TeamRoleChangeSchema>;

/**
 * `POST /v1/team/members/:memberId/role` (owner only, the database refuses anyone else) → `TeamRoleChangeSchema`: a
 * chatter becomes a manager, or the other way round, from the first day of a period, the 1st or the 16th of a month,
 * never before today (`role_date_invalid`): a period is paid under one role, its team share and its collective goal
 * whole (Charles, 28/10). From today, his access changes at once and pay computes the running period again; from a
 * later day, both follow on that day. A second role from the same day answers `role_change_conflict`, since a role is
 * never changed. A manager made a chatter keeps his rate rows: pay gives no team share to a chatter.
 */
export const SetTeamRoleBodySchema = z.object({
  teamRole: TeamRoleSchema,
  effectiveFrom: CalendarDaySchema,
});
export type SetTeamRoleBody = z.infer<typeof SetTeamRoleBodySchema>;

/** `GET /v1/team/members/:memberId/role`: every role, newest first, those still to come included. */
export const TeamRoleHistorySchema = z.object({ roles: z.array(TeamRoleChangeSchema) });

/** An internal note, read by the owner and the active managers only, never by the member it is about. */
export const TeamMemberNoteSchema = z.object({
  id: TeamMemberNoteIdSchema,
  body: z.string().min(1).max(2000),
  authorName: z.string().min(1),
  createdAt: z.iso.datetime(),
});
export type TeamMemberNote = z.infer<typeof TeamMemberNoteSchema>;

/** `GET /v1/team/members/:memberId/notes` (newest first) and `POST` with `AddTeamMemberNoteBodySchema`. */
export const TeamMemberNoteListSchema = z.object({ notes: z.array(TeamMemberNoteSchema) });
export const AddTeamMemberNoteBodySchema = z.object({ body: z.string().trim().min(1).max(2000) });

/**
 * The error codes of `/v1/team`, for the screen to say them in French (the suffix gives the status, api.md):
 * `member_not_found` 404 ; `member_conflict` 409, an account already has this e-mail ; `member_left_conflict` 409, a
 * member who left is not changed any more (EQ-14) ; `commission_preset_not_found` 404 ; `commission_date_invalid` 400,
 * a rate or a preset that starts before today, or a member's new rate that does not start on the 1st or the 16th ; `commission_preset_conflict` 409, this name already has a rate from
 * that day ; `commission_rate_conflict` 409, this member already has a rate from that day ; `team_share_invalid` 400,
 * a share for a chatter ; `creator_not_found` 404, an unknown creator in `creatorIds` ; `role_date_invalid` 400, a
 * change of role that does not start on the 1st or the 16th, or starts before today ; `role_change_conflict` 409, this
 * member already has a role from that day.
 */
export const TEAM_MEMBER_ERROR_CODES = [
  'member_not_found',
  'member_conflict',
  'member_left_conflict',
  'commission_preset_not_found',
  'commission_preset_conflict',
  'commission_rate_conflict',
  'commission_date_invalid',
  'team_share_invalid',
  'creator_not_found',
  'role_date_invalid',
  'role_change_conflict',
] as const;
export type TeamMemberErrorCode = (typeof TEAM_MEMBER_ERROR_CODES)[number];
