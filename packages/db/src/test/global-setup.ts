import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Superuser URL of the Postgres the integration tests run against. */
    pgSuperuserUrl: string;
  }
}

/**
 * One Postgres per run (testing.md): a Testcontainers Postgres 16, or the server named by
 * `IMPERA_TEST_PG_URL` (a superuser URL) where Docker is not available. Creates the two roles the way production
 * has them: the owner with BYPASSRLS but not superuser, the app role with neither.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  let container: StartedPostgreSqlContainer | undefined;
  let url = process.env['IMPERA_TEST_PG_URL'];
  if (url === undefined || url === '') {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withUsername('postgres')
      .withPassword('postgres')
      .start();
    url = container.getConnectionUri();
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query(`
    do $$ begin
      if not exists (select from pg_roles where rolname = 'nirvana_admin') then
        create role nirvana_admin login password 'test' nosuperuser createdb bypassrls;
      end if;
      if not exists (select from pg_roles where rolname = 'nirvana_app') then
        create role nirvana_app login password 'test' nosuperuser nocreatedb nobypassrls;
      end if;
    end $$;
  `);
  await client.end();
  project.provide('pgSuperuserUrl', url);
  return async () => {
    await container?.stop();
  };
}
