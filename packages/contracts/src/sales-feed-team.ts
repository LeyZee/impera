import { z } from 'zod';

import { PlatformSchema } from './enums';
import { CreatorIdSchema, TeamMemberIdSchema } from './ids';
import {
  LinkSalesFeedChatterBodySchema,
  PlatformChatterSchema,
  SalesFeedErrorKindSchema,
} from './sales-feed';
import { CalendarDaySchema, CreateTeamMemberBodySchema, TeamMemberSchema } from './team-members';

/**
 * The team imported from a platform after review (ADR 0076): each account of the platform's team with an action
 * proposed, that the owner or an active manager confirms. Nothing here ever links or creates on its own.
 */

/** What the import proposes for an account without a link (ADR 0076 § 1), in this order of precedence. */
export const TeamImportSuggestionSchema = z.discriminatedUnion('kind', [
  /** A team member with the same login e-mail (case-insensitive), else with the same first and last names. */
  z.object({
    kind: z.literal('member'),
    memberId: TeamMemberIdSchema,
    memberDisplayName: z.string(),
    match: z.enum(['email', 'name']),
    /**
     * The day the member left the team (ADR 0072), `null` while he is in it. Only an e-mail match proposes a member
     * who left, unticked: his sales from before that day count on his final statement, none after.
     */
    departedOn: CalendarDaySchema.nullable(),
  }),
  /** The agent: the account of the captured session's « bot » member, else an account named « bot » (unticked). */
  z.object({ kind: z.literal('agent'), match: z.enum(['session', 'name']) }),
  /** Nobody: an API key's bot (`isBot`), kept in the folded list. */
  z.object({ kind: z.literal('none') }),
  /**
   * An agency member with an e-mail nothing matches, the team's members who left included: an invitation, one row at
   * a time (§ 3). Never for an account the platform removed.
   */
  z.object({ kind: z.literal('invite') }),
]);
export type TeamImportSuggestion = z.infer<typeof TeamImportSuggestionSchema>;

/** What the viewer may do on a row; the server refuses anything else whatever the screen shows (§ 2, § 4). */
export const TeamImportActionSchema = z.enum(['link_member', 'link_agent', 'link_none', 'invite', 'dismiss']);
export type TeamImportAction = z.infer<typeof TeamImportActionSchema>;

/**
 * A model the account is assigned to on the platform (§ 7), named by the route: the creator linked to it (ADR 0069),
 * or `null` with the platform's handle (« Modèle Reveal non importée »).
 */
export const TeamImportModelSchema = z.object({
  platformModelId: z.string().min(1),
  handle: z.string(),
  creatorId: CreatorIdSchema.nullable(),
  creatorDisplayName: z.string().nullable(),
});
export type TeamImportModel = z.infer<typeof TeamImportModelSchema>;

/**
 * A removal on the platform while the linked member is still active in Impera (§ 5): a state, one per account, shown
 * as long as it lasts. `absent`: no longer listed after a complete successful reading.
 */
export const TeamImportRemovalSchema = z.object({
  memberId: TeamMemberIdSchema,
  removedAt: z.iso.datetime().nullable(),
  absent: z.boolean(),
});
export type TeamImportRemoval = z.infer<typeof TeamImportRemovalSchema>;

/**
 * A member's removal as Équipe shows it (§ 5: a pastille on his line of Membres, an amber line on his card): the
 * platform's account it comes from, read by the connectors module for the owner and the active managers.
 */
export const TeamPlatformRemovalSchema = TeamImportRemovalSchema.extend({
  platform: PlatformSchema,
  platformChatterId: z.string().min(1),
});
export type TeamPlatformRemoval = z.infer<typeof TeamPlatformRemovalSchema>;

/** `GET /v1/team/platform-removals`: the removals this viewer may see, none for a chatter. */
export const TeamPlatformRemovalListSchema = z.object({ removals: z.array(TeamPlatformRemovalSchema) });

export const TeamImportRowSchema = z.object({
  chatter: PlatformChatterSchema,
  /** The link in place (`sales_feed_chatters`), `null` when none. */
  link: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('member'), memberId: TeamMemberIdSchema, memberDisplayName: z.string() }),
      z.object({ kind: z.literal('agent') }),
      z.object({ kind: z.literal('none') }),
    ])
    .nullable(),
  /** Dismissed from the review: it does not come back, and can be taken back (§ 1). */
  dismissedAt: z.iso.datetime().nullable(),
  /**
   * The proposal, for a row without a link and not dismissed; `null` otherwise, and for an account the platform
   * removed whose e-mail is no member's.
   */
  suggestion: TeamImportSuggestionSchema.nullable(),
  /** Ticked in advance in the batch: a unique e-mail or name match, the captured session's bot, an API key's bot. */
  preselected: z.boolean(),
  /** What this viewer may do here; empty on a manager's own row (§ 4). */
  actions: z.array(TeamImportActionSchema),
  models: z.array(TeamImportModelSchema),
  /** The linked member's creators in Impera that the platform does not assign him, and the other way round (§ 7). */
  modelGap: z.object({
    inImperaOnly: z.array(z.object({ creatorId: CreatorIdSchema, creatorDisplayName: z.string() })),
    onPlatformOnly: z.array(z.string().min(1)),
  }),
  removal: TeamImportRemovalSchema.nullable(),
});
export type TeamImportRow = z.infer<typeof TeamImportRowSchema>;

