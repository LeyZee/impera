import {
  CreatorIdSchema,
  FanIdSchema,
  FragileDismissalSchema,
  newId,
  PlatformAccountIdSchema,
  TodosAcrossCreatorsSchema,
  type CreatorId,
  type FanId,
  type PlatformAccountId,
} from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
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
const OPERATOR = { email: 'operator@example.test', name: 'Operator', password: 'staple battery horse' };
const CREATOR = { email: 'creator@example.test', name: 'Creator', password: 'battery staple horse' };
const DAY_MS = 86_400_000;

/**
 * ADR 0085 § 9, lot b2: the AI proposes to mark a fan « fragile » in « À traiter », a person accepts or sets it aside.
 * Invented fans and messages only (ADR 0010).
 */
describe('« Le marquer fragile ? » in « À traiter »', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let owner: string;
  let operator: string;
  let creator: string;
  let operatorId: string;
  let anna: CreatorId;
  let account: PlatformAccountId;
  let counter = 0;

  async function message(
    fan: string,
    direction: 'inbound' | 'outbound',
    at: Date,
    paidMinor: number | null = null,
  ): Promise<FanId> {
    counter += 1;
    const { conversationId } = await app.modules.conversations.ingestMessage({
      creatorId: anna,
      platformAccountId: account,
      platformConversationId: `c-${fan}`,
      platformFanId: `f-${fan}`,
      fanDisplayName: fan,
      message: {
        ref: { platform: 'reveal', id: `m-${String(counter)}` },
        conversationRef: { platform: 'reveal', id: `c-${fan}` },
        direction,
        text: direction === 'inbound' ? 'Message inventé' : 'Photo inventée',
        media: [],
        priceMinor: paidMinor,
        currency: paidMinor === null ? null : 'EUR',
        isPaid: paidMinor !== null,
        createdAt: at.toISOString(),
      },
      correlationId: 'seed',
    });
    const [row] = await test.admin.db
      .select({ fanId: schema.conversations.fanId })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId));
    if (row === undefined) throw new Error('no conversation');
    return FanIdSchema.parse(row.fanId);
  }

  const note = (fanId: FanId, key: 'attachment' | 'moods', value: string, at: Date) =>
    app.modules.fans.proposeFacts(anna, fanId, [
      {
        category: 'commercial',
        key,
        value,
        kind: 'inferred',
        confidence: 0.8,
        sourceMessageId: null,
        observedAt: at,
      },
    ]);

  const todos = async (cookie: string) => {
    const answer = await server.inject({ method: 'GET', url: '/v1/dashboard/todos', headers: { cookie } });
    if (answer.statusCode !== 200) throw new Error(answer.body);
    return TodosAcrossCreatorsSchema.parse(answer.json()).items.filter(
      (item) => item.kind === 'fragile_proposed',
    );
  };
  const dismiss = (cookie: string, fanId: FanId) =>
    server.inject({
      method: 'POST',
      url: `/v1/fans/${fanId}/fragile/dismiss?creatorId=${anna}`,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
    });

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
    anna = CreatorIdSchema.parse((await app.modules.persona.creators.create({ displayName: 'Anna' })).id);
    account = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: account, creatorId: anna, platform: 'reveal', handle: 'anna-demo' });
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

  it('proposes a strongly attached fan in distress, in amber, saying which signs and never his card', async () => {
    const now = Date.now();
    const basile = await message('Basile', 'inbound', new Date(now - 60_000));
    await note(basile, 'attachment', 'jaloux, « tu me manques »', new Date(now - 2 * DAY_MS));
    expect(await todos(owner)).toEqual([]);
    await note(basile, 'moods', 'seul le soir', new Date(now - DAY_MS));
    const [line] = await todos(owner);
    expect(line).toMatchObject({
      kind: 'fragile_proposed',
      tone: 'warn',
      title: 'Basile',
      fanId: basile,
      creatorId: anna,
      why: 'Il est très attaché et semble en détresse. L’IA propose de le marquer fragile : à toi d’accepter ou d’écarter.',
    });
    expect(line?.why).not.toContain('jaloux');
  });

  it('proposes one whose spending climbs fast, from his paid messages', async () => {
    const now = Date.now();
    const cyril = await message('Cyril', 'inbound', new Date(now - 3 * DAY_MS));
    await note(cyril, 'attachment', 'accro', new Date(now - 3 * DAY_MS));
    await message('Cyril', 'outbound', new Date(now - 20 * DAY_MS), 1_000);
    expect((await todos(owner)).some((line) => line.fanId === cyril)).toBe(false);
    await message('Cyril', 'outbound', new Date(now - 2 * DAY_MS), 6_000);
    expect((await todos(owner)).find((line) => line.fanId === cyril)?.why).toContain(
      'dépense de plus en plus vite',
    );
  });

  it('lets a chatter set it aside as himself; it stays away until a new sign of distress', async () => {
    const [line] = (await todos(owner)).filter((one) => one.title === 'Basile');
    if (line === undefined) throw new Error('no proposal');
    expect((await dismiss(creator, line.fanId)).statusCode).toBe(403);
    const set = await dismiss(operator, line.fanId);
    expect(set.statusCode).toBe(200);
    expect(FragileDismissalSchema.parse(set.json()).fanId).toBe(line.fanId);
    const events = await test.admin.db.execute(
      sql`select actor, payload from domain_events where type = 'fan_fragile_dismissed'`,
    );
    expect(z.array(z.object({ actor: z.string(), payload: z.unknown() })).parse(events.rows)).toEqual([
      { actor: `human:${operatorId}`, payload: { fanId: line.fanId } },
    ]);
    expect((await todos(owner)).some((one) => one.fanId === line.fanId)).toBe(false);
    await note(line.fanId, 'moods', 'déprimé', new Date());
    expect((await todos(owner)).some((one) => one.fanId === line.fanId)).toBe(true);
  });

  it('is gone once a person marks him fragile, and a fan of another creator is 404', async () => {
    const [line] = (await todos(owner)).filter((one) => one.title === 'Basile');
    if (line === undefined) throw new Error('no proposal');
    const marked = await server.inject({
      method: 'PUT',
      url: `/v1/fans/${line.fanId}/flags?creatorId=${anna}`,
      headers: { cookie: operator, origin: DASHBOARD_ORIGIN },
      payload: { flag: 'fragile', set: true },
    });
    expect(marked.statusCode).toBe(200);
    expect((await todos(owner)).some((one) => one.fanId === line.fanId)).toBe(false);
    expect((await dismiss(owner, newId(FanIdSchema))).statusCode).toBe(404);
  });
});
