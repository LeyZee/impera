import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { runMigrations as runJobQueueMigrations } from 'graphile-worker';

import type { Database, DbClient } from './client';

/** Folder of the reviewed SQL migrations, shipped with the package. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/** The role `withAdmin` runs on in the API and the worker (ADR 0087): it reads and writes rows and owns nothing. */
const SERVICE_ROLE = 'impera_service';

/**
 * What the service role may do in the job queue's own schema: add, take and finish jobs, nothing on its structure,
 * and it only reads the queue's own list of migrations.
 * Said again at every run, since a new version of Graphile Worker may add a table or a function.
 */
const JOB_QUEUE_GRANTS = sql.raw(`
  grant usage on schema graphile_worker to ${SERVICE_ROLE};
  grant select, insert, update, delete on all tables in schema graphile_worker to ${SERVICE_ROLE};
  grant usage, select on all sequences in schema graphile_worker to ${SERVICE_ROLE};
  grant execute on all functions in schema graphile_worker to ${SERVICE_ROLE};
  revoke insert, update, delete on graphile_worker.migrations from ${SERVICE_ROLE};
`);

/**
 * Applies the pending migrations, then the job queue's own (Graphile Worker manages its `graphile_worker` schema);
 * already applied ones are skipped (idempotent). Run as the owner role: since ADR 0087 neither the API nor the worker
 * can change a structure, so the job queue's schema is made here and no longer at their start.
 */
export async function runMigrations(admin: DbClient): Promise<void> {
  await migrate(admin.db, { migrationsFolder: MIGRATIONS_FOLDER });
  await runJobQueueMigrations({ pgPool: admin.pool });
  await admin.db.execute(JOB_QUEUE_GRANTS);
}

/**
 * Lets the service role log in with the password of `serviceUrl` (DATABASE_SERVICE_URL), the first time only: the
 * migration creates it without a login, so that no password lives in the repository. Run as the owner, after the
 * migrations. A role that can already log in is left alone, whatever its password: a password changed in the
 * database is never put back from the environment. `false` when nothing was changed.
 */
export async function ensureServiceLogin(admin: DbClient, serviceUrl: string): Promise<boolean> {
  const url = new URL(serviceUrl);
  if (decodeURIComponent(url.username) !== SERVICE_ROLE) {
    throw new Error(`DATABASE_SERVICE_URL must connect as ${SERVICE_ROLE} (ADR 0087).`);
  }
  const password = decodeURIComponent(url.password);
  if (password === '') throw new Error('DATABASE_SERVICE_URL must carry a password (ADR 0087).');
  const role = await admin.db.execute<{ canLogin: boolean }>(
    sql`select rolcanlogin as "canLogin" from pg_roles where rolname = ${SERVICE_ROLE}`,
  );
  if (role.rows[0]?.canLogin !== false) return false;
  // `alter role` takes no parameter: the password goes in as a literal, quoted by Postgres itself.
  const quoted = await admin.db.execute<{ statement: string }>(
    sql`select format('alter role %I login password %L', ${SERVICE_ROLE}::text, ${password}::text) as statement`,
  );
  const statement = quoted.rows[0]?.statement;
  if (statement === undefined) throw new Error('ensureServiceLogin: no statement');
  await admin.db.execute(sql.raw(statement));
  return true;
}

export interface MigrationStatus {
  readonly applied: number;
  readonly expected: number;
  readonly isUpToDate: boolean;
}

/**
 * Compares the migrations shipped with the code to the ones recorded by Drizzle, for `/ready`: a version deployed
 * before its migration job ran is not ready. Needs read access to `drizzle.__drizzle_migrations` (admin role).
 */
export async function migrationStatus(adminDb: Pick<Database, 'execute'>): Promise<MigrationStatus> {
  const shipped = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
  const latest = shipped.at(-1)?.folderMillis ?? 0;
  const table = await adminDb.execute<{ exists: boolean }>(
    sql`select to_regclass('drizzle.__drizzle_migrations') is not null as exists`,
  );
  if (table.rows[0]?.exists !== true) {
    return { applied: 0, expected: shipped.length, isUpToDate: shipped.length === 0 };
  }
  const result = await adminDb.execute<{ applied: number; latest: string | null }>(
    sql`select count(*)::int as applied, max(created_at)::text as latest from drizzle.__drizzle_migrations`,
  );
  const row = result.rows[0];
  const applied = row?.applied ?? 0;
  const appliedLatest = Number(row?.latest ?? 0);
  return {
    applied,
    expected: shipped.length,
    isUpToDate: applied >= shipped.length && appliedLatest >= latest,
  };
}