/** `GET /v1/settings/sales-feeds/:platform/team` (owner, active manager). */
export const TeamImportOverviewSchema = z.object({
  rows: z.array(TeamImportRowSchema),
  /**
   * Accounts without a link, not dismissed, not an API key's bot and not removed from the platform: the « N nouveaux
   * chatteurs » badge (§ 6). A removed account stays listed, to be linked or dismissed, but is no newcomer: it is
   * never proposed for an invitation.
   */
  newCount: z.number().int().min(0),
  /** Accounts linked to an active member and removed or gone on the platform (§ 5). */
  removalCount: z.number().int().min(0),
  /** The list came back empty, or lost more than half its accounts at once: one alert, no removal believed (§ 5). */
  abnormalRead: z.boolean(),
  /** Why the live list is missing (no key, a refusal, an outage); the links stay. */
  listError: SalesFeedErrorKindSchema.nullable(),
});
export type TeamImportOverview = z.infer<typeof TeamImportOverviewSchema>;

/** `GET /v1/settings/sales-feeds/:platform/team/counts`: the badges, without reading the platform's list again. */
export const TeamImportCountsSchema = TeamImportOverviewSchema.pick({
  newCount: true,
  removalCount: true,
  abnormalRead: true,
});
export type TeamImportCounts = z.infer<typeof TeamImportCountsSchema>;

/** `POST /v1/settings/sales-feeds/:platform/team/links`: the batch (§ 1); an invitation is never in it. */
export const TeamImportLinksBodySchema = z.object({
  items: z
    .array(z.object({ platformChatterId: z.string().min(1).max(200), link: LinkSalesFeedChatterBodySchema }))
    .min(1)
    .max(200),
});
export type TeamImportLinksBody = z.infer<typeof TeamImportLinksBodySchema>;

/** Why one row of a batch was refused; the others go through. */
export const TeamImportRowErrorKindSchema = z.enum([
  /** A manager's own record, before or after (§ 4). */
  'own_link',
  /** A provider's account (`isExternal`) linked to a member: the owner's (§ 2, « ok prestataire-proprio »). */
  'external_owner_only',
  /** A provider's account given to the agent: it is linked to a member or to nobody (§ 2). */
  'external_no_agent',
  /** No longer in the platform's list. */
  'not_listed',
  /** No such team member, or one who left. */
  'member_unknown',
]);
export type TeamImportRowErrorKind = z.infer<typeof TeamImportRowErrorKindSchema>;

export const TeamImportLinksResultSchema = z.object({
  results: z.array(
    z.discriminatedUnion('ok', [
      z.object({ platformChatterId: z.string().min(1), ok: z.literal(true) }),
      z.object({
        platformChatterId: z.string().min(1),
        ok: z.literal(false),
        error: z.object({ kind: TeamImportRowErrorKindSchema, message: z.string() }),
      }),
    ]),
  ),
  overview: TeamImportOverviewSchema,
});
export type TeamImportLinksResult = z.infer<typeof TeamImportLinksResultSchema>;

/** `PUT /v1/settings/sales-feeds/:platform/team/:platformChatterId/dismissal`: dismissed, or taken back. */
export const TeamImportDismissalBodySchema = z.object({ dismissed: z.boolean() });
export type TeamImportDismissalBody = z.infer<typeof TeamImportDismissalBodySchema>;

/**
 * `POST /v1/settings/sales-feeds/:platform/team/:platformChatterId/invitation` (§ 3), password asked again: the member
 * and the link in one transaction. A manager: `teamRole` `chatter`, a `presetId` in effect, no team share, creators of
 * his own list only, else 403 `role_forbidden`. 201 with the member (played again: the same member); 409
 * `member_conflict` for an e-mail taken by another member, or an account already linked to another member. The
 * account is read live first: 403 `sales_feed_external_invite_forbidden` for a provider's (§ 2), 422
 * `sales_feed_chatter_unprocessable` for one the platform no longer lists or removed, 503 `sales_feed_list_unavailable` while
 * the list does not answer. Checked by `connectors`, made by `team` (ADR 0076 § 3).
 */
export const TeamImportInvitationBodySchema = CreateTeamMemberBodySchema;
export type TeamImportInvitationBody = z.infer<typeof TeamImportInvitationBodySchema>;
export const TeamImportInvitationResultSchema = TeamMemberSchema;
