import { sql, type Database } from '@nirvana/db';
import { z } from 'zod';

const RoleSchema = z.object({ name: z.string(), superuser: z.boolean(), bypassRls: z.boolean() });

type Role = z.infer<typeof RoleSchema>;

async function connectedRole(db: Database): Promise<Role> {
  const result = await db.execute(
    sql`select rolname as name, rolsuper as superuser, rolbypassrls as "bypassRls"
        from pg_roles where rolname = current_user`,
  );
  return RoleSchema.parse(result.rows[0]);
}

/** Why the two connections cannot run Nirvana as they are; empty when they can. */
export function databaseRoleProblems(app: Role, admin: Role): string[] {
  const problems: string[] = [];
  // FORCE ROW LEVEL SECURITY binds the table owner too: without BYPASSRLS, every `*Unscoped` read and `withAdmin`
  // job sees zero rows, without an error (deploy.md § 1.1).
  if (!admin.superuser && !admin.bypassRls) {
    problems.push(
      `DATABASE_ADMIN_URL connects as "${admin.name}", which lacks BYPASSRLS: cross-tenant jobs and reads would see no rows`,
    );
  }
  // The app role crossing tenants would make every RLS policy moot (ADR 0005).
  if (app.superuser || app.bypassRls) {
    problems.push(
      `DATABASE_URL connects as "${app.name}", which bypasses row-level security: it must be NOSUPERUSER NOBYPASSRLS`,
    );
  }
  return problems;
}

/**
 * Refuses to start the API or the worker on database roles that would make row-level security silent (P0 runbook
 * check, now enforced): the admin role must cross tenants, the app role must not.
 */
export async function assertDatabaseRoles(db: Database, adminDb: Database): Promise<void> {
  const [app, admin] = await Promise.all([connectedRole(db), connectedRole(adminDb)]);
  const problems = databaseRoleProblems(app, admin);
  if (problems.length > 0) {
    throw new Error(`Database roles misconfigured (docs/runbooks/deploy.md § 1.1): ${problems.join('; ')}`);
  }
}
