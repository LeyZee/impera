import {
  CreatorIdSchema,
  McpGrantCreatedSchema,
  McpGrantListSchema,
  McpTokenSchema,
  newId,
  TeamMemberIdSchema,
  type CreatorId,
} from '@impera/contracts';
import { and, eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { createMcpModule, type McpModule } from '../modules/mcp';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';
const OWNER = { email: 'owner@example.test', name: 'Owner', password: PASSWORD };

/**
 * Réglages › Agents connectés (MCP lot a, ADR 0026 § 3, ADR 0105): the owner creates, lists and revokes his agent
 * accesses; a token is shown once, found by its fingerprint only while live. Invented data only (ADR 0010).
 */
describe('/v1/settings/mcp-grants', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let mcp: McpModule;
  let nora: CreatorId;
  const cookies = { owner: '', manager: '' };

  const call = (method: 'GET' | 'POST' | 'DELETE', url: string, cookie: string, payload?: object) =>
    server.inject({
      method,
      url,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      ...(payload === undefined ? {} : { payload }),
    });
  const codeOf = (response: { json: () => unknown }): string =>
    z.object({ error: z.object({ code: z.string() }) }).parse(response.json()).error.code;
  const body = (over: Record<string, unknown> = {}) => ({
    label: 'Claude Code du PC',
    creatorId: nora,
    capabilities: ['read:status', 'read:conversations'],
    days: 30,
    ...over,
  });

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
    app = await createApp(config, createLogger(config));
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    mcp = createMcpModule({
      db: app.db.db,
      adminDb: app.adminDb.db,
      actorOf: () => Promise.resolve(null),
      creators: { unarchived: () => Promise.resolve([]) },
      fans: {
        getFan: () => Promise.resolve(null),
        activeFacts: () => Promise.resolve([]),
        flags: () => Promise.resolve({}),
        card: () => Promise.reject(new Error('no fan here')),
      },
    });
    nora = newId(CreatorIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: nora, nameKey: nora, displayName: 'Nora', timezone: 'Europe/Paris' });
    await createOwner(app.auth, app.db.db, OWNER);
    cookies.owner = await signIn(server, OWNER.email, OWNER.password);
    const manager = await createOwner(app.auth, app.db.db, {
      email: 'manager@example.test',
      name: 'Manager',
      password: PASSWORD,
    });
    await test.admin.db
      .update(schema.user)
      .set({ role: 'operator' })
      .where(eq(schema.user.id, manager.userId));
    await test.admin.db.insert(schema.teamMembers).values({
      id: newId(TeamMemberIdSchema),
      userId: manager.userId,
      teamRole: 'manager',
      firstName: 'Prénom',
      lastName: 'Inventé',
      displayName: 'Membre manager',
      country: 'BJ',
      timeZone: 'Africa/Porto-Novo',
      joinedOn: '2026-10-01',
    });
    cookies.manager = await signIn(server, 'manager@example.test', PASSWORD);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('creates an access, shows its token once, and lists it without', async () => {
    const response = await call('POST', '/v1/settings/mcp-grants', cookies.owner, body());
    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const created = McpGrantCreatedSchema.parse(response.json());
    expect(McpTokenSchema.safeParse(created.token).success).toBe(true);
    expect(created.capabilities).toEqual(['read:status', 'read:conversations']);
    const listed = await call('GET', '/v1/settings/mcp-grants', cookies.owner);
    expect(listed.statusCode).toBe(200);
    expect(listed.body).not.toContain(created.token);
    const items = McpGrantListSchema.parse(listed.json()).items;
    expect(items.map((item) => item.id)).toContain(created.id);
    const [stored] = await test.admin.db
      .select({ tokenHash: schema.mcpGrants.tokenHash })
      .from(schema.mcpGrants)
      .where(eq(schema.mcpGrants.id, created.id));
    expect(stored?.tokenHash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.token).not.toContain(stored?.tokenHash ?? '-');
    const audit = await test.admin.db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entity, 'mcp_grant'), eq(schema.auditLog.entityId, created.id)));
    expect(audit.map((row) => row.action)).toEqual(['mcp_grant.create']);
  });

  it('is the owner’s alone', async () => {
    expect((await call('GET', '/v1/settings/mcp-grants', cookies.manager)).statusCode).toBe(403);
    expect((await call('POST', '/v1/settings/mcp-grants', cookies.manager, body())).statusCode).toBe(403);
  });

  it('refuses a capability twice, a capability outside the list, more than 90 days and an unknown creator', async () => {
    const twice = await call(
      'POST',
      '/v1/settings/mcp-grants',
      cookies.owner,
      body({ capabilities: ['read:fans', 'read:fans'] }),
    );
    expect(twice.statusCode).toBe(422);
    expect(
      z.object({ error: z.object({ details: z.object({ kind: z.string() }) }) }).parse(twice.json()).error
        .details.kind,
    ).toBe('capability_repeated');
    expect(
      (await call('POST', '/v1/settings/mcp-grants', cookies.owner, body({ capabilities: ['write:fans'] })))
        .statusCode,
    ).toBe(400);
    expect(
      (await call('POST', '/v1/settings/mcp-grants', cookies.owner, body({ days: 91 }))).statusCode,
    ).toBe(400);
    const unknown = await call(
      'POST',
      '/v1/settings/mcp-grants',
      cookies.owner,
      body({ creatorId: newId(CreatorIdSchema) }),
    );
    expect(unknown.statusCode).toBe(404);
    expect(codeOf(unknown)).toBe('reference_not_found');
  });

  it('finds the access of a live token, stamps its use, and nothing once revoked', async () => {
    const created = McpGrantCreatedSchema.parse(
      (await call('POST', '/v1/settings/mcp-grants', cookies.owner, body({ creatorId: null }))).json(),
    );
    const found = await mcp.grantOfToken(created.token);
    expect(found?.id).toBe(created.id);
    expect(found?.creatorId).toBeNull();
    const [used] = await test.admin.db
      .select({ lastUsedAt: schema.mcpGrants.lastUsedAt })
      .from(schema.mcpGrants)
      .where(eq(schema.mcpGrants.id, created.id));
    expect(used?.lastUsedAt).not.toBeNull();
    // Its last character changed: one that differs, or a token ending in « A » would still be found (1 time in 64).
    const other = created.token.endsWith('A') ? 'B' : 'A';
    expect(await mcp.grantOfToken(`${created.token.slice(0, -1)}${other}`)).toBeNull();
    expect(await mcp.grantOfToken('not-a-token')).toBeNull();

    expect((await call('DELETE', `/v1/settings/mcp-grants/${created.id}`, cookies.manager)).statusCode).toBe(
      403,
    );
    expect((await call('DELETE', `/v1/settings/mcp-grants/${created.id}`, cookies.owner)).statusCode).toBe(
      204,
    );
    expect(await mcp.grantOfToken(created.token)).toBeNull();
    const again = await call('DELETE', `/v1/settings/mcp-grants/${created.id}`, cookies.owner);
    expect(again.statusCode).toBe(404);
    expect(codeOf(again)).toBe('mcp_grant_not_found');
  });

  it('gives nothing once its person is no longer the owner', async () => {
    const created = McpGrantCreatedSchema.parse(
      (await call('POST', '/v1/settings/mcp-grants', cookies.owner, body())).json(),
    );
    const [grant] = await test.admin.db
      .select({ userId: schema.mcpGrants.userId })
      .from(schema.mcpGrants)
      .where(eq(schema.mcpGrants.id, created.id));
    const userId = grant?.userId ?? '';
    await test.admin.db.update(schema.user).set({ role: 'operator' }).where(eq(schema.user.id, userId));
    try {
      expect(await mcp.grantOfToken(created.token)).toBeNull();
    } finally {
      await test.admin.db.update(schema.user).set({ role: 'owner' }).where(eq(schema.user.id, userId));
    }
    expect((await mcp.grantOfToken(created.token))?.id).toBe(created.id);
  });

  it('finds nothing for an expired access', async () => {
    const created = McpGrantCreatedSchema.parse(
      (await call('POST', '/v1/settings/mcp-grants', cookies.owner, body({ days: 1 }))).json(),
    );
    // Moved back in time by the owner of the base, as a day passing would: the check holds expiry after creation.
    await test.admin.db
      .update(schema.mcpGrants)
      .set({ createdAt: new Date(Date.now() - 3 * 86_400_000), expiresAt: new Date(Date.now() - 86_400_000) })
      .where(eq(schema.mcpGrants.id, created.id));
    expect(await mcp.grantOfToken(created.token)).toBeNull();
  });
});
