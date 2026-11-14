import {
  ArchivedCreatorListSchema,
  ArchivedCreatorSchema,
  CreatorListSchema,
  CreatorPlannedSchema,
  CreatorSummarySchema,
  newId,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  ShiftTemplateIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
} from '@impera/contracts';
import { and, eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const PASSWORD = 'staple battery horse';
const HOUR = 3_600_000;
const ErrorBodySchema = z.object({
  error: z.object({ code: z.string(), details: z.unknown().optional() }),
});

/**
 * Her archiving (ADR 0071 § 2): refused while she is planned, then out of every list, her agent stopped, her links
 * out revoked and her sessions refused; reopened, she is listed again with her agent still off. Invented data only
 * (ADR 0010).
 */
describe('/v1/creators/:creatorId/archive and /restore', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let owner: Record<string, string>;

  async function account(email: string, set: Partial<typeof schema.user.$inferInsert>) {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    await test.admin.db.update(schema.user).set(set).where(eq(schema.user.id, userId));
    return { userId, headers: { cookie: await signIn(server, email, PASSWORD), origin: DASHBOARD_ORIGIN } };
  }

  const call = (
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    headers: Record<string, string>,
    payload?: object,
  ) => server.inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) });
  const codeOf = (response: { json: () => unknown }) => ErrorBodySchema.parse(response.json()).error.code;

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
    await createOwner(app.auth, app.db.db, OWNER);
    owner = { cookie: await signIn(server, OWNER.email, OWNER.password), origin: DASHBOARD_ORIGIN };
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('refuses while she is planned, then archives her and closes all she had open', async () => {
    const nora = await app.modules.persona.creators.create({ displayName: 'Nora' });
    const ines = await app.modules.persona.creators.create({ displayName: 'Ines' });
    const [ownerRow] = await test.admin.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, OWNER.email));
    if (ownerRow === undefined) throw new Error('owner missing');

    // Her own account, signed in, with a link out still live.
    const creator = await account('nora@example.test', { role: 'creator', creatorIds: [nora.id] });
    const link = await call('POST', `/v1/creators/${nora.id}/invitation-link`, owner, {
      purpose: 'invitation',
      email: 'nora@example.test',
    });
    expect(link.statusCode).toBe(200);
    expect((await call('GET', '/v1/me', creator.headers)).statusCode).toBe(200);

    // A shift still ahead and a weekly template still running on her.
    const accountId = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: accountId, creatorId: nora.id, platform: 'reveal', handle: 'nora-reveal' });
    const memberUserId = newId(UserIdSchema);
    const memberId = newId(TeamMemberIdSchema);
    await test.admin.db
      .insert(schema.user)
      .values({ id: memberUserId, name: 'Kofi', email: 'kofi@example.test' });
    await test.admin.db.insert(schema.teamMembers).values({
      id: memberId,
      userId: memberUserId,
      teamRole: 'chatter',
      firstName: 'Kofi',
      lastName: 'Inventé',
      displayName: 'Kofi',
      country: 'BJ',
      timeZone: 'Africa/Porto-Novo',
      joinedOn: '2026-09-01',
    });
    const shiftId = newId(ShiftIdSchema);
    const now = Math.floor(Date.now() / 60_000) * 60_000;
    await test.admin.db.insert(schema.shifts).values({
      id: shiftId,
      creatorId: nora.id,
      platformAccountId: accountId,
      memberId,
      startsAt: new Date(now + 2 * HOUR),
      endsAt: new Date(now + 4 * HOUR),
      createdBy: ownerRow.id,
      updatedBy: ownerRow.id,
    });
    const templateId = newId(ShiftTemplateIdSchema);
    await test.admin.db.insert(schema.shiftTemplates).values({
      id: templateId,
      creatorId: nora.id,
      platformAccountId: accountId,
      memberId,
      weekday: 1,
      startMinute: 600,
      endMinute: 720,
      validFrom: '2026-10-01',
      createdBy: ownerRow.id,
    });
    // A second one that starts far ahead: ended before its first day, it no longer holds her.
    const laterId = newId(ShiftTemplateIdSchema);
    await test.admin.db.insert(schema.shiftTemplates).values({
      id: laterId,
      creatorId: nora.id,
      platformAccountId: accountId,
      memberId,
      weekday: 3,
      startMinute: 600,
      endMinute: 720,
      validFrom: '2099-01-07',
      createdBy: ownerRow.id,
    });

    // Only the owner archives: a manager of hers is refused.
    const manager = await account('manager@example.test', { role: 'operator', creatorIds: [nora.id] });
    expect((await call('POST', `/v1/creators/${nora.id}/archive`, manager.headers)).statusCode).toBe(403);
    expect((await call('GET', '/v1/creators/archived', manager.headers)).statusCode).toBe(403);

    const planned = await call('POST', `/v1/creators/${nora.id}/archive`, owner);
    expect([planned.statusCode, codeOf(planned)]).toEqual([409, 'creator_planned_conflict']);
    expect(CreatorPlannedSchema.parse(ErrorBodySchema.parse(planned.json()).error.details)).toEqual({
      shiftsAhead: 1,
      templatesRunning: 2,
    });
    // Nothing archived.
    expect(
      CreatorListSchema.parse((await call('GET', '/v1/creators', owner)).json()).creators.map(
        (c) => c.displayName,
      ),
    ).toEqual(['Ines', 'Nora']);

    // The owner ends both in the agenda, then archives her.
    await test.admin.db
      .update(schema.shifts)
      .set({ cancelledAt: new Date() })
      .where(eq(schema.shifts.id, shiftId));
    // Each template ended in the agenda as the owner ends it: today for the running one, the day before its first
    // day for the one ahead; neither keeps her planned (Équipe's review of #562).
    for (const id of [templateId, laterId]) {
      expect((await call('DELETE', `/v1/scheduling/shift-templates/${id}`, owner)).statusCode).toBe(204);
    }
    const archived = await call('POST', `/v1/creators/${nora.id}/archive`, owner);
    expect(archived.statusCode).toBe(200);
    expect(ArchivedCreatorSchema.parse(archived.json())).toMatchObject({ id: nora.id, displayName: 'Nora' });
    // Asked twice, the same answer, one audit line.
    expect((await call('POST', `/v1/creators/${nora.id}/archive`, owner)).statusCode).toBe(200);

    // Out of every list, the owner's included; listed among the archived; her name still reserved.
    const listed = CreatorListSchema.parse((await call('GET', '/v1/creators', owner)).json()).creators;
    expect(listed.map((c) => c.id)).toEqual([ines.id]);
    expect(
      ArchivedCreatorListSchema.parse(
        (await call('GET', '/v1/creators/archived', owner)).json(),
      ).creators.map((c) => c.id),
    ).toEqual([nora.id]);
    const again = await call('POST', '/v1/creators', owner, { displayName: 'nora' });
    expect([again.statusCode, codeOf(again)]).toEqual([409, 'creator_name_conflict']);
    // Her history still reads her name.
    expect((await app.modules.persona.creators.list([nora.id])).map((c) => c.displayName)).toEqual(['Nora']);

    // Her agent stopped by its switch, with why.
    const [stopped] = await test.admin.db
      .select({ active: schema.killSwitches.active, reason: schema.killSwitches.reason })
      .from(schema.killSwitches)
      .where(and(eq(schema.killSwitches.scope, 'creator'), eq(schema.killSwitches.scopeId, nora.id)))
      .orderBy(sql`${schema.killSwitches.setAt} desc`)
      .limit(1);
    expect(stopped).toEqual({ active: true, reason: 'Créatrice archivée' });

    // Her space closed: the link revoked, her session refused, no sign-in, no new link.
    const live = await test.admin.db
      .select({ id: schema.invitationLinks.id })
      .from(schema.invitationLinks)
      .where(
        and(
          eq(schema.invitationLinks.userId, creator.userId),
          sql`${schema.invitationLinks.revokedAt} is null`,
        ),
      );
    expect(live).toEqual([]);
    expect((await call('GET', '/v1/me', creator.headers)).statusCode).toBe(401);
    const signInAgain = await server.inject({
      method: 'POST',
      url: '/v1/auth/sign-in/email',
      headers: { origin: DASHBOARD_ORIGIN },
      payload: { email: 'nora@example.test', password: PASSWORD },
    });
    expect(signInAgain.statusCode).toBe(401);
    const newLink = await call('POST', `/v1/creators/${nora.id}/invitation-link`, owner, {
      purpose: 'reset',
    });
    expect([newLink.statusCode, codeOf(newLink)]).toEqual([404, 'creator_not_found']);

    // A manager of hers no longer sees her either.
    expect(
      CreatorListSchema.parse((await call('GET', '/v1/creators', manager.headers)).json()).creators,
    ).toEqual([]);

    const audit = await test.admin.db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityId, nora.id), eq(schema.auditLog.action, 'creator.archive')));
    expect(audit).toHaveLength(1);
  });

  it('reopens her: listed again, her agent still off, her space closed until a new link', async () => {
    const lea = await app.modules.persona.creators.create({ displayName: 'Léa' });
    expect((await call('POST', `/v1/creators/${lea.id}/archive`, owner)).statusCode).toBe(200);
    const restored = await call('POST', `/v1/creators/${lea.id}/restore`, owner);
    expect(restored.statusCode).toBe(200);
    expect(CreatorSummarySchema.parse(restored.json())).toMatchObject({ id: lea.id, displayName: 'Léa' });
    expect(
      CreatorListSchema.parse((await call('GET', '/v1/creators', owner)).json()).creators.map((c) => c.id),
    ).toContain(lea.id);
    expect(
      ArchivedCreatorListSchema.parse(
        (await call('GET', '/v1/creators/archived', owner)).json(),
      ).creators.map((c) => c.id),
    ).not.toContain(lea.id);
    const [latest] = await test.admin.db
      .select({ active: schema.killSwitches.active })
      .from(schema.killSwitches)
      .where(and(eq(schema.killSwitches.scope, 'creator'), eq(schema.killSwitches.scopeId, lea.id)))
      .orderBy(sql`${schema.killSwitches.setAt} desc`)
      .limit(1);
    expect(latest).toEqual({ active: true });
    // A new link opens her space again.
    const link = await call('POST', `/v1/creators/${lea.id}/invitation-link`, owner, {
      purpose: 'invitation',
      email: 'lea@example.test',
    });
    expect(link.statusCode).toBe(200);
    // Unknown: 404, on both.
    const unknown = '0190f5c0-0000-7000-8000-000000000000';
    expect((await call('POST', `/v1/creators/${unknown}/archive`, owner)).statusCode).toBe(404);
    expect((await call('POST', `/v1/creators/${unknown}/restore`, owner)).statusCode).toBe(404);
  });
});
