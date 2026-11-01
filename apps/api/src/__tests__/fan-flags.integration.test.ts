import {
  FanFlagsViewSchema,
  FanKycViewSchema,
  FanIdSchema,
  newId,
  PlatformAccountIdSchema,
  TeamMemberIdSchema,
  type CreatorId,
  type FanId,
} from '@nirvana/contracts';
import { and, eq, schema, withAdmin } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import type { preValidationAsyncHookHandler } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { createFansModule } from '../modules/fans';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { activateDemoPersona } from './support/persona';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const OPERATOR = { email: 'operator@example.test', name: 'Operator', password: 'staple battery horse' };
const CREATOR = { email: 'creator@example.test', name: 'Creator', password: 'battery staple horse' };

describe('fan flags (GET and PUT /v1/fans/:id/flags) and lines to learn (GET /v1/fans/:id/kyc)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let owner: string;
  let operator: string;
  let creator: string;
  let operatorId: string;
  let anna: CreatorId;
  let bea: CreatorId;
  let fan: FanId;

  const url = (fanId: string, creatorId: string) => `/v1/fans/${fanId}/flags?creatorId=${creatorId}`;
  const get = (cookie: string, creatorId: string = anna) =>
    server.inject({ method: 'GET', url: url(fan, creatorId), headers: { cookie } });
  const put = (cookie: string, payload: object, creatorId: string = anna) =>
    server.inject({
      method: 'PUT',
      url: url(fan, creatorId),
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      payload,
    });
  const eventsOf = (type: 'fan_flag_set' | 'fan_flag_cleared') =>
    test.admin.db
      .select()
      .from(schema.domainEvents)
      .where(and(eq(schema.domainEvents.creatorId, anna), eq(schema.domainEvents.type, type)));

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
    app = await createApp(config, createLogger(config));
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    await createOwner(app.auth, app.db.db, OWNER);
    anna = (await app.modules.persona.creators.create({ displayName: 'Anna' })).id;
    bea = (await app.modules.persona.creators.create({ displayName: 'Bea' })).id;
    // Her lines to learn come from her active version (recette 28/10, G4): the demo persona, for Anna only.
    await activateDemoPersona(app, anna);
    // An invented fan of Anna (ADR 0010).
    const accountId = newId(PlatformAccountIdSchema);
    fan = newId(FanIdSchema);
    await withAdmin(test.admin.db, async (tx) => {
      await tx
        .insert(schema.platformAccounts)
        .values({ id: accountId, creatorId: anna, platform: 'reveal', handle: 'anna-demo' });
      await tx.insert(schema.fans).values({
        id: fan,
        creatorId: anna,
        platformAccountId: accountId,
        platformFanId: 'fan-1',
        displayName: 'Basile',
      });
    });
    operatorId = (await createOwner(app.auth, app.db.db, OPERATOR)).userId;
    await test.admin.db
      .update(schema.user)
      .set({ role: 'operator', creatorIds: [anna] })
      .where(eq(schema.user.id, operatorId));
    const { userId: creatorUserId } = await createOwner(app.auth, app.db.db, CREATOR);
    await test.admin.db
      .update(schema.user)
      .set({ role: 'creator', creatorIds: [anna] })
      .where(eq(schema.user.id, creatorUserId));
    owner = await signIn(server, OWNER.email, OWNER.password);
    operator = await signIn(server, OPERATOR.email, OPERATOR.password);
    creator = await signIn(server, CREATOR.email, CREATOR.password);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('reads his limits, none at first', async () => {
    expect((await server.inject({ method: 'GET', url: url(fan, anna) })).statusCode).toBe(401);
    const read = await get(operator);
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ fanId: fan, flags: {}, mayConfirmDisputedAge: false });
    expect((await get(owner)).json()).toMatchObject({ mayConfirmDisputedAge: true });
  });

  it('lets a chatter set and lift a limit, authored by the session, once per change', async () => {
    const frozen = await put(operator, {
      flag: 'salesFrozen',
      set: true,
      freezeReason: 'distress',
      reason: '  Va mal  ',
    });
    expect(frozen.statusCode).toBe(200);
    const since = frozen.json<{ flags: { salesFrozen: { since: string } } }>().flags.salesFrozen.since;
    expect(frozen.json()).toEqual({
      fanId: fan,
      flags: { salesFrozen: { reason: 'distress', since } },
      mayConfirmDisputedAge: false,
    });
    // The same freeze again keeps its start and writes nothing.
    expect(
      (await put(operator, { flag: 'salesFrozen', set: true, freezeReason: 'distress' })).json(),
    ).toEqual({
      fanId: fan,
      flags: { salesFrozen: { reason: 'distress', since } },
      mayConfirmDisputedAge: false,
    });
    expect((await put(owner, { flag: 'spendingLimitMinor', set: true, limitMinor: 5000 })).statusCode).toBe(
      200,
    );
    expect((await put(owner, { flag: 'ageConfirmedAt', set: true })).statusCode).toBe(200);
    const lifted = await put(operator, { flag: 'salesFrozen', set: false });
    expect(lifted.statusCode).toBe(200);
    expect(lifted.json<{ flags: object }>().flags).not.toHaveProperty('salesFrozen');
    const after = FanFlagsViewSchema.parse((await get(operator)).json()).flags;
    expect(Object.keys(after).sort()).toEqual(['ageConfirmedAt', 'spendingLimitMinor']);
    expect(after.spendingLimitMinor).toBe(5000);

    const set = await eventsOf('fan_flag_set');
    expect(set).toHaveLength(3);
    const first = set.find((event) => event.actor === `human:${operatorId}`);
    expect(first?.payload).toMatchObject({ fanId: fan, flag: 'salesFrozen', reason: 'Va mal' });
    const cleared = await eventsOf('fan_flag_cleared');
    expect(cleared.map((event) => event.actor)).toEqual([`human:${operatorId}`]);
  });

  it('refuses the creator, another creator, an unknown fan and a malformed request', async () => {
    // A creator never sees her fans' data (ADR 0023), not even his limits.
    expect((await get(creator)).statusCode).toBe(403);
    expect((await put(creator, { flag: 'fragile', set: true })).statusCode).toBe(403);
    expect((await put(operator, { flag: 'fragile', set: true }, bea)).statusCode).toBe(403);
    // The owner sees every creator, but Anna's fan is not Bea's.
    expect((await put(owner, { flag: 'fragile', set: true }, bea)).statusCode).toBe(404);
    expect((await get(owner, bea)).statusCode).toBe(404);
    expect((await put(owner, { flag: 'salesFrozen', set: true })).statusCode).toBe(400);
    for (const limitMinor of [-1, 0, 10_000_001])
      expect((await put(owner, { flag: 'spendingLimitMinor', set: true, limitMinor })).statusCode).toBe(400);
    expect((await put(owner, { flag: 'fragile', set: true, reason: '   ' })).statusCode).toBe(400);
    expect((await get(owner)).json<{ flags: object }>().flags).not.toHaveProperty('fragile');
  });

  it('says what is left to learn of him, in her order, among the lines her persona collects', async () => {
    const kyc = (cookie: string, creatorId: string = anna) =>
      server.inject({
        method: 'GET',
        url: `/v1/fans/${fan}/kyc?creatorId=${creatorId}`,
        headers: { cookie },
      });
    // The demo persona collects six lines of the canvas, not `desires` (personas/demo/v0.2.0.yaml).
    const first = await kyc(operator);
    expect(first.statusCode).toBe(200);
    expect(FanKycViewSchema.parse(first.json())).toEqual({
      fanId: fan,
      toLearn: ['first_name', 'age', 'location', 'job', 'situation', 'hobbies'],
    });
    const observedAt = new Date();
    const fact = { kind: 'declared', confidence: 0.9, sourceMessageId: null, observedAt } as const;
    await app.modules.fans.proposeFacts(anna, fan, [
      { ...fact, category: 'identity', key: 'Location', value: 'Lyon' },
      { ...fact, category: 'life', key: 'job', value: 'Infirmier' },
      // A chatter's note never fills a line, whatever its key.
      { ...fact, category: 'operator_note', key: 'first_name', value: 'Prénom à demander' },
    ]);
    expect((await kyc(owner)).json()).toEqual({
      fanId: fan,
      toLearn: ['first_name', 'age', 'situation', 'hobbies'],
    });
    // Past the 40 facts of the context, with a chatter's notes first, a line learnt stays learnt.
    await app.modules.fans.proposeFacts(
      anna,
      fan,
      Array.from({ length: 45 }, (_, index) => ({
        ...fact,
        category: 'operator_note' as const,
        key: `note_${String(index)}`,
        value: `Note ${String(index)}`,
      })),
    );
    expect((await app.modules.fans.activeFacts(anna, fan)).some((f) => f.key === 'location')).toBe(false);
    expect((await kyc(owner)).json<{ toLearn: string[] }>().toLearn).toEqual([
      'first_name',
      'age',
      'situation',
      'hobbies',
    ]);
    // As his limits: never the creator, never a creator out of reach, never a fan of another creator.
    expect((await kyc(creator)).statusCode).toBe(403);
    expect((await kyc(operator, bea)).statusCode).toBe(403);
    expect((await kyc(owner, bea)).statusCode).toBe(404);
  });

  it('says every canvas line, in the canvas order, when no persona gives hers', async () => {
    // Stands in for `requireRole`: an owner, set as auth.ts does.
    const asOwner: preValidationAsyncHookHandler = (request) => {
      request.user = {
        id: operatorId,
        email: 'owner@example.test',
        name: 'Owner',
        role: 'owner',
        creatorIds: [],
        routedCreatorIds: [],
      };
      return Promise.resolve();
    };
    // His own fan of Bea, with one line learnt: nothing from the tests above (ADR 0010, invented).
    const beaAccount = newId(PlatformAccountIdSchema);
    const theo = newId(FanIdSchema);
    await withAdmin(test.admin.db, async (tx) => {
      await tx
        .insert(schema.platformAccounts)
        .values({ id: beaAccount, creatorId: bea, platform: 'reveal', handle: 'bea-demo' });
      await tx.insert(schema.fans).values({
        id: theo,
        creatorId: bea,
        platformAccountId: beaAccount,
        platformFanId: 'fan-2',
        displayName: 'Théo',
      });
    });
    await app.modules.fans.proposeFacts(bea, theo, [
      {
        category: 'identity',
        key: 'location',
        value: 'Nantes',
        kind: 'declared',
        confidence: 0.9,
        sourceMessageId: null,
        observedAt: new Date(),
      },
    ]);
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
    const fans = createFansModule({ db: app.db.db, adminDb: test.admin.db });
    const bare = await buildServer({
      config,
      logger: createLogger(config),
      routes: [fans.routes(() => asOwner)],
      readiness: app.readiness,
    });
    try {
      const read = await bare.inject({ method: 'GET', url: `/v1/fans/${theo}/kyc?creatorId=${bea}` });
      expect(read.statusCode, read.body).toBe(200);
      expect(FanKycViewSchema.parse(read.json()).toLearn).toEqual([
        'first_name',
        'age',
        'job',
        'hobbies',
        'desires',
        'situation',
      ]);
    } finally {
      await bare.close();
    }
    // The app's own route: Bea has no active persona version, so every line (recette 28/10, G4).
    const viaApp = await server.inject({
      method: 'GET',
      url: `/v1/fans/${theo}/kyc?creatorId=${bea}`,
      headers: { cookie: owner },
    });
    expect(FanKycViewSchema.parse(viaApp.json()).toLearn).toEqual([
      'first_name',
      'age',
      'job',
      'hobbies',
      'desires',
      'situation',
    ]);
  });

  it('keeps a disputed age to the owner or an active manager, with a written reason kept in the event (SUIVI-04)', async () => {
    // Taken back by a person: disputed, his own statement no longer confirms it.
    await put(owner, { flag: 'ageConfirmedAt', set: true });
    const disputed = await put(operator, { flag: 'ageConfirmedAt', set: false });
    expect(disputed.json<{ flags: object }>().flags).toHaveProperty('ageDisputed');
    const reason = 'Pièce d’identité vue en appel vidéo';

    // A chatter cannot lift it, even with a reason; nothing is written.
    const refused = await put(operator, { flag: 'ageConfirmedAt', set: true, reason });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ error: { code: 'age_dispute_forbidden' } });
    // Nor lift the dispute alone to confirm him after: the request is refused, nothing is written.
    const clearedBefore = (await eventsOf('fan_flag_cleared')).length;
    const lifted = await put(operator, { flag: 'ageDisputed', set: false, reason });
    expect(lifted.statusCode).toBe(400);
    expect(await eventsOf('fan_flag_cleared')).toHaveLength(clearedBefore);
    expect((await get(operator)).json<{ flags: object }>().flags).toHaveProperty('ageDisputed');
    // The owner must write why.
    const bare = await put(owner, { flag: 'ageConfirmedAt', set: true });
    expect(bare.statusCode).toBe(400);
    expect(bare.json()).toMatchObject({ error: { code: 'age_dispute_reason_invalid' } });
    expect((await get(owner)).json<{ flags: object }>().flags).toHaveProperty('ageDisputed');

    // An active manager may, with a reason (the database says, never the caller).
    await test.admin.db.insert(schema.teamMembers).values({
      id: newId(TeamMemberIdSchema),
      userId: operatorId,
      teamRole: 'manager',
      firstName: 'Prénom',
      lastName: 'Inventé',
      displayName: 'Manager',
      country: 'MG',
      timeZone: 'Indian/Antananarivo',
      joinedOn: '2026-10-01',
    });
    expect((await get(operator)).json()).toMatchObject({ mayConfirmDisputedAge: true });
    const confirmed = await put(operator, { flag: 'ageConfirmedAt', set: true, reason });
    expect(confirmed.statusCode).toBe(200);
    const flags = confirmed.json<{ flags: object }>().flags;
    expect(flags).toHaveProperty('ageConfirmedAt');
    expect(flags).not.toHaveProperty('ageDisputed');
    const byManager = (await eventsOf('fan_flag_set')).filter((e) => e.actor === `human:${operatorId}`);
    expect(byManager.map((e) => e.payload)).toContainEqual(
      expect.objectContaining({ flag: 'ageConfirmedAt', reason }),
    );
    await test.admin.db.delete(schema.teamMembers).where(eq(schema.teamMembers.userId, operatorId));
  });
});
