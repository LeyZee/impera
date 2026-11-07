import {
  CommissionPresetIdSchema,
  CommissionRateIdSchema,
  MemberRoleIdSchema,
  newId,
  payPeriodOfDay,
  TeamMemberIdSchema,
  TeamMemberNoteIdSchema,
  UserIdSchema,
  type CommissionPreset,
  type CommissionRate,
  type CreateCommissionPresetBody,
  type CreateTeamMemberBody,
  type CreatorId,
  type SetCommissionRateBody,
  type SetTeamRoleBody,
  type TeamMember,
  type TeamMemberId,
  type TeamMemberNote,
  type TeamMemberStatus,
  type TeamRoleChange,
  type UpdateTeamMemberBody,
  type UserId,
} from '@impera/contracts';

import { CommissionPresetNotFound, MemberNotFound } from '../domain/errors';
import {
  assertCreatorsExist,
  assertRoleStartsAPeriod,
  assertStartsAPeriod,
  assertStartsFromToday,
  calendarDayIn,
  normalizeEmail,
  presetsInForce,
  uniqueCreatorIds,
} from '../domain/members';
import type {
  Actor,
  CreatorRoster,
  InvitationLinkDirectory,
  NewMember,
  NewRate,
  PlatformAccountRef,
  TeamInvites,
  TeamStore,
} from '../domain/ports';

/** A member invited from a link proposal: the fields of Équipe › Membres, and the account (ADR 0076 § 3). */
export type InviteFromPlatform = CreateTeamMemberBody & { readonly account: PlatformAccountRef };

/** Équipe › Membres (EQ-01): reads for the owner and the managers, writes for the owner. */
export interface TeamService {
  members(actor: UserId): Promise<TeamMember[]>;
  member(actor: UserId, id: TeamMemberId): Promise<TeamMember>;
  addMember(actor: Actor, body: CreateTeamMemberBody): Promise<TeamMember>;
  /**
   * A member invited from a link proposal (ADR 0076 § 3), by the owner or an active manager within his
   * bounds, created and linked to his platform account by `invites` in one transaction. A preset is the one in force
   * today, as the screen offers it. Asked again for the same account, the member already invited.
   */
  inviteFromPlatform(actor: Actor, input: InviteFromPlatform, invites: TeamInvites): Promise<TeamMember>;
  updateMember(actor: Actor, id: TeamMemberId, body: UpdateTeamMemberBody): Promise<TeamMember>;
  changeStatus(actor: Actor, id: TeamMemberId, status: TeamMemberStatus): Promise<TeamMember>;
  setCommission(actor: Actor, id: TeamMemberId, body: SetCommissionRateBody): Promise<CommissionRate>;
  commissionHistory(actor: UserId, id: TeamMemberId): Promise<CommissionRate[]>;
  /** A change of role from the 1st or the 16th, today at the earliest (Charles, 28/10). */
  setRole(actor: Actor, id: TeamMemberId, body: SetTeamRoleBody): Promise<TeamRoleChange>;
  roleHistory(actor: UserId, id: TeamMemberId): Promise<TeamRoleChange[]>;
  /** The presets in force today, one per name. */
  presets(actor: UserId): Promise<CommissionPreset[]>;
  addPreset(actor: Actor, body: CreateCommissionPresetBody): Promise<CommissionPreset>;
  notes(actor: UserId, id: TeamMemberId): Promise<TeamMemberNote[]>;
  addNote(actor: Actor, id: TeamMemberId, body: string): Promise<TeamMemberNote>;
}

export interface TeamServiceOptions {
  /** The agency's time zone, where « today » is read (ADR 0023 § Paie; a setting of its own later). */
  readonly agencyTimeZone: string;
  readonly now?: () => Date;
}

