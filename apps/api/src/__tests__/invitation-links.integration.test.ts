import { Writable } from 'node:stream';

import {
  CreatorIdSchema,
  newId,
  SecurityAlertPayloadSchema,
  TeamMemberIdSchema,
  UserIdSchema,
} from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { liveInvitationLinksUnscoped } from '../invitation-links';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn, signInWithoutCode } from './support/sign-in';

// Invented people only (ADR 0010).
const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const PASSWORD = 'une phrase de passe assez longue';
/** The one password the test's breach check knows (ADR 0046 § 4); the real service is never called. */
const BREACHED = 'un mot de passe déjà fuité';

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

  /** An invented chatter (or manager): his account (no password yet) and his record. */
  async function addMember(
    email: string,
    teamRole: 'chatter' | 'manager' = 'chatter',
  ): Promise<{ memberId: string; userId: string }> {
    const userId = newId(UserIdSchema);
    const memberId = newId(TeamMemberIdSchema);
    await test.admin.db.insert(schema.user).values({ id: userId, name: 'Théo', email, role: 'operator' });
    await test.admin.db.insert(schema.teamMembers).values({
      id: memberId,
      userId,
      teamRole,
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
      DATABASE_SERVICE_URL: test.serviceUrl,
      LOG_LEVEL: 'info',
    });
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        logs.push(chunk.toString());
        done();
      },
    });
    const logger = createLogger(config, sink);
    app = await createApp(config, logger, {
      passwordBreaches: (password) => Promise.resolve(password === BREACHED),
    });
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
      .set({ status: 'left', leftOn: '2025-03-10' })
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
    await test.admin.db.update(schema.session).set({ reauthenticatedAt: sql`now() - interval '1 hour'` });
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
        account: 'member',
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
    // Twelve blanks, or one character twelve times, are long enough only in appearance (recette SEC-04).
    for (const plain of [' '.repeat(12), 'a'.repeat(12), '  abc  abc  ']) {
      const refused = await post('/v1/invitation-links/redeem', { token, password: plain });
      expect(codeOf(refused)).toMatchObject({ code: 'password_invalid', details: { reason: 'too_plain' } });
    }
    const breached = await post('/v1/invitation-links/redeem', { token, password: BREACHED });
    expect(codeOf(breached)).toMatchObject({ code: 'password_invalid', details: { reason: 'breached' } });

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
    // Signed in, straight onto the activation of his code (ADR 0046 § 1).
    const me = await server.inject({ method: 'GET', url: '/v1/me', headers: { cookie } });
    expect(me.statusCode).toBe(403);
    expect(codeOf(me).code).toBe('second_factor_forbidden');

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
      details: {
        purpose: 'invitation',
        sessionsEnded: 0,
        trustedDevicesEnded: 0,
        passkeysRemoved: 0,
        secondFactorReset: false,
      },
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
      .set({ status: 'left', leftOn: '2025-03-10' })
      .where(eq(schema.teamMembers.id, leaving.memberId));
    expect((await post('/v1/invitation-links/inspect', { token: link.token })).statusCode).toBe(404);
    expect(
      (await post('/v1/invitation-links/redeem', { token: link.token, password: PASSWORD })).statusCode,
    ).toBe(404);
  });

  it('lets an active manager make the invitation link of a chatter, and nothing more (ADR 0076 § 3)', async () => {
    const basile = await addMember('basile@example.test', 'manager');
    await post('/v1/invitation-links/redeem', {
      token: (await newLink(basile.memberId)).token,
      password: PASSWORD,
    });
    const manager = await signIn(server, 'basile@example.test', PASSWORD);
    const ask = (memberId: string, purpose: 'invitation' | 'reset', cookie = manager) =>
      post(`/v1/team/members/${memberId}/invitation-link`, { purpose }, { cookie });

    // The chatter he invited from Reveal: the link to choose his first password.
    const lou = await addMember('lou@example.test');
    const made = await ask(lou.memberId, 'invitation');
    expect(made.statusCode).toBe(200);
    const created = await test.admin.db
      .select({ userId: schema.auditLog.userId, details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'invitation_link.create'));
    expect(created).toContainEqual({
      userId: basile.userId,
      details: { purpose: 'invitation', memberId: lou.memberId, replaced: 0 },
    });

    // A reset gives an account that has a password: the owner's alone.
    const reset = await ask(lou.memberId, 'reset');
    expect(reset.statusCode).toBe(403);
    expect(codeOf(reset).code).toBe('role_forbidden');
    // Another manager's account is not his to open.
    const iris = await addMember('iris@example.test', 'manager');
    const colleague = await ask(iris.memberId, 'invitation');
    expect(colleague.statusCode).toBe(403);
    expect(codeOf(colleague).code).toBe('role_forbidden');

    // Once Lou has chosen his password, an invitation would replace it.
    const token = new URL(made.json<{ url: string }>().url).hash.slice('#t='.length);
    expect((await post('/v1/invitation-links/redeem', { token, password: PASSWORD })).statusCode).toBe(200);
    const chosen = await ask(lou.memberId, 'invitation');
    expect(chosen.statusCode).toBe(409);
    expect(codeOf(chosen).code).toBe('password_chosen_conflict');

    // A chatter makes no link, nor a manager who is not active.
    const asChatter = await ask(
      iris.memberId,
      'invitation',
      await signIn(server, 'lou@example.test', PASSWORD),
    );
    expect(asChatter.statusCode).toBe(403);
    expect(codeOf(asChatter).code).toBe('role_forbidden');
    // Refused before any member is looked up: no one else learns whether one exists.
    const unknown = await ask(
      newId(TeamMemberIdSchema),
      'invitation',
      await signIn(server, 'lou@example.test', PASSWORD),
    );
    expect(codeOf(unknown).code).toBe('role_forbidden');
    const noe = await addMember('noe@example.test');
    await test.admin.db
      .update(schema.teamMembers)
      .set({ status: 'suspended' })
      .where(eq(schema.teamMembers.userId, basile.userId));
    expect((await ask(noe.memberId, 'invitation')).statusCode).toBe(403);
  });

  it('never lets an invitation replace a password already chosen, whoever made the link', async () => {
    const { memberId, userId } = await addMember('late@example.test');
    const { token } = await newLink(memberId);
    // His password chosen meanwhile (another way than this link): the invitation no longer opens his account.
    const context = await app.auth.$context;
    await context.internalAdapter.linkAccount({
      userId,
      providerId: 'credential',
      accountId: userId,
      password: await context.password.hash(PASSWORD),
    });
    const inspected = await post('/v1/invitation-links/inspect', { token });
    expect(codeOf(inspected).code).toBe('invitation_link_not_found');
    const redeemed = await post('/v1/invitation-links/redeem', { token, password: `${PASSWORD} autre` });
    expect(redeemed.statusCode).toBe(404);
    expect(codeOf(redeemed).code).toBe('invitation_link_not_found');
    await expect(signIn(server, 'late@example.test', `${PASSWORD} autre`)).rejects.toThrow(/Sign-in failed/);
    const [link] = await test.admin.db
      .select({ usedAt: schema.invitationLinks.usedAt })
      .from(schema.invitationLinks)
      .where(eq(schema.invitationLinks.memberId, memberId));
    expect(link?.usedAt).toBeNull();
  });

  it('ends every open session of a member who chooses a new password, and resets his code', async () => {
    const { memberId, userId } = await addMember('reset@example.test');
    await post('/v1/invitation-links/redeem', { token: (await newLink(memberId)).token, password: PASSWORD });
    // The first link opened a session too, the activation of his code another: four are open when the reset is used.
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
    // His lost phone held his code: the new password opens the activation of a new one.
    const fresh = await signInWithoutCode(server, 'reset@example.test', `${PASSWORD} neuve`);
    const me = await server.inject({ method: 'GET', url: '/v1/me', headers: { cookie: fresh } });
    expect(codeOf(me).code).toBe('second_factor_forbidden');
    expect(
      await test.admin.db.select().from(schema.twoFactor).where(eq(schema.twoFactor.userId, userId)),
    ).toEqual([]);
    const resets = await test.admin.db
      .select({ details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(
        sql`${schema.auditLog.userId} = ${userId} and ${schema.auditLog.action} = 'invitation_link.redeem'`,
      );
    expect(resets).toContainEqual({
      details: {
        purpose: 'reset',
        sessionsEnded: 4,
        trustedDevicesEnded: 0,
        passkeysRemoved: 0,
        secondFactorReset: true,
      },
    });
    // His code put back to zero is told to the urgent groups (ADR 0046 § 8); his first link reset nothing.
    const alerts = await test.admin.db
      .select({ payload: schema.domainEvents.payload })
      .from(schema.domainEvents)
      .where(
        sql`${schema.domainEvents.type} = 'security_alert' and ${schema.domainEvents.payload}->>'userId' = ${userId}
          and ${schema.domainEvents.payload}->>'reason' = 'second_factor_reset'`,
      );
    const [alert, ...others] = alerts.map((row) => SecurityAlertPayloadSchema.parse(row.payload));
    expect(others).toEqual([]);
    expect(alert).toMatchObject({
      reason: 'second_factor_reset',
      userId,
      role: 'operator',
      via: 'invitation_link',
    });
    // Its network, never its address.
    expect(alert && 'network' in alert ? alert.network : null).toMatch(/^10\.0\.\d+\.x$/u);
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

  /** An invented creator, without an account yet (CR-02). */
  async function addCreator(name: string): Promise<string> {
    const creatorId = newId(CreatorIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: creatorId, displayName: name, timezone: 'Europe/Paris' });
    return creatorId;
  }

  const inviteCreator = (creatorId: string, body: Json) =>
    post(`/v1/creators/${creatorId}/invitation-link`, body, { cookie: owner });

  it('invites a creator into her own account, made with her e-mail, linked to her alone (CR-02)', async () => {
    const creatorId = await addCreator('Nora');
    // Typed with capitals: her account is written in lower case.
    const made = await inviteCreator(creatorId, { purpose: 'invitation', email: 'Nora@Example.TEST' });
    expect(made.statusCode, made.body).toBe(200);
    const { url } = made.json<{ url: string }>();
    expect(new URL(url).pathname).toBe('/bienvenue');
    const token = new URL(url).hash.slice('#t='.length);
    const [account] = await test.admin.db
      .select({
        id: schema.user.id,
        role: schema.user.role,
        creatorIds: schema.user.creatorIds,
        name: schema.user.name,
      })
      .from(schema.user)
      .where(eq(schema.user.email, 'nora@example.test'));
    expect(account).toMatchObject({ role: 'creator', creatorIds: [creatorId], name: 'Nora' });

    const preview = await post('/v1/invitation-links/inspect', { token });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({
      purpose: 'invitation',
      account: 'creator',
      email: 'nora@example.test',
      displayName: 'Nora',
    });
    expect(preview.json()).not.toHaveProperty('country');

    const redeemed = await post('/v1/invitation-links/redeem', { token, password: PASSWORD });
    expect(redeemed.statusCode, redeemed.body).toBe(200);
    expect(redeemed.json()).toMatchObject({ id: account?.id, role: 'creator', creatorIds: [creatorId] });
    // Once only.
    expect((await post('/v1/invitation-links/redeem', { token, password: PASSWORD })).statusCode).toBe(404);
    await expect(signIn(server, 'nora@example.test', PASSWORD)).resolves.toContain('=');
  });

  it('keeps her one account: a new link replaces the last, another e-mail corrects it until she signs in', async () => {
    const creatorId = await addCreator('Ines');
    const first = await inviteCreator(creatorId, { purpose: 'invitation', email: 'ines@example.test' });
    const firstToken = new URL(first.json<{ url: string }>().url).hash.slice('#t='.length);
    const second = await inviteCreator(creatorId, { purpose: 'invitation', email: 'INES@example.test' });
    expect(second.statusCode, second.body).toBe(200);
    expect((await post('/v1/invitation-links/inspect', { token: firstToken })).statusCode).toBe(404);
    const accounts = await test.admin.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(sql`${schema.user.creatorIds} = array[${creatorId}]::uuid[]`);
    expect(accounts).toHaveLength(1);

    // A typo corrected before her first sign-in (ADR 0071 § 3): the same account, the new e-mail, the link before gone.
    const secondToken = new URL(second.json<{ url: string }>().url).hash.slice('#t='.length);
    const taken = await inviteCreator(creatorId, { purpose: 'invitation', email: OWNER.email });
    expect(codeOf(taken).code).toBe('account_email_conflict');
    const corrected = await inviteCreator(creatorId, { purpose: 'invitation', email: 'Ines.B@example.test' });
    expect(corrected.statusCode, corrected.body).toBe(200);
    expect((await post('/v1/invitation-links/inspect', { token: secondToken })).statusCode).toBe(404);
    const correctedToken = new URL(corrected.json<{ url: string }>().url).hash.slice('#t='.length);
    const preview = await post('/v1/invitation-links/inspect', { token: correctedToken });
    expect(preview.json()).toMatchObject({ email: 'ines.b@example.test' });
    const after = await test.admin.db
      .select({ id: schema.user.id, email: schema.user.email })
      .from(schema.user)
      .where(sql`${schema.user.creatorIds} = array[${creatorId}]::uuid[]`);
    expect(after).toEqual([{ id: accounts[0]?.id, email: 'ines.b@example.test' }]);
    const [audited] = await test.admin.db
      .select({ details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(
        sql`${schema.auditLog.action} = 'creator_account.email' and ${schema.auditLog.entityId} = ${accounts[0]?.id}`,
      );
    expect(audited?.details).toEqual({ creatorId });

    // Once her password is chosen, her e-mail is how she signs in: no longer changed from her sheet.
    expect(
      (await post('/v1/invitation-links/redeem', { token: correctedToken, password: PASSWORD })).statusCode,
    ).toBe(200);
    const other = await inviteCreator(creatorId, { purpose: 'invitation', email: 'autre@example.test' });
    expect(other.statusCode).toBe(409);
    expect(codeOf(other).code).toBe('creator_account_conflict');
    const reset = await inviteCreator(creatorId, { purpose: 'reset' });
    expect(reset.statusCode).toBe(200);
    expect(new URL(reset.json<{ url: string }>().url).pathname).toBe('/nouveau-mot-de-passe');
  });

  it('refuses a reset before her account exists, an e-mail another account has, an unknown creator', async () => {
    const creatorId = await addCreator('Lina');
    const reset = await inviteCreator(creatorId, { purpose: 'reset' });
    expect(reset.statusCode).toBe(404);
    expect(codeOf(reset).code).toBe('creator_account_not_found');
    const taken = await inviteCreator(creatorId, { purpose: 'invitation', email: OWNER.email });
    expect(taken.statusCode).toBe(409);
    expect(codeOf(taken).code).toBe('account_email_conflict');
    const unknown = await inviteCreator(newId(CreatorIdSchema), {
      purpose: 'invitation',
      email: 'x@example.test',
    });
    expect(unknown.statusCode).toBe(404);
    expect(codeOf(unknown).code).toBe('creator_not_found');
    const accounts = await test.admin.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(sql`${schema.user.creatorIds} = array[${creatorId}]::uuid[]`);
    expect(accounts).toHaveLength(0);
  });

  it('refuses her expired link', async () => {
    const creatorId = await addCreator('Maya');
    const made = await inviteCreator(creatorId, { purpose: 'invitation', email: 'maya@example.test' });
    const token = new URL(made.json<{ url: string }>().url).hash.slice('#t='.length);
    await test.admin.db
      .update(schema.invitationLinks)
      .set({ createdAt: sql`now() - interval '4 days'`, expiresAt: sql`now() - interval '1 day'` })
      .where(
        sql`${schema.invitationLinks.userId} is not null and ${schema.invitationLinks.usedAt} is null and ${schema.invitationLinks.revokedAt} is null`,
      );
    expect((await post('/v1/invitation-links/inspect', { token })).statusCode).toBe(404);
    const redeem = await post('/v1/invitation-links/redeem', { token, password: PASSWORD });
    expect(redeem.statusCode).toBe(404);
    expect(codeOf(redeem).code).toBe('invitation_link_not_found');
  });

  it('tells the owner where her account stands: none, invited, then in (CR-02)', async () => {
    const creatorId = await addCreator('Sara');
    const read = () =>
      server.inject({ method: 'GET', url: `/v1/creators/${creatorId}/account`, headers: { cookie: owner } });

    const before = await read();
    expect(before.statusCode, before.body).toBe(200);
    expect(before.json()).toEqual({ account: null });

    const made = await inviteCreator(creatorId, { purpose: 'invitation', email: 'sara@example.test' });
    const { expiresAt, url } = made.json<{ expiresAt: string; url: string }>();
    expect((await read()).json()).toEqual({
      account: { email: 'sara@example.test', invitationPending: true, invitationExpiresAt: expiresAt },
    });

    const token = new URL(url).hash.slice('#t='.length);
    expect((await post('/v1/invitation-links/redeem', { token, password: PASSWORD })).statusCode).toBe(200);
    expect((await read()).json()).toEqual({
      account: { email: 'sara@example.test', invitationPending: false, invitationExpiresAt: null },
    });

    // Hers alone to read for the owner: her own account, once in, is refused; an unknown creator is 404.
    const sara = await signIn(server, 'sara@example.test', PASSWORD);
    const own = await server.inject({
      method: 'GET',
      url: `/v1/creators/${creatorId}/account`,
      headers: { cookie: sara },
    });
    expect(own.statusCode).toBe(403);
    const unknown = await server.inject({
      method: 'GET',
      url: `/v1/creators/${newId(CreatorIdSchema)}/account`,
      headers: { cookie: owner },
    });
    expect(unknown.statusCode).toBe(404);
    expect(codeOf(unknown).code).toBe('creator_not_found');
  });

  it('keeps the table out of reach of the application role', async () => {
    await expect(test.app.db.select().from(schema.invitationLinks)).rejects.toMatchObject({
      cause: { code: '42501' },
    });
  });
});
