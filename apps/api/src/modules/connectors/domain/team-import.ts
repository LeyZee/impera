import {
  creatorNameKey,
  type CreatorId,
  type Platform,
  type PlatformChatter,
  type SalesFeedErrorKind,
  type TeamImportCounts,
  type TeamImportAction,
  type TeamImportOverview,
  type TeamImportRow,
  type TeamImportSuggestion,
  type TeamMemberId,
} from '@impera/contracts';

/**
 * The team imported from a platform after review (ADR 0076): what the review proposes, row by row, and what a viewer
 * may do on each. Pure: the live list, the links, the decisions and the members come in; nothing is written.
 */

export interface ImportableMember {
  readonly memberId: TeamMemberId;
  readonly displayName: string;
  readonly firstName: string;
  readonly lastName: string;
  /** His account's login e-mail. */
  readonly email: string;
  /** `left` members are never proposed. */
  readonly active: boolean;
}

/** Who looks at the review: the owner, or an active manager with his own member record. */
export type TeamImportViewer =
  { readonly kind: 'owner' } | { readonly kind: 'manager'; readonly memberId: TeamMemberId };

export interface SuggestionInputs {
  /** The platform's account of the captured session's « bot » member, when known (ADR 0050 § 5). */
  readonly sessionChatterId: string | null;
  readonly members: readonly ImportableMember[];
}

export interface Proposal {
  readonly suggestion: TeamImportSuggestion;
  readonly preselected: boolean;
}

const emailKey = (email: string): string => email.trim().toLowerCase();
const personKey = (first: string, last: string): string => creatorNameKey(`${first} ${last}`);

/** A name read as the agent's when the captured session's account is not known yet: « bot », any case or accent. */
const isBotName = (chatter: PlatformChatter): boolean =>
  creatorNameKey(`${chatter.firstName} ${chatter.lastName}`) === 'bot';

/**
 * The proposal for one account without a link and not dismissed (ADR 0076 § 1), in this order: the same e-mail, the
 * captured session's account or an API key's bot, the same first and last names, then an invitation for an agency
 * member with an e-mail, else nobody. A unique match is ticked in advance; two members of the same name, or a name only
 * read as « bot », are proposed unticked. A provider's account (`isExternal`) is never invited (§ 2).
 */
export function proposeFor(chatter: PlatformChatter, inputs: SuggestionInputs): Proposal {
  const active = inputs.members.filter((member) => member.active);
  if (chatter.email !== null && !chatter.isExternal) {
    const key = emailKey(chatter.email);
    const same = active.find((member) => emailKey(member.email) === key);
    if (same !== undefined) {
      return {
        suggestion: {
          kind: 'member',
          memberId: same.memberId,
          memberDisplayName: same.displayName,
          match: 'email',
        },
        preselected: true,
      };
    }
  }
  if (inputs.sessionChatterId !== null && chatter.platformChatterId === inputs.sessionChatterId) {
    return { suggestion: { kind: 'agent', match: 'session' }, preselected: true };
  }
  if (chatter.isBot) return { suggestion: { kind: 'none' }, preselected: true };
  const name = personKey(chatter.firstName, chatter.lastName);
  const named = active.filter((member) => personKey(member.firstName, member.lastName) === name);
  const [first] = named;
  if (first !== undefined) {
    return {
      suggestion: {
        kind: 'member',
        memberId: first.memberId,
        memberDisplayName: first.displayName,
        match: 'name',
      },
      preselected: named.length === 1,
    };
  }
  if (inputs.sessionChatterId === null && isBotName(chatter)) {
    return { suggestion: { kind: 'agent', match: 'name' }, preselected: false };
  }
  if (!chatter.isExternal && chatter.email !== null) {
    return { suggestion: { kind: 'invite' }, preselected: false };
  }
  return { suggestion: { kind: 'none' }, preselected: false };
}

export interface RowRights {
  readonly chatter: PlatformChatter;
  /** The member the account is linked to now, `null` when none. */
  readonly linkedMemberId: TeamMemberId | null;
  readonly dismissed: boolean;
}

/**
 * What a viewer may do on a row (ADR 0076 § 2, § 3, § 4). The owner does everything but invite a provider. A manager
 * does nothing on a row linked to his own record, never links a provider to a member, and invites only an agency
 * member with an e-mail; the server checks again on each write, whatever the screen sent.
 */
