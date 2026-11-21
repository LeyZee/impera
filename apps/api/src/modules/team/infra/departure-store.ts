import {
  AuditEntryIdSchema,
  DEPARTURE_MAX_DAYS_AHEAD,
  JOB_MAX_ATTEMPTS,
  MemberDepartureIdSchema,
  MemberDepartureSchema,
  newId,
  TeamMemberIdSchema,
  TeamMemberNoteIdSchema,
  TeamMemberStatusSchema,
  UserIdSchema,
  type MemberDeparture,
  type MemberDepartureId,
  type TeamMemberId,
  type UserId,
} from '@impera/contracts';
import { eq, schema, sql, withMember, type Database, type Transaction } from '@impera/db';

import {
  MemberDepartureConflict,
  MemberDepartureDateInvalid,
  MemberDepartureNotFound,
  MemberNotFound,
  OwnerProtected,
} from '../domain/errors';
import { assertOwnerScope, assertStillInTeam } from '../domain/members';
import type { Actor } from '../domain/ports';

import { leaveTeam } from './leave';

const { auditLog, teamMemberDepartures, teamMemberNotes, teamMembers, user } = schema;

type Row = typeof teamMemberDepartures.$inferSelect;

const toDeparture = (row: Row): MemberDeparture =>
  MemberDepartureSchema.parse({
    id: row.id,
    memberId: row.memberId,
    state: row.cancelledAt !== null ? 'cancelled' : row.appliedAt !== null ? 'applied' : 'scheduled',
    endsAt: row.endsAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    appliedAt: row.appliedAt?.toISOString() ?? null,
    revealRemovedAt: row.revealRemovedAt?.toISOString() ?? null,
    revealRemovedBy: row.revealRemovedBy,
  });

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Error &&
  [error, error.cause].some((e) => typeof e === 'object' && e !== null && 'code' in e && e.code === '23505');

async function audit(
  tx: Transaction,
  actor: Actor,
  action: string,
  memberId: TeamMemberId,
  details: Record<string, unknown> = {},
): Promise<void> {
  await tx.insert(auditLog).values({
    id: newId(AuditEntryIdSchema),
    userId: actor.userId,
    action,
    entity: 'team_member',
    entityId: memberId,
    details,
    ip: actor.ip,
  });
}

async function departureOf(tx: Transaction, id: MemberDepartureId): Promise<Row> {
  const [row] = await tx
    .select()
    .from(teamMemberDepartures)
    .where(eq(teamMemberDepartures.id, id))
    .for('update');
  if (row === undefined) throw new MemberDepartureNotFound();
  return row;
}

export interface DepartureStore {
  /** Équipe: the departures waiting, and those applied whose Reveal access is not ticked yet. */
  list(actor: Actor): Promise<MemberDeparture[]>;
  /** `endsAt` null: now, applied in the same transaction. */
  schedule(
    actor: Actor,
    memberId: TeamMemberId,
    endsAt: Date | null,
    reason: string | null,
  ): Promise<MemberDeparture>;
  cancel(actor: Actor, id: MemberDepartureId): Promise<MemberDeparture>;
  revealRemoved(actor: Actor, id: MemberDepartureId): Promise<MemberDeparture>;
  /** `team.member_departure`, in the name of the owner who set it: whether it applied now. */
  apply(id: MemberDepartureId, ownerId: UserId): Promise<boolean>;
}

/**
 * A member's departure (ADR 0166): the owner sets it, cancels it or ticks Reveal through `withMember`, and the job
 * applies it in his name at its hour, through the same policies. Nothing goes through the service role.
 */
