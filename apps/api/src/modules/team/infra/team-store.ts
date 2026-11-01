import {
  AuditEntryIdSchema,
  CommissionPresetSchema,
  CommissionRateSchema,
  newId,
  TeamMemberNoteSchema,
  TeamMemberSchema,
  TeamMemberStatusSchema,
  TeamRoleChangeSchema,
  TeamRoleSchema,
  UserIdSchema,
  type CommissionRate,
  type PayPeriod,
  type TeamMember,
  type TeamMemberId,
  type TeamMemberStatus,
  type TeamRole,
  type TeamRoleChange,
  type UserId,
} from '@nirvana/contracts';
import { and, eq, inArray, schema, sql, withMember, type Database, type Transaction } from '@nirvana/db';

import {
  CommissionPresetConflict,
  CommissionRateConflict,
  MemberConflict,
  MemberNotFound,
  OwnNotesForbidden,
  RoleChangeConflict,
} from '../domain/errors';
import {
  assertOwnerScope,
  assertReadsTeam,
  assertStillInTeam,
  assertTeamShareFits,
  leavesTeam,
  rateInForce,
  roleOn,
} from '../domain/members';
import type { Actor, NewRate, NewRole, TeamStore } from '../domain/ports';

const {
  account,
  auditLog,
  commissionPresets,
  memberCommissionRates,
  memberRoles,
  session,
  teamMemberNotes,
  teamMembers,
  user,
} = schema;

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Error &&
  [error, error.cause].some((e) => typeof e === 'object' && e !== null && 'code' in e && e.code === '23505');

/** The write, with the unique violation it may hit (it aborts the transaction) turned into the module's conflict. */
async function orConflict<T>(write: Promise<T>, conflict: () => Error): Promise<T> {
  try {
    return await write;
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict();
    throw error;
  }
}

const rateColumns = {
  rateBps: memberCommissionRates.rateBps,
  teamShareBps: memberCommissionRates.teamShareBps,
  presetId: memberCommissionRates.presetId,
  effectiveFrom: memberCommissionRates.effectiveFrom,
};

/**
 * The records the policies let this transaction read (`member_read`: his own, or the whole team for the owner and an
 * active manager), each with the e-mail and the creators of his account, his rate of the day and whether his
 * password is still to choose.
 */