export function actionsFor(row: RowRights, viewer: TeamImportViewer): TeamImportAction[] {
  if (viewer.kind === 'manager' && row.linkedMemberId === viewer.memberId) return [];
  const actions: TeamImportAction[] = [];
  if (viewer.kind === 'owner' || !row.chatter.isExternal) actions.push('link_member');
  actions.push('link_agent', 'link_none');
  if (row.linkedMemberId === null && !row.chatter.isExternal && row.chatter.email !== null) {
    actions.push('invite');
  }
  if (row.linkedMemberId === null) actions.push('dismiss');
  return actions;
}

export type LinkRefusal = 'own_link' | 'external_owner_only';

/**
 * Whether a viewer may move an account's link from `before` to `after` (ADR 0076 § 2, § 4): `null` when he may. The
 * database holds the same rule for his own record (migration 0132); this one answers in French, row by row.
 */
export function linkRefusal(
  viewer: TeamImportViewer,
  chatter: Pick<PlatformChatter, 'isExternal'>,
  before: TeamMemberId | null,
  after: { readonly kind: 'member'; readonly memberId: string } | { readonly kind: 'agent' | 'none' },
): LinkRefusal | null {
  if (viewer.kind === 'owner') return null;
  if (before === viewer.memberId) return 'own_link';
  if (after.kind === 'member' && after.memberId === viewer.memberId) return 'own_link';
  if (after.kind === 'member' && chatter.isExternal) return 'external_owner_only';
  return null;
}

/** A reading that lost more than half the accounts at once, or came back empty, is not believed (ADR 0076 § 5). */
export function isAbnormalReading(listed: number, known: number): boolean {
  if (known === 0) return false;
  return listed === 0 || listed * 2 < known;
}

/** A member as the review reads him: what the suggestions need, and his creators in Impera (§ 7). */
interface ReviewedMember extends ImportableMember {
  readonly creatorIds: readonly CreatorId[];
}

/** What the review keeps of an account besides its link (`sales_feed_chatter_reviews`). */
export interface ReviewState {
  readonly decision: 'none' | 'dismissed' | null;
  readonly decidedAt: Date | null;
  readonly platformRemovedAt: Date | null;
  readonly absentSince: Date | null;
  readonly isBot: boolean;
}

export type TeamLink =
  { readonly kind: 'member'; readonly memberId: TeamMemberId } | { readonly kind: 'agent' };

/** Everything the review reads in the base, in the viewer's own transaction. */
export interface TeamImportContext {
  readonly viewer: TeamImportViewer;
  readonly members: readonly ReviewedMember[];
  readonly links: ReadonlyMap<string, TeamLink>;
  readonly reviews: ReadonlyMap<string, ReviewState>;
  /** Each linked model of the platform: the creator it is linked to (ADR 0069). */
  readonly modelCreators: ReadonlyMap<
    string,
    { readonly creatorId: CreatorId; readonly displayName: string }
  >;
  /** Every creator's display name, for the gap of § 7. */
  readonly creatorNames: ReadonlyMap<CreatorId, string>;
  /** The last reading of the list was not believed (§ 5). */
  readonly abnormalRead: boolean;
}

export interface LiveTeam {
  /** The platform's team as read now; `null` when it could not be read (`listError`). */
  readonly chatters: readonly PlatformChatter[] | null;
  /** Each model's handle, by id, as the platform lists them now; an unknown one shows its id. */
  readonly handles: ReadonlyMap<string, string>;
  readonly listError: SalesFeedErrorKind | null;
  readonly sessionChatterId: string | null;
}

/** An account linked in Impera that the platform no longer lists: kept visible with its link, nothing of its person. */
const goneChatter = (platformChatterId: string): PlatformChatter => ({
  platformChatterId,
  firstName: '',
  lastName: '',
  email: null,
  role: '',
  isBot: false,
  isExternal: false,
  removedAt: null,
  platformModelIds: [],
});

/**
 * The review of a platform's team (ADR 0076): one row per account listed now, plus each linked account the platform
 * no longer lists, with its proposal, the viewer's actions, its models named, the gap with the member's creators and
 * the removal alert; the badges' counts with it.
 */
export function teamImportOverview(context: TeamImportContext, live: LiveTeam): TeamImportOverview {
  const members = new Map(context.members.map((member) => [member.memberId, member]));
  const listed = live.chatters ?? [];
  const seen = new Set(listed.map((chatter) => chatter.platformChatterId));
  const gone =
    live.chatters === null
      ? []
      : [...context.links.keys()].filter((id) => !seen.has(id)).map((id) => goneChatter(id));
  const rows = [...listed, ...gone].map((chatter) => rowOf(chatter, context, live, members));
  return {
    rows,
    newCount: rows.filter(
      (row) =>
        row.link === null && row.dismissedAt === null && !row.chatter.isBot && row.chatter.removedAt === null,
    ).length,
    removalCount: rows.filter((row) => row.removal !== null).length,
    abnormalRead: context.abnormalRead,
    listError: live.listError,
  };
}

