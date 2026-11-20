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

/** Impera's own roles (ADR 0087): the only ones meant to reach its schemas. */
const OUR_ROLES = ['nirvana_app', 'impera_service', 'nirvana_admin'];
/** The schemas Impera's data lives in. */
const OUR_SCHEMAS = ['public', 'graphile_worker'];
/**
 * Built-in roles that read, or write, every table of the base whatever its rights: only the host gives them. A reader
 * is the accepted risk of ADR 0152; a non-superuser writer is not (none on Supabase, seen on 20/11: only its superuser),
 * and stays a problem like any role that reaches our schemas.
 */
const READ_ALL_ROLE = 'pg_read_all_data';
const WRITE_ALL_ROLE = 'pg_write_all_data';

const literalArray = (values: readonly string[]) => sql.raw(`array['${values.join("','")}']`);

const ForeignAccessSchema = z.object({
  reachable: z.array(z.string()),
  hostReaders: z.array(z.string()),
  owners: z.array(z.string()),
  migrator: z.string().nullable(),
});

export interface ForeignAccess {
  /** Why the base is not as closed as ADR 0152 § 2 wants; empty when it is. */
  readonly problems: readonly string[];
  /**
   * The host's own roles that read every table through `pg_read_all_data` (on Supabase: `postgres`,
   * `supabase_read_only_user`…). No right of ours can close the base to them: they are the host itself, an accepted
   * risk written in ADR 0152 (Conséquences), and are only named in the log.
   */
  readonly hostReaders: readonly string[];
}

/**
 * Reads how closed the base is (ADR 0152 § 2):
 * - a closed list: a role other than ours, a superuser or a reader of everything that has USAGE on one of our schemas
 *   is a problem (`packages/db/supabase/lock-down.sql` takes USAGE away). Without USAGE a role reaches no table,
 *   function or sequence of the schema, whatever their own rights;
 * - one owner for the tables, views, sequences and functions of our schemas (those of extensions apart), and it is
 *   the role that ran the migrations: another owner means an object created by hand, by `postgres` or by the host,
 *   with the host's default rights.
 */
export async function readForeignAccess(db: Database): Promise<ForeignAccess> {
  const result = await db.execute(
    sql`with schemas as (
          select n.oid, n.nspname from pg_namespace n where n.nspname = any(${literalArray(OUR_SCHEMAS)})
        ),
        objects as (
          select c.relowner as owner, c.oid, 'pg_class'::regclass as catalog
            from pg_class c join schemas s on s.oid = c.relnamespace
           where c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
          union all
          select p.proowner, p.oid, 'pg_proc'::regclass
            from pg_proc p join schemas s on s.oid = p.pronamespace
        ),
        others as (
          select r.oid, r.rolname from pg_roles r
           where not r.rolsuper
             and r.rolname <> all(${literalArray(OUR_ROLES)})
             and r.rolname not like 'pg\_%'
             and r.oid <> (select d.datdba from pg_database d where d.datname = current_database())
        ),
        readers as (
          select o.oid, o.rolname from others o
           where exists (select 1 from pg_roles b
                          where b.rolname = ${READ_ALL_ROLE} and pg_has_role(o.oid, b.oid, 'MEMBER'))
             and not exists (select 1 from pg_roles w
                              where w.rolname = ${WRITE_ALL_ROLE} and pg_has_role(o.oid, w.oid, 'MEMBER'))
        )
        select
          array(select o.rolname::text || ' on ' || s.nspname::text
                  from others o cross join schemas s
                 where has_schema_privilege(o.oid, s.oid, 'USAGE')
                   and not exists (select 1 from readers r where r.oid = o.oid)
                 order by 1) as reachable,
          array(select r.rolname::text from readers r order by 1) as "hostReaders",
          array(select distinct pg_get_userbyid(o.owner)::text
                  from objects o
                 where not exists (select 1 from pg_depend d
                                    where d.classid = o.catalog and d.objid = o.oid and d.deptype = 'e')
                 order by 1) as owners,
          (select pg_get_userbyid(c.relowner)::text from pg_class c
            where c.oid = to_regclass('drizzle.__drizzle_migrations')) as migrator`,
  );
  const { reachable, hostReaders, owners, migrator } = ForeignAccessSchema.parse(result.rows[0]);
  const problems: string[] = [];
  if (reachable.length > 0) {
    problems.push(
      `roles other than ours reach our schemas (${reachable.join(', ')}): play packages/db/supabase/lock-down.sql as postgres`,
    );
  }
  const strangers = owners.filter((owner) => owner !== migrator);
  if (strangers.length > 0) {
    problems.push(
      `our schemas hold objects owned by ${strangers.join(', ')}: only the role that ran the migrations${migrator === null ? '' : ` (${migrator})`} creates them`,
    );
  }
  return { problems, hostReaders };
}

/**
 * Refuses to start in production on a base other roles than ours can still reach, or holding an object not created
 * by the migrations (ADR 0152 § 2). Elsewhere it only warns: a developer's base is open to PUBLIC, and a stray object
 * there is not worth stopping the day for. The host's readers of everything are named, never refused.
 */
export async function assertNoForeignAccess(
  db: Database,
  production: boolean,
  log: { readonly warn: (message: string) => void; readonly info: (message: string) => void },
): Promise<void> {
  const { problems, hostReaders } = await readForeignAccess(db);
  if (hostReaders.length > 0) {
    log.info(`roles of the host that read every table (accepted, ADR 0152): ${hostReaders.join(', ')}`);
  }
  if (problems.length === 0) return;
  const message = `Database not closed to other roles (docs/runbooks/deploy.md, ADR 0152 § 2): ${problems.join('; ')}`;
  if (production) throw new Error(message);
  log.warn(message);
}
