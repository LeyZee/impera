import {
  CommissionPresetIdSchema,
  CreatorIdSchema,
  newId,
  TeamMemberIdSchema,
  UserIdSchema,
  type Platform,
  type UserId,
} from '@impera/contracts';
import { and, eq, schema, sql, type Transaction } from '@impera/db';
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

describe('a member invited from a platform’s suggestion (ADR 0076 § 3)', () => {
  let test: TestDb;
  let app: App;
  let owner: { userId: UserId; ip: null };
  let invite: ReturnType<ReturnType<typeof createTeamModule>['invites']>['fromPlatform'];
  const presetId = newId(CommissionPresetIdSchema);

  /**
   * `connectors`' link writes, as the composition root will give them: here a plain upsert of `sales_feed_chatters`
   * in the invitation's transaction, under the account's advisory lock.
   */
  const links = {
    lockLink: async (tx: Transaction, account: { platform: Platform; platformChatterId: string }) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`${account.platform}:${account.platformChatterId}`}))`,
      );
      const [row] = await tx
        .select({ kind: schema.salesFeedChatters.kind, memberId: schema.salesFeedChatters.memberId })
        .from(schema.salesFeedChatters)
        .where(
          and(
            eq(schema.salesFeedChatters.platform, account.platform),
            eq(schema.salesFeedChatters.platformChatterId, account.platformChatterId),
          ),
        );
      if (row === undefined) return null;
      return row.memberId === null
        ? ({ kind: 'agent' } as const)
        : ({ kind: 'member', memberId: TeamMemberIdSchema.parse(row.memberId) } as const);
    },
    link: async (
      tx: Transaction,
      account: { platform: Platform; platformChatterId: string },
      memberId: string,
      actor: { userId: string },
    ) => {
      await tx
        .insert(schema.salesFeedChatters)
        .values({ ...account, kind: 'member', memberId, linkedBy: actor.userId })
        .onConflictDoUpdate({
          target: [schema.salesFeedChatters.platform, schema.salesFeedChatters.platformChatterId],
          set: { kind: 'member', memberId, linkedBy: actor.userId },
        });
    },
  };

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
    invite = team.invites(links).fromPlatform;
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

  it('lets no chatter invite anyone', async () => {
    const lou = await invite(owner, { ...body('zoe@example.test'), account: reveal('rv-chatter-5') });
    await expect(
      invite({ userId: lou.userId, ip: null }, { ...body('friend@example.test'), account: reveal('rv-x4') }),
    ).rejects.toMatchObject({ code: 'role_forbidden' });
    expect(await linkOf('rv-x4')).toBeNull();
  });
});
