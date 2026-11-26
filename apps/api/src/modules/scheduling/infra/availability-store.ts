import {
  AvailabilityRangeSchema,
  AvailabilityWeekIdSchema,
  MemberAvailabilitySchema,
  TeamAvailabilitySchema,
  TeamMemberIdSchema,
  type AvailabilityRange,
  type MemberAvailability,
} from '@impera/contracts';
import { eq, inArray, schema, sql, withMember, type Database, type Transaction } from '@impera/db';
import { z } from 'zod';

import { AvailabilityConflict, MemberNotActive, MemberNotFound, PlanningForbidden } from '../domain/errors';
import type { AvailabilityStore } from '../domain/ports';

import { audit } from './rows';

const { memberAvailabilityWeeks, teamMembers } = schema;

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
 * The weeks of availability (ADR 0171, trou 16) under `withMember`. A member reads and writes his own; the owner and an
 * active manager read every active member's and write one for a member (the journal says it). The policies hold the
 * same rule: a row is read by its member or the scope `owner` | `agency`, written only under the writer's own name.
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
          .where(eq(teamMembers.status, 'active'))
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
