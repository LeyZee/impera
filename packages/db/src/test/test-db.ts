import { randomBytes } from 'node:crypto';

import { Client } from 'pg';

import { createDbClient, type DbClient } from '../client';
import { runMigrations } from '../migrate';

export interface TestDb {
  /** Connected as `nirvana_admin` (owner, BYPASSRLS): seeding and `withAdmin`. */
  readonly admin: DbClient;
  /** Connected as `nirvana_app` (RLS applies): what the application sees. */
  readonly app: DbClient;
  /** Connection strings of the two roles, for code that builds its own pools (the API's composition root). */
  readonly adminUrl: string;
  readonly appUrl: string;
  close(): Promise<void>;
}

function asRole(superuserUrl: string, database: string, role: string, password: string): string {
  const url = new URL(superuserUrl);
  url.username = role;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

/** The password of the two test roles: `test`, or the one they already have on an existing server (recette MOT-12). */
export const testRolePassword = (): string => process.env['IMPERA_TEST_ROLE_PASSWORD'] ?? 'test';

/**
 * A fresh database for one test file, migrated with the real migrations (never a schema sync), owned by
 * `nirvana_admin`. `superuserUrl` comes from the global setup (`inject('pgSuperuserUrl')`).
 */
export async function createTestDb(superuserUrl: string, password = testRolePassword()): Promise<TestDb> {
  const database = `test_${randomBytes(6).toString('hex')}`;
  const root = new Client({ connectionString: superuserUrl });
  await root.connect();
  await root.query(`create database ${database} owner nirvana_admin`);
  await root.end();

  const adminUrl = asRole(superuserUrl, database, 'nirvana_admin', password);
  const appUrl = asRole(superuserUrl, database, 'nirvana_app', password);
  const admin = createDbClient(adminUrl, { max: 2 });
  await runMigrations(admin.db);
  const app = createDbClient(appUrl, { max: 4 });
  return {
    admin,
    app,
    adminUrl,
    appUrl,
    async close() {
      await Promise.all([admin.close(), app.close()]);
    },
  };
}
