import {
  CommissionPresetIdSchema,
  CommissionRateIdSchema,
  CreatorIdSchema,
  MemberRoleIdSchema,
  newId,
  TeamMemberIdSchema,
  UserIdSchema,
  type TeamMemberId,
  type UserId,
} from '@impera/contracts';
import { eq, schema, withMember, type Transaction } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { enqueuePayRecalculation } from '../modules/payroll';
import { createTeamModule } from '../modules/team';

import { testConfig } from './support/config';

/** Invented people, accounts and rates only (ADR 0010). */
const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const [ANNA, BELLA, CLARA] = [newId(CreatorIdSchema), newId(CreatorIdSchema), newId(CreatorIdSchema)];

/** The agency's day (Europe/Paris), shifted by `days`. */
function agencyDay(days = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const day = new Date(`${today}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

describe('a member invited from a link proposal (ADR 0076 § 3)', () => {
  let test: TestDb;
  let app: App;
  let owner: { userId: UserId; ip: null };
  let invite: ReturnType<ReturnType<typeof createTeamModule>['invites']>['fromPlatform'];
  const presetId = newId(CommissionPresetIdSchema);

  const body = (email: string, overrides: object = {}) => ({
    email,
    firstName: 'Lou',
    lastName: 'Garnier',
    displayName: 'Lou',
    teamRole: 'chatter' as const,
    country: 'MG' as const,
    timeZone: 'Indian/Antananarivo',
    color: null,
    joinedOn: agencyDay(),
    creatorIds: [],
    commission: { presetId },
    teamShareBps: null,
    ...overrides,
  });
  const reveal = (platformChatterId: string) => ({ platform: 'reveal' as const, platformChatterId });

  const linkOf = async (platformChatterId: string) => {
    const [row] = await test.admin.db
      .select({ kind: schema.salesFeedChatters.kind, memberId: schema.salesFeedChatters.memberId })
      .from(schema.salesFeedChatters)
      .where(eq(schema.salesFeedChatters.platformChatterId, platformChatterId));
    return row ?? null;
  };
  const accountsWith = async (email: string) =>
    (await test.admin.db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email)))
      .length;
  const invitesAudited = () =>
    test.admin.db
      .select({
        userId: schema.auditLog.userId,
        entityId: schema.auditLog.entityId,
        details: schema.auditLog.details,
      })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'team_member.invite'));

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
    app = await createApp(config, createLogger(config), { passwordBreaches: () => Promise.resolve(false) });
    const { userId } = await createOwner(app.auth, app.db.db, OWNER);
    owner = { userId: UserIdSchema.parse(userId), ip: null };
    // « Standard », the owner's preset, in force since yesterday.
    await test.admin.db.insert(schema.commissionPresets).values({
      id: presetId,
      name: 'Standard',
      rateBps: 1500,
      effectiveFrom: agencyDay(-1),
      createdBy: userId,
    });
    const team = createTeamModule({
      db: app.db.db,
      adminDb: app.adminDb.db,
      creators: { existing: (ids) => Promise.resolve(new Set(ids)) },
      invitationLinks: { live: () => Promise.resolve(new Map()) },
      enqueuePayRecalculation,
    });
    // `connectors`' own link writes (migration 0135), as the composition root gives them to the route.
    invite = team.invites(app.modules.connectors.invitationChatterLinks).fromPlatform;
  });

  afterAll(async () => {
    await app.shutdown();
    await test.close();
  });

  it('creates the member and links his account in one transaction, audited with the platform’s id', async () => {
    const lou = await invite(owner, {
      ...body(' Lou.Garnier@Example.test '),
      account: reveal('rv-chatter-1'),
    });
    expect(lou).toMatchObject({
      email: 'lou.garnier@example.test',
      teamRole: 'chatter',
      invitationPending: true,
      commission: { rateBps: 1500, presetId, teamShareBps: null },
    });
    expect(await linkOf('rv-chatter-1')).toEqual({ kind: 'member', memberId: lou.id });
    const audited = (await invitesAudited()).filter((row) => row.entityId === lou.id);
    expect(audited).toEqual([
      {
        userId: owner.userId,
        entityId: lou.id,
        details: { teamRole: 'chatter', creators: 0, platform: 'reveal', platformChatterId: 'rv-chatter-1' },
      },
    ]);
  });

  it('gives the member already invited when asked again for the same account, and creates nothing', async () => {
    const first = await invite(owner, { ...body('mia@example.test'), account: reveal('rv-chatter-2') });
    const again = await invite(owner, { ...body('Mia@Example.test'), account: reveal('rv-chatter-2') });
    expect(again.id).toBe(first.id);
    expect(await accountsWith('mia@example.test')).toBe(1);
    expect((await invitesAudited()).filter((row) => row.entityId === first.id)).toHaveLength(1);
  });

  it('refuses an account linked to another member or to the agent, and writes nothing', async () => {
    await invite(owner, { ...body('noe@example.test'), account: reveal('rv-chatter-3') });
    await expect(
      invite(owner, { ...body('other@example.test'), account: reveal('rv-chatter-3') }),
    ).rejects.toMatchObject({ code: 'member_conflict' });
    await test.admin.db
      .insert(schema.salesFeedChatters)
      .values({ platform: 'reveal', platformChatterId: 'rv-bot', kind: 'agent' });
    await expect(
      invite(owner, { ...body('bot@example.test'), account: reveal('rv-bot') }),
    ).rejects.toMatchObject({ code: 'member_conflict' });
    expect(await accountsWith('other@example.test')).toBe(0);
    expect(await accountsWith('bot@example.test')).toBe(0);
    expect(await linkOf('rv-bot')).toEqual({ kind: 'agent', memberId: null });
  });

  it('refuses an e-mail another account has, and leaves the platform account unlinked', async () => {
    await expect(
      invite(owner, { ...body(OWNER.email), account: reveal('rv-chatter-4') }),
    ).rejects.toMatchObject({ code: 'member_conflict' });
    expect(await linkOf('rv-chatter-4')).toBeNull();
  });

  it('keeps every choice of the owner, and bounds an active manager before anything is written', async () => {
    // The owner invites a manager, with a share of the team's net and two creators: Équipe › Membres' choices.
    const basile = await invite(owner, {
      ...body('basile@example.test', {
        firstName: 'Basile',
        displayName: 'Basile',
        teamRole: 'manager',
        commission: { rateBps: 1200 },
        teamShareBps: 300,
        creatorIds: [ANNA, BELLA],
      }),
      account: reveal('rv-manager-1'),
    });
    expect(basile).toMatchObject({ teamRole: 'manager', creatorIds: [ANNA, BELLA] });
    const manager = { userId: basile.userId, ip: null };

    const refused = (overrides: object, chatterId: string) =>
      invite(manager, { ...body(`${chatterId}@example.test`, overrides), account: reveal(chatterId) });
    await expect(refused({ teamRole: 'manager' }, 'rv-x1')).rejects.toMatchObject({
      code: 'role_forbidden',
      details: { bound: 'role' },
    });
    await expect(refused({ commission: { rateBps: 1500 } }, 'rv-x2')).rejects.toMatchObject({
      code: 'role_forbidden',
      details: { bound: 'rate' },
    });
    // Clara is not on his list: she would open her fans' conversations to the chatter he invites.
    await expect(refused({ creatorIds: [ANNA, CLARA] }, 'rv-x3')).rejects.toMatchObject({
      code: 'role_forbidden',
      details: { bound: 'creators' },
    });
    for (const chatterId of ['rv-x1', 'rv-x2', 'rv-x3']) {
      expect(await linkOf(chatterId)).toBeNull();
      expect(await accountsWith(`${chatterId}@example.test`)).toBe(0);
    }
  });

  it('lets an active manager invite a chatter within his bounds, under the base’s policies (§ 3)', async () => {
    const vera = await invite(owner, {
      ...body('vera@example.test', {
        firstName: 'Vera',
        displayName: 'Vera',
        teamRole: 'manager',
        commission: { rateBps: 1200 },
        creatorIds: [ANNA, BELLA],
      }),
      account: reveal('rv-manager-2'),
    });
    const manager = { userId: vera.userId, ip: null };
    const ines = await invite(manager, {
      ...body('ines@example.test', { firstName: 'Ines', displayName: 'Ines', creatorIds: [ANNA] }),
      account: reveal('rv-chatter-6'),
    });
    expect(ines).toMatchObject({
      teamRole: 'chatter',
      creatorIds: [ANNA],
      invitationPending: true,
      commission: { rateBps: 1500, presetId, teamShareBps: null },
    });
    expect(await linkOf('rv-chatter-6')).toEqual({ kind: 'member', memberId: ines.id });
    expect((await invitesAudited()).filter((row) => row.entityId === ines.id)).toEqual([
      {
        userId: vera.userId,
        entityId: ines.id,
        details: { teamRole: 'chatter', creators: 1, platform: 'reveal', platformChatterId: 'rv-chatter-6' },
      },
    ]);
  });

  it('never lets a manager invite onto his own platform account (§ 4)', async () => {
    const yan = await invite(owner, {
      ...body('yan@example.test', {
        firstName: 'Yan',
        displayName: 'Yan',
        teamRole: 'manager',
        commission: { rateBps: 1200 },
      }),
      account: reveal('rv-manager-3'),
    });
    await expect(
      invite(
        { userId: yan.userId, ip: null },
        { ...body('yan.bis@example.test'), account: reveal('rv-manager-3') },
      ),
    ).rejects.toMatchObject({ code: 'member_conflict' });
    expect(await accountsWith('yan.bis@example.test')).toBe(0);
    expect(await linkOf('rv-manager-3')).toEqual({ kind: 'member', memberId: yan.id });
  });

  it('holds a manager’s bounds in the base, whatever the route (§ 3, migration 0135)', async () => {
    const zia = await invite(owner, {
      ...body('zia@example.test', {
        firstName: 'Zia',
        displayName: 'Zia',
        teamRole: 'manager',
        commission: { rateBps: 1200 },
      }),
      account: reveal('rv-manager-4'),
    });
    /** A member written by hand as Zia, past the domain's bounds: `patch` makes one write step out of them. */
    const asZia = (
      email: string,
      patch: {
        account?: (tx: Transaction) => Promise<UserId>;
        teamRole?: 'chatter' | 'manager';
        rate?: { rateBps: number; teamShareBps: number | null };
        roleRow?: 'chatter' | 'manager';
      } = {},
    ) =>
      withMember(app.db.db, zia.userId, async (tx) => {
        const fresh = async () => {
          const id = newId(UserIdSchema);
          await tx.insert(schema.user).values({ id, name: 'X', email, role: 'operator', creatorIds: [] });
          return id;
        };
        const userId = await (patch.account ?? fresh)(tx);
        const memberId: TeamMemberId = newId(TeamMemberIdSchema);
        await tx.insert(schema.teamMembers).values({
          id: memberId,
          userId,
          teamRole: patch.teamRole ?? 'chatter',
          firstName: 'X',
          lastName: 'Y',
          displayName: 'X',
          country: 'MG',
          timeZone: 'Indian/Antananarivo',
          color: null,
          joinedOn: agencyDay(),
        });
        await tx.insert(schema.memberCommissionRates).values({
          id: newId(CommissionRateIdSchema),
          memberId,
          rateBps: patch.rate?.rateBps ?? 1500,
          teamShareBps: patch.rate?.teamShareBps ?? null,
          presetId,
          effectiveFrom: agencyDay(),
          createdBy: zia.userId,
        });
        await tx.insert(schema.memberRoles).values({
          id: newId(MemberRoleIdSchema),
          memberId,
          teamRole: patch.roleRow ?? 'chatter',
          effectiveFrom: agencyDay(),
          createdBy: zia.userId,
        });
      });

    // The same writes inside his bounds pass: what follows fails on its one step out, not on the scaffold.
    await asZia('inside@example.test');
    expect(await accountsWith('inside@example.test')).toBe(1);

    const outside = {
      'a manager': { teamRole: 'manager' as const },
      'his own account': { account: () => Promise.resolve(zia.userId) },
      'an account made before': { account: () => Promise.resolve(owner.userId) },
      'a rate above the preset': { rate: { rateBps: 1600, teamShareBps: null } },
      'a share of the team’s net': { rate: { rateBps: 1500, teamShareBps: 300 } },
      'a manager’s role row': { roleRow: 'manager' as const },
    };
    for (const [step, patch] of Object.entries(outside)) {
      const email = `out-${step.replaceAll(/[^a-z]/gu, '')}@example.test`;
      // 42501: the row-level security refusal, not a constraint the scaffold would trip on.
      await expect(asZia(email, patch), step).rejects.toMatchObject({ cause: { code: '42501' } });
      expect(await accountsWith(email), step).toBe(0);
    }
  });

  it('lets no chatter invite anyone', async () => {
    const lou = await invite(owner, { ...body('zoe@example.test'), account: reveal('rv-chatter-5') });
    await expect(
      invite({ userId: lou.userId, ip: null }, { ...body('friend@example.test'), account: reveal('rv-x4') }),
    ).rejects.toMatchObject({ code: 'role_forbidden' });
    expect(await linkOf('rv-x4')).toBeNull();
  });
});