export function createTeamService(
  store: TeamStore,
  roster: CreatorRoster,
  links: InvitationLinkDirectory,
  options: TeamServiceOptions,
): TeamService {
  const now = options.now ?? (() => new Date());
  const today = (): string => calendarDayIn(now(), options.agencyTimeZone);

  /** When each member's link out stops working (« Lien valable jusqu'à… », « Lien expiré »); `null` with none. */
  const withLinks = async (members: TeamMember[]): Promise<TeamMember[]> => {
    if (members.length === 0) return members;
    const live = await links.live(members.map((member) => member.id));
    return members.map((member) => ({
      ...member,
      invitationExpiresAt: live.get(member.id)?.expiresAt.toISOString() ?? null,
    }));
  };

  const read = async (actor: UserId, id: TeamMemberId): Promise<TeamMember> => {
    const member = await store.member(actor, id, today());
    if (member === null) throw new MemberNotFound();
    const [withLink] = await withLinks([member]);
    return withLink ?? member;
  };

  const knownCreators = async (ids: readonly CreatorId[]): Promise<CreatorId[]> => {
    const unique = uniqueCreatorIds(ids);
    if (unique.length > 0) assertCreatorsExist(unique, await roster.existing(unique));
    return unique;
  };

  /**
   * A preset becomes its rate of that row; a rate typed by hand stays as it is. `inForce`: only the presets offered
   * today, one per name (an invitation's, which an active manager may give: never an older, higher row of a name).
   */
  const resolveRate = async (
    actor: UserId,
    choice: CreateTeamMemberBody['commission'],
    teamShareBps: number | null,
    effectiveFrom: string,
    inForce = false,
  ): Promise<NewRate> => {
    const id = newId(CommissionRateIdSchema);
    if ('rateBps' in choice) {
      return { id, rateBps: choice.rateBps, teamShareBps, presetId: null, effectiveFrom };
    }
    const rows = await store.presets(actor);
    const offered = inForce ? presetsInForce(rows, today()) : rows;
    const preset = offered.find((row) => row.id === choice.presetId);
    if (preset === undefined) throw new CommissionPresetNotFound();
    return { id, rateBps: preset.rateBps, teamShareBps, presetId: preset.id, effectiveFrom };
  };

  /** The account, the record, the first rate and the first role of a member, as the body asks them. */
  const newMember = async (
    actor: UserId,
    body: CreateTeamMemberBody,
    inForce = false,
  ): Promise<NewMember> => ({
    id: newId(TeamMemberIdSchema),
    userId: newId(UserIdSchema),
    email: normalizeEmail(body.email),
    firstName: body.firstName,
    lastName: body.lastName,
    displayName: body.displayName,
    teamRole: body.teamRole,
    country: body.country,
    timeZone: body.timeZone,
    color: body.color,
    joinedOn: body.joinedOn,
    creatorIds: await knownCreators(body.creatorIds),
    // The first rate starts the day he joins: no day of his was worked before it.
    rate: await resolveRate(actor, body.commission, body.teamShareBps, body.joinedOn, inForce),
    // His first role too: whatever day he joins, a later change waits for the 1st or the 16th.
    roleId: newId(MemberRoleIdSchema),
  });

  return {
    members: async (actor) => withLinks(await store.members(actor, today())),
    member: read,

    addMember: async (actor, body) => {
      const member = await newMember(actor.userId, body);
      await store.create(actor, member);
      return read(actor.userId, member.id);
    },

    inviteFromPlatform: async (actor, input, invites) => {
      const { account, ...body } = input;
      const id = await invites.invite(actor, await newMember(actor.userId, body, true), account);
      return read(actor.userId, id);
    },

    updateMember: async (actor, id, body) => {
      const { creatorIds, ...fields } = body;
      await store.update(actor, id, {
        ...fields,
        ...(creatorIds !== undefined && { creatorIds: await knownCreators(creatorIds) }),
      });
      return read(actor.userId, id);
    },

    changeStatus: async (actor, id, status) => {
      // The day he leaves is the day it is said, never typed: a departure is never back-dated (EQ-14).
      await store.changeStatus(actor, id, status, today());
      return read(actor.userId, id);
    },

    setCommission: async (actor, id, body) => {
      const day = today();
      assertStartsAPeriod(body.effectiveFrom, day);
      // A rate from a later period changes nothing computed yet: only one from today, the 1st or the 16th, does.
      const running = payPeriodOfDay(day);
      return store.addRate(
        actor,
        id,
        await resolveRate(actor.userId, body.commission, body.teamShareBps, body.effectiveFrom),
        payPeriodOfDay(body.effectiveFrom) === running ? running : null,
      );
    },

    commissionHistory: async (actor, id) => {
      const rates = await store.rates(actor, id);
      if (rates === null) throw new MemberNotFound();
      return rates;
    },

    setRole: async (actor, id, body) => {
      const day = today();
      assertRoleStartsAPeriod(body.effectiveFrom, day);
      return store.addRole(
        actor,
        id,
        { id: newId(MemberRoleIdSchema), ...body },
        { today: day, running: payPeriodOfDay(day) },
      );
    },

    roleHistory: async (actor, id) => {
      const roles = await store.roles(actor, id);
      if (roles === null) throw new MemberNotFound();
      return roles;
    },

    presets: async (actor) => presetsInForce(await store.presets(actor), today()),

    addPreset: (actor, body) => {
      assertStartsFromToday(body.effectiveFrom, today());
      return store.addPreset(actor, { id: newId(CommissionPresetIdSchema), ...body });
    },

    notes: async (actor, id) => {
      const notes = await store.notes(actor, id);
      if (notes === null) throw new MemberNotFound();
      return notes;
    },

    addNote: (actor, id, body) => store.addNote(actor, id, { id: newId(TeamMemberNoteIdSchema), body }),
  };
}
