import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import type { TestProject } from 'vitest/node';

import { testRolePassword } from './test-db';

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
  const password = testRolePassword();
  const client = new Client({ connectionString: url });
  await client.connect();
  // `do` blocks take no parameters: the password goes in as a literal, quoted by Postgres itself.
  const { rows } = await client.query<{ quoted: string }>('select quote_literal($1::text) as quoted', [
    password,
  ]);
  const quoted = rows[0]?.quoted ?? `'test'`;
  await client.query(`
    do $$ begin
      if not exists (select from pg_roles where rolname = 'nirvana_admin') then
        create role nirvana_admin login password ${quoted} nosuperuser createdb bypassrls;
      end if;
      if not exists (select from pg_roles where rolname = 'nirvana_app') then
        create role nirvana_app login password ${quoted} nosuperuser nocreatedb nobypassrls;
      end if;
    end $$;
  `);
  await client.end();
  // Roles left by another use of this server may have another password: say so once, before any test makes a database.
  const asAdmin = new URL(url);
  asAdmin.username = 'nirvana_admin';
  asAdmin.password = password;
  const probe = new Client({ connectionString: asAdmin.toString() });
  try {
    await probe.connect();
  } catch (error) {
    await container?.stop();
    throw new Error(
      'Les rôles nirvana_admin et nirvana_app existent déjà sur ce Postgres avec un autre mot de passe : ' +
        'donne-le dans IMPERA_TEST_ROLE_PASSWORD, ou utilise un Postgres jetable (testing.md).',
      { cause: error },
    );
  } finally {
    await probe.end().catch(() => undefined);
  }
  project.provide('pgSuperuserUrl', url);
  return async () => {
    await container?.stop();
  };
}
