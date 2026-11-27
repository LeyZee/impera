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
  type UserId,
  type TeamMemberId,
} from '@impera/contracts';
import { eq, schema, sql, withAdmin, withMember, type Database, type Transaction } from '@impera/db';

import { departureApplier, isLateDeparture } from '../domain/departures';
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

const toDeparture = (row: Row, now: Date): MemberDeparture =>
  MemberDepartureSchema.parse({
    id: row.id,
    memberId: row.memberId,
    state: row.cancelledAt !== null ? 'cancelled' : row.appliedAt !== null ? 'applied' : 'scheduled',
    endsAt: row.endsAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    appliedAt: row.appliedAt?.toISOString() ?? null,
    revealRemovedAt: row.revealRemovedAt?.toISOString() ?? null,
    revealRemovedBy: row.revealRemovedBy,
    late: isLateDeparture(row, now),
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
  /**
   * `team.member_departure`: whether it applied now. In the name of the owner who set it, or of an owner in office if
   * he no longer is one (ADR 0166 § 2). `scheduledBy`, from the job's payload, must be the departure's own.
   */
  apply(id: MemberDepartureId, scheduledBy: UserId): Promise<boolean>;
}

/**
 * A member's departure (ADR 0166): the owner sets it, cancels it or ticks Reveal through `withMember`, and the job
 * applies it at its hour in an owner's name, through the same policies. The service role reads who the owners are,
 * never a departure.
 */
export function createDepartureStore(
  db: Database,
  /** The service role: the owners in office, nothing else. */
  adminDb: Database,
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
        return rows.map((row) => toDeparture(row, now()));
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
          return toDeparture(row, now());
        }
        // At its hour, once: the key makes a second scheduling of the same departure the same job.
        await tx.execute(
          sql`select public.enqueue_job(
            task => 'team.member_departure',
            payload => ${JSON.stringify({ departureId: id, scheduledBy: actor.userId })}::jsonb,
            run_at => ${row.endsAt.toISOString()}::timestamptz,
            max_attempts => ${JOB_MAX_ATTEMPTS['team.member_departure']}::int,
            job_key => ${`team.member_departure:${id}`}
          )`,
        );
        return toDeparture(row, now());
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
        return toDeparture(cancelled, now());
      }),

    revealRemoved: (actor, id) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertOwnerScope(scope);
        const row = await departureOf(tx, id);
        if (row.cancelledAt !== null) throw new MemberDepartureConflict('Ce départ est annulé');
        // Ticked twice, the first tick stays: its day and who ticked it.
        if (row.revealRemovedAt !== null) return toDeparture(row, now());
        const [ticked] = await tx
          .update(teamMemberDepartures)
          .set({ revealRemovedAt: sql`now()`, revealRemovedBy: actor.userId })
          .where(eq(teamMemberDepartures.id, id))
          .returning();
        if (ticked === undefined) throw new MemberDepartureNotFound();
        await audit(tx, actor, 'team_member.reveal_removed', TeamMemberIdSchema.parse(row.memberId));
        return toDeparture(ticked, now());
      }),

    apply: async (id, scheduledBy) => {
      const owners = await withAdmin(adminDb, (tx) =>
        tx.select({ id: user.id }).from(user).where(eq(user.role, 'owner')).orderBy(user.createdAt),
      );
      const applier = departureApplier(
        scheduledBy,
        owners.map((owner) => owner.id),
      );
      // No owner at all: thrown, the job is tried again and the departure stays late, in red.
      if (applier === null) throw new Error('team.member_departure: no owner to apply it');
      const ownerId = UserIdSchema.parse(applier);
      return withMember(db, ownerId, async (tx, scope) => {
        assertOwnerScope(scope);
        const row = await departureOf(tx, id);
        // A payload that names another owner than the one who set it is not this departure's job.
        if (row.createdBy !== scheduledBy)
          throw new Error('team.member_departure: not set by the owner named');
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
        const leftOn = today(now());
        const done =
          member.status === 'left'
            ? { sessionsEnded: 0, passkeysRemoved: 0 }
            : await leaveTeam(tx, memberId, UserIdSchema.parse(member.userId), leftOn);
        await tx
          .update(teamMemberDepartures)
          .set({ appliedAt: sql`greatest(now(), ${teamMemberDepartures.endsAt})` })
          .where(eq(teamMemberDepartures.id, id));
        // The entry says who applied it and who had set it, when an owner in office took it over.
        await audit(tx, { userId: ownerId, ip: null }, 'team_member.departure_apply', memberId, {
          ...done,
          leftOn,
          scheduledBy: row.createdBy,
        });
        return true;
      });
    },
  };
}
