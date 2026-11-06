import {
  creatorNameKey,
  type PlatformChatter,
  type TeamImportAction,
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
  after: { readonly kind: 'member'; readonly memberId: TeamMemberId } | { readonly kind: 'agent' | 'none' },
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
