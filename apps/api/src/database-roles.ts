import { sql, type Database } from '@impera/db';
import { z } from 'zod';

const RoleSchema = z.object({
  name: z.string(),
  superuser: z.boolean(),
  bypassRls: z.boolean(),
  createRole: z.boolean(),
  createDb: z.boolean(),
  /** Tables, views and sequences this role owns, or could act as the owner of through a role it belongs to. */
  owned: z.number().int(),
});

type Role = z.infer<typeof RoleSchema>;

async function connectedRole(db: Database): Promise<Role> {
  const result = await db.execute(
    sql`select r.rolname as name, r.rolsuper as superuser, r.rolbypassrls as "bypassRls",
               r.rolcreaterole as "createRole", r.rolcreatedb as "createDb",
               (select count(*)::int
                  from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
                   and pg_has_role(current_user, c.relowner, 'MEMBER')) as owned
        from pg_roles r where r.rolname = current_user`,
  );
  return RoleSchema.parse(result.rows[0]);
}

/** Why the two connections cannot run Impera as they are; empty when they can. */
export function databaseRoleProblems(app: Role, service: Role): string[] {
  const problems: string[] = [];
  // FORCE ROW LEVEL SECURITY binds every role: without BYPASSRLS, every `*Unscoped` read and `withAdmin` job sees
  // zero rows, without an error (deploy.md § 1.1).
  if (!service.superuser && !service.bypassRls) {
    problems.push(
      `DATABASE_SERVICE_URL connects as "${service.name}", which lacks BYPASSRLS: cross-tenant jobs and reads would see no rows`,
    );
  }
  // ADR 0087: the role behind `withAdmin` reads and writes rows, and nothing else.
  const powers = [
    service.superuser ? 'is a superuser' : null,
    service.createRole ? 'can create roles' : null,
    service.createDb ? 'can create databases' : null,
    service.owned > 0 ? 'owns tables, or belongs to the role that owns them' : null,
  ].filter((power) => power !== null);
  if (powers.length > 0) {
    problems.push(
      `DATABASE_SERVICE_URL connects as "${service.name}", which ${powers.join(', ')}: it must be the service role, never the owner`,
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
 * Refuses to start the API or the worker on database roles that would make row-level security silent, or that could
 * change the structure of the base (ADR 0087): the service role crosses tenants and owns nothing, the app role does
 * not cross them.
 */
export async function assertDatabaseRoles(db: Database, serviceDb: Database): Promise<void> {
  const [app, service] = await Promise.all([connectedRole(db), connectedRole(serviceDb)]);
  const problems = databaseRoleProblems(app, service);
  if (problems.length > 0) {
    throw new Error(`Database roles misconfigured (docs/runbooks/deploy.md § 1.1): ${problems.join('; ')}`);
  }
}
