import {
  AvailabilityRangeSchema,
  AvailabilityWeekIdSchema,
  MemberAvailabilitySchema,
  TeamAvailabilitySchema,
  TeamMemberIdSchema,
  type AvailabilityRange,
  type TeamScope,
  type MemberAvailability,
} from '@impera/contracts';
import { and, eq, inArray, schema, sql, withMember, type Database, type Transaction } from '@impera/db';
import { z } from 'zod';

import { AvailabilityConflict, MemberNotActive, MemberNotFound, PlanningForbidden } from '../domain/errors';
import type { AvailabilityStore } from '../domain/ports';

import { audit } from './rows';

const { memberAvailabilityWeeks, teamMembers } = schema;

type SQL = ReturnType<typeof sql>;

type WeekRow = typeof memberAvailabilityWeeks.$inferSelect;

const RangesSchema = z.array(AvailabilityRangeSchema);

/** The ranges as stored, read back through their contract: a row the base kept is never trusted blind. */
const rangesOf = (row: WeekRow): AvailabilityRange[] => RangesSchema.parse(row.ranges);

const weekOf = (
  member: { readonly id: string; readonly userId: string; readonly timeZone: string },
  row: WeekRow | undefined,
): MemberAvailability =>
  MemberAvailabilitySchema.parse({
    memberId: member.id,
    weekId: row?.id ?? null,
    // A member who gave nothing yet: his own zone, where his first plages will be read.
    timeZone: row?.timeZone ?? member.timeZone,
    ranges: row === undefined ? [] : rangesOf(row),
    setAt: row?.createdAt.toISOString() ?? null,
    setByMember: row === undefined ? false : row.createdBy === member.userId,
  });

/** The latest week of each member named, as the policies show them. */
async function latestOf(tx: Transaction, memberIds: readonly string[]): Promise<Map<string, WeekRow>> {
  if (memberIds.length === 0) return new Map();
  const rows = await tx
    .selectDistinctOn([memberAvailabilityWeeks.memberId])
    .from(memberAvailabilityWeeks)
    .where(inArray(memberAvailabilityWeeks.memberId, [...memberIds]))
    .orderBy(
      memberAvailabilityWeeks.memberId,
      sql`${memberAvailabilityWeeks.createdAt} desc`,
      sql`${memberAvailabilityWeeks.id} desc`,
    );
  return new Map(rows.map((row) => [row.memberId, row]));
}

const sameRanges = (a: readonly AvailabilityRange[], b: readonly AvailabilityRange[]): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** Plages in the order of the week: the day, then the hour. */
const ordered = (ranges: readonly AvailabilityRange[]): AvailabilityRange[] =>
  ranges.toSorted((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);

const memberColumns = {
  id: teamMembers.id,
  userId: teamMembers.userId,
  timeZone: teamMembers.timeZone,
  status: teamMembers.status,
};

/**
 * Who a reader may see beside himself: everyone for the owner; for a manager, the members who share at least one
 * creator of his own list (Sécurité on #1030, as the shift feedbacks). The table has no creator, so the store bounds it.
 */
function reachOf(userId: string, scope: TeamScope): SQL | undefined {
  if (scope !== 'agency') return undefined;
  return sql`exists (select 1 from "user" u, "user" me where u.id = ${teamMembers.userId} and me.id = ${userId} and u.creator_ids && me.creator_ids)`;
}

/**
 * The weeks of availability (ADR 0171, trou 16) under `withMember`. A member reads and writes his own; the owner and an
 * active manager read the active members' and write one for a member (Charles, 26/11 : « Oui, journalisé » ; the
 * journal says it). A manager reaches only the members of his creators (`reachOf`). The policies hold the rest: a row
 * is read by its member or the scope `owner` | `agency`, written only under the writer's own name.
 */
export function createDrizzleAvailabilityStore(db: Database): AvailabilityStore {
  return {
    mine: (userId) =>
      withMember(db, userId, async (tx) => {
        const [member] = await tx
          .select(memberColumns)
          .from(teamMembers)
          .where(eq(teamMembers.userId, userId));
        if (member === undefined) throw new MemberNotFound();
        const latest = await latestOf(tx, [member.id]);
        return weekOf(member, latest.get(member.id));
      }),

    team: (userId) =>
      withMember(db, userId, async (tx, scope) => {
        if (scope === 'self') throw new PlanningForbidden();
        const members = await tx
          .select(memberColumns)
          .from(teamMembers)
          .where(and(eq(teamMembers.status, 'active'), reachOf(userId, scope)))
          .orderBy(teamMembers.displayName);
        const latest = await latestOf(
          tx,
          members.map((member) => member.id),
        );
        return TeamAvailabilitySchema.parse({
          members: members.map((member) => weekOf(member, latest.get(member.id))),
        });
      }),

    set: (actor, target, body) =>
      withMember(db, actor.userId, async (tx, scope) => {
        const [member] = await tx
          .select(memberColumns)
          .from(teamMembers)
          .where(target === 'self' ? eq(teamMembers.userId, actor.userId) : eq(teamMembers.id, target));
        if (member === undefined) throw new MemberNotFound();
        const own = member.userId === actor.userId;
        if (!own && scope === 'self') throw new PlanningForbidden();
        if (!own) {
          const reach = reachOf(actor.userId, scope);
          if (reach !== undefined) {
            const [inReach] = await tx
              .select({ id: teamMembers.id })
              .from(teamMembers)
              .where(and(eq(teamMembers.id, member.id), reach));
            // Outside his creators the member is not his to see: the same answer as a member that does not exist.
            if (inReach === undefined) throw new MemberNotFound();
          }
        }
        if (member.status !== 'active') throw new MemberNotActive();
        const ranges = ordered(body.ranges);
        const [sent] = await tx
          .select()
          .from(memberAvailabilityWeeks)
          .where(eq(memberAvailabilityWeeks.id, body.id));
        if (sent !== undefined) {
          if (sent.memberId !== member.id || !sameRanges(rangesOf(sent), ranges))
            throw new AvailabilityConflict();
          return { value: weekOf(member, sent), created: false };
        }
        // One week at a time per member: the week in force is the one written last, never two at the same instant.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext('member_availability_weeks'), hashtext(${member.id}))`,
        );
        const [row] = await tx
          .insert(memberAvailabilityWeeks)
          .values({
            id: AvailabilityWeekIdSchema.parse(body.id),
            memberId: TeamMemberIdSchema.parse(member.id),
            timeZone: member.timeZone,
            ranges,
            createdBy: actor.userId,
          })
          .returning();
        if (row === undefined) throw new Error('A week of availability was not written');
        await audit(
          tx,
          actor,
          'member_availability.set',
          { kind: 'member_availability_week', id: row.id },
          { forMember: !own },
        );
        return { value: weekOf(member, row), created: true };
      }),
  };
}
