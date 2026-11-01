import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createApp } from '../composition-root';
import { assertDatabaseRoles, databaseRoleProblems } from '../database-roles';
import { createLogger } from '../logger';

import { testConfig } from './support/config';

const role = (name: string, superuser: boolean, bypassRls: boolean) => ({ name, superuser, bypassRls });

describe('database roles at startup', () => {
  let test: TestDb;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
  });

  afterAll(async () => {
    await test.close();
  });

  it('accepts an admin role that crosses tenants, superuser or not, and an app role that does not', () => {
    const app = role('nirvana_app', false, false);
    expect(databaseRoleProblems(app, role('nirvana_admin', false, true))).toEqual([]);
    expect(databaseRoleProblems(app, role('postgres', true, true))).toEqual([]);
  });

  it('names each role that would make row-level security silent or moot', () => {
    const problems = databaseRoleProblems(
      role('nirvana_admin', false, true),
      role('neon_owner', false, false),
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/DATABASE_ADMIN_URL connects as "neon_owner", which lacks BYPASSRLS/);
    expect(problems[1]).toMatch(
      /DATABASE_URL connects as "nirvana_admin", which bypasses row-level security/,
    );
  });

  it('reads the roles the two connections really use', async () => {
    await expect(assertDatabaseRoles(test.app.db, test.admin.db)).resolves.toBeUndefined();
    await expect(assertDatabaseRoles(test.app.db, test.app.db)).rejects.toThrow(/lacks BYPASSRLS/);
  });

  it('refuses to start the API or the worker on an admin connection without BYPASSRLS', async () => {
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.appUrl });
    await expect(createApp(config, createLogger(config), { withPlayground: false })).rejects.toThrow(
      /deploy\.md § 1\.1.*"nirvana_app", which lacks BYPASSRLS/,
    );
  });

  it('refuses to start on an app connection that bypasses row-level security', async () => {
    const config = testConfig({ DATABASE_URL: test.adminUrl, DATABASE_ADMIN_URL: test.adminUrl });
    await expect(createApp(config, createLogger(config), { withPlayground: false })).rejects.toThrow(
      /"nirvana_admin", which bypasses row-level security/,
    );
  });
});
