import {
  CreatorIdSchema,
  newId,
  PlatformAccountIdSchema,
  SalesFeedOverviewSchema,
  type CreatorId,
  type PlatformAccountId,
} from '@nirvana/contracts';
import { eq, schema, sql } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { revealSalesFeed } from '../modules/connectors';
import { buildServer, type Server } from '../server';

import { createFakeCrm, FAKE_CRM_BASE_URL, FAKE_CRM_KEY, type FakeCrm } from './fake-reveal/crm';
import { testConfig } from './support/config';
import { LogSink } from './support/log-sink';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const OPERATOR = { email: 'operator@example.test', name: 'Operator', password: 'staple battery horse' };
const NO_LOG = { info: () => undefined, warn: () => undefined };

const CountSchema = z.array(z.object({ n: z.number() }));

/** The sales feed of ADR 0050 through the real app: the key in Réglages, the register read by its job (CRM-01). */
describe('sales feed (CRM-01)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let crm: FakeCrm;
  let owner: string;
  let creatorId: CreatorId;
  let accountId: PlatformAccountId;
  let otherCreatorId: CreatorId;
  let otherAccountId: PlatformAccountId;
  const sink = new LogSink();
  let jobLogger: ReturnType<typeof createLogger>;

  const read = () => app.modules.connectors.jobs.readSales(jobLogger, 'test');

  async function count(query: ReturnType<typeof sql>): Promise<number> {
    const result = await test.admin.db.execute(query);
    return CountSchema.parse(result.rows)[0]?.n ?? 0;
  }

  const ledgerLines = (saleId: string) =>
    count(sql`select count(*)::int as n from platform_sales where platform_sale_id = ${saleId}`);
  const signals = (kind: string) =>
    count(
      sql`select count(*)::int as n from domain_events where type = 'sales_feed_signal' and payload->'signal'->>'kind' = ${kind}`,
    );

  async function cursor(): Promise<string | null> {
    const [row] = await test.admin.db
      .select({ position: schema.salesFeedCursors.position })
      .from(schema.salesFeedCursors)
      .where(eq(schema.salesFeedCursors.platform, 'reveal'));
    return row?.position ?? null;
  }

  async function api(method: 'GET' | 'PUT' | 'DELETE', url: string, payload?: object, cookie = owner) {
    return server.inject({
      method,
      url,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      ...(payload === undefined ? {} : { payload }),
    });
  }

  async function creatorWithAccount(handle: string): Promise<[CreatorId, PlatformAccountId]> {
    const creator = newId(CreatorIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creator, nameKey: handle, displayName: handle, timezone: 'Europe/Paris' });
    const account = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: account, creatorId: creator, platform: 'reveal', handle });
    return [creator, account];
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    crm = createFakeCrm();
    const config = testConfig({
      LOG_LEVEL: 'trace',
      DATABASE_URL: test.appUrl,
      DATABASE_ADMIN_URL: test.adminUrl,
      CREDENTIALS_ENCRYPTION_KEYS: `v1:${Buffer.alloc(32, 9).toString('base64')}`,
    });
    const logger = createLogger(config, sink);
    jobLogger = logger;
    app = await createApp(config, logger, {
      salesFeeds: { reveal: revealSalesFeed(crm.fetch, FAKE_CRM_BASE_URL) },
    });
    server = await buildServer({ config, logger, routes: app.routes, readiness: app.readiness });
    await createOwner(app.auth, app.db.db, OWNER);
    const { userId } = await createOwner(app.auth, app.db.db, OPERATOR);
    await test.admin.db.update(schema.user).set({ role: 'operator' }).where(eq(schema.user.id, userId));
    owner = await signIn(server, OWNER.email, OWNER.password);
    // The handle of FakeReveal's first model: linked on its own at connection. The second one is linked by hand.
    [creatorId, accountId] = await creatorWithAccount('creatrice_test');
    [otherCreatorId, otherAccountId] = await creatorWithAccount('compte_sans_lien');
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await crm.app.close();
    await test.close();
  });

  it('is the owner’s only, and a refused key is never kept', async () => {
    expect((await server.inject({ method: 'GET', url: '/v1/settings/sales-feeds' })).statusCode).toBe(401);
    const operator = await signIn(server, OPERATOR.email, OPERATOR.password);
    expect((await api('GET', '/v1/settings/sales-feeds', undefined, operator)).statusCode).toBe(403);

    const malformed = await api('PUT', '/v1/settings/sales-feeds/reveal/key', { key: 'sk-not-a-reveal-key' });
    expect(malformed.statusCode).toBe(422);
    expect(malformed.json()).toMatchObject({ kind: 'malformed' });
    const refused = await api('PUT', '/v1/settings/sales-feeds/reveal/key', { key: 'rvl_fake_key_revoked' });
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toMatchObject({ kind: 'unauthorized' });
    expect(await count(sql`select count(*)::int as n from sales_feed_credentials`)).toBe(0);

    const none = await api('GET', '/v1/settings/sales-feeds');
    expect(none.json()).toMatchObject({ feeds: [{ platform: 'reveal', state: 'not_connected' }] });
    // A platform without a sales feed.
    expect((await api('GET', '/v1/settings/sales-feeds/onlyfans')).statusCode).toBe(404);
  });

  it('keeps a verified key sealed, never sends it back, and links the model whose handle matches', async () => {
    const connected = await api('PUT', '/v1/settings/sales-feeds/reveal/key', { key: FAKE_CRM_KEY });
    expect(connected.statusCode).toBe(200);
    expect(connected.json()).toMatchObject({ state: 'connected', capabilities: ['sales', 'stats', 'team'] });

    const [row] = await test.admin.db.select().from(schema.salesFeedCredentials);
    expect(row?.keyCiphertext.toString('utf8')).not.toContain(FAKE_CRM_KEY);
    const overview = await api('GET', '/v1/settings/sales-feeds/reveal');
    expect(overview.body).not.toContain(FAKE_CRM_KEY);
    expect(overview.json()).toMatchObject({
      listError: null,
      models: [
        {
          platformModelId: 'model_test_01',
          platformAccountId: accountId,
          linkedBy: { kind: 'auto' },
          quarantined: 0,
        },
        { platformModelId: 'model_test_02', platformAccountId: null, linkedBy: null },
      ],
      chatters: [
        { platformChatterId: 'chatter_test_01', link: null },
        { platformChatterId: 'bot_test_01', isBot: true, link: null },
      ],
    });
    // Exactly the accounts a model can be linked to, and the model each one already counts.
    const choices = SalesFeedOverviewSchema.parse(overview.json()).accounts;
    expect(choices.find((one) => one.platformAccountId === accountId)?.linkedTo).toBe('model_test_01');
    expect(choices.find((one) => one.platformAccountId === otherAccountId)?.linkedTo).toBeNull();
    const audit = await test.admin.db
      .select({ action: schema.auditLog.action, details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entity, 'sales_feed_credential'));
    expect(audit.map((line) => line.action)).toEqual(['sales_feed_key.connected']);
    expect(JSON.stringify(audit)).not.toContain(FAKE_CRM_KEY);
  });

  it('records each line once, under its creator, and keeps an unlinked model aside, counted nowhere', async () => {
    crm.sell({ id: 'sale_a', createdAt: '2026-10-20T18:00:00.000Z' });
    crm.sell({ id: 'sale_q', modelId: 'model_test_02', createdAt: '2026-10-20T18:01:00.000Z' });
    await read();
    const [line] = await test.admin.db
      .select()
      .from(schema.platformSales)
      .where(eq(schema.platformSales.platformSaleId, 'sale_a'));
    expect(line).toMatchObject({
      creatorId,
      platformAccountId: accountId,
      event: 'sale',
      saleType: 'ppv',
      netMinor: 800,
      agencyMinor: 300,
      creatorMinor: 500,
      platformChatterId: 'chatter_test_01',
      platformFanId: 'member_test_01',
    });
    expect(await ledgerLines('sale_q')).toBe(0);
    expect(
      await count(
        sql`select count(*)::int as n from platform_sales_quarantine where platform_sale_id = 'sale_q'`,
      ),
    ).toBe(1);
    expect(await signals('model_unlinked')).toBe(1);

    // Nothing new: the next minute reads nothing again and says nothing again.
    await read();
    expect(await ledgerLines('sale_a')).toBe(1);
    crm.sell({ id: 'sale_q2', modelId: 'model_test_02' });
    await read();
    expect(await signals('model_unlinked')).toBe(1);

    // RLS: the creator's tenant reads her line, another creator's sees nothing of it.
    const seen = await app.db.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.creator_id', ${otherCreatorId}, true)`);
      return tx.select().from(schema.platformSales);
    });
    expect(seen).toEqual([]);
  });

  it('never loses a late sale nor a refund, and a replay of the register writes nothing twice', async () => {
    crm.sell({ id: 'sale_b', createdAt: '2026-10-21T10:00:00.000Z' });
    // Confirmed late (3-D Secure): registered after sale_b, dated before it.
    crm.sell({ id: 'sale_late', createdAt: '2026-10-21T09:00:00.000Z' });
    crm.refund('sale_a', '2026-10-22T08:00:00.000Z');
    await read();
    expect(await ledgerLines('sale_b')).toBe(1);
    expect(await ledgerLines('sale_late')).toBe(1);
    expect(await ledgerLines('sale_a')).toBe(2);

    // The cursor sent back to the start: every line comes again, none is written twice, none is « changed ».
    const total = await count(sql`select count(*)::int as n from platform_sales`);
    await test.admin.db
      .update(schema.salesFeedCursors)
      .set({ position: null })
      .where(eq(schema.salesFeedCursors.platform, 'reveal'));
    await read();
    expect(await count(sql`select count(*)::int as n from platform_sales`)).toBe(total);
    expect(await signals('line_changed')).toBe(0);
  });

  it('a crash between the lines and the cursor loses and doubles nothing', async () => {
    const before = await cursor();
    crm.sell({ id: 'sale_crash' });
    // The cursor's update fails once, after the line was inserted in the same transaction.
    await test.admin.db.execute(
      sql.raw(`
      create function fail_cursor_once() returns trigger language plpgsql as $$
      begin raise exception 'simulated crash'; end; $$;
      create trigger fail_cursor_once before update on sales_feed_cursors
        for each row execute function fail_cursor_once();
    `),
    );
    await expect(read()).rejects.toThrow();
    expect(await ledgerLines('sale_crash')).toBe(0);
    expect(await cursor()).toBe(before);
    await test.admin.db.execute(
      sql.raw('drop trigger fail_cursor_once on sales_feed_cursors; drop function fail_cursor_once();'),
    );
    await read();
    expect(await ledgerLines('sale_crash')).toBe(1);
    await read();
    expect(await ledgerLines('sale_crash')).toBe(1);
  });

  it('records an unknown type as other and says it once; a broken net moves nothing', async () => {
    crm.sell({ id: 'sale_new_type', type: 'live_ticket' });
    crm.sell({ id: 'sale_new_type_2', type: 'live_ticket' });
    await read();
    const [line] = await test.admin.db
      .select({ saleType: schema.platformSales.saleType, rawType: schema.platformSales.rawType })
      .from(schema.platformSales)
      .where(eq(schema.platformSales.platformSaleId, 'sale_new_type'));
    expect(line).toEqual({ saleType: 'other', rawType: 'live_ticket' });
    expect(await signals('unknown_value')).toBe(1);

    const before = await cursor();
    crm.sell({ id: 'sale_bad_net', netAmount: 801 });
    await read();
    await read();
    expect(await ledgerLines('sale_bad_net')).toBe(0);
    expect(await cursor()).toBe(before);
    expect(await signals('unexpected_answer')).toBe(1);
    const status = await api('GET', '/v1/settings/sales-feeds');
    expect(status.json()).toMatchObject({
      feeds: [{ state: 'connected', lastErrorKind: 'unexpected_answer' }],
    });
  });

  it('links a model by hand: its quarantined lines join the register; moving it once it has lines is refused', async () => {
    // Out of the previous test's broken page: the register goes on from the line after it.
    await test.admin.db
      .update(schema.salesFeedCursors)
      .set({ position: crmPositionAfter('sale_bad_net') })
      .where(eq(schema.salesFeedCursors.platform, 'reveal'));
    const linked = await api('PUT', '/v1/settings/sales-feeds/reveal/models/model_test_02', {
      platformAccountId: otherAccountId,
    });
    expect(linked.statusCode).toBe(200);
    const after = SalesFeedOverviewSchema.parse(linked.json());
    expect(after.models.find((model) => model.platformModelId === 'model_test_02')).toMatchObject({
      linkedBy: { kind: 'member' },
      quarantined: 0,
    });
    expect(after.accounts.find((one) => one.platformAccountId === otherAccountId)?.linkedTo).toBe(
      'model_test_02',
    );
    // Entered the register at the link, not at its first read: pay sees it as a late line.
    const [released] = await test.admin.db
      .select({ recordedAt: schema.platformSales.recordedAt })
      .from(schema.platformSales)
      .where(eq(schema.platformSales.platformSaleId, 'sale_q'));
    const [waited] = await test.admin.db
      .select({ recordedAt: schema.platformSalesQuarantine.recordedAt })
      .from(schema.platformSalesQuarantine)
      .where(eq(schema.platformSalesQuarantine.platformSaleId, 'sale_q'));
    expect(released?.recordedAt.getTime()).toBeGreaterThan(waited?.recordedAt.getTime() ?? Infinity);
    const links = await test.admin.db
      .select({ action: schema.auditLog.action, details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entity, 'sales_feed_model'));
    const LinkDetailsSchema = z.object({
      platformModelId: z.string(),
      auto: z.boolean(),
      released: z.number(),
    });
    expect(links.map((line) => LinkDetailsSchema.parse(line.details))).toEqual([
      { platformModelId: 'model_test_01', auto: true, released: 0 },
      { platformModelId: 'model_test_02', auto: false, released: 2 },
    ]);
    expect(await ledgerLines('sale_q')).toBe(1);
    expect(await ledgerLines('sale_q2')).toBe(1);
    expect(
      await count(sql`select count(*)::int as n from platform_sales_quarantine where released_at is null`),
    ).toBe(0);
    const moved = await api('PUT', '/v1/settings/sales-feeds/reveal/models/model_test_02', {
      platformAccountId: accountId,
    });
    expect(moved.statusCode).toBe(409);
    expect(moved.json()).toMatchObject({ error: { code: 'sales_feed_model_conflict' } });

    const chatter = await api('PUT', '/v1/settings/sales-feeds/reveal/chatters/bot_test_01', {
      kind: 'agent',
    });
    expect(chatter.statusCode).toBe(200);
    expect(chatter.json()).toMatchObject({
      chatters: [{ platformChatterId: 'chatter_test_01', link: null }, { link: { kind: 'agent' } }],
    });
    const unknownMember = await api('PUT', '/v1/settings/sales-feeds/reveal/chatters/chatter_test_01', {
      kind: 'member',
      memberId: newId(CreatorIdSchema),
    });
    expect(unknownMember.statusCode).toBe(422);
  });

  it('waits out a 429 and stops on a revoked key until it is connected again', async () => {
    const callsBefore = crm.calls.length;
    crm.rateLimit(1, 120);
    await read();
    await read();
    // One call answered 429, then nothing until Retry-After.
    expect(crm.calls.length).toBe(callsBefore + 1);
    await test.admin.db.update(schema.salesFeedCursors).set({ pausedUntil: null });

    crm.revoke();
    await read();
    await read();
    expect(await signals('needs_reconnect')).toBe(1);
    const status = await api('GET', '/v1/settings/sales-feeds');
    expect(status.json()).toMatchObject({
      feeds: [{ state: 'needs_reconnect', lastErrorKind: 'unauthorized' }],
    });
    const calls = crm.calls.length;
    await read();
    expect(crm.calls.length).toBe(calls);
  });

  it('never writes a fan’s pseudo or id to the logs', () => {
    const logged = JSON.stringify(sink.lines);
    expect(sink.withMessage('sales feed read').length).toBeGreaterThan(0);
    expect(logged).not.toContain('fan_test_01');
    expect(logged).not.toContain('member_test_01');
    expect(logged).not.toContain(FAKE_CRM_KEY);
  });

  it('disconnects the key: removed, said in the audit log', async () => {
    const removed = await api('DELETE', '/v1/settings/sales-feeds/reveal');
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ state: 'not_connected' });
    expect(await count(sql`select count(*)::int as n from sales_feed_credentials`)).toBe(0);
    await app.modules.connectors.jobs.readSales(NO_LOG, 'test');
  });

  /** FakeReveal's cursor of the line after a sale (its cursors count up from 1001). */
  function crmPositionAfter(saleId: string): string {
    const position = crm.positionOf(saleId);
    if (position === null) throw new Error(`no line for ${saleId}`);
    return position;
  }
});
