import { randomUUID } from 'node:crypto';

import {
  CREATOR_MESSAGE_ANSWERED_CONFLICT,
  CreatorIdSchema,
  newId,
  TeamMemberIdSchema,
  ToAgencyMessageSchema,
  ToAgencyMessagesSchema,
  WaitingToAgencyMessagesSchema,
  type CreatorId,
} from '@impera/contracts';
import { eq, schema, withTenantMember } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';

/**
 * « Écrire à l'agence » (trous béants n° 13): she writes, once even sent twice; her owner and an active manager read
 * what waits; the owner alone answers, once; the answer comes back on her card, never on another creator's. Invented
 * data only (ADR 0010).
 */
describe('what she writes to the agency, and the owner’s answer', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let nora: CreatorId;
  let ines: CreatorId;
  let managerUserId = '';
  const cookies: Record<'nora' | 'ines' | 'owner' | 'manager' | 'chatter', string> = {
    nora: '',
    ines: '',
    owner: '',
    manager: '',
    chatter: '',
  };

  const call = (method: 'GET' | 'POST', url: string, who: keyof typeof cookies, body?: object) =>
    server.inject({
      method,
      url,
      headers: { cookie: cookies[who], origin: DASHBOARD_ORIGIN },
      ...(body === undefined ? {} : { payload: body }),
    });

  async function account(email: string, set: Partial<typeof schema.user.$inferInsert>) {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    await test.admin.db.update(schema.user).set(set).where(eq(schema.user.id, userId));
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
    nora = newId(CreatorIdSchema);
    ines = newId(CreatorIdSchema);
    for (const [id, label] of [
      [nora, 'Nora'],
      [ines, 'Ines'],
    ] as const)
      await test.admin.db
        .insert(schema.creators)
        .values({ id, nameKey: id, displayName: label, timezone: 'Europe/Paris' });
    await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: PASSWORD,
    });
    cookies.owner = await signIn(server, 'owner@example.test', PASSWORD);
    for (const teamRole of ['manager', 'chatter'] as const) {
      const member = await account(`${teamRole}@example.test`, {
        role: 'operator',
        creatorIds: [nora, ines],
      });
      await test.admin.db.insert(schema.teamMembers).values({
        id: newId(TeamMemberIdSchema),
        userId: member.userId,
        teamRole,
        firstName: 'Prénom',
        lastName: 'Inventé',
        displayName: `Membre ${teamRole}`,
        country: 'FR',
        timeZone: 'Europe/Paris',
        joinedOn: '2026-10-01',
      });
      cookies[teamRole] = member.cookie;
      if (teamRole === 'manager') managerUserId = member.userId;
    }
    cookies.nora = (await account('nora@example.test', { role: 'creator', creatorIds: [nora] })).cookie;
    cookies.ines = (await account('ines@example.test', { role: 'creator', creatorIds: [ines] })).cookie;
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  const id = randomUUID();

  it('keeps her message once, even sent twice, and lists it as waiting for her owner and an active manager', async () => {
    const body = { id, kind: 'idea', body: '  Une séance  au bord du lac ?  ' };
    const first = await call('POST', '/v1/creator-space/messages', 'nora', body);
    expect(first.statusCode).toBe(201);
    const written = ToAgencyMessageSchema.parse(first.json());
    expect(written).toMatchObject({
      creatorId: nora,
      kind: 'idea',
      body: 'Une séance au bord du lac ?',
      answer: null,
    });
    const again = await call('POST', '/v1/creator-space/messages', 'nora', body);
    expect(ToAgencyMessageSchema.parse(again.json())).toEqual(written);

    for (const who of ['owner', 'manager'] as const) {
      const waiting = WaitingToAgencyMessagesSchema.parse(
        (await call('GET', '/v1/creator-messages/waiting', who)).json(),
      );
      expect(waiting.messages.map((m) => [m.id, m.creatorName])).toEqual([[id, 'Nora']]);
    }
    expect((await call('GET', '/v1/creator-messages/waiting', 'chatter')).statusCode).toBe(403);
    expect((await call('GET', '/v1/creator-messages/waiting', 'nora')).statusCode).toBe(403);
    // Another creator never reads it.
    expect(
      ToAgencyMessagesSchema.parse((await call('GET', '/v1/creator-space/messages', 'ines')).json()),
    ).toEqual({
      messages: [],
    });
  });

  it('takes the owner’s answer once, replays it, refuses other words, and refuses anyone else', async () => {
    const url = `/v1/creators/${nora}/messages/${id}/answer`;
    expect((await call('POST', url, 'manager', { answer: 'Oui' })).statusCode).toBe(403);
    expect((await call('POST', url, 'nora', { answer: 'Oui' })).statusCode).toBe(403);
    expect(
      (await call('POST', `/v1/creators/${ines}/messages/${id}/answer`, 'owner', { answer: 'Oui' }))
        .statusCode,
    ).toBe(404);
    const answered = await call('POST', url, 'owner', { answer: 'Oui, on la cale samedi' });
    expect(answered.statusCode).toBe(200);
    expect(ToAgencyMessageSchema.parse(answered.json()).answer).toBe('Oui, on la cale samedi');
    expect((await call('POST', url, 'owner', { answer: 'Oui, on la cale samedi' })).statusCode).toBe(200);
    const other = await call('POST', url, 'owner', { answer: 'Non' });
    expect(other.statusCode).toBe(409);
    expect(other.json()).toMatchObject({ error: { code: CREATOR_MESSAGE_ANSWERED_CONFLICT } });

    const mine = ToAgencyMessagesSchema.parse(
      (await call('GET', '/v1/creator-space/messages', 'nora')).json(),
    );
    expect(mine.messages[0]?.answer).toBe('Oui, on la cale samedi');
    expect(
      WaitingToAgencyMessagesSchema.parse((await call('GET', '/v1/creator-messages/waiting', 'owner')).json())
        .messages,
    ).toEqual([]);
  });

  it('lets no manager rewrite her words nor an answer in the base itself', async () => {
    const touched = await withTenantMember(app.db.db, nora, managerUserId, (tx) =>
      tx
        .update(schema.creatorMessages)
        .set({ answer: 'Autre chose' })
        .where(eq(schema.creatorMessages.id, id))
        .returning(),
    );
    expect(touched).toEqual([]);
  });
});
