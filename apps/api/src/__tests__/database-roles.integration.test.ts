import { createTestDb, type TestDb } from '@impera/db/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createApp } from '../composition-root';
import { assertDatabaseRoles, databaseRoleProblems } from '../database-roles';
import { createLogger } from '../logger';

import { testConfig } from './support/config';

const role = (
  name: string,
  superuser: boolean,
  bypassRls: boolean,
  powers: { owned?: number; memberOf?: string[] } = {},
) => ({
  name,
  superuser,
  bypassRls,
  createRole: superuser,
  createDb: superuser,
  owned: powers.owned ?? 0,
  powerfulMemberships: powers.memberOf ?? [],
});

describe('database roles at startup', () => {
  let test: TestDb;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
  });

  afterAll(async () => {
    await test.close();
  });

  it('accepts a service role that crosses tenants and owns nothing, and an app role that does not cross them', () => {
    const app = role('nirvana_app', false, false);
    expect(databaseRoleProblems(app, role('impera_service', false, true))).toEqual([]);
  });

  it('names each role that would make row-level security silent or moot', () => {
    const problems = databaseRoleProblems(
      role('nirvana_admin', false, true),
      role('neon_owner', false, false),
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/DATABASE_SERVICE_URL connects as "neon_owner", which lacks BYPASSRLS/);
    expect(problems[1]).toMatch(
      /DATABASE_URL connects as "nirvana_admin", which bypasses row-level security/,
    );
  });

  it('names a service role that could do more than read and write rows (ADR 0087)', () => {
    const app = role('nirvana_app', false, false);
    expect(databaseRoleProblems(app, role('postgres', true, true))[0]).toMatch(
      /"postgres", which is a superuser, can create roles, can create databases: it must be the service role/,
    );
    expect(databaseRoleProblems(app, role('nirvana_admin', false, true, { owned: 200 }))[0]).toMatch(
      /"nirvana_admin", which owns tables, or belongs to the role that owns them/,
    );
  });

  it('names a connection whose role belongs to a stronger one, like postgres on Supabase (ADR 0152 § 2)', () => {
    const problems = databaseRoleProblems(
      role('nirvana_app', false, false, { memberOf: ['postgres'] }),
      role('impera_service', false, true, { memberOf: ['nirvana_admin', 'postgres'] }),
    );
    expect(problems).toEqual([
      expect.stringMatching(/DATABASE_URL connects as "nirvana_app", which belongs to "postgres"/),
      expect.stringMatching(
        /DATABASE_SERVICE_URL connects as "impera_service", which belongs to "nirvana_admin", "postgres"/,
      ),
    ]);
  });

  it('refuses to start on an app role that belongs to a role able to create roles', async () => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const strong = `essai_strong_${suffix}`;
    const member = `essai_member_${suffix}`;
    const password = `essai-${suffix}`;
    const database = new URL(test.appUrl).pathname.slice(1);
    const root = new pg.Client({ connectionString: inject('pgSuperuserUrl') });
    await root.connect();
    await root.query(`create role ${strong} nologin createrole`);
    await root.query(`create role ${member} login password '${password}' nobypassrls in role ${strong}`);
    await root.query(`grant connect on database "${database}" to ${member}`);
    try {
      const url = new URL(test.appUrl);
      url.username = member;
      url.password = password;
      const config = testConfig({ DATABASE_URL: url.toString(), DATABASE_SERVICE_URL: test.serviceUrl });
      await expect(createApp(config, createLogger(config), { withPlayground: false })).rejects.toThrow(
        new RegExp(`"${member}", which belongs to "${strong}"`),
      );
    } finally {
      await root.query(`drop owned by ${member}`);
      await root.query(`drop role ${member}`);
      await root.query(`drop role ${strong}`);
      await root.end();
    }
  });

  it('reads the roles the two connections really use', async () => {
    await expect(assertDatabaseRoles(test.app.db, test.service.db)).resolves.toBeUndefined();
    await expect(assertDatabaseRoles(test.app.db, test.app.db)).rejects.toThrow(/lacks BYPASSRLS/);
    await expect(assertDatabaseRoles(test.app.db, test.admin.db)).rejects.toThrow(/owns tables/);
  });

  it('refuses to start the API or the worker on a service connection without BYPASSRLS', async () => {
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.appUrl });
    await expect(createApp(config, createLogger(config), { withPlayground: false })).rejects.toThrow(
      /deploy\.md § 1\.1.*"nirvana_app", which lacks BYPASSRLS/,
    );
  });

  it('refuses to start the API or the worker on the owner of the tables', async () => {
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.adminUrl });
    await expect(createApp(config, createLogger(config), { withPlayground: false })).rejects.toThrow(
      /"nirvana_admin", which .*owns tables/,
    );
  });

  it('refuses to start on an app connection that bypasses row-level security', async () => {
    const config = testConfig({ DATABASE_URL: test.adminUrl, DATABASE_SERVICE_URL: test.serviceUrl });
    await expect(createApp(config, createLogger(config), { withPlayground: false })).rejects.toThrow(
      /"nirvana_admin", which bypasses row-level security/,
    );
  });
});
