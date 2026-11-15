import {
  AccountPayRulesIdSchema,
  calendarDayAt,
  newId,
  PayPeriodSchema,
  PaySaleDecisionIdSchema,
  SalesLineIdSchema,
  ShiftIdSchema,
  type TeamMember,
} from '@impera/contracts';
import { and, eq, inArray, schema } from '@impera/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

// Everything below is invented (ADR 0010). Periods of 2025: they have ended.
const P1 = PayPeriodSchema.parse('2025-05-01');
const P2 = PayPeriodSchema.parse('2025-05-16');
const CauseSchema = z.object({ cause: z.object({ code: z.string(), message: z.string() }) });
const HeldListSchema = z.object({
  sales: z.array(
    z.object({
      platformSaleId: z.string(),
      decision: z.string().nullable(),
      given: z.object({ recipientMemberId: z.string(), shareBp: z.number(), note: z.string() }).nullable(),
      excludeReason: z.string().nullable(),
      outcomes: z.array(z.string()),
      recipients: z.array(z.string()),
    }),
  ),
});
const SaleEntrySchema = z.object({
  platformSaleId: z.string(),
  netMinor: z.number(),
  shareBp: z.number().optional(),
});
const MySalesSchema = z.object({
  items: z.array(
    z.object({
      platformSaleId: z.string(),
      state: z.string(),
      netMinor: z.number(),
      given: z
        .object({
          role: z.string(),
          myShareBp: z.number(),
          other: z.object({ kind: z.string(), displayName: z.string().optional() }),
          note: z.string(),
        })
        .nullable(),
    }),
  ),
  days: z.array(z.object({ nets: z.array(z.object({ netMinor: z.number() })) })),
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
 * A sale given to the member who was decisive, whole or shared (ADR 0101): Anna's account is paid on the platform's
 * net from P1 on. Théo (a manager) sells in the morning, Léa holds the account in the evening, Sam is on another
 * account; the agent sells too. The rules, links, shifts and the register's lines are fixtures.
 */
describe('Équipe › Paie : donner ou partager une vente avec le chatteur décisif (ADR 0101)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;
  let theoCookie: string;
  let lea: TeamMember;
  let leaCookie: string;
  let sam: TeamMember;

  const NOTE = 'Elle a relancé le fan et l’a convaincu';

  const sale = (id: string, at: string, chatter: string, net: number) => ({
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
    platformChatterId: chatter,
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

  const heldIn = async (period: string, cookie = team.owner) => {
    const response = await team.call('GET', `/payroll/periods/${period}/held-sales`, cookie);
    expect(response.statusCode).toBe(200);
    return HeldListSchema.parse(response.json()).sales;
  };

  const decide = (
    values: {
      sale: string;
      outcome: 'count' | 'exclude' | 'give' | 'withdraw';
      to?: TeamMember;
      shareBp?: number;
      note?: string | null;
      excludeReason?: 'agent_decisive' | 'other';
      period?: string;
    },
    cookie = team.owner,
  ) =>
    team.call('POST', '/payroll/sale-decisions', cookie, {
      id: newId(PaySaleDecisionIdSchema),
      period: values.period ?? P1,
      platform: 'reveal',
      platformSaleId: values.sale,
      outcome: values.outcome,
      note: values.note === undefined ? (values.outcome === 'give' ? NOTE : null) : values.note,
      recipientMemberId: values.to?.id ?? null,
      shareBp: values.outcome === 'give' ? (values.shareBp ?? 10_000) : null,
      excludeReason: values.outcome === 'exclude' ? (values.excludeReason ?? 'other') : null,
    });

  /** A member's lines of the platform's net on their statement of `period`: sale, net, share. */
  const statementSales = async (member: TeamMember, period = P1) => {
    const statement = await team.statementOf(member, period);
    const lines = await team.test.admin.db
      .select({ sales: schema.commissionStatementLines.sales })
      .from(schema.commissionStatementLines)
      .where(
        and(
          eq(schema.commissionStatementLines.statementId, statement.id),
          eq(schema.commissionStatementLines.revision, statement.revision),
        ),
      );
    return lines
      .flatMap((line) => z.array(SaleEntrySchema).parse(line.sales))
      .sort((a, b) => a.platformSaleId.localeCompare(b.platformSaleId))
      .map((one) => [one.platformSaleId, one.netMinor, one.shareBp ?? null]);
  };

  const mySales = async (cookie: string, period = P1) => {
    const response = await team.call('GET', `/payroll/my-sales?period=${period}`, cookie);
    expect(response.statusCode, response.body).toBe(200);
    return MySalesSchema.parse(response.json());
  };

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'));
    ({ member: theo, cookie: theoCookie } = await team.addMember('theo@example.test', 'Théo', 'manager'));
    ({ member: lea, cookie: leaCookie } = await team.addMember('lea@example.test', 'Léa'));
    ({ member: sam } = await team.addMember('sam@example.test', 'Sam'));
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
    await db.insert(schema.salesFeedChatters).values([
      {
        platform: 'reveal',
        platformChatterId: 'chatter_theo',
        kind: 'member',
        memberId: theo.id,
        linkVersionAt: linked,
        linkedAt: linked,
      },
      {
        platform: 'reveal',
        platformChatterId: 'chatter_lea',
        kind: 'member',
        memberId: lea.id,
        linkVersionAt: linked,
        linkedAt: linked,
      },
      {
        platform: 'reveal',
        platformChatterId: 'chatter_bot',
        kind: 'agent',
        linkVersionAt: linked,
        linkedAt: linked,
      },
    ]);
    const shift = (member: TeamMember, startsAt: string, endsAt: string, account = team.annas) => ({
      id: newId(ShiftIdSchema),
      creatorId: account === team.annas ? team.anna : team.bea,
      platformAccountId: account,
      memberId: member.id,
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      createdBy: team.ownerId,
      updatedBy: team.ownerId,
    });
    await db
      .insert(schema.shifts)
      .values([
        shift(theo, '2025-05-05T08:00:00Z', '2025-05-05T12:00:00Z'),
        shift(lea, '2025-05-05T18:00:00Z', '2025-05-05T23:00:00Z'),
        shift(sam, '2025-05-05T18:00:00Z', '2025-05-05T23:00:00Z', team.beas),
      ]);
    await db.insert(schema.platformSales).values([
      // Théo sends the paid media off shift; Léa, on shift, convinces the fan to pay.
      sale('sale_whole', '2025-05-05T20:00:00Z', 'chatter_theo', 3_000),
      sale('sale_split', '2025-05-05T21:00:00Z', 'chatter_theo', 10_001),
      sale('sale_bot', '2025-05-05T22:00:00Z', 'chatter_bot', 2_000),
      sale('sale_morning', '2025-05-05T10:00:00Z', 'chatter_theo', 5_000),
    ]);
  });

  afterAll(async () => {
    await team.close();
  });

  it('offers to give a sale to the members on shift at its instant only, never to its author nor the reader', async () => {
    const held = await heldIn(P1);
    expect(held.map((one) => [one.platformSaleId, one.outcomes, one.recipients])).toEqual([
      ['sale_split', ['count', 'exclude', 'give'], [lea.id]],
      ['sale_whole', ['count', 'exclude', 'give'], [lea.id]],
    ]);
    // Sam was on another account, Théo made the sale: refused.
    expect(team.refusal(await decide({ sale: 'sale_whole', outcome: 'give', to: sam })).code).toBe(
      'pay_sale_recipient_conflict',
    );
    // A give names its recipient, its share and why: the body says so before anything.
    expect((await decide({ sale: 'sale_whole', outcome: 'give', to: lea, note: null })).statusCode).toBe(400);
    // A manager never decides a sale of their own, nor gives one to themselves.
    expect((await decide({ sale: 'sale_whole', outcome: 'give', to: lea }, theoCookie)).statusCode).toBe(403);
  });

  it('finds the sales of a day the reader may give, a member’s or the agent’s, never their own', async () => {
    const toGive = async (day: string, cookie = team.owner) => {
      const response = await team.call('GET', `/payroll/periods/${P1}/sales-to-give?day=${day}`, cookie);
      expect(response.statusCode, response.body).toBe(200);
      return HeldListSchema.parse(response.json()).sales.map((one) => [
        one.platformSaleId,
        one.outcomes,
        one.recipients,
      ]);
    };
    // Théo's morning had nobody else on the account. The agent's sale, at midnight in Paris, is the next day's.
    expect(await toGive('2025-05-05')).toEqual([
      ['sale_whole', ['count', 'exclude', 'give'], [lea.id]],
      ['sale_split', ['count', 'exclude', 'give'], [lea.id]],
    ]);
    expect(await toGive('2025-05-06')).toEqual([['sale_bot', ['give'], [lea.id]]]);
    // A manager never finds his own sales; a chatter reads none; a day is a day.
    expect(await toGive('2025-05-05', theoCookie)).toEqual([]);
    expect((await toGive('2025-05-06', theoCookie)).map(([id]) => id)).toEqual(['sale_bot']);
    const asked = (cookie: string, day: string) =>
      team.call('GET', `/payroll/periods/${P1}/sales-to-give?day=${day}`, cookie);
    expect((await asked(leaCookie, '2025-05-05')).statusCode).toBe(403);
    expect((await asked(team.owner, 'mai')).statusCode).toBe(400);
  });

  it('counts a sale given whole for its recipient, and tells both of them on their own lines', async () => {
    const given = await decide({ sale: 'sale_whole', outcome: 'give', to: lea });
    expect(given.statusCode, given.body).toBe(201);
    expect(given.json()).toMatchObject({
      outcome: 'give',
      memberId: theo.id,
      recipientMemberId: lea.id,
      shareBp: 10_000,
      excludeReason: null,
      note: NOTE,
    });
    await team.recalculate(P1);
    expect(await statementSales(lea)).toEqual([['sale_whole', 3_000, null]]);
    expect(await statementSales(theo)).toEqual([['sale_morning', 5_000, null]]);
    const forLea = await mySales(leaCookie);
    expect(forLea.items.map((one) => [one.platformSaleId, one.state, one.given])).toEqual([
      [
        'sale_whole',
        'counted',
        { role: 'recipient', myShareBp: 10_000, other: { kind: 'member', displayName: 'Théo' }, note: NOTE },
      ],
    ]);
    const forTheo = await mySales(theoCookie);
    const whole = forTheo.items.find((one) => one.platformSaleId === 'sale_whole');
    expect(whole).toMatchObject({ state: 'given', netMinor: 3_000 });
    expect(whole?.given).toEqual({
      role: 'author',
      myShareBp: 0,
      other: { kind: 'member', displayName: 'Léa' },
      note: NOTE,
    });
    expect(forTheo.items.find((one) => one.platformSaleId === 'sale_morning')).toMatchObject({
      state: 'counted',
      given: null,
    });
    // Given away, it pays Théo nothing: his days hold his morning sale only.
    expect(forTheo.days.flatMap((day) => day.nets.map((one) => one.netMinor))).toEqual([5_000]);
  });

  it('shares a sale: each member counts their part, the recipient’s rounded once, the rest to the author', async () => {
    const shared = await decide({ sale: 'sale_split', outcome: 'give', to: lea, shareBp: 6_000 });
    expect(shared.statusCode, shared.body).toBe(201);
    await team.recalculate(P1);
    expect(await statementSales(lea)).toEqual([
      ['sale_split', 6_001, 6_000],
      ['sale_whole', 3_000, null],
    ]);
    expect(await statementSales(theo)).toEqual([
      ['sale_morning', 5_000, null],
      ['sale_split', 4_000, 4_000],
    ]);
    const split = (await mySales(theoCookie)).items.find((one) => one.platformSaleId === 'sale_split');
    expect(split?.given).toEqual({
      role: 'author',
      myShareBp: 4_000,
      other: { kind: 'member', displayName: 'Léa' },
      note: NOTE,
    });
    expect((await heldIn(P1)).find((one) => one.platformSaleId === 'sale_split')).toMatchObject({
      decision: 'give',
      given: { recipientMemberId: lea.id, shareBp: 6_000, note: NOTE },
      outcomes: ['count', 'exclude', 'give', 'withdraw'],
    });
  });

  it('gives a sale of the agent whole to the member who convinced, never a share of it', async () => {
    expect(
      team.refusal(await decide({ sale: 'sale_bot', outcome: 'give', to: lea, shareBp: 5_000 })).code,
    ).toBe('pay_sale_recipient_conflict');
    const given = await decide({ sale: 'sale_bot', outcome: 'give', to: lea });
    expect(given.statusCode, given.body).toBe(201);
    expect(given.json()).toMatchObject({ memberId: null, recipientMemberId: lea.id });
    await team.recalculate(P1);
    expect(await statementSales(lea)).toContainEqual(['sale_bot', 2_000, null]);
    const bot = (await mySales(leaCookie)).items.find((one) => one.platformSaleId === 'sale_bot');
    expect(bot?.given?.other).toEqual({ kind: 'agent' });
  });

  it('counts for the owner the sales each validator gave in the month, and how many of them shared', async () => {
    // The decisions above were written today: the month under way counts them, May 2025 none.
    const today = calendarDayAt(new Date(), 'Europe/Paris');
    const period = PayPeriodSchema.parse(`${today.slice(0, 7)}-01`);
    const gifts = await team.call('GET', `/payroll/periods/${period}/sale-gifts`, team.owner);
    expect(gifts.statusCode, gifts.body).toBe(200);
    expect(gifts.json()).toEqual({
      period,
      monthStart: `${today.slice(0, 7)}-01`,
      counts: [{ decidedBy: team.ownerId, given: 3, shared: 1 }],
    });
    const may = await team.call('GET', `/payroll/periods/${P1}/sale-gifts`, team.owner);
    expect(may.json()).toMatchObject({ monthStart: '2025-05-01', counts: [] });
    // A manager does not read them: they watch him.
    const refused = await team.call('GET', `/payroll/periods/${period}/sale-gifts`, theoCookie);
    expect(refused.statusCode).toBe(403);
  });

  it('registers a shared sale as two parts at the closing, and the base keeps the parts whole', async () => {
    expect((await team.validate(team.owner, lea, P1)).statusCode).toBe(200);
    const db = team.test.admin.db;
    const rows = await db
      .select()
      .from(schema.payPeriodSales)
      .where(inArray(schema.payPeriodSales.platformSaleId, ['sale_split', 'sale_whole', 'sale_bot']))
      .orderBy(schema.payPeriodSales.platformSaleId, schema.payPeriodSales.netMinor);
    expect(
      rows.map((one) => [one.platformSaleId, one.memberId, one.netMinor, one.shareBp, one.shareRole]),
    ).toEqual([
      ['sale_bot', lea.id, 2_000, 10_000, null],
      ['sale_split', theo.id, 4_000, 4_000, 'author'],
      ['sale_split', lea.id, 6_001, 6_000, 'recipient'],
      ['sale_whole', lea.id, 3_000, 10_000, null],
    ]);
    // A counted sale is never decided again.
    expect(team.refusal(await decide({ sale: 'sale_split', outcome: 'withdraw', period: P2 })).code).toBe(
      'pay_sale_not_found',
    );
  });

  it('refuses in the base a part alone, a part with another net than its share gives, and a share of the agent’s sale', async () => {
    const db = team.test.admin.db;
    const refused = async (write: () => PromiseLike<unknown>, code: string, message: string) => {
      const cause = await refusalOf(write);
      expect(cause.code).toBe(code);
      expect(cause.message).toContain(message);
    };
    await db
      .insert(schema.platformSales)
      .values(sale('sale_late', '2025-05-20T20:00:00Z', 'chatter_theo', 999));
    await team.recalculate(P2);
    const part = (
      member: TeamMember,
      netMinor: number,
      shareBp: number,
      shareRole: 'author' | 'recipient',
    ) => ({
      platform: 'reveal',
      platformSaleId: 'sale_late',
      event: 'sale',
      period: P2,
      memberId: member.id,
      linkVersion: 'link_test',
      platformAccountId: team.annas,
      currency: 'EUR',
      netMinor,
      salePeriod: P2,
      shareBp,
      shareRole,
    });
    // In a closing's transaction (rolled back): 999 shared at 50 % gives the recipient 500 (499.5 rounded away from
    // zero) and the author 499.
    const closing = (parts: ReturnType<typeof part>[]) =>
      db.transaction(async (tx) => {
        await tx.insert(schema.payPeriodClosings).values({
          period: P2,
          teamNetMinor: 0,
          collective: null,
          exchangeRates: [],
          closedBy: team.ownerId,
        });
        await tx.insert(schema.payPeriodSales).values(parts);
      });
    await refused(() => closing([part(lea, 499, 5_000, 'recipient')]), '23001', 'a line of the register');
    await refused(() => closing([part(theo, 500, 5_000, 'author')]), '23001', 'a line of the register');
    await refused(() => closing([part(lea, 500, 5_000, 'recipient')]), '23001', 'shared between its author');
    // Shares that do not make the whole: 40 % to the author leaves 599 to a recipient said at 50 %.
    await refused(
      () => closing([part(theo, 400, 4_000, 'author'), part(lea, 500, 5_000, 'recipient')]),
      '23001',
      'shared between its author',
    );
    expect(await team.closingOf(P2)).toBeUndefined();

    // A give keeps the line as the register has it, and never shares a sale of the agent.
    const [line] = await db
      .select()
      .from(schema.platformSales)
      .where(eq(schema.platformSales.platformSaleId, 'sale_late'));
    if (line === undefined) throw new Error('The line was not written');
    const give = (values: { shareBp: number; author: TeamMember | null; net: number }) => ({
      id: newId(PaySaleDecisionIdSchema),
      platform: 'reveal',
      platformSaleId: 'sale_late',
      revision: 1,
      platformAccountId: team.annas,
      outcome: 'give',
      authorMemberId: values.author?.id ?? null,
      linkVersion: 'link_test',
      recipientMemberId: lea.id,
      shareBp: values.shareBp,
      note: NOTE,
      saleCurrency: 'EUR',
      saleNetMinor: values.net,
      saleOccurredAt: line.occurredAt,
      decidedBy: team.ownerId,
    });
    await refused(
      () => db.insert(schema.paySaleDecisions).values(give({ shareBp: 5_000, author: theo, net: 998 })),
      '23001',
      'as the register has it',
    );
    await refused(
      () => db.insert(schema.paySaleDecisions).values(give({ shareBp: 5_000, author: null, net: 999 })),
      '23514',
      'pay_sale_decisions_give_check',
    );
  });
});
