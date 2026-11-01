import {
  ApiErrorSchema,
  CommissionPresetListSchema,
  CommissionPresetSchema,
  CommissionRateHistorySchema,
  CommissionRateSchema,
  InvitationLinkCreatedSchema,
  nextPayPeriod,
  payPeriodOfDay,
  TeamMemberListSchema,
  TeamMemberNoteListSchema,
  TeamMemberSchema,
  TeamRoleChangeSchema,
  TeamRoleHistorySchema,
  type CreatorId,
  type InvitationLinkCreated,
  type TeamMember,
} from '@nirvana/contracts';
import { eq, schema, sql } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import type { Config } from '../config';
import { createLogger } from '../logger';
import { enqueuePayRecalculation } from '../modules/payroll';
import { createTeamModule } from '../modules/team';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

/** Invented people and rates only (ADR 0010). */
const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const CREATOR = { email: 'creator@example.test', name: 'Creator', password: 'battery staple horse' };
const THEO_PASSWORD = 'staple battery horse';
const NORA_PASSWORD = 'horse staple battery';

/** The agency's day (Europe/Paris), shifted by `days`: what the server calls « today ». */
function agencyDay(days = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const day = new Date(`${today}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

const codeOf = (response: LightMyRequestResponse): string => ApiErrorSchema.parse(response.json()).error.code;

describe('Équipe › Membres (/v1/team, EQ-01)', () => {
  let test: TestDb;
  let config: Config;
  let app: App;
  let server: Server;
  let owner: string;
  let creator: string;
  let anna: CreatorId;
  let presetId: string;
  let theo: TeamMember;
  let nora: TeamMember;
  let theoCookie: string;
  let noraCookie: string;

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT',
    url: string,
    cookie: string,
    payload?: object,
    via?: Server,
  ) =>
    (via ?? server).inject({
      method,
      url: `/v1${url}`,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      ...(payload !== undefined && { payload }),
    });

  /** What the invitation link will do (EQ-10, Bilan): the member's password account. */
  const choosePassword = async (userId: string, password: string): Promise<void> => {
    const context = await app.auth.$context;
    await context.internalAdapter.linkAccount({
      userId,
      providerId: 'credential',
      accountId: userId,
      password: await context.password.hash(password),
    });
  };

  const recalculations = async (): Promise<string[]> =>
    (
      await test.admin.db.execute<{ key: string }>(
        sql`select key from graphile_worker._private_jobs where key like 'payroll.recalculate:%' order by key`,
      )
    ).rows.map((row) => row.key);
  const forgetRecalculations = () =>
    test.admin.db.execute(
      sql`delete from graphile_worker._private_jobs where key like 'payroll.recalculate:%'`,
    );

  /** The team module as it runs on `day` (noon in Paris), on this test's database. */
  const teamOn = (day: string) =>
    createTeamModule({
      db: app.db.db,
      adminDb: app.adminDb.db,
      creators: { existing: () => Promise.resolve(new Set()) },
      invitationLinks: { live: () => Promise.resolve(new Map()) },
      enqueuePayRecalculation,
      now: () => new Date(`${day}T11:00:00Z`),
    });

  /** A server whose team routes run on `day`, for a write dated that very day; the sessions are the same. */
  const serverOn = (day: string): Promise<Server> =>
    buildServer({
      config,
      logger: createLogger(config),
      routes: [teamOn(day).routes(app.requireRole)],
      readiness: app.readiness,
    });

  const auditOf = (action: string) =>
    test.admin.db
      .select({ userId: schema.auditLog.userId, details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, action));

  const theoBody = () => ({
    email: 'Theo@Example.test',
    firstName: 'Théo',
    lastName: 'Martin',
    displayName: 'Théo',
    teamRole: 'chatter',
    country: 'BJ',
    timeZone: 'Africa/Porto-Novo',
    joinedOn: agencyDay(-30),
    creatorIds: [anna],
    commission: { presetId },
  });

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
    app = await createApp(config, createLogger(config));
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    await createOwner(app.auth, app.db.db, OWNER);
    anna = (await app.modules.persona.creators.create({ displayName: 'Anna' })).id;
    const { userId: creatorUserId } = await createOwner(app.auth, app.db.db, CREATOR);
    await test.admin.db
      .update(schema.user)
      .set({ role: 'creator', creatorIds: [anna] })
      .where(eq(schema.user.id, creatorUserId));
    owner = await signIn(server, OWNER.email, OWNER.password);
    creator = await signIn(server, CREATOR.email, CREATOR.password);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('lets the owner name a preset from today, and refuses one that starts yesterday', async () => {
    const yesterday = await call('POST', '/team/commission-presets', owner, {
      name: 'Palier inventé',
      rateBps: 1250,
      effectiveFrom: agencyDay(-1),
    });
    expect(yesterday.statusCode).toBe(400);
    expect(codeOf(yesterday)).toBe('commission_date_invalid');

    const created = await call('POST', '/team/commission-presets', owner, {
      name: ' Palier inventé ',
      rateBps: 1250,
      effectiveFrom: agencyDay(),
    });
    expect(created.statusCode).toBe(201);
    const preset = CommissionPresetSchema.parse(created.json());
    expect(preset.name).toBe('Palier inventé');
    presetId = preset.id;

    const twice = await call('POST', '/team/commission-presets', owner, {
      name: 'Palier inventé',
      rateBps: 1300,
      effectiveFrom: agencyDay(),
    });
    expect(twice.statusCode).toBe(409);
    expect(codeOf(twice)).toBe('commission_preset_conflict');

    const later = await call('POST', '/team/commission-presets', owner, {
      name: 'Palier inventé',
      rateBps: 1400,
      effectiveFrom: agencyDay(7),
    });
    expect(later.statusCode).toBe(201);
    const offered = CommissionPresetListSchema.parse(
      (await call('GET', '/team/commission-presets', owner)).json(),
    );
    expect(offered.presets.map(({ name, rateBps }) => ({ name, rateBps }))).toEqual([
      { name: 'Palier inventé', rateBps: 1250 },
    ]);
  });

  it('adds a chatter with his account, his creators and his first rate, in one gesture', async () => {
    const response = await call('POST', '/team/members', owner, theoBody());
    expect(response.statusCode).toBe(201);
    theo = TeamMemberSchema.parse(response.json());
    expect(theo).toMatchObject({
      email: 'theo@example.test',
      displayName: 'Théo',
      teamRole: 'chatter',
      status: 'active',
      country: 'BJ',
      creatorIds: [anna],
      invitationPending: true,
      invitationExpiresAt: null,
      commission: { rateBps: 1250, teamShareBps: null, presetId, effectiveFrom: agencyDay(-30) },
    });
    const [account] = await test.admin.db.select().from(schema.user).where(eq(schema.user.id, theo.userId));
    expect(account).toMatchObject({ role: 'operator', creatorIds: [anna], email: 'theo@example.test' });
    const [created] = await auditOf('team_member.create');
    expect(created?.details).toEqual({ teamRole: 'chatter', creators: 1 });
  });

  it('refuses an e-mail that already has an account, an unknown creator, preset or country', async () => {
    const twice = await call('POST', '/team/members', owner, theoBody());
    expect(twice.statusCode).toBe(409);
    expect(codeOf(twice)).toBe('member_conflict');
    const shouted = await call('POST', '/team/members', owner, { ...theoBody(), email: 'THEO@EXAMPLE.TEST' });
    expect(shouted.statusCode).toBe(409);
    expect(codeOf(shouted)).toBe('member_conflict');

    const unknownCreator = await call('POST', '/team/members', owner, {
      ...theoBody(),
      email: 'basile@example.test',
      creatorIds: ['0199f2a0-0000-7000-8000-0000000000c9'],
    });
    expect(unknownCreator.statusCode).toBe(404);
    expect(codeOf(unknownCreator)).toBe('creator_not_found');

    const unknownPreset = await call('POST', '/team/members', owner, {
      ...theoBody(),
      email: 'basile@example.test',
      commission: { presetId: '0199f2a0-0000-7000-8000-0000000000b9' },
    });
    expect(unknownPreset.statusCode).toBe(404);
    expect(codeOf(unknownPreset)).toBe('commission_preset_not_found');

    const unknownCountry = await call('POST', '/team/members', owner, {
      ...theoBody(),
      email: 'basile@example.test',
      country: 'ZZ',
    });
    expect([unknownCountry.statusCode, codeOf(unknownCountry)]).toEqual([400, 'request_invalid']);
    expect(
      await test.admin.db.select().from(schema.user).where(eq(schema.user.email, 'basile@example.test')),
    ).toEqual([]);
  });

  it('adds a manager with a share of the team’s net, typed by hand', async () => {
    const response = await call('POST', '/team/members', owner, {
      email: 'nora@example.test',
      firstName: 'Nora',
      lastName: 'Vidal',
      displayName: 'Nora',
      teamRole: 'manager',
      country: 'FR',
      timeZone: 'Europe/Paris',
      color: '#c2410c',
      joinedOn: agencyDay(),
      commission: { rateBps: 1000 },
      teamShareBps: 500,
    });
    expect(response.statusCode).toBe(201);
    nora = TeamMemberSchema.parse(response.json());
    expect(nora.commission).toEqual({
      rateBps: 1000,
      teamShareBps: 500,
      presetId: null,
      effectiveFrom: agencyDay(),
    });
    await choosePassword(theo.userId, THEO_PASSWORD);
    await choosePassword(nora.userId, NORA_PASSWORD);
    // Typed as the owner typed it: Better Auth looks the account up in lower case, where it was stored.
    theoCookie = await signIn(server, 'Theo@Example.test', THEO_PASSWORD);
    noraCookie = await signIn(server, 'nora@example.test', NORA_PASSWORD);
  });

  it('shows the owner and the active manager the whole team, a chatter his own record only', async () => {
    const all = TeamMemberListSchema.parse((await call('GET', '/team/members', owner)).json()).members;
    expect(all.map((member) => member.displayName)).toEqual(['Nora', 'Théo']);
    expect(all.every((member) => !member.invitationPending)).toBe(true);

    const byManager = TeamMemberListSchema.parse((await call('GET', '/team/members', noraCookie)).json());
    expect(byManager.members).toHaveLength(2);

    const byChatter = TeamMemberListSchema.parse((await call('GET', '/team/members', theoCookie)).json());
    expect(byChatter.members.map((member) => member.id)).toEqual([theo.id]);
    const other = await call('GET', `/team/members/${nora.id}`, theoCookie);
    expect(other.statusCode).toBe(404);
    expect(codeOf(other)).toBe('member_not_found');
    expect((await call('GET', `/team/members/${nora.id}/commission`, theoCookie)).statusCode).toBe(404);
  });

  it('never opens the team to a creator', async () => {
    const response = await call('GET', '/team/members', creator);
    expect(response.statusCode).toBe(403);
    expect(codeOf(response)).toBe('role_forbidden');
  });

  it('keeps the writes to the owner: a manager and a chatter are refused', async () => {
    for (const cookie of [noraCookie, theoCookie]) {
      const add = await call('POST', '/team/members', cookie, {
        ...theoBody(),
        email: 'basile@example.test',
      });
      expect(add.statusCode).toBe(403);
      const rate = await call('POST', `/team/members/${theo.id}/commission`, cookie, {
        commission: { rateBps: 9000 },
        effectiveFrom: agencyDay(1),
      });
      expect(rate.statusCode).toBe(403);
      const status = await call('PUT', `/team/members/${theo.id}/status`, cookie, { status: 'suspended' });
      expect(status.statusCode).toBe(403);
    }
  });

  it('lets an active manager write and read a note, never the member it is about', async () => {
    const added = await call('POST', `/team/members/${theo.id}/notes`, noraCookie, {
      body: 'Très bon sur les relances du soir.',
    });
    expect(added.statusCode).toBe(201);
    const notes = TeamMemberNoteListSchema.parse(
      (await call('GET', `/team/members/${theo.id}/notes`, owner)).json(),
    );
    expect(notes.notes).toMatchObject([{ body: 'Très bon sur les relances du soir.', authorName: 'Nora' }]);

    const byTheo = await call('GET', `/team/members/${theo.id}/notes`, theoCookie);
    expect(byTheo.statusCode).toBe(403);
    expect(
      (await call('POST', `/team/members/${theo.id}/notes`, theoCookie, { body: 'Moi' })).statusCode,
    ).toBe(403);
    const own = await call('GET', `/team/members/${nora.id}/notes`, noraCookie);
    expect([own.statusCode, ApiErrorSchema.parse(own.json()).error.message]).toEqual([
      403,
      'Les notes sur toi ne te sont pas lisibles',
    ]);
    expect((await call('GET', '/team/commission-presets', theoCookie)).statusCode).toBe(403);
    const [audited] = await auditOf('team_member_note.create');
    expect(JSON.stringify(audited)).not.toContain('relances');
  });

  it('sets a rate from a period on, never before today nor twice the same day, a share for a manager only', async () => {
    // A new rate starts the 1st or the 16th (Charles, 28/10): the next period's first day, and a day that is not one.
    const nextStart = nextPayPeriod(payPeriodOfDay(agencyDay()));
    const notAStart = `${nextStart.slice(0, 8)}${nextStart.endsWith('-01') ? '02' : '17'}`;
    const past = await call('POST', `/team/members/${theo.id}/commission`, owner, {
      commission: { rateBps: 1500 },
      effectiveFrom: agencyDay(-1),
    });
    expect(codeOf(past)).toBe('commission_date_invalid');

    const midPeriod = await call('POST', `/team/members/${theo.id}/commission`, owner, {
      commission: { rateBps: 1500 },
      effectiveFrom: notAStart,
    });
    expect([midPeriod.statusCode, codeOf(midPeriod)]).toEqual([400, 'commission_date_invalid']);

    const share = await call('POST', `/team/members/${theo.id}/commission`, owner, {
      commission: { rateBps: 1500 },
      teamShareBps: 300,
      effectiveFrom: nextStart,
    });
    expect(share.statusCode).toBe(400);
    expect(codeOf(share)).toBe('team_share_invalid');

    const next = await call('POST', `/team/members/${theo.id}/commission`, owner, {
      commission: { rateBps: 1500 },
      effectiveFrom: nextStart,
    });
    expect(next.statusCode).toBe(201);
    expect(CommissionRateSchema.parse(next.json())).toEqual({
      rateBps: 1500,
      teamShareBps: null,
      presetId: null,
      effectiveFrom: nextStart,
    });
    const again = await call('POST', `/team/members/${theo.id}/commission`, owner, {
      commission: { rateBps: 1600 },
      effectiveFrom: nextStart,
    });
    expect(again.statusCode).toBe(409);
    expect(codeOf(again)).toBe('commission_rate_conflict');

    const history = CommissionRateHistorySchema.parse(
      (await call('GET', `/team/members/${theo.id}/commission`, theoCookie)).json(),
    );
    expect(history.rates.map((rate) => rate.rateBps)).toEqual([1500, 1250]);
    const today = TeamMemberSchema.parse((await call('GET', `/team/members/${theo.id}`, owner)).json());
    expect(today.commission?.rateBps).toBe(1250);
  });

  it('has pay compute nothing again for a rate of a later period', async () => {
    const running = payPeriodOfDay(agencyDay());
    // A rate from the next period changes nothing computed yet (the running period's own first day is unit-tested).
    await forgetRecalculations();
    const later = await call('POST', `/team/members/${theo.id}/commission`, owner, {
      commission: { rateBps: 1700 },
      effectiveFrom: nextPayPeriod(nextPayPeriod(running)),
    });
    expect(later.statusCode).toBe(201);
    expect(await recalculations()).toEqual([]);
  });

  it('dates a change of role from the 1st or the 16th, effective on its day for access and pay (Charles, 28/10)', async () => {
    const first = nextPayPeriod(payPeriodOfDay(agencyDay()));
    const second = nextPayPeriod(first);
    const notAStart = `${first.slice(0, 8)}${first.endsWith('-01') ? '02' : '17'}`;
    await forgetRecalculations();

    // The record does not take a role any more: a role is dated, on its own route.
    const patched = await call('PATCH', `/team/members/${nora.id}`, owner, { teamRole: 'chatter' });
    expect([patched.statusCode, codeOf(patched)]).toEqual([400, 'request_invalid']);
    for (const effectiveFrom of [notAStart, '2020-01-16']) {
      const refused = await call('POST', `/team/members/${nora.id}/role`, owner, {
        teamRole: 'chatter',
        effectiveFrom,
      });
      expect([refused.statusCode, codeOf(refused)]).toEqual([400, 'role_date_invalid']);
      expect(ApiErrorSchema.parse(refused.json()).error.message).toBe(
        'Un changement de rôle commence le 1er ou le 16 d’un mois, aujourd’hui au plus tôt',
      );
    }
    expect(
      (
        await call('POST', `/team/members/${nora.id}/role`, noraCookie, {
          teamRole: 'chatter',
          effectiveFrom: first,
        })
      ).statusCode,
    ).toBe(403);

    // Made a chatter from the next period: she stays a manager until then, and nothing computed changes.
    const demoted = await call('POST', `/team/members/${nora.id}/role`, owner, {
      teamRole: 'chatter',
      effectiveFrom: first,
    });
    expect(demoted.statusCode).toBe(201);
    expect(TeamRoleChangeSchema.parse(demoted.json())).toEqual({ teamRole: 'chatter', effectiveFrom: first });
    expect(await recalculations()).toEqual([]);
    expect(
      TeamMemberSchema.parse((await call('GET', `/team/members/${nora.id}`, owner)).json()).teamRole,
    ).toBe('manager');
    const twice = await call('POST', `/team/members/${nora.id}/role`, owner, {
      teamRole: 'manager',
      effectiveFrom: first,
    });
    expect([twice.statusCode, codeOf(twice)]).toEqual([409, 'role_change_conflict']);
    // A share of the team's net from a day she is a chatter is refused, though she is a manager today.
    const share = await call('POST', `/team/members/${nora.id}/commission`, owner, {
      commission: { rateBps: 1000 },
      teamShareBps: 500,
      effectiveFrom: first,
    });
    expect([share.statusCode, codeOf(share)]).toEqual([400, 'team_share_invalid']);

    const history = TeamRoleHistorySchema.parse(
      (await call('GET', `/team/members/${nora.id}/role`, noraCookie)).json(),
    );
    expect(history.roles).toEqual([
      { teamRole: 'chatter', effectiveFrom: first },
      { teamRole: 'manager', effectiveFrom: nora.joinedOn },
    ]);
    expect((await call('GET', `/team/members/${nora.id}/role`, theoCookie)).statusCode).toBe(404);
    const [audited] = await auditOf('team_role.create');
    expect(audited?.details).toEqual({ teamRole: 'chatter', effectiveFrom: first });

    // On its day, the hourly job gives it to her record: her scope follows, she reads her own record only.
    expect(await teamOn(agencyDay()).jobs.applyRoles()).toBe(0);
    expect(await teamOn(first).jobs.applyRoles()).toBe(1);
    expect(await teamOn(first).jobs.applyRoles()).toBe(0);
    const byNora = TeamMemberListSchema.parse((await call('GET', '/team/members', noraCookie)).json());
    expect(byNora.members.map((member) => [member.id, member.teamRole])).toEqual([[nora.id, 'chatter']]);

    // On the 1st or the 16th, a role from that very day is hers at once, and pay computes that period again.
    const onSecond = await serverOn(second);
    try {
      const promoted = await call(
        'POST',
        `/team/members/${nora.id}/role`,
        owner,
        { teamRole: 'manager', effectiveFrom: second },
        onSecond,
      );
      expect(promoted.statusCode).toBe(201);
      expect(await recalculations()).toEqual([`payroll.recalculate:${second}`]);
      expect(
        TeamMemberSchema.parse((await call('GET', `/team/members/${nora.id}`, owner)).json()).teamRole,
      ).toBe('manager');
      expect(await teamOn(second).jobs.applyRoles()).toBe(0);
    } finally {
      await onSecond.close();
      await forgetRecalculations();
    }
  });

  it('changes what is sent and keeps the account in step', async () => {
    const response = await call('PATCH', `/team/members/${theo.id}`, owner, {
      displayName: 'Théo M.',
      creatorIds: [anna, anna],
    });
    expect(response.statusCode).toBe(200);
    expect(TeamMemberSchema.parse(response.json())).toMatchObject({
      displayName: 'Théo M.',
      firstName: 'Théo',
      creatorIds: [anna],
    });
    const [account] = await test.admin.db
      .select({ name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, theo.userId));
    expect(account?.name).toBe('Théo M.');
  });

  it('brings a manager who is not active back to his own record', async () => {
    await call('PUT', `/team/members/${nora.id}/status`, owner, { status: 'on_leave' });
    const byManager = TeamMemberListSchema.parse((await call('GET', '/team/members', noraCookie)).json());
    expect(byManager.members.map((member) => member.id)).toEqual([nora.id]);
    expect((await call('GET', `/team/members/${theo.id}/notes`, noraCookie)).statusCode).toBe(403);
    await call('PUT', `/team/members/${nora.id}/status`, owner, { status: 'active' });
  });

  it('marks a member who left: no creator, no session, and his record no longer changes', async () => {
    const response = await call('PUT', `/team/members/${theo.id}/status`, owner, { status: 'left' });
    expect(response.statusCode).toBe(200);
    expect(TeamMemberSchema.parse(response.json())).toMatchObject({ status: 'left', creatorIds: [] });
    expect((await call('GET', '/me', theoCookie)).statusCode).toBe(401);
    const sessions = await test.admin.db
      .select()
      .from(schema.session)
      .where(eq(schema.session.userId, theo.userId));
    expect(sessions).toEqual([]);

    const again = await call('PUT', `/team/members/${theo.id}/status`, owner, { status: 'left' });
    expect(again.statusCode).toBe(200);
    const back = await call('PUT', `/team/members/${theo.id}/status`, owner, { status: 'active' });
    expect(back.statusCode).toBe(409);
    expect(codeOf(back)).toBe('member_left_conflict');
    const patch = await call('PATCH', `/team/members/${theo.id}`, owner, { color: '#123abc' });
    expect(codeOf(patch)).toBe('member_left_conflict');
    const [left] = await auditOf('team_member.status_change').then((rows) =>
      rows.filter((row) => JSON.stringify(row.details).includes('"left"')),
    );
    expect(left?.details).toEqual({ from: 'active', to: 'left', sessionsEnded: 1 });

    // Signing in again is refused like a wrong password: the page does not learn the account exists (ADR 0023).
    const signInAs = (password: string) =>
      server.inject({
        method: 'POST',
        url: '/v1/auth/sign-in/email',
        payload: { email: 'theo@example.test', password },
        headers: { origin: DASHBOARD_ORIGIN },
      });
    const refused = await signInAs(THEO_PASSWORD);
    const wrong = await signInAs('not the password at all');
    expect(refused.statusCode).toBe(401);
    expect(refused.headers['set-cookie']).toBeUndefined();
    expect(ApiErrorSchema.parse(refused.json()).error).toMatchObject({
      code: 'sign_in_unauthenticated',
      message: 'E-mail ou mot de passe incorrect',
    });
    expect(ApiErrorSchema.parse(wrong.json()).error).toMatchObject({
      code: 'sign_in_unauthenticated',
      message: 'E-mail ou mot de passe incorrect',
    });
    expect(
      await test.admin.db.select().from(schema.session).where(eq(schema.session.userId, theo.userId)),
    ).toEqual([]);
  });

  it('shows when a member’s link stops working: none, live, expired, used, then a new password link', async () => {
    const created = await call('POST', '/team/members', owner, {
      ...theoBody(),
      email: 'basile@example.test',
      firstName: 'Basile',
      lastName: 'Morel',
      displayName: 'Basile',
    });
    expect(created.statusCode).toBe(201);
    const basile = TeamMemberSchema.parse(created.json());
    const expiresAtOf = async (): Promise<string | null> => {
      const one = TeamMemberSchema.parse((await call('GET', `/team/members/${basile.id}`, owner)).json());
      const listed = TeamMemberListSchema.parse(
        (await call('GET', '/team/members', owner)).json(),
      ).members.find((member) => member.id === basile.id);
      // The record and the list say the same.
      expect(listed?.invitationExpiresAt).toBe(one.invitationExpiresAt);
      return one.invitationExpiresAt;
    };
    const newLink = async (
      purpose: 'invitation' | 'reset' = 'invitation',
    ): Promise<InvitationLinkCreated> => {
      const response = await call('POST', `/team/members/${basile.id}/invitation-link`, owner, { purpose });
      expect(response.statusCode).toBe(200);
      return InvitationLinkCreatedSchema.parse(response.json());
    };

    // No link made yet.
    expect(basile.invitationExpiresAt).toBeNull();
    expect(await expiresAtOf()).toBeNull();

    // A live link: its own end, 72 h on.
    const live = await newLink();
    expect(await expiresAtOf()).toBe(live.expiresAt);

    // Expired, it stays, so the screen can say « Lien expiré » rather than offer a first link.
    const past = new Date(Date.now() - 60 * 60 * 1000);
    await test.admin.db
      .update(schema.invitationLinks)
      .set({ createdAt: new Date(past.getTime() - 72 * 60 * 60 * 1000), expiresAt: past })
      .where(eq(schema.invitationLinks.memberId, basile.id));
    expect(await expiresAtOf()).toBe(past.toISOString());

    // Used, nothing is out any more.
    const fresh = await newLink();
    const token = new URL(fresh.url).hash.replace('#t=', '');
    const redeemed = await server.inject({
      method: 'POST',
      url: '/v1/invitation-links/redeem',
      headers: { origin: DASHBOARD_ORIGIN },
      payload: { token, password: 'une phrase de passe inventée' },
    });
    expect(redeemed.statusCode).toBe(200);
    expect(await expiresAtOf()).toBeNull();

    // A link for a new password shows too: the owner sees it is out, rather than make a second that cancels it.
    const reset = await newLink('reset');
    expect(await expiresAtOf()).toBe(reset.expiresAt);
  });
});