function rowOf(
  chatter: PlatformChatter,
  context: TeamImportContext,
  live: LiveTeam,
  members: ReadonlyMap<TeamMemberId, ReviewedMember>,
): TeamImportRow {
  const id = chatter.platformChatterId;
  const link = context.links.get(id);
  const review = context.reviews.get(id);
  const linkedMember = link?.kind === 'member' ? members.get(link.memberId) : undefined;
  const dismissed = link === undefined && review?.decision === 'dismissed';
  const confirmedNone = link === undefined && review?.decision === 'none';
  const open = link === undefined && !dismissed && !confirmedNone;
  const proposal = open
    ? proposeFor(chatter, { sessionChatterId: live.sessionChatterId, members: context.members })
    : null;
  const models = chatter.platformModelIds.map((platformModelId) => {
    const creator = context.modelCreators.get(platformModelId);
    return {
      platformModelId,
      handle: live.handles.get(platformModelId) ?? platformModelId,
      creatorId: creator?.creatorId ?? null,
      creatorDisplayName: creator?.displayName ?? null,
    };
  });
  const onPlatform = new Set(models.flatMap((model) => (model.creatorId === null ? [] : [model.creatorId])));
  const mine = new Set(linkedMember?.creatorIds ?? []);
  const absent = review?.absentSince != null && !live.chatters?.some((one) => one.platformChatterId === id);
  const removedAt = chatter.removedAt ?? review?.platformRemovedAt?.toISOString() ?? null;
  return {
    chatter,
    link:
      link === undefined
        ? confirmedNone
          ? { kind: 'none' }
          : null
        : link.kind === 'agent'
          ? { kind: 'agent' }
          : { kind: 'member', memberId: link.memberId, memberDisplayName: linkedMember?.displayName ?? '' },
    dismissedAt: dismissed ? (review.decidedAt?.toISOString() ?? null) : null,
    suggestion: proposal?.suggestion ?? null,
    preselected: proposal?.preselected ?? false,
    actions: actionsFor(
      { chatter, linkedMemberId: link?.kind === 'member' ? link.memberId : null, dismissed },
      context.viewer,
    ),
    models,
    modelGap: {
      inImperaOnly:
        linkedMember === undefined
          ? []
          : linkedMember.creatorIds
              .filter((creatorId) => !onPlatform.has(creatorId))
              .map((creatorId) => ({
                creatorId,
                creatorDisplayName: context.creatorNames.get(creatorId) ?? '',
              })),
      onPlatformOnly:
        linkedMember === undefined
          ? []
          : models
              .filter((model) => model.creatorId === null || !mine.has(model.creatorId))
              .map((model) => model.handle),
    },
    removal:
      linkedMember?.active === true && (removedAt !== null || absent)
        ? { memberId: linkedMember.memberId, removedAt, absent }
        : null,
  };
}

export type TeamLinkOutcome =
  { readonly ok: true } | { readonly ok: false; readonly kind: LinkRefusal | 'member_unknown' };

export interface TeamLinkRequest {
  readonly platformChatterId: string;
  /** `null`: « Personne ». A member's id as the screen sent it, checked by the store. */
  readonly link: { readonly kind: 'member'; readonly memberId: string } | { readonly kind: 'agent' } | null;
  /** As the platform lists the account now (§ 2). */
  readonly isExternal: boolean;
}

/** The review's base, each call in the viewer's own `withMember`; `null` (or `forbidden`) for anyone but the owner or an active manager. */
export interface TeamImportStore {
  context(userId: string, platform: Platform): Promise<TeamImportContext | null>;
  /** What a successful reading of the list saw (§ 5): each account's state, the absent ones, and the reading believed or not. */
  recordReading(platform: Platform, listed: readonly PlatformChatter[], now: Date): Promise<void>;
  link(
    userId: string,
    platform: Platform,
    requests: readonly TeamLinkRequest[],
  ): Promise<TeamLinkOutcome[] | null>;
  dismiss(
    userId: string,
    platform: Platform,
    platformChatterId: string,
    dismissed: boolean,
  ): Promise<'done' | 'linked' | 'forbidden'>;
  counts(userId: string, platform: Platform): Promise<TeamImportCounts | null>;
}
