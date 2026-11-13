import { AuditEntryIdSchema, newId } from '@impera/contracts';
import { eq, schema, withAdmin, type Database } from '@impera/db';

import { NO_CAPS, type StoredCaps } from '../domain/budget';
import type { BudgetStore } from '../domain/ports';

/** The agency's one row (a CHECK holds it to 1). */
const ROW_ID = 1;

const columns = {
  dailyCapMinor: schema.aiBudgetSettings.dailyCapMinor,
  trendWatchCapMinor: schema.aiBudgetSettings.trendWatchCapMinor,
  updatedAt: schema.aiBudgetSettings.updatedAt,
};

/**
 * `ai_budget_settings` with the owner role (the agency's row, RLS forced, `agency_only`). A change writes its
 * `audit_log` line with the values before and after, in the same transaction.
 */
export function createPostgresBudgetStore(adminDb: Database): BudgetStore {
  return {
    async read() {
      const [row] = await adminDb
        .select(columns)
        .from(schema.aiBudgetSettings)
        .where(eq(schema.aiBudgetSettings.id, ROW_ID));
      return row ?? NO_CAPS;
    },
    write(next, actor) {
      return withAdmin(adminDb, async (tx): Promise<StoredCaps> => {
        // Locked: two owners saving at once each write their own « before ».
        const [before] = await tx
          .select(columns)
          .from(schema.aiBudgetSettings)
          .where(eq(schema.aiBudgetSettings.id, ROW_ID))
          .for('update');
        const values = {
          dailyCapMinor: next.dailyCapMinor,
          trendWatchCapMinor: next.trendWatchCapMinor,
          updatedBy: actor.userId,
          updatedAt: new Date(),
        };
        const [after] = await tx
          .insert(schema.aiBudgetSettings)
          .values({ id: ROW_ID, ...values })
          .onConflictDoUpdate({ target: schema.aiBudgetSettings.id, set: values })
          .returning(columns);
        if (after === undefined) throw new Error('ai_budget_settings: the upsert returned no row');
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: actor.userId,
          action: 'ai_budget.update',
          entity: 'ai_budget_settings',
          entityId: String(ROW_ID),
          ip: actor.ip,
          details: {
            before: {
              dailyCapMinor: before?.dailyCapMinor ?? null,
              trendWatchCapMinor: before?.trendWatchCapMinor ?? null,
            },
            after: { dailyCapMinor: after.dailyCapMinor, trendWatchCapMinor: after.trendWatchCapMinor },
          },
        });
        return after;
      });
    },
  };
}
