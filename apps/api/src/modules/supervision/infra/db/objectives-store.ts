import {
  AuditEntryIdSchema,
  newId,
  type AgencyObjective,
  type CreatorId,
  type UserId,
} from '@impera/contracts';
import { schema, sql, withTenantMember, type Database } from '@impera/db';
import { z } from 'zod';

/** What a write of an objective did: done, or refused because the person is not the owner. */
type ObjectiveWrite = { readonly kind: 'written' } | { readonly kind: 'not_owner' };

export interface ObjectivesStore {
  /** Sets her objective for the month, or replaces it (ADR 0092 § 6). */
  set(objective: AgencyObjective, userId: UserId): Promise<ObjectiveWrite>;
  /** Takes her objective for the month away, if any. */
  remove(creatorId: CreatorId, month: string, userId: UserId): Promise<ObjectiveWrite>;
}

const { auditLog } = schema;

const WrittenSchema = z.array(z.object({ id: z.string(), before: z.coerce.number().int().nullable() }));
const RemovedSchema = z.array(z.object({ id: z.string(), amount_minor: z.coerce.number().int() }));

/**
 * The owner's revenue objectives (ADR 0092 § 6), written inside her tenant with his team scope: the policies let the
 * owner alone write (`owner_insert`, `owner_update`, `owner_delete`), the check here only says it before the base does.
 */
export function createObjectivesStore(db: Database): ObjectivesStore {
  return {
    set: (objective, userId) =>
      withTenantMember(db, objective.creatorId, userId, async (tx, scope): Promise<ObjectiveWrite> => {
        if (scope !== 'owner') return { kind: 'not_owner' };
        const [row] = WrittenSchema.parse(
          (
            await tx.execute(sql`
              with before as (
                select amount_minor from creator_revenue_objectives
                 where creator_id = ${objective.creatorId}::uuid and month = ${objective.month}::date
              )
              insert into creator_revenue_objectives (id, creator_id, month, amount_minor, set_by)
              values (gen_random_uuid(), ${objective.creatorId}::uuid, ${objective.month}::date,
                      ${objective.amountMinor}, ${userId})
              on conflict (creator_id, month) do update
                set amount_minor = excluded.amount_minor, set_by = excluded.set_by, updated_at = now()
              returning id, (select amount_minor from before) as before`)
          ).rows,
        );
        // A gesture of the owner on a figure of money: in the journal, amounts only (fil Bilan, 20/11).
        if (row !== undefined)
          await tx.insert(auditLog).values({
            id: newId(AuditEntryIdSchema),
            userId,
            action: 'objective.set',
            entity: 'creator_revenue_objective',
            entityId: row.id,
            details: {
              creatorId: objective.creatorId,
              month: objective.month,
              from: row.before,
              to: objective.amountMinor,
            },
            ip: null,
          });
        return { kind: 'written' };
      }),
    remove: (creatorId, month, userId) =>
      withTenantMember(db, creatorId, userId, async (tx, scope): Promise<ObjectiveWrite> => {
        if (scope !== 'owner') return { kind: 'not_owner' };
        const removed = RemovedSchema.parse(
          (
            await tx.execute(sql`
              delete from creator_revenue_objectives where creator_id = ${creatorId}::uuid and month = ${month}::date
              returning id, amount_minor`)
          ).rows,
        );
        for (const row of removed)
          await tx.insert(auditLog).values({
            id: newId(AuditEntryIdSchema),
            userId,
            action: 'objective.remove',
            entity: 'creator_revenue_objective',
            entityId: row.id,
            details: { creatorId, month, from: row.amount_minor },
            ip: null,
          });
        return { kind: 'written' };
      }),
  };
}
