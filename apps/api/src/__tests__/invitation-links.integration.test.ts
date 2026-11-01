import { Writable } from 'node:stream';

import { newId, TeamMemberIdSchema, UserIdSchema } from '@nirvana/contracts';
import { eq, schema, sql } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { liveInvitationLinksUnscoped } from '../invitation-links';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

// Invented people only (ADR 0010).
const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const PASSWORD = 'une phrase de passe assez longue';

type Json = Record<string, unknown>;

const ErrorBodySchema = z.object({
  error: z.object({ code: z.string(), details: z.record(z.string(), z.unknown()).optional() }),
});

describe('invitation links (EQ-10)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let owner = '';
  const logs: string[] = [];
  let address = 0;

  /** Each request from its own address, so the per-IP limits only bite where a test means them to. */
  const post = (url: string, payload: Json, headers: Record<string, string> = {}, remoteAddress?: string) =>
    server.inject({
      method: 'POST',
      url,
      payload,
      headers: { origin: DASHBOARD_ORIGIN, ...headers },
      remoteAddress:
        remoteAddress ?? `10.0.${String(Math.floor(address / 250))}.${String((address++ % 250) + 1)}`,
    });
  const codeOf = (response: { json: () => unknown }) => ErrorBodySchema.parse(response.json()).error;

  /** An invented chatter: his account (no password yet) and his record. */
  async function addMember(email: string): Promise<{ memberId: string; userId: string }> {
    const userId = newId(UserIdSchema);
    const memberId = newId(TeamMemberIdSchema);
    await test.admin.db.insert(schema.user).values({ id: userId, name: 'Théo', email, role: 'operator' });
    await test.admin.db.insert(schema.teamMembers).values({
      id: memberId,
      userId,
      teamRole: 'chatter',
      firstName: 'Théo',
      lastName: 'Inventé',
      displayName: 'Théo',
      country: 'BJ',
      timeZone: 'Africa/Porto-Novo',
      joinedOn: '2026-10-01',
    });
    return { memberId, userId };
  }

  async function newLink(memberId: string, purpose: 'invitation' | 'reset' = 'invitation') {
    const response = await post(
      `/v1/team/members/${memberId}/invitation-link`,
      { purpose },
      { cookie: owner },
    );
    expect(response.statusCode).toBe(200);
    const { url, expiresAt } = response.json<{ url: string; expiresAt: string }>();
    return { url, expiresAt, token: new URL(url).hash.slice('#t='.length) };
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_ADMIN_URL: test.adminUrl,
      LOG_LEVEL: 'info',
    });
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        logs.push(chunk.toString());
        done();
      },
    });
    const logger = createLogger(config, sink);
    app = await createApp(config, logger);
    server = await buildServer({ config, logger, routes: app.routes, readiness: app.readiness });
    await createOwner(app.auth, app.db.db, OWNER);
    owner = await signIn(server, OWNER.email, OWNER.password);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('gives the owner a link valid 72 h, its token in the fragment of the welcome page', async () => {
    const { memberId } = await addMember('link@example.test');
    const before = Date.now();
    const { url, expiresAt, token } = await newLink(memberId);
    expect(url).toMatch(/^http:\/\/localhost:5173\/bienvenue#t=[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(expiresAt) - before).toBeGreaterThan(71.9 * 3600 * 1000);
    expect(Date.parse(expiresAt) - before).toBeLessThan(72.1 * 3600 * 1000);
    const [stored] = await test.admin.db
      .select()
      .from(schema.invitationLinks)
      .where(eq(schema.invitationLinks.memberId, memberId));
    // Only its SHA-256 is kept.
    expect(stored?.tokenHash).not.toContain(token);
    expect(stored?.tokenHash).toHaveLength(43);

    const reset = await newLink(memberId, 'reset');
    expect(reset.url).toMatch(/\/nouveau-mot-de-passe#t=/);
  });

  it('keeps the links to the owner, for a member who exists and has not left', async () => {
    const { memberId, userId } = await addMember('guarded@example.test');
    expect(
      (await post(`/v1/team/members/${memberId}/invitation-link`, { purpose: 'invitation' })).statusCode,
    ).toBe(401);
    const unknown = await post(
      `/v1/team/members/${newId(TeamMemberIdSchema)}/invitation-link`,
      { purpose: 'invitation' },
      { cookie: owner },
    );
    expect(unknown.statusCode).toBe(404);
    expect(codeOf(unknown).code).toBe('member_not_found');

    await test.admin.db
      .update(schema.teamMembers)
      .set({ status: 'left' })
      .where(eq(schema.teamMembers.userId, userId));
    const left = await post(
      `/v1/team/members/${memberId}/invitation-link`,
      { purpose: 'invitation' },
      { cookie: owner },
    );
    expect(left.statusCode).toBe(409);
    expect(codeOf(left).code).toBe('member_left_conflict');
  });

  it('asks for a recent sign-in before making a link', async () => {
    const { memberId } = await addMember('recent@example.test');
    await test.admin.db.update(schema.session).set({ createdAt: sql`now() - interval '1 hour'` });
    const stale = await post(
      `/v1/team/members/${memberId}/invitation-link`,
      { purpose: 'invitation' },
      { cookie: owner },
    );
    expect(stale.statusCode).toBe(403);
    expect(codeOf(stale).code).toBe('reauthentication_forbidden');
    owner = await signIn(server, OWNER.email, OWNER.password);
  });

  it('shows the page who it is for without using the link', async () => {
    const { memberId } = await addMember('preview@example.test');
    const { token } = await newLink(memberId);
    for (let i = 0; i < 2; i++) {
      const preview = await post('/v1/invitation-links/inspect', { token });
      expect(preview.statusCode).toBe(200);
      expect(preview.json()).toMatchObject({
        purpose: 'invitation',
        email: 'preview@example.test',
        displayName: 'Théo',
        country: 'BJ',
      });
    }
  });

  it('lets an invited member in only through his link, once, then with his password', async () => {
    const { memberId, userId } = await addMember('first@example.test');
    const { token } = await newLink(memberId);
    // No password account until the link is used.
    await expect(signIn(server, 'first@example.test', PASSWORD)).rejects.toThrow(/Sign-in failed/);

    const short = await post('/v1/invitation-links/redeem', { token, password: 'court' });
    expect(short.statusCode).toBe(400);
    expect(codeOf(short)).toMatchObject({ code: 'password_invalid', details: { reason: 'too_short' } });
    const long = await post('/v1/invitation-links/redeem', { token, password: 'x'.repeat(129) });
    expect(codeOf(long)).toMatchObject({ code: 'password_invalid', details: { reason: 'too_long' } });

    // A refused password left the link unused.
    const redeemed = await post('/v1/invitation-links/redeem', { token, password: PASSWORD });
    expect(redeemed.statusCode).toBe(200);
    expect(redeemed.json()).toMatchObject({
      id: userId,
      email: 'first@example.test',
      role: 'operator',
      team: { role: 'chatter', status: 'active' },
      teamScope: 'self',
    });
    const cookie = String(redeemed.headers['set-cookie']).split(';')[0] ?? '';
    const me = await server.inject({ method: 'GET', url: '/v1/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);

    const again = await post('/v1/invitation-links/redeem', { token, password: PASSWORD });
    expect(again.statusCode).toBe(404);
    expect(codeOf(again).code).toBe('invitation_link_not_found');
    expect((await post('/v1/invitation-links/inspect', { token })).statusCode).toBe(404);
    await expect(signIn(server, 'first@example.test', PASSWORD)).resolves.toContain('=');

    const audit = await test.admin.db
      .select({ action: schema.auditLog.action, details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.userId, userId));
    expect(audit).toContainEqual({
      action: 'invitation_link.redeem',
      details: { purpose: 'invitation', sessionsEnded: 0 },
    });
  });

  it('lets only one of two simultaneous requests use a link', async () => {
    const { memberId } = await addMember('race@example.test');
    const { token } = await newLink(memberId);
    const answers = await Promise.all([
      post('/v1/invitation-links/redeem', { token, password: PASSWORD }),
      post('/v1/invitation-links/redeem', { token, password: `${PASSWORD} bis` }),
    ]);
    expect(answers.map((answer) => answer.statusCode).sort()).toEqual([200, 404]);
  });

  it('cancels the previous link when a new one is made', async () => {
    const { memberId } = await addMember('twice@example.test');
    const first = await newLink(memberId);
    const second = await newLink(memberId);
    expect((await post('/v1/invitation-links/inspect', { token: first.token })).statusCode).toBe(404);
    expect((await post('/v1/invitation-links/inspect', { token: second.token })).statusCode).toBe(200);
    const created = await test.admin.db
      .select({ details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'invitation_link.create'));
    expect(created).toContainEqual({ details: { purpose: 'invitation', memberId, replaced: 1 } });
    const revoked = await test.admin.db
      .select({ entityId: schema.auditLog.entityId })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'invitation_link.revoke'));
    const [firstLink] = await test.admin.db
      .select({ id: schema.invitationLinks.id })
      .from(schema.invitationLinks)
      .where(
        sql`${schema.invitationLinks.memberId} = ${memberId} and ${schema.invitationLinks.revokedAt} is not null`,
      );
    expect(revoked).toContainEqual({ entityId: firstLink?.id });
  });

  it('refuses an expired link and the link of a member who left', async () => {
    const expired = await addMember('expired@example.test');
    const old = await newLink(expired.memberId);
    await test.admin.db
      .update(schema.invitationLinks)
      .set({ createdAt: sql`now() - interval '73 hours'`, expiresAt: sql`now() - interval '1 hour'` })
      .where(eq(schema.invitationLinks.memberId, expired.memberId));
    expect(
      (await post('/v1/invitation-links/redeem', { token: old.token, password: PASSWORD })).statusCode,
    ).toBe(404);

    const leaving = await addMember('leaving@example.test');
    const link = await newLink(leaving.memberId);
    await test.admin.db
      .update(schema.teamMembers)
      .set({ status: 'left' })
      .where(eq(schema.teamMembers.id, leaving.memberId));
    expect((await post('/v1/invitation-links/inspect', { token: link.token })).statusCode).toBe(404);
    expect(
      (await post('/v1/invitation-links/redeem', { token: link.token, password: PASSWORD })).statusCode,
    ).toBe(404);
  });

  it('ends every open session of a member who chooses a new password', async () => {
    const { memberId, userId } = await addMember('reset@example.test');
    await post('/v1/invitation-links/redeem', { token: (await newLink(memberId)).token, password: PASSWORD });
    // The first link opened a session too: three are open when the reset is used.
    const phone = await signIn(server, 'reset@example.test', PASSWORD);
    const laptop = await signIn(server, 'reset@example.test', PASSWORD);

    const { token } = await newLink(memberId, 'reset');
    const preview = await post('/v1/invitation-links/inspect', { token });
    expect(preview.json()).toMatchObject({ purpose: 'reset' });
    const redeemed = await post('/v1/invitation-links/redeem', { token, password: `${PASSWORD} neuve` });
    expect(redeemed.statusCode).toBe(200);

    for (const cookie of [phone, laptop]) {
      expect((await server.inject({ method: 'GET', url: '/v1/me', headers: { cookie } })).statusCode).toBe(
        401,
      );
    }
    await expect(signIn(server, 'reset@example.test', PASSWORD)).rejects.toThrow(/Sign-in failed/);
    const resets = await test.admin.db
      .select({ details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(
        sql`${schema.auditLog.userId} = ${userId} and ${schema.auditLog.action} = 'invitation_link.redeem'`,
      );
    expect(resets).toContainEqual({ details: { purpose: 'reset', sessionsEnded: 3 } });
  });

  it('stops a burst on the redeem route', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const token = `${'A'.repeat(40)}${String(i).padStart(3, '0')}`;
      statuses.push(
        (await post('/v1/invitation-links/redeem', { token, password: PASSWORD }, {}, '10.9.9.9')).statusCode,
      );
    }
    expect(statuses.slice(0, 10).every((status) => status === 404)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('never writes a token in the logs', async () => {
    const { memberId } = await addMember('logs@example.test');
    const { token } = await newLink(memberId);
    await post('/v1/invitation-links/inspect', { token });
    await post('/v1/invitation-links/redeem', { token, password: PASSWORD });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join('\n')).not.toContain(token);
  });

  it('tells the team list which link is still out, expired or not', async () => {
    const out = await addMember('out@example.test');
    const expired = await addMember('lapsed@example.test');
    const used = await addMember('used@example.test');
    const none = await addMember('none@example.test');
    const { expiresAt } = await newLink(out.memberId);
    await newLink(expired.memberId, 'reset');
    await test.admin.db
      .update(schema.invitationLinks)
      .set({ createdAt: sql`now() - interval '73 hours'`, expiresAt: sql`now() - interval '1 hour'` })
      .where(eq(schema.invitationLinks.memberId, expired.memberId));
    await post('/v1/invitation-links/redeem', {
      token: (await newLink(used.memberId)).token,
      password: PASSWORD,
    });

    const links = await liveInvitationLinksUnscoped(app.adminDb.db, [
      out.memberId,
      expired.memberId,
      used.memberId,
      none.memberId,
    ]);
    expect(links.get(out.memberId)).toEqual({ purpose: 'invitation', expiresAt: new Date(expiresAt) });
    expect(links.get(expired.memberId)?.purpose).toBe('reset');
    expect(links.get(expired.memberId)?.expiresAt.getTime()).toBeLessThan(Date.now());
    expect(links.has(used.memberId)).toBe(false);
    expect(links.has(none.memberId)).toBe(false);
    expect((await liveInvitationLinksUnscoped(app.adminDb.db, [])).size).toBe(0);
  });

  it('keeps the table out of reach of the application role', async () => {
    await expect(test.app.db.select().from(schema.invitationLinks)).rejects.toMatchObject({
      cause: { code: '42501' },
    });
  });
});
