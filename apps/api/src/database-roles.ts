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
  /**
   * Other roles this one belongs to that can create roles or databases, are superusers or bypass row-level security:
   * a member may `SET ROLE` to them, so it holds their powers (ADR 0152 § 2: never `postgres` nor one of its members).
   */
  powerfulMemberships: z.array(z.string()),
});

type Role = z.infer<typeof RoleSchema>;

async function connectedRole(db: Database): Promise<Role> {
  const result = await db.execute(
    sql`select r.rolname as name, r.rolsuper as superuser, r.rolbypassrls as "bypassRls",
               r.rolcreaterole as "createRole", r.rolcreatedb as "createDb",
               (select count(*)::int
                  from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
                   and pg_has_role(current_user, c.relowner, 'MEMBER')) as owned,
               array(select p.rolname::text from pg_roles p
                      where p.rolname <> current_user
                        and pg_has_role(current_user, p.oid, 'MEMBER')
                        and (p.rolsuper or p.rolcreaterole or p.rolcreatedb or p.rolbypassrls)
                      order by p.rolname) as "powerfulMemberships"
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
  // A member of a stronger role holds its powers through `SET ROLE` (ADR 0152 § 2): `postgres` on Supabase, the owner.
  for (const [variable, role] of [
    ['DATABASE_URL', app],
    ['DATABASE_SERVICE_URL', service],
  ] as const) {
    if (role.powerfulMemberships.length > 0) {
      problems.push(
        `${variable} connects as "${role.name}", which belongs to ${role.powerfulMemberships.map((name) => `"${name}"`).join(', ')}: it must not be a member of a role with more powers`,
      );
    }
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

/** Roles a managed host creates for its own services: they must reach nothing of Impera (ADR 0152 § 2). */
const PREDEFINED_ROLES = [
  'anon',
  'authenticated',
  'service_role',
  'authenticator',
  'supabase_read_only_user',
];
/** The schemas Impera's data lives in. */
const OUR_SCHEMAS = ['public', 'graphile_worker'];

const ForeignAccessSchema = z.object({
  reachable: z.array(z.string()),
  owners: z.array(z.string()),
});

/**
 * Why the base is not as closed as ADR 0152 § 2 wants; empty when it is. Two things are read:
 * - a predefined role of the host with USAGE on one of our schemas (`packages/db/supabase/lock-down.sql` takes it
 *   away): without USAGE it reaches no table, function or sequence of the schema, whatever their own rights;
 * - more than one owner for the tables, views, sequences and functions of our schemas, those of extensions apart:
 *   everything is created by the owner role through the migrations, so another owner means an object created by
 *   hand, by `postgres` or by the host, with the host's default rights.
 */
export async function foreignAccessProblems(db: Database): Promise<string[]> {
  const result = await db.execute(
    sql`with schemas as (
          select n.oid, n.nspname from pg_namespace n
           where n.nspname = any(${sql.raw(`array['${OUR_SCHEMAS.join("','")}']`)})
        ),
        objects as (
          select c.relowner as owner, c.oid, 'pg_class'::regclass as catalog
            from pg_class c join schemas s on s.oid = c.relnamespace
           where c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
          union all
          select p.proowner, p.oid, 'pg_proc'::regclass
            from pg_proc p join schemas s on s.oid = p.pronamespace
        )
        select
          array(select r.rolname || ' on ' || s.nspname
                  from pg_roles r cross join schemas s
                 where r.rolname = any(${sql.raw(`array['${PREDEFINED_ROLES.join("','")}']`)})
                   and has_schema_privilege(r.oid, s.oid, 'USAGE')
                 order by 1) as reachable,
          array(select distinct pg_get_userbyid(o.owner)
                  from objects o
                 where not exists (select 1 from pg_depend d
                                    where d.classid = o.catalog and d.objid = o.oid and d.deptype = 'e')
                 order by 1) as owners`,
  );
  const { reachable, owners } = ForeignAccessSchema.parse(result.rows[0]);
  const problems: string[] = [];
  if (reachable.length > 0) {
    problems.push(
      `the host's roles reach our schemas (${reachable.join(', ')}): play packages/db/supabase/lock-down.sql as postgres`,
    );
  }
  if (owners.length > 1) {
    problems.push(
      `our schemas hold objects of several owners (${owners.join(', ')}): only the owner role creates them`,
    );
  }
  return problems;
}

/**
 * Refuses to start in production on a base the host's roles can still reach, or holding an object not created by the
 * migrations (ADR 0152 § 2). Elsewhere it only warns: a developer's base has no such roles, and a stray object there
 * is not worth stopping the day for.
 */
export async function assertNoForeignAccess(
  db: Database,
  production: boolean,
  warn: (message: string) => void,
): Promise<void> {
  const problems = await foreignAccessProblems(db);
  if (problems.length === 0) return;
  const message = `Database not closed to the host (docs/runbooks/deploy.md, ADR 0152 § 2): ${problems.join('; ')}`;
  if (production) throw new Error(message);
  warn(message);
}
