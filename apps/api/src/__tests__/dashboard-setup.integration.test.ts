import { createHash, randomUUID } from 'node:crypto';

import {
  BillingRegimeIdSchema,
  ContractAcceptanceIdSchema,
  ContractorRegimeIdSchema,
  ContractTextIdSchema,
  CreatorIdSchema,
  CreatorSetupListSchema,
  MemberSetupListSchema,
  newId,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  TeamMemberIdSchema,
  type CreatorId,
  type PlatformAccountId,
  type TeamMemberId,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
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
 * « Mise en route » (pilotage plan W1) through the real app: each step ticked from the base, never by a click, for the
 * owner alone. Everything is invented (ADR 0010).
 */
describe('GET /v1/dashboard/setup/creators and /members, « Mise en route »', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let nora: CreatorId;
  let bare: CreatorId;
  let account: PlatformAccountId;
  let theo: TeamMemberId;
  let ownerId: string;
  type Who = 'owner' | 'manager' | 'chatter' | 'creator';
  const cookies = new Map<Who, string>();

  const get = (who: Who | null, path: string) =>
    server.inject({
      method: 'GET',
      url: `/v1/dashboard/setup/${path}`,
      headers: { origin: DASHBOARD_ORIGIN, ...(who === null ? {} : { cookie: cookies.get(who) }) },
    });
  const creators = async () => {
    const answer = await get('owner', 'creators');
    expect(answer.statusCode, answer.body).toBe(200);
    return CreatorSetupListSchema.parse(answer.json()).creators;
  };
  const stepsOf = async (creatorId: CreatorId) =>
    Object.fromEntries(
      ((await creators()).find((c) => c.creatorId === creatorId)?.steps ?? []).map((s) => [s.key, s.state]),
    );

  async function person(key: Exclude<Who, 'owner'>, role: 'operator' | 'creator', ids: readonly CreatorId[]) {
    const email = `${key}@example.test`;
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: key, password: PASSWORD });
    await test.admin.db
      .update(schema.user)
      .set({ role, creatorIds: [...ids] })
      .where(eq(schema.user.id, userId));
    cookies.set(key, await signIn(server, email, PASSWORD));
    return userId;
  }

  async function member(userId: string, teamRole: 'manager' | 'chatter', displayName: string) {
    const id = newId(TeamMemberIdSchema);
    await test.admin.db.insert(schema.teamMembers).values({
      id,
      userId,
      teamRole,
      firstName: 'Prénom',
      lastName: 'Inventé',
      displayName,
      country: 'BJ',
      timeZone: 'Africa/Porto-Novo',
      joinedOn: '2026-10-01',
    });
    return id;
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
    bare = newId(CreatorIdSchema);
    account = newId(PlatformAccountIdSchema);
    await test.admin.db.insert(schema.creators).values([
      { id: nora, nameKey: 'nora', displayName: 'Nora', timezone: 'Europe/Paris' },
      { id: bare, nameKey: 'sans-rien', displayName: 'Sans rien', timezone: 'Europe/Paris' },
    ]);
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: account, creatorId: nora, platform: 'reveal', handle: 'creatrice_test' });

    ({ userId: ownerId } = await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: PASSWORD,
    }));
    cookies.set('owner', await signIn(server, 'owner@example.test', PASSWORD));
    await member(await person('manager', 'operator', [nora]), 'manager', 'Maya');
    theo = await member(await person('chatter', 'operator', [nora]), 'chatter', 'Théo');
    await person('creator', 'creator', [nora]);
    await test.admin.db
      .insert(schema.salesFeedChatters)
      .values({ platform: 'reveal', platformChatterId: 'chatter_theo', kind: 'member', memberId: theo });
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('gives the creators’ to the owner alone, the team’s to the owner and an active manager', async () => {
    for (const path of ['creators', 'members']) {
      expect((await get(null, path)).statusCode).toBe(401);
      for (const who of ['chatter', 'creator'] as const) {
        expect((await get(who, path)).statusCode, `${who} ${path}`).toBe(403);
      }
    }
    expect((await get('manager', 'creators')).statusCode).toBe(403);
    expect((await get('manager', 'members')).statusCode).toBe(200);
  });

  it('reads what a creator has, and what she does not', async () => {
    expect(await stepsOf(bare)).toMatchObject({
      platform_account: 'todo',
      persona: 'todo',
      agency_rate: 'todo',
      access: 'todo',
      pay_rules: 'todo',
      shifts: 'todo',
      agent_hours: 'done',
      agent_mode: 'done',
      reliability_check: 'todo',
    });
    // Her own account, made and signed in with: her invitation is used.
    expect(await stepsOf(nora)).toMatchObject({
      platform_account: 'done',
      access: 'done',
      pay_rules: 'todo',
    });
  });

  it('ticks a step as soon as the base holds it', async () => {
    await test.admin.db
      .insert(schema.creatorAgencyRates)

      .values({
        id: randomUUID(),
        creatorId: nora,
        fromDay: '2026-10-01',
        agencyBps: 4500,
        createdBy: ownerId,
      });
    await test.admin.db.insert(schema.accountPayRules).values({
      id: randomUUID(),
      creatorId: nora,
      platformAccountId: account,
      fromPeriod: '2026-10-01',
      currency: 'EUR',
      vatBps: 2000,
      platformFeeBps: 2000,
      earningsSource: 'detected',
      createdBy: ownerId,
    });
    const starts = new Date(Date.now() + 86_400_000);
    starts.setUTCSeconds(0, 0);
    await test.admin.db.insert(schema.shifts).values({
      id: newId(ShiftIdSchema),
      creatorId: nora,
      platformAccountId: account,
      memberId: theo,
      startsAt: starts,
      endsAt: new Date(starts.getTime() + 4 * 3_600_000),
      createdBy: ownerId,
      updatedBy: ownerId,
    });
    const today = new Date().toISOString().slice(0, 10);
    await test.admin.db.insert(schema.salesFeedChecks).values({
      id: randomUUID(),
      platform: 'reveal',
      fromDay: '2026-10-01',
      toDay: today,
      verdict: 'match',
      clean: true,
      report: {},
      generatedAt: new Date(),
    });
    expect(await stepsOf(nora)).toMatchObject({
      agency_rate: 'done',
      pay_rules: 'done',
      shifts: 'done',
      reliability_check: 'done',
    });
    // A later check that is not clean takes the tick back.
    await test.admin.db.insert(schema.salesFeedChecks).values({
      id: randomUUID(),
      platform: 'reveal',
      fromDay: '2026-10-01',
      toDay: today,
      verdict: 'mismatch',
      clean: false,
      report: {},
      generatedAt: new Date(Date.now() + 1000),
    });
    const check = (await creators())
      .find((c) => c.creatorId === nora)
      ?.steps.find((s) => s.key === 'reliability_check');
    expect(check).toEqual({ key: 'reliability_check', state: 'todo', note: { kind: 'check_not_clean' } });
  });

  it('reads each member’s arrival', async () => {
    const answer = await get('owner', 'members');
    expect(answer.statusCode, answer.body).toBe(200);
    const members = MemberSetupListSchema.parse(answer.json()).members;
    const of = (role: 'manager' | 'chatter') =>
      Object.fromEntries(
        (members.find((m) => m.teamRole === role)?.steps ?? []).map((s) => [s.key, s.state]),
      );
    // Both signed in with their authenticator code (the test's sign-in sets one up). The manager has no rate: not paid,
    // no invoicing; the chatter's file is empty, so his first invoice could not go out.
    expect(of('manager')).toEqual({ invitation: 'done', second_factor: 'done', creators: 'done' });
    expect(of('chatter')).toEqual({
      invitation: 'done',
      second_factor: 'done',
      extension: 'todo',
      platform_account: 'done',
      creators: 'done',
      first_shift: 'done',
      billing: 'todo',
    });
    const billing = members.find((m) => m.memberId === theo)?.steps.find((s) => s.key === 'billing');
    expect(billing?.note?.kind).toBe('billing');
  });

  it('says a transfer under a tax treaty would wait for the residence certificate', async () => {
    const admin = test.admin.db;
    // Everything an invoice needs, all invented (ADR 0010): the agency, a treaty regime of his country, his mandate,
    // his file checked by the owner. The invoice could go out; the transfer would wait (ADR 0041).
    await admin.insert(schema.billingSettings).values({
      id: 1,
      agency: {
        legalName: 'Agence Exemple SAS',
        address: '1 place Fictive, 69000 Lyon',
        siren: '123456789',
        vatNumber: 'FR12123456789',
      },
      paymentTerms: 'Conditions inventées pour le test.',
      dueDays: 60,
      serviceDescription: 'Prestation inventée pour le test.',
      logoSha256: null,
      documentReminderDays: 30,
      accounts: null,
      updatedBy: ownerId,
    });
    const regimeId = newId(BillingRegimeIdSchema);
    await admin.insert(schema.billingRegimes).values({
      id: regimeId,
      name: 'Bénin (texte inventé)',
      countries: ['BJ'],
      vatTreatment: 'reverse_charge',
      vatRateBps: 2_000,
      withholding: 'treaty_exempt',
      mentions: ['Autofacturation'],
      documents: ['tax_residence'],
      taxIdRequired: true,
      createdBy: ownerId,
    });
    await admin
      .insert(schema.billingRegimeValidations)
      .values({ regimeId, validatedOn: '2025-01-01', recordedBy: ownerId });
    const body = 'Mandat de facturation (texte inventé pour le test).';
    const sha = createHash('sha256').update(body, 'utf8').digest('hex');
    const textId = newId(ContractTextIdSchema);
    await admin.insert(schema.contractTexts).values({
      id: textId,
      kind: 'billing_mandate',
      version: 1,
      body,
      sha256: sha,
      contestDelayDays: 7,
      createdBy: ownerId,
    });
    const theoUser = (
      await admin
        .select({ userId: schema.teamMembers.userId })
        .from(schema.teamMembers)
        .where(eq(schema.teamMembers.id, theo))
    )[0]?.userId;
    if (theoUser === undefined) throw new Error('Théo introuvable');
    await admin.insert(schema.contractAcceptances).values({
      id: newId(ContractAcceptanceIdSchema),
      memberId: theo,
      textId,
      textSha256: sha,
      acceptedBy: theoUser,
    });
    await admin.insert(schema.contractorRegimes).values({
      id: newId(ContractorRegimeIdSchema),
      memberId: theo,
      regimeId,
      effectiveFrom: '2025-01-01',
      createdBy: ownerId,
    });
    await admin.insert(schema.contractorProfiles).values({
      memberId: theo,
      legalName: 'Prestataire Inventé',
      address: '3 rue Imaginaire, Cotonou',
      taxId: '0000000000000',
      email: 'theo@example.test',
      invoicePrefix: 'THEO',
      updatedBy: theoUser,
    });
    await admin
      .update(schema.contractorProfiles)
      .set({ verifiedAt: new Date(), verifiedBy: ownerId, updatedBy: ownerId })
      .where(eq(schema.contractorProfiles.memberId, theo));
    const answer = await get('owner', 'members');
    const billing = MemberSetupListSchema.parse(answer.json())
      .members.find((m) => m.memberId === theo)
      ?.steps.find((s) => s.key === 'billing');
    expect(billing).toEqual({
      key: 'billing',
      state: 'todo',
      note: { kind: 'billing', reason: 'tax_residence_missing' },
    });
  });

  it('shows an active manager the chatters alone, without their invoicing', async () => {
    const answer = await get('manager', 'members');
    expect(answer.statusCode, answer.body).toBe(200);
    const members = MemberSetupListSchema.parse(answer.json()).members;
    expect(members.every((m) => m.teamRole === 'chatter')).toBe(true);
    expect(members.map((m) => m.memberId)).toContain(theo);
    expect(members.flatMap((m) => m.steps.map((s) => s.key))).not.toContain('billing');
  });

  it('asks a new link for an invitation that died unused, and leaves archived creators out', async () => {
    const gone = newId(CreatorIdSchema);
    const goneAccount = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: gone, nameKey: 'partie', displayName: 'Partie', timezone: 'Europe/Paris' });
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: goneAccount, creatorId: gone, platform: 'reveal', handle: 'partie_test' });
    // Never signed in: no password, a link made two weeks ago and dead since last week.
    const userId = randomUUID();
    await test.admin.db.insert(schema.user).values({
      id: userId,
      name: 'Nouveau',
      email: 'nouveau@example.test',
      role: 'operator',
      creatorIds: [gone],
    });
    const late = await member(userId, 'chatter', 'Nouveau');
    await test.admin.db.insert(schema.invitationLinks).values({
      id: randomUUID(),
      memberId: late,
      purpose: 'invitation',
      tokenHash: 'hash-inventé-pour-le-test',
      createdBy: ownerId,
      createdAt: new Date(Date.now() - 14 * 86_400_000),
      expiresAt: new Date(Date.now() - 7 * 86_400_000),
    });
    const starts = new Date(Date.now() + 86_400_000);
    starts.setUTCSeconds(0, 0);
    await test.admin.db.insert(schema.shifts).values({
      id: newId(ShiftIdSchema),
      creatorId: gone,
      platformAccountId: goneAccount,
      memberId: late,
      startsAt: starts,
      endsAt: new Date(starts.getTime() + 4 * 3_600_000),
      createdBy: ownerId,
      updatedBy: ownerId,
    });
    await test.admin.db
      .update(schema.creators)
      .set({ archivedAt: new Date() })
      .where(eq(schema.creators.id, gone));
    const answer = await get('owner', 'members');
    const steps = MemberSetupListSchema.parse(answer.json()).members.find((m) => m.memberId === late)?.steps;
    expect(steps?.find((s) => s.key === 'invitation')).toEqual({
      key: 'invitation',
      state: 'todo',
      note: { kind: 'invitation_expired' },
    });
    expect(steps?.find((s) => s.key === 'creators')?.state).toBe('todo');
    expect(steps?.find((s) => s.key === 'first_shift')?.state).toBe('todo');
  });
});
