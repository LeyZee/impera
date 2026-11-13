import {
  AccountPayRulesIdSchema,
  MyFiguresSchema,
  newId,
  PayPeriodSchema,
  PaySaleDecisionIdSchema,
  PaySaleSignalIdSchema,
  SalesLineIdSchema,
  ShiftIdSchema,
  type TeamMember,
} from '@impera/contracts';
import { schema } from '@impera/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

// Everything below is invented (ADR 0010). A period of 2025: it has ended.
const P1 = PayPeriodSchema.parse('2025-05-01');
const CauseSchema = z.object({ cause: z.object({ code: z.string(), message: z.string() }) });
const MineSchema = z.object({
  period: z.string(),
  closed: z.boolean(),
  items: z.array(
    z.object({
      platformSaleId: z.string(),
      netMinor: z.number(),
      occurredAt: z.string().nullable(),
      state: z.string(),
      signal: z.object({ note: z.string().nullable() }).nullable(),
      open: z.boolean(),
    }),
  ),
  nextCursor: z.string().nullable(),
  days: z.array(
    z.object({
      day: z.string().nullable(),
      sales: z.number(),
      refunds: z.number(),
      nets: z.array(z.object({ currency: z.string(), netMinor: z.number() })),
    }),
  ),
});
const HeldListSchema = z.object({
  sales: z.array(
    z.object({
      platformSaleId: z.string(),
      reason: z.string().nullable(),
      decision: z.string().nullable(),
      outcomes: z.array(z.string()),
      signal: z.object({ memberId: z.string(), note: z.string().nullable() }).nullable(),
    }),
  ),
});
const SignalSchema = z.object({
  id: z.string(),
  revision: z.number(),
  kind: z.string(),
  netMinor: z.number(),
});

/** What the base said when it refused `write`: its SQLSTATE and its message. */
async function refusalOf(write: () => PromiseLike<unknown>): Promise<{ code: string; message: string }> {
  try {
    await write();
  } catch (error) {
    return CauseSchema.parse(error).cause;
  }
  throw new Error('The write was not refused');
}

/**
 * A member's own sales and their signal (CRM-03 lot b4c, ADR 0050 §§ 5, 10): Anna's account is paid on the platform's
 * net from P1 on, Théo was on shift for both sales. The rules and the register's lines are written here as fixtures:
 * the API still refuses `detected` until the switch's guard (CRM-03).
 */
