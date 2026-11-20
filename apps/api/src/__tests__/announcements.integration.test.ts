import {
  AnnouncementListSchema,
  ApiErrorSchema,
  AnnouncementReaderListSchema,
  AnnouncementReadSchema,
  AnnouncementSchema,
  CreatorIdSchema,
  newId,
  TeamMemberIdSchema,
  type Announcement,
  type CreatorId,
} from '@impera/contracts';
import { and, eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { fixedComposer } from './support/composer';
import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';

interface Person {
  readonly userId: string;
  readonly memberId: string;
  readonly cookie: string;
}

/**
 * Annonces (EQ-12): the owner or an active manager writes to the whole team or to a creator's members, a manager only
 * to a creator of his own list; each member reads those addressed to him and says « Lu » once; the owner and the
 * managers see who read; withdrawn by its author or the owner, never edited nor deleted. Invented data only (ADR 0010).
 */
describe('announcements to the team (EQ-12)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let ownerCookie: string;
  let people = 0;
  const nora = newId(CreatorIdSchema);
  const ines = newId(CreatorIdSchema);
  let manager: Person;
  let onNora: Person;
  let onInes: Person;

  function call(method: 'GET' | 'POST', url: string, cookie: string, payload?: object) {
    return server.inject({
      method,
      url,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      ...(payload === undefined ? {} : { payload }),
    });
  }

  async function person(teamRole: 'chatter' | 'manager', creatorIds: CreatorId[]): Promise<Person> {
    people += 1;
    const email = `${teamRole}-${String(people)}@example.test`;
    const { userId } = await createOwner(app.auth, app.db.db, {
      email,
      name: `${teamRole} ${String(people)}`,
      password: PASSWORD,
    });
    await test.admin.db
      .update(schema.user)
      .set({ role: 'operator', creatorIds })
      .where(eq(schema.user.id, userId));
    const memberId = newId(TeamMemberIdSchema);
    await test.admin.db.insert(schema.teamMembers).values({
      id: memberId,
      userId,
      teamRole,
      firstName: 'Prénom',
      lastName: 'Inventé',
      displayName: `${teamRole} ${String(people)}`,
      country: 'BJ',
      timeZone: 'Africa/Porto-Novo',
      joinedOn: '2026-10-01',
    });
    return { userId, memberId, cookie: await signIn(server, email, PASSWORD) };
  }

  async function write(cookie: string, body: string, creatorId: CreatorId | null): Promise<Announcement> {
    const response = await call('POST', '/v1/team/announcements', cookie, { body, creatorId });
    expect(response.statusCode).toBe(201);
    return AnnouncementSchema.parse(response.json());
  }

  const listOf = async (cookie: string) =>
    AnnouncementListSchema.parse((await call('GET', '/v1/team/announcements', cookie)).json()).announcements;

  const find = async (cookie: string, id: string) => (await listOf(cookie)).find((one) => one.id === id);

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
    app = await createApp(config, createLogger(config), { composer: fixedComposer });
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    for (const [id, label] of [
      [nora, 'Nora'],
      [ines, 'Inès'],
    ] as const) {
      await test.admin.db
        .insert(schema.creators)
        .values({ id, nameKey: id, displayName: label, timezone: 'Europe/Paris' });
    }
    const owner = { email: 'owner@example.test', name: 'Owner', password: PASSWORD };
    await createOwner(app.auth, app.db.db, owner);
    ownerCookie = await signIn(server, owner.email, owner.password);
    manager = await person('manager', [nora]);
    onNora = await person('chatter', [nora]);
    onInes = await person('chatter', [ines]);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('shows an announcement to the whole team to every member, and how many read it to the owner alone', async () => {
    const all = await write(ownerCookie, 'Réunion inventée lundi à 10 h', null);
    expect(all).toMatchObject({ creatorId: null, creatorName: null, mine: true, readAt: null });
    expect(all.reads).toEqual({ read: 0, of: 3 });

    for (const member of [onNora, onInes]) {
      const seen = await find(member.cookie, all.id);
      expect(seen).toMatchObject({
        body: 'Réunion inventée lundi à 10 h',
        mine: false,
        reads: null,
        readAt: null,
      });
    }
    expect((await find(manager.cookie, all.id))?.reads).toEqual({ read: 0, of: 3 });

    const first = AnnouncementReadSchema.parse(
      (await call('POST', `/v1/team/announcements/${all.id}/read`, onNora.cookie)).json(),
    );
    // A second « Lu » keeps the first.
    const again = AnnouncementReadSchema.parse(
      (await call('POST', `/v1/team/announcements/${all.id}/read`, onNora.cookie)).json(),
    );
    expect(again.readAt).toBe(first.readAt);
    expect((await find(onNora.cookie, all.id))?.readAt).toBe(first.readAt);
    expect((await find(ownerCookie, all.id))?.reads).toEqual({ read: 1, of: 3 });

    const readers = AnnouncementReaderListSchema.parse(
      (await call('GET', `/v1/team/announcements/${all.id}/readers`, ownerCookie)).json(),
    ).readers;
    expect(readers[0]).toMatchObject({ memberId: onNora.memberId, readAt: first.readAt });
    expect(readers.map((one) => one.memberId).sort()).toEqual(
      [manager.memberId, onNora.memberId, onInes.memberId].sort(),
    );
    // Who read is not a chatter's to see.
    expect((await call('GET', `/v1/team/announcements/${all.id}/readers`, onInes.cookie)).statusCode).toBe(
      403,
    );
  });

  it('keeps a creator’s announcement to her members, the same answer for anyone else', async () => {
    const toNora = await write(ownerCookie, 'Nouveau script inventé pour Nora', nora);
    expect(toNora).toMatchObject({ creatorId: nora, creatorName: 'Nora', reads: { read: 0, of: 2 } });

    expect(await find(onNora.cookie, toNora.id)).toBeDefined();
    expect(await find(onInes.cookie, toNora.id)).toBeUndefined();
    const refused = await call('POST', `/v1/team/announcements/${toNora.id}/read`, onInes.cookie);
    expect(refused.statusCode).toBe(404);
    expect(refused.json()).toMatchObject({ error: { code: 'announcement_not_found' } });
    const unknown = await call(
      'POST',
      `/v1/team/announcements/${newId(CreatorIdSchema)}/read`,
      onInes.cookie,
    );
    const said = (response: typeof refused) => {
      const { code, message } = ApiErrorSchema.parse(response.json()).error;
      return { status: response.statusCode, code, message };
    };
    expect(said(unknown)).toEqual(said(refused));

    const readers = AnnouncementReaderListSchema.parse(
      (await call('GET', `/v1/team/announcements/${toNora.id}/readers`, manager.cookie)).json(),
    ).readers;
    expect(readers.map((one) => one.memberId).sort()).toEqual([manager.memberId, onNora.memberId].sort());
  });

  it('lets a manager write to his own creators only, and a chatter not at all', async () => {
    const own = await write(manager.cookie, 'Pensez aux rapports inventés', nora);
    // He is not among those it is addressed to.
    expect(own.reads).toEqual({ read: 0, of: 1 });
    expect((await find(manager.cookie, own.id))?.mine).toBe(true);

    const other = await call('POST', '/v1/team/announcements', manager.cookie, {
      body: 'Hors de sa liste',
      creatorId: ines,
    });
    expect(other.statusCode).toBe(403);
    expect(other.json()).toMatchObject({ error: { code: 'announcement_creator_forbidden' } });
    expect((await write(manager.cookie, 'À toute l’équipe, inventé', null)).reads).toEqual({
      read: 0,
      of: 2,
    });

    const chatter = await call('POST', '/v1/team/announcements', onNora.cookie, {
      body: 'Non',
      creatorId: null,
    });
    expect(chatter.statusCode).toBe(403);
    // The owner is no member: nothing to say « Lu » to.
    expect((await call('POST', `/v1/team/announcements/${own.id}/read`, ownerCookie)).statusCode).toBe(404);
  });

  it('withdraws by its author or the owner, and then nobody reads it', async () => {
    const byOwner = await write(ownerCookie, 'Annonce inventée du propriétaire', null);
    expect(
      (await call('POST', `/v1/team/announcements/${byOwner.id}/withdraw`, onNora.cookie)).statusCode,
    ).toBe(403);
    const managerTried = await call('POST', `/v1/team/announcements/${byOwner.id}/withdraw`, manager.cookie);
    expect(managerTried.statusCode).toBe(403);
    expect(managerTried.json()).toMatchObject({ error: { code: 'announcement_withdraw_forbidden' } });

    const byManager = await write(manager.cookie, 'Annonce inventée du manager', null);
    expect(
      (await call('POST', `/v1/team/announcements/${byManager.id}/withdraw`, manager.cookie)).statusCode,
    ).toBe(204);
    expect(
      (await call('POST', `/v1/team/announcements/${byOwner.id}/withdraw`, ownerCookie)).statusCode,
    ).toBe(204);
    for (const cookie of [ownerCookie, manager.cookie, onNora.cookie]) {
      expect(await find(cookie, byOwner.id)).toBeUndefined();
      expect(await find(cookie, byManager.id)).toBeUndefined();
    }
    expect((await call('POST', `/v1/team/announcements/${byOwner.id}/read`, onNora.cookie)).statusCode).toBe(
      404,
    );
    expect(
      (await call('POST', `/v1/team/announcements/${byOwner.id}/withdraw`, ownerCookie)).statusCode,
    ).toBe(404);

    // Who wrote, who withdrew: never the text.
    const traces = await test.admin.db
      .select({ action: schema.auditLog.action, details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entity, 'announcement'), eq(schema.auditLog.entityId, byOwner.id)));
    expect(traces.map((one) => one.action).sort()).toEqual(['announcement.create', 'announcement.withdraw']);
    expect(JSON.stringify(traces)).not.toContain('inventée');
  });

  it('lets the app only add, say « Lu » and withdraw: no edit, no delete, the reads its own', async () => {
    const privileges = z
      .object({
        update_body: z.boolean(),
        update_withdrawn: z.boolean(),
        del: z.boolean(),
        del_reads: z.boolean(),
        update_reads: z.boolean(),
      })
      .parse(
        (
          await test.admin.db.execute(sql`select
            has_column_privilege('nirvana_app', 'announcements', 'body', 'UPDATE') as update_body,
            has_column_privilege('nirvana_app', 'announcements', 'withdrawn_at', 'UPDATE') as update_withdrawn,
            has_table_privilege('nirvana_app', 'announcements', 'DELETE') as del,
            has_table_privilege('nirvana_app', 'announcement_reads', 'DELETE') as del_reads,
            has_table_privilege('nirvana_app', 'announcement_reads', 'UPDATE') as update_reads`)
        ).rows[0],
      );
    expect(privileges).toEqual({
      update_body: false,
      update_withdrawn: true,
      del: false,
      del_reads: false,
      update_reads: false,
    });
  });
});
