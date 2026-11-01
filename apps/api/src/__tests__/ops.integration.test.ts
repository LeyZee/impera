import { randomBytes } from 'node:crypto';

import { CreatorIdSchema, newId, PlatformAccountIdSchema } from '@nirvana/contracts';
import { decryptSecret, encryptSecret, eq, keyVersionOf, parseEncryptionKeys, schema } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { reencryptPlatformSessions, revokeDashboardSessions, setKillSwitch } from '../ops';
import { buildServer } from '../server';

import { testConfig } from './support/config';
import { signIn } from './support/sign-in';

const key = () => randomBytes(32).toString('base64');

describe('ops commands (P0-07b)', () => {
  let test: TestDb;
  let app: App;

  async function audit(action: string) {
    return test.admin.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, action));
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
    app = await createApp(config, createLogger(config));
  });

  afterAll(async () => {
    await app.shutdown();
    await test.close();
  });

  it('turns a creator kill switch on and off, with its event and audit lines', async () => {
    const creatorId = newId(CreatorIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: creatorId, displayName: 'Test', timezone: 'Europe/Paris' });
    await setKillSwitch(test.admin.db, {
      active: true,
      scope: 'creator',
      scopeId: creatorId,
      reason: 'test',
    });
    await setKillSwitch(test.admin.db, {
      active: false,
      scope: 'creator',
      scopeId: creatorId,
      reason: 'fin',
    });
    const switches = await test.admin.db
      .select()
      .from(schema.killSwitches)
      .where(eq(schema.killSwitches.scopeId, creatorId));
    expect(switches.map((row) => [row.active, row.creatorId])).toEqual([
      [true, creatorId],
      [false, creatorId],
    ]);
    // UUID v7 like every other row (ADR 0011): ids sort in the order the switches were set.
    expect(switches.map((row) => row.id[14])).toEqual(['7', '7']);
    expect(await audit('kill_switch.on')).toHaveLength(1);
    expect(await audit('kill_switch.off')).toHaveLength(1);
    const events = await test.admin.db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.type, 'kill_switch_toggled'));
    expect(events).toHaveLength(2);
    await expect(
      setKillSwitch(test.admin.db, { active: true, scope: 'global', scopeId: creatorId, reason: 'x' }),
    ).rejects.toThrow();
  });

  it('revokes the dashboard sessions: the cookie stops working', async () => {
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
    const server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    const owner = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
    await createOwner(app.auth, app.db.db, owner);
    const cookie = await signIn(server, owner.email, owner.password);
    expect((await server.inject({ method: 'GET', url: '/v1/me', headers: { cookie } })).statusCode).toBe(200);
    expect(await revokeDashboardSessions(test.admin.db, owner.email)).toBe(1);
    expect((await server.inject({ method: 'GET', url: '/v1/me', headers: { cookie } })).statusCode).toBe(401);
    expect(await audit('auth.sessions_revoked')).toHaveLength(1);
    await server.close();
  });

  it('re-seals platform sessions under the newest key, once', async () => {
    const creatorId = newId(CreatorIdSchema);
    const accountId = newId(PlatformAccountIdSchema);
    const oldKeys = parseEncryptionKeys(`v1:${key()}`);
    const rotated = parseEncryptionKeys(`v2:${key()},v1:${oldKeys[0]?.key.toString('base64') ?? ''}`);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: creatorId, displayName: 'Test', timezone: 'Europe/Paris' });
    await test.admin.db.insert(schema.platformAccounts).values({
      id: accountId,
      creatorId,
      platform: 'reveal',
      handle: 'rotate',
      sessionCiphertext: encryptSecret('session-a', oldKeys, accountId),
    });
    expect(await reencryptPlatformSessions(test.admin.db, rotated)).toBe(1);
    expect(await reencryptPlatformSessions(test.admin.db, rotated)).toBe(0);
    const [row] = await test.admin.db
      .select()
      .from(schema.platformAccounts)
      .where(eq(schema.platformAccounts.id, accountId));
    const sealed = row?.sessionCiphertext ?? Buffer.alloc(0);
    expect(keyVersionOf(sealed)).toBe('v2');
    expect(decryptSecret(sealed, rotated.slice(0, 1), accountId)).toBe('session-a');
  });
});
