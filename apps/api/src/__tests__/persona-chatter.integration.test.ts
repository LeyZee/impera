import {
  ChatterPersonaSchema,
  CreatorIdSchema,
  newId,
  PlatformAccountIdSchema,
  ShiftIdSchema,
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
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { activateDemoPersona } from './support/persona';
import { signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';
const MINUTE = 60_000;

/**
 * The short sheet of her a chatter reads on shift (ADR 0153): only during his shift window on her, every opening in
 * the audit log once per quarter of an hour, never the agency's method. Invented data only (ADR 0010).
 */
describe('a creator’s sheet for the chatter (GET /v1/creators/:id/persona/chatter)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let ownerId: string;
  let ownerCookie: string;
  let members = 0;
  const nora: CreatorId = newId(CreatorIdSchema);
  const ines: CreatorId = newId(CreatorIdSchema);

  const codeOf = (response: { json: () => unknown }): string =>
    z.object({ error: z.object({ code: z.string() }) }).parse(response.json()).error.code;
  const read = (creatorId: string, cookie: string) =>
    server.inject({ method: 'GET', url: `/v1/creators/${creatorId}/persona/chatter`, headers: { cookie } });
  const openings = async (userId: string) =>
    test.admin.db
      .select({ entityId: schema.auditLog.entityId })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.userId, userId), eq(schema.auditLog.action, 'persona.open')));

  /** A chatter of Nora (scope `self`), signed in, with a shift on her from `from` to `to` minutes from now, if any. */
  async function chatter(window?: { from: number; to: number }): Promise<{ userId: string; cookie: string }> {
    members += 1;
    const email = `chatter-${String(members)}@example.test`;
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: 'chatter', password: PASSWORD });
    await test.admin.db
      .update(schema.user)
      .set({ role: 'operator', creatorIds: [nora] })
      .where(eq(schema.user.id, userId));
    const memberId = newId(TeamMemberIdSchema);
    await test.admin.db.insert(schema.teamMembers).values({
      id: memberId,
      userId,
      teamRole: 'chatter',
      firstName: 'Prénom',
      lastName: 'Inventé',
      displayName: `chatter ${String(members)}`,
      country: 'BJ',
      timeZone: 'Africa/Porto-Novo',
      joinedOn: '2026-10-01',
    });
    if (window !== undefined) {
      const accountId = newId(PlatformAccountIdSchema);
      await test.admin.db.insert(schema.platformAccounts).values({
        id: accountId,
        creatorId: nora,
        platform: 'reveal',
        handle: `shift-${accountId}`,
      });
      const base = Math.floor(Date.now() / MINUTE) * MINUTE;
      await test.admin.db.insert(schema.shifts).values({
        id: newId(ShiftIdSchema),
        creatorId: nora,
        platformAccountId: accountId,
        memberId,
        startsAt: new Date(base + window.from * MINUTE),
        endsAt: new Date(base + window.to * MINUTE),
        createdBy: ownerId,
        updatedBy: ownerId,
      });
    }
    return { userId, cookie: await signIn(server, email, PASSWORD) };
  }

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
    for (const [id, label] of [
      [nora, 'nora'],
      [ines, 'ines'],
    ] as const) {
      await test.admin.db
        .insert(schema.creators)
        .values({ id, nameKey: id, displayName: label, timezone: 'Europe/Paris' });
    }
    await activateDemoPersona(app, nora);
    const owner = { email: 'owner@example.test', name: 'Owner', password: PASSWORD };
    ({ userId: ownerId } = await createOwner(app.auth, app.db.db, owner));
    ownerCookie = await signIn(server, owner.email, owner.password);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('shows her sheet to a chatter on shift, his opening audited once, without the agency’s method', async () => {
    const onShift = await chatter({ from: -10, to: 60 });
    const first = await read(nora, onShift.cookie);
    expect(first.statusCode, first.body).toBe(200);
    const body = ChatterPersonaSchema.parse(first.json());
    expect(body.creatorId).toBe(nora);
    expect(body.sheet?.limits.never_say.length).toBeGreaterThan(0);
    for (const key of ['strategies', 'follow_ups', 'notifications', 'alert_keywords', 'birth_date'])
      expect(first.body, key).not.toContain(`"${key}"`);

    expect((await read(nora, onShift.cookie)).statusCode).toBe(200);
    expect(await openings(onShift.userId)).toEqual([{ entityId: nora }]);
  });

  it('refuses a chatter off shift, and another creator, before anything is written', async () => {
    const offShift = await chatter();
    const refused = await read(nora, offShift.cookie);
    expect([refused.statusCode, codeOf(refused)]).toEqual([403, 'persona_shift_forbidden']);
    const later = await chatter({ from: 300, to: 400 });
    expect(codeOf(await read(nora, later.cookie))).toBe('persona_shift_forbidden');
    const elsewhere = await read(ines, offShift.cookie);
    expect([elsewhere.statusCode, codeOf(elsewhere)]).toEqual([403, 'creator_forbidden']);
    expect(await openings(offShift.userId)).toEqual([]);
    expect(await openings(later.userId)).toEqual([]);
  });

  it('shows it to the owner untraced, and says when she has no version in force', async () => {
    expect((await read(nora, ownerCookie)).statusCode).toBe(200);
    expect(ChatterPersonaSchema.parse((await read(ines, ownerCookie)).json())).toEqual({
      creatorId: ines,
      sheet: null,
    });
    expect(await openings(ownerId)).toEqual([]);
  });
});