async function readMembers(tx: Transaction, today: string, id?: TeamMemberId): Promise<TeamMember[]> {
  const rows = await tx
    .select({
      id: teamMembers.id,
      userId: teamMembers.userId,
      email: user.email,
      firstName: teamMembers.firstName,
      lastName: teamMembers.lastName,
      displayName: teamMembers.displayName,
      teamRole: teamMembers.teamRole,
      status: teamMembers.status,
      country: teamMembers.country,
      timeZone: teamMembers.timeZone,
      color: teamMembers.color,
      joinedOn: teamMembers.joinedOn,
      creatorIds: user.creatorIds,
    })
    .from(teamMembers)
    .innerJoin(user, eq(user.id, teamMembers.userId))
    .where(id === undefined ? undefined : eq(teamMembers.id, id));
  if (rows.length === 0) return [];
  const rates = await tx
    .select({ memberId: memberCommissionRates.memberId, ...rateColumns })
    .from(memberCommissionRates)
    .where(
      inArray(
        memberCommissionRates.memberId,
        rows.map((row) => row.id),
      ),
    );
  // Better Auth's password account: none until the invitation link is used (EQ-10).
  const passwords = await tx
    .select({ userId: account.userId })
    .from(account)
    .where(
      and(
        inArray(
          account.userId,
          rows.map((row) => row.userId),
        ),
        eq(account.providerId, 'credential'),
      ),
    );
  const withPassword = new Set(passwords.map((row) => row.userId));
  return rows
    .map((row) => {
      const rate = rateInForce(
        rates.filter((candidate) => candidate.memberId === row.id),
        today,
      );
      return TeamMemberSchema.parse({
        ...row,
        commission:
          rate === null
            ? null
            : {
                rateBps: rate.rateBps,
                teamShareBps: rate.teamShareBps,
                presetId: rate.presetId,
                effectiveFrom: rate.effectiveFrom,
              },
        invitationPending: !withPassword.has(row.userId),
        // The links' table is not the module's: the service adds it from `InvitationLinkDirectory`.
        invitationExpiresAt: null,
      });
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'));
}

interface LockedMember {
  readonly userId: UserId;
  readonly status: TeamMemberStatus;
  readonly teamRole: TeamRole;
}

/** The record about to change, locked until the transaction ends; `member_not_found` when the actor cannot read it. */
async function lockMember(tx: Transaction, id: TeamMemberId): Promise<LockedMember> {
  const [row] = await tx
    .select({ userId: teamMembers.userId, status: teamMembers.status, teamRole: teamMembers.teamRole })
    .from(teamMembers)
    .where(eq(teamMembers.id, id))
    .for('update');
  if (row === undefined) throw new MemberNotFound();
  return {
    userId: UserIdSchema.parse(row.userId),
    status: TeamMemberStatusSchema.parse(row.status),
    teamRole: TeamRoleSchema.parse(row.teamRole),
  };
}

/** One rate row, signed by the owner (`owner_insert`): never changed afterwards. */
async function insertRate(
  tx: Transaction,
  actor: Actor,
  memberId: TeamMemberId,
  rate: NewRate,
): Promise<void> {
  await tx.insert(memberCommissionRates).values({ ...rate, memberId, createdBy: actor.userId });
}

/** One role row, signed by the owner (`owner_insert`): never changed afterwards. */
async function insertRole(
  tx: Transaction,
  actor: Actor,
  memberId: TeamMemberId,
  role: NewRole,
): Promise<void> {
  await tx.insert(memberRoles).values({ ...role, memberId, createdBy: actor.userId });
}

const roleColumns = { teamRole: memberRoles.teamRole, effectiveFrom: memberRoles.effectiveFrom };

/** Every dated role of the member, newest first. */
async function rolesOf(tx: Transaction, memberId: TeamMemberId): Promise<TeamRoleChange[]> {
  const rows = await tx
    .select(roleColumns)
    .from(memberRoles)
    .where(eq(memberRoles.memberId, memberId))
    .orderBy(sql`${memberRoles.effectiveFrom} desc`);
  return rows.map((row) => TeamRoleChangeSchema.parse(row));
}

/** Who did what (append-only, `audit_log`): never a name, an e-mail or a note's text. */
async function audit(
  tx: Transaction,
  actor: Actor,
  action: string,
  memberOrPreset: { readonly entity: string; readonly id: string },
  details: Record<string, unknown> = {},
): Promise<void> {
  await tx.insert(auditLog).values({
    id: newId(AuditEntryIdSchema),
    userId: actor.userId,
    action,
    entity: memberOrPreset.entity,
    entityId: memberOrPreset.id,
    details,
    ip: actor.ip,
  });
}

/** Pay's `payroll.recalculate` for a period, given by the composition root (the `payroll` module's, EQ-04). */
export type EnqueuePayRecalculation = (tx: Transaction, period: PayPeriod) => Promise<void>;

/**
 * The team's tables through `withMember`, plus Better Auth's `user` (account, name, creators), `account` (read: is
 * the password chosen) and `session` (ended when a member leaves), all out of RLS and written in the same
 * transaction as the record, so a member never exists without his account nor keeps creators after leaving.
 */
export function createDrizzleTeamStore(
  db: Database,
  enqueuePayRecalculation: EnqueuePayRecalculation,
  now: () => Date = () => new Date(),
): TeamStore {
  return {
    members: (actor, today) => withMember(db, actor, (tx) => readMembers(tx, today)),

    member: (actor, id, today) =>
      withMember(db, actor, async (tx) => (await readMembers(tx, today, id))[0] ?? null),

    create: (actor, member) =>
      orConflict(
        withMember(db, actor.userId, async (tx, scope) => {
          assertOwnerScope(scope);
          const [taken] = await tx.select({ id: user.id }).from(user).where(eq(user.email, member.email));
          if (taken !== undefined) throw new MemberConflict();
          await tx.insert(user).values({
            id: member.userId,
            name: member.displayName,
            email: member.email,
            role: 'operator',
            creatorIds: [...member.creatorIds],
          });
          await tx.insert(teamMembers).values({
            id: member.id,
            userId: member.userId,
            teamRole: member.teamRole,
            firstName: member.firstName,
            lastName: member.lastName,
            displayName: member.displayName,
            country: member.country,
            timeZone: member.timeZone,
            color: member.color,
            joinedOn: member.joinedOn,
          });
          await insertRate(tx, actor, member.id, member.rate);
          await insertRole(tx, actor, member.id, {
            id: member.roleId,
            teamRole: member.teamRole,
            effectiveFrom: member.joinedOn,
          });
          await audit(
            tx,
            actor,
            'team_member.create',
            { entity: 'team_member', id: member.id },
            { teamRole: member.teamRole, creators: member.creatorIds.length },
          );
        }),
        () => new MemberConflict(),
      ),

    update: (actor, id, patch) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertOwnerScope(scope);
        const current = await lockMember(tx, id);
        assertStillInTeam(current.status);
        const { creatorIds, ...fields } = patch;
        if (Object.keys(fields).length > 0) {
          await tx
            .update(teamMembers)
            .set({ ...fields, updatedAt: now() })
            .where(eq(teamMembers.id, id));
        }
        if (fields.displayName !== undefined || creatorIds !== undefined) {
          await tx
            .update(user)
            .set({
              ...(fields.displayName !== undefined && { name: fields.displayName }),
              ...(creatorIds !== undefined && { creatorIds: [...creatorIds] }),
              updatedAt: now(),
            })
            .where(eq(user.id, current.userId));
        }
        await audit(
          tx,
          actor,
          'team_member.update',
          { entity: 'team_member', id },
          { fields: Object.keys(patch).sort() },
        );
      }),

    changeStatus: (actor, id, status) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertOwnerScope(scope);
        const current = await lockMember(tx, id);
        // Asked twice, the same status changes nothing and writes nothing.
        if (current.status === status) return;
        assertStillInTeam(current.status);
        await tx.update(teamMembers).set({ status, updatedAt: now() }).where(eq(teamMembers.id, id));
        const leaving = leavesTeam(current.status, status);
        let sessionsEnded = 0;
        if (leaving) {
          await tx.update(user).set({ creatorIds: [], updatedAt: now() }).where(eq(user.id, current.userId));
          const ended = await tx
            .delete(session)
            .where(eq(session.userId, current.userId))
            .returning({ id: session.id });
          sessionsEnded = ended.length;
        }
        await audit(
          tx,
          actor,
          'team_member.status_change',
          { entity: 'team_member', id },
          { from: current.status, to: status, ...(leaving && { sessionsEnded }) },
        );
      }),

    addRate: (actor, id, rate, recalculate) =>
      orConflict(
        withMember(db, actor.userId, async (tx, scope): Promise<CommissionRate> => {
          assertOwnerScope(scope);
          const current = await lockMember(tx, id);
          assertStillInTeam(current.status);
          // A share is a manager's on the rate's first day: a chatter made a manager from the 16th has one from then.
          assertTeamShareFits(
            roleOn(await rolesOf(tx, id), rate.effectiveFrom, current.teamRole),
            rate.teamShareBps,
          );
          await insertRate(tx, actor, id, rate);
          if (recalculate !== null) await enqueuePayRecalculation(tx, recalculate);
          await audit(
            tx,
            actor,
            'commission_rate.create',
            { entity: 'team_member', id },
            { effectiveFrom: rate.effectiveFrom, fromPreset: rate.presetId !== null },
          );
          return CommissionRateSchema.parse(rate);
        }),
        () => new CommissionRateConflict(),
      ),

    rates: (actor, id) =>
      withMember(db, actor, async (tx) => {
        const [member] = await tx
          .select({ id: teamMembers.id })
          .from(teamMembers)
          .where(eq(teamMembers.id, id));
        if (member === undefined) return null;
        const rows = await tx
          .select(rateColumns)
          .from(memberCommissionRates)
          .where(eq(memberCommissionRates.memberId, id))
          .orderBy(sql`${memberCommissionRates.effectiveFrom} desc`);
        return rows.map((row) => CommissionRateSchema.parse(row));
      }),

    addRole: (actor, id, role, { today, running }) =>
      orConflict(
        withMember(db, actor.userId, async (tx, scope): Promise<TeamRoleChange> => {
          assertOwnerScope(scope);
          const current = await lockMember(tx, id);
          assertStillInTeam(current.status);
          await insertRole(tx, actor, id, role);
          // From today, his access changes now and pay computes the running period again; a later role waits.
          if (role.effectiveFrom === today && role.teamRole !== current.teamRole) {
            await tx
              .update(teamMembers)
              .set({ teamRole: role.teamRole, updatedAt: now() })
              .where(eq(teamMembers.id, id));
            await enqueuePayRecalculation(tx, running);
          }
          await audit(
            tx,
            actor,
            'team_role.create',
            { entity: 'team_member', id },
            { teamRole: role.teamRole, effectiveFrom: role.effectiveFrom },
          );
          return TeamRoleChangeSchema.parse(role);
        }),
        () => new RoleChangeConflict(),
      ),

    roles: (actor, id) =>
      withMember(db, actor, async (tx) => {
        const [member] = await tx
          .select({ id: teamMembers.id })
          .from(teamMembers)
          .where(eq(teamMembers.id, id));
        return member === undefined ? null : rolesOf(tx, id);
      }),

    presets: (actor) =>
      withMember(db, actor, async (tx, scope) => {
        assertReadsTeam(scope);
        const rows = await tx
          .select({
            id: commissionPresets.id,
            name: commissionPresets.name,
            rateBps: commissionPresets.rateBps,
            effectiveFrom: commissionPresets.effectiveFrom,
          })
          .from(commissionPresets);
        return rows.map((row) => CommissionPresetSchema.parse(row));
      }),

    addPreset: (actor, preset) =>
      orConflict(
        withMember(db, actor.userId, async (tx, scope) => {
          assertOwnerScope(scope);
          await tx.insert(commissionPresets).values({ ...preset, createdBy: actor.userId });
          await audit(
            tx,
            actor,
            'commission_preset.create',
            { entity: 'commission_preset', id: preset.id },
            { effectiveFrom: preset.effectiveFrom },
          );
          return CommissionPresetSchema.parse(preset);
        }),
        () => new CommissionPresetConflict(),
      ),

    notes: (actor, id) =>
      withMember(db, actor, async (tx, scope) => {
        assertReadsTeam(scope);
        const [member] = await tx
          .select({ userId: teamMembers.userId })
          .from(teamMembers)
          .where(eq(teamMembers.id, id));
        if (member === undefined) return null;
        // The notes about him are not his to read (ADR 0024), the policy shows none: refused rather than empty.
        if (member.userId === actor) throw new OwnNotesForbidden();
        const rows = await tx
          .select({
            id: teamMemberNotes.id,
            body: teamMemberNotes.body,
            authorName: user.name,
            createdAt: teamMemberNotes.createdAt,
          })
          .from(teamMemberNotes)
          .innerJoin(user, eq(user.id, teamMemberNotes.authorUserId))
          .where(eq(teamMemberNotes.memberId, id))
          .orderBy(sql`${teamMemberNotes.createdAt} desc, ${teamMemberNotes.id} desc`);
        return rows.map((row) =>
          TeamMemberNoteSchema.parse({ ...row, createdAt: row.createdAt.toISOString() }),
        );
      }),

    addNote: (actor, id, note) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertReadsTeam(scope);
        const [member] = await tx
          .select({ userId: teamMembers.userId })
          .from(teamMembers)
          .where(eq(teamMembers.id, id));
        if (member === undefined) throw new MemberNotFound();
        if (member.userId === actor.userId) throw new OwnNotesForbidden();
        const createdAt = now();
        await tx
          .insert(teamMemberNotes)
          .values({ id: note.id, memberId: id, body: note.body, authorUserId: actor.userId, createdAt });
        const [author] = await tx.select({ name: user.name }).from(user).where(eq(user.id, actor.userId));
        await audit(tx, actor, 'team_member_note.create', { entity: 'team_member', id }, { noteId: note.id });
        return TeamMemberNoteSchema.parse({
          id: note.id,
          body: note.body,
          authorName: author?.name,
          createdAt: createdAt.toISOString(),
        });
      }),
  };
}
