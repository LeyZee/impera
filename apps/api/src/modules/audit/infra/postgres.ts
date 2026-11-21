import {
  AUDIT_ACTION_FAMILIES,
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_CATEGORY_PREFIXES,
  AUDIT_DEFAULT_CATEGORY,
  AuditEntryIdSchema,
  newId,
  type AuditNames,
} from '@impera/contracts';
import { and, schema, sql, withAdmin, type Database } from '@impera/db';
import { z } from 'zod';

import type { AuditActor, AuditPosition, AuditSelection, AuditStore, StoredAuditRow } from '../domain/ports';

const { auditLog } = schema;

/** A fragment of SQL, as Drizzle's `sql` builds it. */
type SQL = ReturnType<typeof sql>;

/**
 * The category of a line, computed by Postgres as `auditCategoryOf` computes it: the registry's actions, then its
 * families, then the first words, in that order (a `case` takes the first branch that holds), else the default.
 * `audit-journal.integration.test.ts` checks, through the route, that the two agree on every action.
 */
function categorySql(action: SQL): SQL {
  const exact = AUDIT_CATEGORIES.flatMap((category) => {
    const names = Object.entries(AUDIT_ACTIONS)
      .filter(([, definition]) => definition.category === category)
      .map(([name]) => sql`${name}`);
    return names.length === 0
      ? []
      : [sql`when ${action} in (${sql.join(names, sql`, `)}) then ${category}::text`];
  });
  const families = AUDIT_ACTION_FAMILIES.map(
    (family) =>
      sql`when starts_with(${action}, ${family.prefix}) then ${family.definition('').category}::text`,
  );
  const prefixes = AUDIT_CATEGORY_PREFIXES.map(
    (rule) => sql`when starts_with(${action}, ${rule.prefix}) then ${rule.category}::text`,
  );
  return sql`(case ${sql.join([...exact, ...families, ...prefixes], sql` `)} else ${AUDIT_DEFAULT_CATEGORY}::text end)`;
}

const RowSchema = z.object({
  id: z.uuid(),
  user_id: z.string().nullable(),
  action: z.string(),
  entity: z.string(),
  entity_id: z.string().nullable(),
  details: z.unknown(),
  created_at: z.coerce.date(),
  position_at: z.string(),
  author_name: z.string().nullable(),
});

const NameSchema = z.object({ kind: z.enum(['member', 'creator']), id: z.string(), name: z.string() });

/** The selection as conditions on `audit_log`, aliased `a`. */
function conditionsOf(selection: AuditSelection, after: AuditPosition | null): SQL | undefined {
  const conditions: SQL[] = [];
  if (selection.userId !== undefined) conditions.push(sql`a.user_id = ${selection.userId}`);
  if (selection.category !== undefined)
    conditions.push(sql`${categorySql(sql`a.action`)} = ${selection.category}`);
  if (selection.from !== undefined)
    conditions.push(sql`a.created_at >= ${selection.from.toISOString()}::timestamptz`);
  if (selection.to !== undefined)
    conditions.push(sql`a.created_at < ${selection.to.toISOString()}::timestamptz`);
  // Strictly after the page before, in the order of the page: (created_at, id) descending.
  if (after !== null)
    conditions.push(sql`(a.created_at, a.id) < (${after.at}::timestamptz, ${after.id}::uuid)`);
  return conditions.length === 0 ? undefined : and(...conditions);
}

export function createPostgresAuditStore(adminDb: Database): AuditStore {
  return {
    rowsUnscoped: (selection, after, limit) =>
      withAdmin(adminDb, async (tx) => {
        const where = conditionsOf(selection, after);
        const result = await tx.execute(sql`
          select a.id, a.user_id, a.action, a.entity, a.entity_id, a.details, a.created_at,
                 to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as position_at,
                 coalesce(
                   (select m.display_name from team_members m where m.user_id = a.user_id limit 1),
                   (select u.name from "user" u where u.id = a.user_id)
                 ) as author_name
            from audit_log a
           ${where === undefined ? sql`` : sql`where ${where}`}
           order by a.created_at desc, a.id desc
           limit ${limit}`);
        return result.rows.map((raw): StoredAuditRow => {
          const row = RowSchema.parse(raw);
          return {
            id: row.id,
            at: row.created_at,
            position: { at: row.position_at, id: row.id },
            userId: row.user_id,
            authorName: row.author_name,
            action: row.action,
            entity: row.entity,
            entityId: row.entity_id,
            details: row.details,
          };
        });
      }),

    namesUnscoped: async (ids) => {
      const members = new Map<string, string>();
      const creators = new Map<string, string>();
      const names: AuditNames = { members, creators };
      if (ids.length === 0) return names;
      // One parameter whatever the number of ids: an export may name many.
      const wanted = sql`string_to_array(${ids.join(',')}, ',')::uuid[]`;
      const result = await withAdmin(adminDb, (tx) =>
        tx.execute(sql`
          select 'member' as kind, m.id::text as id, m.display_name as name
            from team_members m where m.id = any(${wanted})
          union all
          select 'creator' as kind, c.id::text as id, c.display_name as name
            from creators c where c.id = any(${wanted})`),
      );
      for (const raw of result.rows) {
        const row = NameSchema.parse(raw);
        (row.kind === 'member' ? members : creators).set(row.id, row.name);
      }
      return names;
    },

    recordExportUnscoped: (actor: AuditActor, rows: number) =>
      withAdmin(adminDb, async (tx) => {
        await tx.insert(auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: actor.userId,
          action: 'audit.export',
          entity: 'audit_log',
          entityId: null,
          details: { rows },
          ip: actor.ip,
        });
      }),
  };
}
