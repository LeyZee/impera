import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AuditEntryIdSchema,
  AuditPageSchema,
  auditCategoryOf,
  newId,
  type AuditPage,
  type TeamMember,
} from '@impera/contracts';
import { schema, sql } from '@impera/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { startPayrollTeam, type PayrollTeam } from '../../../__tests__/support/payroll-team';

/**
 * Réglages › Journal on the server (EQ-18 lot a), through the real app and the real `audit_log`: the owner's alone, a
 * cursor that neither skips nor repeats a line while lines arrive, the filters, the export of exactly the selection,
 * and nothing a writer stored beyond the contract. Invented people only.
 */
/** A line written straight into `audit_log`, as a writer would. */
interface Line {
  readonly userId: string | null;
  readonly action: string;
  readonly entity?: string;
  readonly entityId?: string | null;
  readonly details?: object;
  readonly at?: Date;
  readonly ip?: string | null;
}

describe('/v1/audit and /v1/audit.csv', () => {
  let team: PayrollTeam;
  let manager: { readonly member: TeamMember; readonly cookie: string };
  let chatter: { readonly member: TeamMember; readonly cookie: string };
  /** Authors made up for the lines written here, so that each test reads its own lines only. */
  const author = () => newId(AuditEntryIdSchema);

  const write = async (lines: readonly Line[]): Promise<string[]> => {
    const ids = lines.map(() => newId(AuditEntryIdSchema));
    await team.test.admin.db.insert(schema.auditLog).values(
      lines.map((line, index) => ({
        id: ids[index] ?? '',
        userId: line.userId,
        action: line.action,
        entity: line.entity ?? 'test',
        entityId: line.entityId ?? null,
        details: line.details ?? {},
        ip: line.ip ?? null,
        ...(line.at !== undefined && { createdAt: line.at }),
      })),
    );
    return ids;
  };

  const get = (url: string, cookie = team.owner) => team.call('GET', url, cookie);
  const page = async (query: Record<string, string>): Promise<AuditPage> => {
    const response = await get(`/audit?${new URLSearchParams(query).toString()}`);
    expect(response.statusCode, response.body).toBe(200);
    return AuditPageSchema.parse(response.json());
  };
  /** Every line of a selection, page after page; `between` runs after each page. */
  const walk = async (
    query: Record<string, string>,
    between: () => Promise<unknown> = () => Promise.resolve(),
  ) => {
    const seen: AuditPage['items'] = [];
    let cursor: string | null = null;
    do {
      const read: AuditPage = await page({ ...query, ...(cursor !== null && { cursor }) });
      seen.push(...read.items);
      cursor = read.nextCursor;
      await between();
    } while (cursor !== null);
    return seen;
  };

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'));
    manager = await team.addMember('manon@example.test', 'Manon', 'manager');
    chatter = await team.addMember('nora@example.test', 'Nora', 'chatter');
  });

  afterAll(async () => {
    await team.close();
  });

  it('is the owner’s alone: 401 without a session, 403 for a manager and a chatter', async () => {
    for (const url of ['/v1/audit', '/v1/audit.csv']) {
      expect((await team.server.inject({ method: 'GET', url })).statusCode).toBe(401);
      for (const { cookie } of [manager, chatter]) {
        const response = await team.server.inject({ method: 'GET', url, headers: { cookie } });
        expect(response.statusCode, url).toBe(403);
        expect(team.refusal(response).code).toBe('role_forbidden');
      }
    }
    expect((await get('/audit')).statusCode).toBe(200);
  });

  it('neither skips nor repeats a line when lines arrive during the reading', async () => {
    const someone = author();
    const base = Date.now() - 3_600_000;
    // 23 lines over 15 instants: several share one, so that a page may end between two lines of the same instant.
    await write(
      Array.from({ length: 23 }, (_, i) => ({
        userId: someone,
        action: 'shift.create',
        entity: 'shift',
        at: new Date(base + Math.floor(i / 2) * 1_000),
      })),
    );
    const snapshot = (await page({ userId: someone, limit: '200' })).items.map((item) => item.id);
    expect(snapshot).toHaveLength(23);

    let arrived = 0;
    const seen = await walk({ userId: someone, limit: '5' }, async () => {
      // A line of the same author arrives now, and another a little older than the newest, before the next page.
      arrived += 2;
      await write([
        { userId: someone, action: 'shift.cancel', entity: 'shift' },
        { userId: someone, action: 'shift.update', entity: 'shift', at: new Date(base + 30 * 1_000) },
      ]);
    });
    const ids = seen.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(snapshot);
    expect(arrived).toBe(10);
    // Newest first, and the lines that arrived show at the top of a new reading.
    const again = await page({ userId: someone, limit: '200' });
    expect(again.items).toHaveLength(33);
    expect(again.items.slice(0, 5).every((item) => item.action === 'shift.cancel')).toBe(true);
  });

  it('refuses a cursor it did not give', async () => {
    for (const cursor of ['abc', Buffer.from('{"at":"2026","id":"x"}').toString('base64url')]) {
      const response = await get(`/audit?cursor=${cursor}`);
      expect(response.statusCode).toBe(400);
      expect(team.refusal(response).code).toBe('audit_cursor_invalid');
    }
  });

  it('files every action in the base as the contracts do, and filters by category', async () => {
    const someone = author();
    const actions = [
      ...Object.keys(AUDIT_ACTIONS),
      'mcp.fan_card',
      'mcp.tool_unknown',
      'invoice.reminded',
      'auth.something_new',
      'view_as.open',
    ];
    await write(actions.map((action) => ({ userId: someone, action })));
    for (const category of AUDIT_CATEGORIES) {
      const read = await walk({ userId: someone, category, limit: '200' });
      const expected = actions.filter((action) => auditCategoryOf(action) === category).sort();
      expect(read.map((item) => item.action).sort(), category).toEqual(expected);
      expect(read.every((item) => item.category === category)).toBe(true);
    }
  });

  it('filters by author and by period, `from` included and `to` excluded', async () => {
    const one = author();
    const other = author();
    const at = (minute: number) => new Date(Date.UTC(2031, 0, 15, 9, minute));
    const [, inside, , last] = await write([
      { userId: one, action: 'leave_request.create', at: at(0) },
      { userId: one, action: 'leave_request.approve', at: at(10) },
      { userId: other, action: 'leave_request.refuse', at: at(10) },
      { userId: one, action: 'leave_request.cancel', at: at(20) },
    ]);
    const from = at(10).toISOString();
    const to = at(20).toISOString();
    expect((await page({ userId: one, from, to })).items.map((item) => item.id)).toEqual([inside]);
    expect((await page({ userId: one, from })).items.map((item) => item.id)).toEqual([last, inside]);
    expect((await page({ from, to })).items.map((item) => item.action).sort()).toEqual([
      'leave_request.approve',
      'leave_request.refuse',
    ]);
    const backwards = await get(`/audit?from=${to}&to=${from}`);
    expect(backwards.statusCode).toBe(400);
  });

  it('says who did it and names the member, with a link to his record', async () => {
    const [rate] = await write([
      {
        userId: manager.member.userId,
        action: 'commission_rate.create',
        entity: 'team_member',
        entityId: chatter.member.id,
        details: { effectiveFrom: '2031-02-01', fromPreset: false },
        at: new Date(Date.UTC(2031, 1, 1, 8)),
      },
    ]);
    const read = await page({ userId: manager.member.userId });
    expect(read.items.find((item) => item.id === rate)).toEqual({
      id: rate,
      at: '2031-02-01T08:00:00.000Z',
      author: { userId: manager.member.userId, name: 'Manon' },
      action: 'commission_rate.create',
      category: 'money',
      label: 'a changé le taux de Nora à partir du 1er février 2031',
      link: { kind: 'member', id: chatter.member.id },
    });
    const system = await write([
      { userId: null, action: 'invoice.lapse', details: { number: 'NORA-2031-0001' } },
    ]);
    const lapsed = (await page({ category: 'money' })).items.find((item) => item.id === system[0]);
    expect(lapsed).toMatchObject({ author: null, label: 'a accepté tacitement la facture NORA-2031-0001' });
  });

  it('exports exactly the selection, guarded against formulas, and journals the export', async () => {
    const someone = author();
    const ids = await write([
      ...Array.from({ length: 12 }, (_, i) => ({
        userId: someone,
        action: i % 2 === 0 ? 'bonus.create' : 'shift.create',
        details: { period: '2031-03-01' },
        at: new Date(Date.UTC(2031, 2, 2, 9, i)),
      })),
      { userId: someone, action: '=cmd|calc', at: new Date(Date.UTC(2031, 2, 2, 10)) },
    ]);
    const query = new URLSearchParams({
      userId: someone,
      from: '2031-03-02T09:03:00Z',
      to: '2031-03-02T11:00:00Z',
    });
    const response = await get(`/audit.csv?${query.toString()}`);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['cache-control']).toBe('no-store');
    const lines = response.body
      .replace(/^\uFEFF/u, '')
      .trimEnd()
      .split('\r\n');
    const selected = (await walk({ ...Object.fromEntries(query), limit: '4' })).map((item) => item.id);
    expect(selected).toHaveLength(10);
    expect(lines.slice(1).map((line) => line.split(';')[0])).toEqual(selected.map((id) => `"${id}"`));
    expect(selected).toEqual([ids[12], ...ids.slice(3, 12).reverse()]);
    expect(response.body).toContain(`"'=cmd|calc"`);
    expect(response.body).not.toMatch(/;"=/u);
    // Money only: the same period, without the shifts nor the unknown action.
    const money = await get(`/audit.csv?${query.toString()}&category=money`);
    expect(money.body.trimEnd().split('\r\n')).toHaveLength(1 + 4);

    const exported = await team.test.admin.db.execute<{ user_id: string; details: unknown }>(
      sql`select user_id, details from audit_log where action = 'audit.export' order by created_at desc, id desc limit 2`,
    );
    expect(exported.rows).toEqual([
      { user_id: team.ownerId, details: { rows: 4 } },
      { user_id: team.ownerId, details: { rows: 10 } },
    ]);
    expect((await page({ userId: team.ownerId, category: 'access' })).items[0]?.label).toBe(
      'a exporté le journal (4 lignes)',
    );
  });

  it('shows nothing a writer stored beyond the contract: no secret, no address, no fan’s words', async () => {
    const someone = author();
    const leaks = {
      fingerprint: 'fp-7f3a…c9e1',
      url: 'https://hooks.example.test/s3cr3t-path',
      key: 'invoices/2031/leak.pdf',
      sha256: 'e'.repeat(64),
      reason: 'Le fan a écrit : « mon numéro est le 06 00 00 00 00 »',
      password: 'hunter2-leak',
      token: 'tok_leak_123',
      body: 'Coucou c’est le message du fan',
      phrase: 'phrase-de-alerte-leak',
    };
    await write([
      {
        userId: someone,
        action: 'provider_key.connected',
        details: { provider: 'xai', ...leaks },
        ip: '198.51.100.23',
      },
      { userId: someone, action: 'sales_feed_webhook.registered', details: { platform: 'reveal', ...leaks } },
      { userId: someone, action: 'invoice.contest', details: { number: 'NORA-2031-0002', ...leaks } },
      { userId: someone, action: 'kill_switch.on', details: { scope: 'global', ...leaks } },
      { userId: someone, action: 'custom_alert.create', details: leaks },
      // Not parsed: an unknown action and details its schema refuses show the action alone.
      { userId: someone, action: 'unknown.thing', details: leaks },
      { userId: someone, action: 'bonus.create', details: { period: 'pas une quinzaine', ...leaks } },
    ]);
    const read = await get(`/audit?userId=${someone}`);
    const file = await get(`/audit.csv?userId=${someone}`);
    expect(AuditPageSchema.parse(read.json()).items).toHaveLength(7);
    for (const body of [read.body, file.body]) {
      for (const value of [...Object.values(leaks), '198.51.100.23']) expect(body).not.toContain(value);
      expect(body).toContain('unknown.thing');
    }
  });

  it('answers the categories its contract names, nothing else', async () => {
    expect((await get('/audit?category=argent')).statusCode).toBe(400);
    expect((await get('/audit?limit=201')).statusCode).toBe(400);
  });
});