export function createDepartureStore(
  db: Database,
  now: () => Date,
  /** The agency's day of an instant, where `left_on` is read (EQ-14). */
  today: (at: Date) => string,
): DepartureStore {
  return {
    list: (actor) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertOwnerScope(scope);
        const rows = await tx
          .select()
          .from(teamMemberDepartures)
          .where(
            sql`${teamMemberDepartures.cancelledAt} is null and (${teamMemberDepartures.appliedAt} is null or ${teamMemberDepartures.revealRemovedAt} is null)`,
          )
          .orderBy(teamMemberDepartures.endsAt);
        return rows.map(toDeparture);
      }),

    schedule: (actor, memberId, endsAt, reason) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertOwnerScope(scope);
        const at = endsAt ?? now();
        const limit = now().getTime() + DEPARTURE_MAX_DAYS_AHEAD * 86_400_000;
        if (at.getTime() < now().getTime() - 60_000 || at.getTime() > limit) {
          throw new MemberDepartureDateInvalid(DEPARTURE_MAX_DAYS_AHEAD);
        }
        const [member] = await tx
          .select({ userId: teamMembers.userId, status: teamMembers.status, role: user.role })
          .from(teamMembers)
          .innerJoin(user, eq(user.id, teamMembers.userId))
          .where(eq(teamMembers.id, memberId))
          .for('update', { of: teamMembers });
        if (member === undefined) throw new MemberNotFound();
        assertStillInTeam(TeamMemberStatusSchema.parse(member.status));
        // An owner leaves through his removal, with its notice (ADR 0096 § 2), never through a departure.
        if (member.role === 'owner') throw new OwnerProtected();
        const id = newId(MemberDepartureIdSchema);
        const immediate = endsAt === null;
        try {
          await tx.insert(teamMemberDepartures).values({
            id,
            memberId,
            endsAt: immediate ? sql`now()` : at,
            createdBy: actor.userId,
            ...(immediate && { appliedAt: sql`now()` }),
          });
        } catch (error) {
          if (isUniqueViolation(error)) throw new MemberDepartureConflict();
          throw error;
        }
        // The reason is a note of his record: the owner and the managers read it, never the member (ADR 0166 § 1).
        if (reason !== null) {
          await tx.insert(teamMemberNotes).values({
            id: newId(TeamMemberNoteIdSchema),
            memberId,
            body: `Motif du départ : ${reason}`,
            authorUserId: actor.userId,
            createdAt: now(),
          });
        }
        const row = await departureOf(tx, id);
        await audit(tx, actor, 'team_member.departure_schedule', memberId, {
          endsAt: row.endsAt.toISOString(),
        });
        // Now: applied in this very transaction, his sessions end with the click.
        if (immediate) {
          const leftOn = today(now());
          const done = await leaveTeam(tx, memberId, UserIdSchema.parse(member.userId), leftOn);
          await audit(tx, actor, 'team_member.departure_apply', memberId, { ...done, leftOn });
          return toDeparture(row);
        }
        // At its hour, once: the key makes a second scheduling of the same departure the same job.
        await tx.execute(
          sql`select public.enqueue_job(
            task => 'team.member_departure',
            payload => ${JSON.stringify({ departureId: id, ownerId: actor.userId })}::jsonb,
            run_at => ${row.endsAt.toISOString()}::timestamptz,
            max_attempts => ${JOB_MAX_ATTEMPTS['team.member_departure']}::int,
            job_key => ${`team.member_departure:${id}`}
          )`,
        );
        return toDeparture(row);
      }),

    cancel: (actor, id) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertOwnerScope(scope);
        const row = await departureOf(tx, id);
        if (row.cancelledAt !== null || row.appliedAt !== null) {
          throw new MemberDepartureConflict('Ce départ n’est plus prévu : il est déjà annulé ou appliqué');
        }
        const [cancelled] = await tx
          .update(teamMemberDepartures)
          .set({ cancelledAt: sql`now()`, cancelledBy: actor.userId })
          .where(eq(teamMemberDepartures.id, id))
          .returning();
        await audit(tx, actor, 'team_member.departure_cancel', TeamMemberIdSchema.parse(row.memberId));
        if (cancelled === undefined) throw new MemberDepartureNotFound();
        return toDeparture(cancelled);
      }),

    revealRemoved: (actor, id) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertOwnerScope(scope);
        const row = await departureOf(tx, id);
        if (row.cancelledAt !== null) throw new MemberDepartureConflict('Ce départ est annulé');
        // Ticked twice, the first tick stays: its day and who ticked it.
        if (row.revealRemovedAt !== null) return toDeparture(row);
        const [ticked] = await tx
          .update(teamMemberDepartures)
          .set({ revealRemovedAt: sql`now()`, revealRemovedBy: actor.userId })
          .where(eq(teamMemberDepartures.id, id))
          .returning();
        if (ticked === undefined) throw new MemberDepartureNotFound();
        await audit(tx, actor, 'team_member.reveal_removed', TeamMemberIdSchema.parse(row.memberId));
        return toDeparture(ticked);
      }),

    apply: (id, ownerId) =>
      withMember(db, ownerId, async (tx, scope) => {
        // The owner who set it is no longer one: nothing applies in his name; the job fails and says so.
        assertOwnerScope(scope);
        const row = await departureOf(tx, id);
        if (row.cancelledAt !== null || row.appliedAt !== null) return false;
        // Never before its hour: thrown, so that the job is tried again rather than marked done.
        if (row.endsAt.getTime() > now().getTime()) throw new Error('team.member_departure: before its hour');
        const [member] = await tx
          .select({ userId: teamMembers.userId, status: teamMembers.status })
          .from(teamMembers)
          .where(eq(teamMembers.id, row.memberId))
          .for('update');
        if (member === undefined) throw new MemberNotFound();
        const memberId = TeamMemberIdSchema.parse(row.memberId);
        const userId = UserIdSchema.parse(member.userId);
        const leftOn = today(now());
        const done =
          member.status === 'left'
            ? { sessionsEnded: 0, passkeysRemoved: 0 }
            : await leaveTeam(tx, memberId, userId, leftOn);
        await tx
          .update(teamMemberDepartures)
          .set({ appliedAt: sql`greatest(now(), ${teamMemberDepartures.endsAt})` })
          .where(eq(teamMemberDepartures.id, id));
        await audit(tx, { userId: ownerId, ip: null }, 'team_member.departure_apply', memberId, {
          ...done,
          leftOn,
        });
        return true;
      }),
  };
}