describe('Équipe › Paie : le chatteur lit ses ventes et signale celle qui n’est pas à lui (CRM-03)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;
  let theoCookie: string;
  let leaCookie: string;

  const sale = (id: string, at: string, net: number) => ({
    id: newId(SalesLineIdSchema),
    creatorId: team.anna,
    platformAccountId: team.annas,
    platform: 'reveal',
    platformSaleId: id,
    event: 'sale',
    saleType: 'ppv',
    status: 'paid',
    occurredAt: new Date(at),
    platformModelId: 'model_test_01',
    platformChatterId: 'chatter_theo',
    platformFanId: null,
    currency: 'EUR',
    grossInclVatMinor: net * 2,
    grossExclVatMinor: net * 2,
    netMinor: net,
    agencyMinor: net,
    creatorMinor: 0,
    position: `${id}:sale`,
    inputsHash: 'hash_test',
    recordedAt: new Date(at),
  });

  const mine = async (cookie: string, query = '') => {
    const response = await team.call('GET', `/payroll/my-sales?period=${P1}${query}`, cookie);
    expect(response.statusCode).toBe(200);
    return MineSchema.parse(response.json());
  };
  const states = async (cookie = theoCookie) =>
    (await mine(cookie)).items.map((one) => [
      one.platformSaleId,
      one.state,
      one.signal?.note ?? null,
      one.open,
    ]);

  const signal = (
    values: { sale: string; kind?: 'signal' | 'withdraw'; id?: string; note?: string | null },
    cookie = theoCookie,
  ) =>
    team.call('POST', '/payroll/sale-signals', cookie, {
      id: values.id ?? newId(PaySaleSignalIdSchema),
      period: P1,
      platform: 'reveal',
      platformSaleId: values.sale,
      event: 'sale',
      kind: values.kind ?? 'signal',
      note: values.note ?? null,
    });

  const held = async () => {
    const response = await team.call('GET', `/payroll/periods/${P1}/held-sales`, team.owner);
    expect(response.statusCode).toBe(200);
    return HeldListSchema.parse(response.json()).sales.map((one) => [
      one.platformSaleId,
      one.reason,
      one.decision,
      one.outcomes,
      one.signal === null ? null : [one.signal.memberId, one.signal.note],
    ]);
  };

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'));
    ({ member: theo, cookie: theoCookie } = await team.addMember('theo@example.test', 'Théo'));
    ({ cookie: leaCookie } = await team.addMember('lea@example.test', 'Léa'));
    const db = team.test.admin.db;
    await db.insert(schema.accountPayRules).values({
      id: newId(AccountPayRulesIdSchema),
      creatorId: team.anna,
      platformAccountId: team.annas,
      fromPeriod: P1,
      currency: 'EUR',
      vatBps: 0,
      platformFeeBps: 0,
      earningsSource: 'detected',
      createdBy: team.ownerId,
    });
    const linked = new Date('2025-01-01T00:00:00Z');
    await db.insert(schema.salesFeedChatters).values({
      platform: 'reveal',
      platformChatterId: 'chatter_theo',
      kind: 'member',
      memberId: theo.id,
      linkVersionAt: linked,
      linkedAt: linked,
    });
    await db.insert(schema.shifts).values({
      id: newId(ShiftIdSchema),
      creatorId: team.anna,
      platformAccountId: team.annas,
      memberId: theo.id,
      startsAt: new Date('2025-05-05T08:00:00Z'),
      endsAt: new Date('2025-05-05T12:00:00Z'),
      createdBy: team.ownerId,
      updatedBy: team.ownerId,
    });
    await db
      .insert(schema.platformSales)
      .values([sale('sale_a', '2025-05-05T10:00:00Z', 4_000), sale('sale_b', '2025-05-05T11:00:00Z', 2_500)]);
    await team.recalculate(P1);
  });

  afterAll(async () => {
    await team.close();
  });

  it('gives Théo his own sales from his statement, the most recent first, with their instant and net', async () => {
    const read = await mine(theoCookie);
    expect(read.closed).toBe(false);
    expect(
      read.items.map((one) => [one.platformSaleId, one.netMinor, one.occurredAt, one.state, one.open]),
    ).toEqual([
      ['sale_b', 2_500, '2025-05-05T11:00:00.000Z', 'counted', true],
      ['sale_a', 4_000, '2025-05-05T10:00:00.000Z', 'counted', true],
    ]);
    expect(read.days).toEqual([
      { day: '2025-05-05', sales: 2, refunds: 0, nets: [{ currency: 'EUR', netMinor: 6_500 }] },
    ]);
    // A page at a time, the days whole on each.
    const first = await mine(theoCookie, '&limit=1');
    expect(first.items.map((one) => one.platformSaleId)).toEqual(['sale_b']);
    expect(first.days).toEqual(read.days);
    const second = await mine(theoCookie, `&limit=1&cursor=${first.nextCursor ?? ''}`);
    expect([second.items.map((one) => one.platformSaleId), second.nextCursor]).toEqual([['sale_a'], null]);
    const forged = await team.call('GET', `/payroll/my-sales?period=${P1}&cursor=pas-un-curseur`, theoCookie);
    expect([forged.statusCode, team.refusal(forged).code]).toEqual([400, 'cursor_invalid']);
    // Léa and the owner have no sale of theirs: Théo's never show to them here.
    expect((await mine(leaCookie)).items).toEqual([]);
    expect((await mine(team.owner)).items).toEqual([]);
  });

  it('gives Théo his own figures, and nothing of them to Léa nor to the owner (ADR 0104 § 1)', async () => {
    const figuresOf = async (cookie: string) => {
      const response = await team.call('GET', '/payroll/my-figures', cookie);
      expect(response.statusCode).toBe(200);
      return MyFiguresSchema.parse(response.json());
    };
    const own = await figuresOf(theoCookie);
    // His best day and fortnight are those of his only statement; the period under way, in 2026, holds nothing yet.
    expect(own.records).toEqual({
      bestDay: { day: '2025-05-05', currency: 'EUR', netMinor: 6_500 },
      bestPeriod: { period: P1, currency: 'EUR', netMinor: 6_500 },
    });
    expect(own.days).toEqual([]);
    expect(own.previous).toBeNull();
    expect(own.hours).toMatchObject({ sales: 0, enough: false, cells: [] });

    for (const cookie of [leaCookie, team.owner]) {
      const other = await figuresOf(cookie);
      expect(other.records).toEqual({ bestDay: null, bestPeriod: null });
      expect(other.days).toEqual([]);
      expect(other.nets).toEqual([]);
      expect(other.hours.cells).toEqual([]);
    }
    expect((await team.call('GET', '/payroll/my-figures', '')).statusCode).toBe(401);
  });

  it('lets Théo signal a line of his statement once, with a note, and the validator sees it', async () => {
    await team.forgetJobs(P1);
    const id = newId(PaySaleSignalIdSchema);
    const first = await signal({ id, sale: 'sale_a', note: 'Vendue pendant le shift de Léa' });
    expect(first.statusCode).toBe(201);
    expect(SignalSchema.parse(first.json())).toEqual({ id, revision: 1, kind: 'signal', netMinor: 4_000 });
    const again = await signal({ id, sale: 'sale_a', note: 'Vendue pendant le shift de Léa' });
    expect([again.statusCode, again.json()]).toEqual([200, first.json()]);
    const other = await signal({ id, sale: 'sale_a', note: 'Autre chose' });
    expect([other.statusCode, team.refusal(other).code]).toEqual([409, 'pay_sale_signal_conflict']);
    const twice = await signal({ sale: 'sale_a' });
    expect([twice.statusCode, team.refusal(twice).code]).toEqual([409, 'pay_sale_signal_state_conflict']);
    // Léa may not signal Théo's line, nor anyone a line that is on no statement.
    const lea = await signal({ sale: 'sale_b' }, leaCookie);
    expect([lea.statusCode, team.refusal(lea).code]).toEqual([404, 'pay_sale_signal_not_found']);
    const none = await signal({ sale: 'sale_none' });
    expect(team.refusal(none).code).toBe('pay_sale_signal_not_found');

    expect(await states()).toEqual([
      ['sale_b', 'counted', null, true],
      ['sale_a', 'signalled', 'Vendue pendant le shift de Léa', true],
    ]);
    expect(await held()).toEqual([
      ['sale_a', null, null, ['exclude'], [theo.id, 'Vendue pendant le shift de Léa']],
    ]);
    // A signal changes no amount and computes nothing again.
    expect(await team.jobsFor(P1)).toEqual([]);
    expect(await team.audited('pay_sale_signal.create')).toBe(1);
  });

  it('lets Théo take his signal back, and signal again', async () => {
    const back = await signal({ sale: 'sale_a', kind: 'withdraw' });
    expect(SignalSchema.parse(back.json())).toEqual(
      expect.objectContaining({ revision: 2, kind: 'withdraw' }),
    );
    const nothing = await signal({ sale: 'sale_a', kind: 'withdraw' });
    expect(team.refusal(nothing).code).toBe('pay_sale_signal_state_conflict');
    expect(await held()).toEqual([]);
    const anew = await signal({ sale: 'sale_a', note: 'Finalement, pas à moi' });
    expect(SignalSchema.parse(anew.json())).toEqual(expect.objectContaining({ revision: 3, kind: 'signal' }));
  });

  it('shows Théo a signalled sale the validator excluded, which left his statement, and nothing more to do on it', async () => {
    const excluded = await team.call('POST', '/payroll/sale-decisions', team.owner, {
      id: newId(PaySaleDecisionIdSchema),
      period: P1,
      platform: 'reveal',
      platformSaleId: 'sale_a',
      outcome: 'exclude',
      note: null,
      excludeReason: 'other',
    });
    expect(excluded.statusCode).toBe(201);
    await team.recalculate(P1);
    expect(await states()).toEqual([
      ['sale_b', 'counted', null, true],
      ['sale_a', 'excluded', 'Finalement, pas à moi', false],
    ]);
    expect((await mine(theoCookie)).days).toEqual([
      { day: '2025-05-05', sales: 1, refunds: 0, nets: [{ currency: 'EUR', netMinor: 2_500 }] },
    ]);
    expect(await held()).toEqual([
      ['sale_a', null, 'exclude', ['withdraw'], [theo.id, 'Finalement, pas à moi']],
    ]);
    expect(team.refusal(await signal({ sale: 'sale_a', kind: 'withdraw' })).code).toBe(
      'pay_sale_signal_not_found',
    );
  });

  it('keeps a signal on the member’s own statement as it stands, added only, in the base too', async () => {
    const db = team.test.admin.db;
    const row = (values: { revision: number; kind?: string; net?: number; sale?: string }) => ({
      id: newId(PaySaleSignalIdSchema),
      platform: 'reveal',
      platformSaleId: values.sale ?? 'sale_b',
      event: 'sale',
      memberId: theo.id,
      period: P1,
      revision: values.revision,
      kind: values.kind ?? 'signal',
      platformAccountId: team.annas,
      currency: 'EUR',
      netMinor: values.net ?? 2_500,
      occurredAt: new Date('2025-05-05T11:00:00Z'),
      createdBy: team.ownerId,
    });
    const refused = async (write: () => PromiseLike<unknown>, message: string) => {
      const cause = await refusalOf(write);
      expect(cause.code).toBe('23001');
      expect(cause.message).toContain(message);
    };
    await refused(() => db.insert(schema.paySaleSignals).values(row({ revision: 2 })), 'next number');
    await refused(
      () => db.insert(schema.paySaleSignals).values(row({ revision: 1, kind: 'withdraw' })),
      'takes back a signal',
    );
    await refused(
      () => db.insert(schema.paySaleSignals).values(row({ revision: 1, net: 2_400 })),
      'as it stands',
    );
    await refused(
      () => db.insert(schema.paySaleSignals).values({ ...row({ revision: 1 }), occurredAt: null }),
      'as it stands',
    );
    await refused(() => db.delete(schema.paySaleSignals), 'pay keeps its past');
  });

  it('closes with the period: nothing more is signalled, and a closed period refuses it in the base too', async () => {
    expect((await team.validate(team.owner, theo, P1)).statusCode).toBe(200);
    const read = await mine(theoCookie);
    expect(read.closed).toBe(true);
    expect(read.items.map((one) => [one.platformSaleId, one.open])).toEqual([
      ['sale_b', false],
      ['sale_a', false],
    ]);
    const late = await signal({ sale: 'sale_b' });
    expect([late.statusCode, team.refusal(late).code]).toEqual([409, 'pay_period_closed_conflict']);
    const cause = await refusalOf(() =>
      team.test.admin.db.insert(schema.paySaleSignals).values({
        id: newId(PaySaleSignalIdSchema),
        platform: 'reveal',
        platformSaleId: 'sale_b',
        event: 'sale',
        memberId: theo.id,
        period: P1,
        revision: 1,
        kind: 'signal',
        platformAccountId: team.annas,
        currency: 'EUR',
        netMinor: 2_500,
        occurredAt: new Date('2025-05-05T11:00:00Z'),
        createdBy: team.ownerId,
      }),
    );
    expect([cause.code, cause.message]).toEqual([
      '23001',
      'a closed period keeps what it paid: nothing is signalled on it (ADR 0032)',
    ]);
  });
});
