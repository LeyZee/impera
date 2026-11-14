import { randomUUID } from 'node:crypto';

import {
  ContentDropIdSchema,
  CreatorIdSchema,
  FanIdSchema,
  McpFanCardGetSchema,
  McpGrantCreatedSchema,
  McpSalesListSchema,
  McpWhoamiSchema,
  newId,
  type CreatorId,
} from '@impera/contracts';
import { and, eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { MCP_FAILURES_PER_ADDRESS_PER_MINUTE } from '../modules/mcp/infra/http/transport';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';
const OWNER = { email: 'owner@example.test', name: 'Owner', password: PASSWORD };
const ACCEPT = 'application/json, text/event-stream';

const RpcSchema = z.object({
  result: z
    .object({
      isError: z.boolean().optional(),
      structuredContent: z.record(z.string(), z.unknown()).optional(),
      tools: z.array(z.object({ name: z.string() })).optional(),
    })
    .optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

/**
 * `POST /v1/mcp` (MCP lot a, ADR 0026 § 2 to § 8, ADR 0105): a client of the SDK lists and calls; the door refuses
 * every token that is not a live one in its header, the same way; the person is read at every call; every call has its
 * line in the journal. Invented data only (ADR 0010).
 */
describe('/v1/mcp', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let nora: CreatorId;
  let lea: CreatorId;
  let gone: CreatorId;
  let ownerId = '';
  let cookie = '';
  let address = 0;

  /** Each test its own address, so that the counters of one never touch another. */
  const nextIp = () => `203.0.113.${String((address += 1))}`;

  const createGrant = async (over: Record<string, unknown> = {}) =>
    McpGrantCreatedSchema.parse(
      (
        await server.inject({
          method: 'POST',
          url: '/v1/settings/mcp-grants',
          headers: { cookie, origin: DASHBOARD_ORIGIN },
          payload: {
            label: 'Agent inventé',
            creatorId: nora,
            capabilities: ['read:status'],
            days: 30,
            ...over,
          },
        })
      ).json(),
    );

  const rpc = (
    token: string | null,
    body: object,
    options: { url?: string; headers?: Record<string, string>; ip?: string } = {},
  ) =>
    server.inject({
      method: 'POST',
      url: options.url ?? '/v1/mcp',
      remoteAddress: options.ip ?? nextIp(),
      headers: {
        accept: ACCEPT,
        'content-type': 'application/json',
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        ...options.headers,
      },
      payload: body,
    });
  const callTool = (name: string, args: object = {}) => ({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  });
  const journal = (grantId: string) =>
    test.admin.db
      .select({ action: schema.auditLog.action, details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entity, 'mcp_grant'), eq(schema.auditLog.entityId, grantId)))
      // Each call writes its line in its own transaction, so in the order of the calls.
      .orderBy(schema.auditLog.createdAt);
  const setSecondFactor = (enabled: boolean) =>
    test.admin.db.update(schema.user).set({ twoFactorEnabled: enabled }).where(eq(schema.user.id, ownerId));

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
    app = await createApp(config, createLogger(config));
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
      // The shared store, as in production: it refuses two limiters of the same bounds when the routes are mounted.
      rateLimitStore: app.rateLimitStore,
    });
    nora = newId(CreatorIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: nora, nameKey: nora, displayName: 'Nora', timezone: 'Europe/Paris' });
    lea = newId(CreatorIdSchema);
    gone = newId(CreatorIdSchema);
    await test.admin.db.insert(schema.creators).values([
      { id: lea, nameKey: lea, displayName: 'Léa', timezone: 'America/Montreal' },
      { id: gone, nameKey: gone, displayName: 'Archivée', timezone: 'Europe/Paris', archivedAt: new Date() },
    ]);
    ownerId = (await createOwner(app.auth, app.db.db, OWNER)).userId;
    cookie = await signIn(server, OWNER.email, OWNER.password);
    // Signed in before: the code itself is not what these tests are about (ADR 0046).
    await setSecondFactor(true);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('serves a client of the SDK: it lists the tools of its access and calls whoami, written down', async () => {
    const grant = await createGrant();
    const url = new URL('/v1/mcp', await server.listen({ host: '127.0.0.1', port: 0 }));
    const client = new Client({ name: 'client-de-test', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { authorization: `Bearer ${grant.token}` } },
      }),
    );
    try {
      expect(client.getServerVersion()?.name).toBe('impera-mcp');
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
        'whoami',
        'creators_list',
        'creator_get',
      ]);
      const result = await client.callTool({ name: 'whoami', arguments: {} });
      const whoami = McpWhoamiSchema.parse(result.structuredContent);
      expect(whoami).toMatchObject({ grantId: grant.id, creatorId: nora, capabilities: ['read:status'] });
      expect(JSON.stringify(result)).not.toContain(grant.token);
    } finally {
      await client.close();
    }
    const lines = await journal(grant.id);
    expect(lines.map((line) => line.action)).toEqual(['mcp_grant.create', 'mcp.whoami']);
    expect(lines[1]?.details).toMatchObject({ outcome: 'ok', creatorId: nora });
  });

  it('refuses every door but a live token in its header, with one same answer', async () => {
    const grant = await createGrant();
    const revoked = await createGrant();
    expect(
      (
        await server.inject({
          method: 'DELETE',
          url: `/v1/settings/mcp-grants/${revoked.id}`,
          headers: { cookie, origin: DASHBOARD_ORIGIN },
        })
      ).statusCode,
    ).toBe(204);
    const refusals = [
      await rpc(null, callTool('whoami')),
      await rpc('impmcp_court', callTool('whoami')),
      await rpc(`${grant.token.slice(0, -1)}${grant.token.endsWith('A') ? 'B' : 'A'}`, callTool('whoami')),
      await rpc(revoked.token, callTool('whoami')),
      await rpc(null, callTool('whoami'), { url: `/v1/mcp?access_token=${grant.token}` }),
      await rpc(grant.token, callTool('whoami'), { url: '/v1/mcp?x=1' }),
      await rpc(null, callTool('whoami'), { headers: { cookie } }),
      await rpc(null, callTool('whoami'), { headers: { authorization: `Basic ${grant.token}` } }),
    ];
    for (const refusal of refusals) {
      expect(refusal.statusCode).toBe(401);
      expect(refusal.headers['www-authenticate']).toBe('Bearer');
      expect(refusal.body).toBe(refusals[0]?.body);
    }
    expect((await rpc(grant.token, callTool('whoami'))).statusCode).toBe(200);
  });

  it('counts refused tokens by address: past the bound, the next refusals answer 429', async () => {
    const grant = await createGrant();
    const ip = nextIp();
    for (let i = 0; i < MCP_FAILURES_PER_ADDRESS_PER_MINUTE; i += 1) {
      expect((await rpc('impmcp_court', callTool('whoami'), { ip })).statusCode).toBe(401);
    }
    const blocked = await rpc('impmcp_court', callTool('whoami'), { ip });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    // Only refusals are counted and refused: a live token from that address still passes.
    expect((await rpc(grant.token, callTool('whoami'), { ip })).statusCode).toBe(200);
  });

  it('takes no browser origin, and a client without one', async () => {
    const grant = await createGrant();
    const fromPage = await rpc(grant.token, callTool('whoami'), { headers: { origin: DASHBOARD_ORIGIN } });
    expect(fromPage.statusCode).toBe(403);
    expect((await rpc(grant.token, callTool('whoami'))).statusCode).toBe(200);
  });

  it('answers only POST', async () => {
    const response = await server.inject({ method: 'GET', url: '/v1/mcp', headers: { accept: ACCEPT } });
    expect(response.statusCode).toBe(405);
    expect(response.headers.allow).toBe('POST');
  });

  it('reads the person at every call: without a second factor, nothing, and the refusal is written down', async () => {
    const grant = await createGrant();
    await setSecondFactor(false);
    try {
      const refused = RpcSchema.parse((await rpc(grant.token, callTool('whoami'))).json());
      expect(refused.result?.isError).toBe(true);
      expect(refused.result?.structuredContent).toEqual({ refusal: 'second_factor_required' });
    } finally {
      await setSecondFactor(true);
    }
    const lines = await journal(grant.id);
    expect(lines.at(-1)).toMatchObject({
      action: 'mcp.whoami',
      details: { outcome: 'second_factor_required' },
    });
  });

  it('refuses a name outside the catalogue and arguments it does not take, written down without them', async () => {
    const grant = await createGrant();
    const unknown = RpcSchema.parse((await rpc(grant.token, callTool('message_send', { text: 'x' }))).json());
    expect(unknown.result?.structuredContent).toEqual({ refusal: 'tool_unknown' });
    const extra = RpcSchema.parse((await rpc(grant.token, callTool('whoami', { creatorId: nora }))).json());
    expect(extra.result?.structuredContent).toEqual({ refusal: 'arguments_invalid' });
    const lines = await journal(grant.id);
    expect(lines.map((line) => line.action)).toEqual(['mcp_grant.create', 'mcp.tool_unknown', 'mcp.whoami']);
    expect(JSON.stringify(lines)).not.toContain('message_send');
  });

  it('lists only the tools whose capability the access holds', async () => {
    const grant = await createGrant({ capabilities: ['read:payroll'], creatorId: null });
    const listed = RpcSchema.parse(
      (await rpc(grant.token, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })).json(),
    );
    expect(listed.result?.tools?.map((tool) => tool.name)).toEqual(['whoami']);
  });

  it('reads the creators of its access only, never an archived one nor her persona', async () => {
    const bound = await createGrant();
    const listed = RpcSchema.parse((await rpc(bound.token, callTool('creators_list'))).json());
    expect(listed.result?.structuredContent).toEqual({
      creators: [{ id: nora, displayName: 'Nora', timezone: 'Europe/Paris' }],
    });
    const got = RpcSchema.parse((await rpc(bound.token, callTool('creator_get'))).json());
    expect(got.result?.structuredContent).toEqual({
      creator: { id: nora, displayName: 'Nora', timezone: 'Europe/Paris' },
    });
    const other = RpcSchema.parse(
      (await rpc(bound.token, callTool('creator_get', { creatorId: lea }))).json(),
    );
    expect(other.result?.structuredContent).toEqual({ refusal: 'creator_forbidden' });

    const agency = await createGrant({ creatorId: null });
    const all = RpcSchema.parse((await rpc(agency.token, callTool('creators_list'))).json());
    const ids = z
      .object({ creators: z.array(z.object({ id: z.string() })) })
      .parse(all.result?.structuredContent)
      .creators.map((creator) => creator.id);
    expect(ids).toContain(nora);
    expect(ids).toContain(lea);
    expect(ids).not.toContain(gone);
    const none = RpcSchema.parse((await rpc(agency.token, callTool('creator_get'))).json());
    expect(none.result?.structuredContent).toEqual({ refusal: 'creator_required' });
    expect((await journal(agency.id)).map((line) => line.action)).toEqual([
      'mcp_grant.create',
      'mcp.creators_list',
      'mcp.creator_get',
    ]);
  });
  it('reads a fan of its creator, his texts untrusted, nothing of his platform, and names him by id in the journal', async () => {
    const accountId = randomUUID();
    const theo = newId(FanIdSchema);
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: accountId, creatorId: nora, platform: 'reveal', handle: 'nora-demo' });
    await test.admin.db.insert(schema.fans).values({
      id: theo,
      creatorId: nora,
      platformAccountId: accountId,
      platformFanId: 'plateforme-theo',
      displayName: 'Théo',
      flags: { fragile: true },
    });
    await test.admin.db.insert(schema.fanFacts).values({
      id: randomUUID(),
      creatorId: nora,
      fanId: theo,
      category: 'identity',
      key: 'first_name',
      value: 'Théo',
      kind: 'declared',
      confidence: 0.9,
      observedAt: new Date('2026-11-01T20:00:00.000Z'),
    });

    const grant = await createGrant({ capabilities: ['read:fans'] });
    const listed = RpcSchema.parse(
      (await rpc(grant.token, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })).json(),
    );
    expect(listed.result?.tools?.map((tool) => tool.name)).toEqual(['whoami', 'fan_get', 'fan_card_get']);

    const fan = RpcSchema.parse((await rpc(grant.token, callTool('fan_get', { fanId: theo }))).json());
    expect(fan.result?.structuredContent).toMatchObject({
      fan: {
        id: theo,
        name: { kind: 'fan_name', text: 'Théo' },
        flags: { fragile: true },
        facts: [
          {
            category: 'identity',
            key: { kind: 'fan_fact', text: 'first_name' },
            value: { kind: 'fan_fact', text: 'Théo' },
          },
        ],
      },
    });
    const card = RpcSchema.parse((await rpc(grant.token, callTool('fan_card_get', { fanId: theo }))).json());
    const firstName = McpFanCardGetSchema.parse(card.result?.structuredContent).card?.fields.find(
      (entry) => entry.field === 'first_name',
    );
    expect(firstName?.current?.items).toEqual([{ kind: 'fan_card', text: 'Théo' }]);
    expect(firstName?.toCheck).toBe(0);
    const text = JSON.stringify([fan, card]);
    for (const leak of ['plateforme-theo', accountId, 'nora-demo']) expect(text).not.toContain(leak);

    // Not hers: null, never his card.
    const stranger = newId(FanIdSchema);
    const none = RpcSchema.parse(
      (await rpc(grant.token, callTool('fan_card_get', { fanId: stranger }))).json(),
    );
    expect(none.result?.structuredContent).toEqual({ card: null });
    const elsewhere = RpcSchema.parse(
      (await rpc(grant.token, callTool('fan_get', { fanId: theo, creatorId: lea }))).json(),
    );
    expect(elsewhere.result?.structuredContent).toEqual({ refusal: 'creator_forbidden' });

    const lines = await journal(grant.id);
    expect(lines.map((line) => [line.action, line.details])).toEqual([
      ['mcp_grant.create', expect.anything()],
      ['mcp.fan_get', expect.objectContaining({ outcome: 'ok', subject: { fanId: theo } })],
      ['mcp.fan_card_get', expect.objectContaining({ outcome: 'ok', subject: { fanId: theo } })],
      ['mcp.fan_card_get', expect.objectContaining({ outcome: 'ok', subject: { fanId: stranger } })],
      ['mcp.fan_get', expect.objectContaining({ outcome: 'creator_forbidden', subject: {} })],
    ]);
    expect(JSON.stringify(lines)).not.toContain('Théo');
  });
  it('reads her drops and scripts through their modules, and names a script by its id in the journal', async () => {
    const grant = await createGrant({ capabilities: ['read:media', 'read:script_content'] });
    const listed = RpcSchema.parse(
      (await rpc(grant.token, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })).json(),
    );
    expect(listed.result?.tools?.map((tool) => tool.name)).toEqual([
      'whoami',
      'drops_list',
      'scripts_list',
      'script_steps_get',
    ]);
    const drops = RpcSchema.parse((await rpc(grant.token, callTool('drops_list', { limit: 5 }))).json());
    expect(drops.result?.structuredContent).toEqual({ drops: [], next: null });
    const scripts = RpcSchema.parse((await rpc(grant.token, callTool('scripts_list'))).json());
    expect(scripts.result?.structuredContent).toMatchObject({ scripts: [] });
    const absent = newId(ContentDropIdSchema);
    const steps = RpcSchema.parse(
      (await rpc(grant.token, callTool('script_steps_get', { dropId: absent }))).json(),
    );
    expect(steps.result?.structuredContent).toEqual({ script: null });
    const tooMany = RpcSchema.parse((await rpc(grant.token, callTool('drops_list', { limit: 51 }))).json());
    expect(tooMany.result?.structuredContent).toEqual({ refusal: 'arguments_invalid' });

    const lines = await journal(grant.id);
    expect(lines.map((line) => [line.action, line.details])).toEqual([
      ['mcp_grant.create', expect.anything()],
      ['mcp.drops_list', expect.objectContaining({ outcome: 'ok', subject: {} })],
      ['mcp.scripts_list', expect.objectContaining({ outcome: 'ok', subject: {} })],
      ['mcp.script_steps_get', expect.objectContaining({ outcome: 'ok', subject: { dropId: absent } })],
      ['mcp.drops_list', expect.objectContaining({ outcome: 'arguments_invalid' })],
    ]);
  });
  it('says who is on shift now, read as its person, for the agency or for its creator', async () => {
    const agency = await createGrant({ capabilities: ['read:team'], creatorId: null });
    const listed = RpcSchema.parse(
      (await rpc(agency.token, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })).json(),
    );
    expect(listed.result?.tools?.map((tool) => tool.name)).toEqual([
      'whoami',
      'shifts_list',
      'on_shift_now',
      'team_import_list',
    ]);
    const all = RpcSchema.parse((await rpc(agency.token, callTool('on_shift_now'))).json());
    expect(all.result?.structuredContent).toEqual({ onShift: [] });
    const bound = await createGrant({ capabilities: ['read:team'] });
    const hers = RpcSchema.parse((await rpc(bound.token, callTool('on_shift_now'))).json());
    expect(hers.result?.structuredContent).toEqual({ onShift: [] });
    const other = RpcSchema.parse(
      (await rpc(bound.token, callTool('on_shift_now', { creatorId: lea }))).json(),
    );
    expect(other.result?.structuredContent).toEqual({ refusal: 'creator_forbidden' });
  });
  it('lists the planning over a bounded range, for the agency or for its creator', async () => {
    const week = { from: '2026-11-16T00:00:00.000Z', to: '2026-11-23T00:00:00.000Z' };
    const agency = await createGrant({ capabilities: ['read:team'], creatorId: null });
    const all = RpcSchema.parse((await rpc(agency.token, callTool('shifts_list', week))).json());
    expect(all.result?.structuredContent).toEqual({ shifts: [] });
    const tooLong = RpcSchema.parse(
      (await rpc(agency.token, callTool('shifts_list', { ...week, to: '2026-12-29T00:00:00.000Z' }))).json(),
    );
    expect(tooLong.result?.structuredContent).toEqual({ refusal: 'arguments_invalid' });
    const backwards = RpcSchema.parse(
      (await rpc(agency.token, callTool('shifts_list', { from: week.to, to: week.from }))).json(),
    );
    expect(backwards.result?.structuredContent).toEqual({ refusal: 'arguments_invalid' });
    const bound = await createGrant({ capabilities: ['read:team'] });
    const hers = RpcSchema.parse((await rpc(bound.token, callTool('shifts_list', week))).json());
    expect(hers.result?.structuredContent).toEqual({ shifts: [] });
    const other = RpcSchema.parse(
      (await rpc(bound.token, callTool('shifts_list', { ...week, creatorId: lea }))).json(),
    );
    expect(other.result?.structuredContent).toEqual({ refusal: 'creator_forbidden' });
  });
  it('gives the team imported from the platform to an access of the agency, never to one bound to a creator', async () => {
    const agency = await createGrant({ capabilities: ['read:team'], creatorId: null });
    const team = RpcSchema.parse((await rpc(agency.token, callTool('team_import_list'))).json());
    expect(team.result?.structuredContent).toEqual({
      platform: 'reveal',
      accounts: [],
      newCount: 0,
      removalCount: 0,
      abnormalRead: false,
    });
    const bound = await createGrant({ capabilities: ['read:team'] });
    const listed = RpcSchema.parse(
      (await rpc(bound.token, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })).json(),
    );
    expect(listed.result?.tools?.map((tool) => tool.name)).toEqual(['whoami', 'shifts_list', 'on_shift_now']);
    const refused = RpcSchema.parse((await rpc(bound.token, callTool('team_import_list'))).json());
    expect(refused.result?.structuredContent).toEqual({ refusal: 'creator_forbidden' });
  });
  it('lists the sales of each creator the access reads, summed over sellers, over a bounded period', async () => {
    const week = { from: '2026-11-01', to: '2026-11-07' };
    const agency = await createGrant({ capabilities: ['read:sales'], creatorId: null });
    const listed = RpcSchema.parse(
      (await rpc(agency.token, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })).json(),
    );
    expect(listed.result?.tools?.map((tool) => tool.name)).toEqual(['whoami', 'sales_list']);
    const all = McpSalesListSchema.parse(
      RpcSchema.parse((await rpc(agency.token, callTool('sales_list', week))).json()).result
        ?.structuredContent,
    );
    // The archived creator is left out; nothing was sold in this test's base.
    expect(all.creators.map((creator) => creator.creatorId).sort()).toEqual([nora, lea].sort());
    expect(all.creators.every((creator) => creator.rows.length === 0)).toBe(true);
    const tooLong = RpcSchema.parse(
      (await rpc(agency.token, callTool('sales_list', { from: '2026-08-01', to: '2026-11-02' }))).json(),
    );
    expect(tooLong.result?.structuredContent).toEqual({ refusal: 'arguments_invalid' });
    const bound = await createGrant({ capabilities: ['read:sales'] });
    const hers = McpSalesListSchema.parse(
      RpcSchema.parse((await rpc(bound.token, callTool('sales_list', week))).json()).result
        ?.structuredContent,
    );
    expect(hers.creators.map((creator) => creator.creatorId)).toEqual([nora]);
    const other = RpcSchema.parse(
      (await rpc(bound.token, callTool('sales_list', { ...week, creatorId: lea }))).json(),
    );
    expect(other.result?.structuredContent).toEqual({ refusal: 'creator_forbidden' });
  });
  it('refuses the steps of a script to an access without read:script_content, even with read:media', async () => {
    const grant = await createGrant({ capabilities: ['read:media'] });
    const steps = RpcSchema.parse(
      (await rpc(grant.token, callTool('script_steps_get', { dropId: newId(ContentDropIdSchema) }))).json(),
    );
    expect(steps.result?.structuredContent).toEqual({ refusal: 'capability_missing' });
  });
  it('gives the AI spend to the owner on an access of the agency, never on one bound to a creator', async () => {
    const agency = await createGrant({ capabilities: ['read:status'], creatorId: null });
    const listed = RpcSchema.parse(
      (await rpc(agency.token, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })).json(),
    );
    expect(listed.result?.tools?.map((tool) => tool.name)).toContain('ai_usage_get');
    const usage = RpcSchema.parse((await rpc(agency.token, callTool('ai_usage_get'))).json());
    expect(Object.keys(usage.result?.structuredContent ?? {}).sort()).toEqual([
      'days',
      'lastCallAt',
      'pace',
      'readAt',
      'today',
    ]);
    const bound = await createGrant({ capabilities: ['read:status'] });
    const boundList = RpcSchema.parse(
      (await rpc(bound.token, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })).json(),
    );
    expect(boundList.result?.tools?.map((tool) => tool.name)).not.toContain('ai_usage_get');
    const refused = RpcSchema.parse((await rpc(bound.token, callTool('ai_usage_get'))).json());
    expect(refused.result?.structuredContent).toEqual({ refusal: 'creator_forbidden' });
  });
});
