import { CreatorWeekStateSchema, WeekPlanSchema, type AgencyCreatorWeek } from '@impera/contracts';
import { and, eq, schema, sql, withAdmin, withTenantMember, type Database } from '@impera/db';

import { CreatorWeekForbidden, CreatorWeekNotFound } from '../../domain/errors';
import { weekId } from '../../domain/ids';
import type { WeekDraftStore } from '../../domain/ports';

const weeks = schema.creatorWeeks;

type WeekRow = typeof weeks.$inferSelect;

/** A row to the contract: its plan parsed on read (docs/architecture/jsonb.md). */
function weekOf(row: WeekRow): AgencyCreatorWeek {
  return {
    week: row.week,
    state: CreatorWeekStateSchema.parse(row.state),
    plan: WeekPlanSchema.parse(row.plan),
    computedAt: row.computedAt.toISOString(),
    validatedAt: row.validatedAt?.toISOString() ?? null,
  };
}

/** The job's writes on the admin connection; her team's reads and the owner's validation under `withTenantMember`. */
export function createDrizzleWeekDraftStore(db: Database, adminDb: Database): WeekDraftStore {
  return {
    creators: () =>
      withAdmin(adminDb, (tx) =>
        tx
          .select({ creatorId: schema.creators.id, timeZone: schema.creators.timezone })
          .from(schema.creators)
          .where(sql`${schema.creators.archivedAt} is null`),
      ),

    saveDraft: (creatorId, week, plan, now) =>
      withAdmin(adminDb, async (tx) => {
        // Parsed on write as on read: the job never stores a plan the contract refuses.
        const parsed = WeekPlanSchema.parse(plan);
        const [written] = await tx
          .insert(weeks)
          .values({
            id: weekId('creator-week-row', creatorId, week),
            creatorId,
            week,
            plan: parsed,
            computedAt: now,
          })
          .onConflictDoNothing()
          .returning({ id: weeks.id });
        if (written !== undefined) return 'written';
        const [refreshed] = await tx
          .update(weeks)
          .set({ plan: parsed, computedAt: now, updatedAt: sql`now()` })
          .where(and(eq(weeks.creatorId, creatorId), eq(weeks.week, week), eq(weeks.state, 'draft')))
          .returning({ id: weeks.id });
        return refreshed === undefined ? 'validated' : 'refreshed';
      }),

    read: (creatorId, userId, week) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        if (scope !== 'owner' && scope !== 'agency') throw new CreatorWeekForbidden('read');
        const [row] = await tx.select().from(weeks).where(eq(weeks.week, week));
        return row === undefined ? null : weekOf(row);
      }),

    forValidation: (creatorId, userId, week) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        if (scope !== 'owner') throw new CreatorWeekForbidden('validate');
        const [row] = await tx.select().from(weeks).where(eq(weeks.week, week));
        if (row === undefined) throw new CreatorWeekNotFound();
        return weekOf(row);
      }),

    markValidated: (creatorId, userId, week, plan, now) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        if (scope !== 'owner') throw new CreatorWeekForbidden('validate');
        const parsed = WeekPlanSchema.parse(plan);
        const [row] = await tx
          .update(weeks)
          .set({
            state: 'validated',
            plan: parsed,
            validatedBy: userId,
            validatedAt: now,
            updatedAt: sql`now()`,
          })
          .where(and(eq(weeks.week, week), eq(weeks.state, 'draft')))
          .returning();
        if (row !== undefined) return weekOf(row);
        // Validated in the meantime (a replay, a second tab): the week as it is.
        const [known] = await tx.select().from(weeks).where(eq(weeks.week, week));
        if (known === undefined) throw new CreatorWeekNotFound();
        return weekOf(known);
      }),
  };
}
