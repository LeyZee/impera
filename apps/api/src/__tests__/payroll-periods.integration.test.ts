import {
  AccountPayRulesIdSchema,
  newId,
  PayAdjustmentIdSchema,
  PayPeriodPageSchema,
  PayPeriodSchema,
  PayrollPeriodSchema,
  PlatformAccountIdSchema,
  type PayPeriod,
  type PayPeriodPage,
  type TeamMember,
} from '@nirvana/contracts';
import { schema } from '@nirvana/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

const Q1 = PayPeriodSchema.parse('2025-05-01');
const Q2 = PayPeriodSchema.parse('2025-05-16');

describe('Paie › Relevés : la liste des quinzaines (EQ-05)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;
  let lea: TeamMember;
  let mona: TeamMember;
  let theoCookie: string;
  let leaCookie: string;
  let monaCookie: string;

  const list = async (cookie: string, query = '') => {
    const response = await team.call('GET', `/payroll/periods${query}`, cookie);
    expect(response.statusCode, response.body).toBe(200);
    return PayPeriodPageSchema.parse(response.json());
  };

  /** What the list should say of `period` for a reader of `members`' statements, read as the admin. */
  const expected = async (period: PayPeriod, members: readonly TeamMember[]) => {
    const rows = (await team.test.admin.db.select().from(schema.commissionStatements)).filter(
      (row) => row.period === period && members.some((member) => member.id === row.memberId),
    );
    const sum = (pick: (row: (typeof rows)[number]) => number | null) =>
      rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
    const count = (keep: (row: (typeof rows)[number]) => boolean) => rows.filter(keep).length;
    return {
      statements: {
        draft: count((row) => row.status === 'draft'),
        validated: count((row) => row.status === 'validated'),
        paid: count((row) => row.status === 'paid'),
        carried: count((row) => row.carryOverOutMinor !== 0 && row.status !== 'draft'),
      },
      netMinor: sum((row) => row.netMinor),
      payableMinor: sum((row) => row.payableMinor),
      validatedPayableMinor: sum((row) => (row.status === 'draft' ? 0 : row.payableMinor)),
      carriedMinor: sum((row) => (row.status === 'draft' ? 0 : row.carryOverOutMinor)),
      paidMinor: sum((row) => row.sentMinor),
    };
  };

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'));
    ({ member: theo, cookie: theoCookie } = await team.addMember('theo@example.test', 'Théo'));
    ({ member: lea, cookie: leaCookie } = await team.addMember('lea@example.test', 'Léa'));
    ({ member: mona, cookie: monaCookie } = await team.addMember('mona@example.test', 'Mona', 'manager'));

    // Léa also sells in dollars, so that the first fortnight's closing freezes a rate.
    const dollars = newId(PlatformAccountIdSchema);
    await team.test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: dollars, creatorId: team.bea, platform: 'reveal', handle: 'bea-en-dollars' });
    await team.test.admin.db.insert(schema.accountPayRules).values({
      id: newId(AccountPayRulesIdSchema),
      creatorId: team.bea,
      platformAccountId: dollars,
      fromPeriod: '2020-01-01',
      currency: 'USD',
      vatBps: 0,
      platformFeeBps: 2_000,
      earningsSource: 'declared',
      createdBy: team.ownerId,
    });
    await team.test.admin.db.insert(schema.exchangeRates).values({
      currency: 'USD',
      day: '2025-05-15',
      rateMicros: 920_000,
      source: 'BCE, taux de référence',
      fetchedAt: new Date('2025-05-15T15:07:00Z'),
    });

    // The first fortnight, closed, Théo paid; the second still in draft, Théo under the minimum payout and Léa below
    // zero (an adjustment takes back more than she earns): both carry their total over.
    await team.report(theo, Q1, 10_000);
    await team.report(lea, Q1, 30_000);
    await team.report(lea, Q1, 10_000, { account: dollars, currency: 'USD' });
    await team.report(mona, Q1, 20_000);
    await team.recalculate(Q1);
    for (const member of [theo, lea])
      expect((await team.validate(team.owner, member, Q1)).statusCode).toBe(200);
    expect((await team.validate(team.owner, mona, Q1)).statusCode).toBe(200);
    const paid = await team.statementOf(theo, Q1);
    const payment = {
      revision: paid.revision,
      paidOn: '2025-05-20',
      method: 'worldremit',
      sentMinor: paid.payableMinor,
    };
    expect(
      (await team.call('POST', `/payroll/statements/${paid.id}/pay`, team.owner, payment)).statusCode,
    ).toBe(200);
    await team.report(theo, Q2, 5_000);
    await team.report(lea, Q2, 20_000);
    const takenBack = {
      id: newId(PayAdjustmentIdSchema),
      memberId: lea.id,
      amountMinor: -50_000,
      reason: 'Remboursement d’une vente annulée',
    };
    expect((await team.call('POST', '/payroll/adjustments', team.owner, takenBack)).statusCode).toBe(201);
    await team.recalculate(Q2);
    expect((await team.statementOf(theo, Q2)).carryOverOutMinor).toBeGreaterThan(0);
    expect((await team.statementOf(lea, Q2)).carryOverOutMinor).toBeLessThan(0);
  });

  afterAll(() => team.close());

  it('sums each reader’s statements in SQL: the team for the agency, one’s own for a member', async () => {
    const everyone = [theo, lea, mona];
    const owners = await list(team.owner);
    expect(owners.items.map((item) => item.window.period)).toEqual([Q2, Q1]);
    for (const item of owners.items)
      expect(item).toMatchObject({ ended: true, ...(await expected(item.window.period, everyone)) });
    expect(owners.items[1]?.statements).toEqual({ draft: 0, validated: 2, paid: 1, carried: 0 });
    // Théo and Léa would carry their Q2 totals over, but nothing is owed nor carried before a validation.
    expect(owners.items[0]).toMatchObject({
      statements: { draft: 2, validated: 0, paid: 0, carried: 0 },
      validatedPayableMinor: 0,
      carriedMinor: 0,
    });
    expect(q1Of(owners)?.validatedPayableMinor).toBe(q1Of(owners)?.payableMinor);

    // An active manager reads the team, as the owner does; each chatter reads their own, never the team's.
    expect(await list(monaCookie)).toEqual(owners);
    const theos = await list(theoCookie);
    const leas = await list(leaCookie);
    for (const [page, member] of [
      [theos, theo],
      [leas, lea],
    ] as const)
      for (const item of page.items) expect(item).toMatchObject(await expected(item.window.period, [member]));
    // Three readers, three sums on the same data.
    const sums = [owners, theos, leas].map((page) =>
      JSON.stringify([q1Of(page)?.netMinor, q1Of(page)?.paidMinor]),
    );
    expect(new Set(sums).size).toBe(3);
    expect(q1Of(theos)?.paidMinor).toBe((await team.statementOf(theo, Q1)).payableMinor);
    expect(q1Of(leas)?.paidMinor).toBe(0);
  });

  it('gives a member the date of a closing, never who closed it nor its rates', async () => {
    const closing = await team.closingOf(Q1);
    const closedAt = closing?.closedAt.toISOString();
    expect(q1Of(await list(team.owner))).toMatchObject({ closedAt, closedBy: team.ownerId });
    expect(q1Of(await list(theoCookie))).toMatchObject({ closedAt, closedBy: null });
    expect((await list(theoCookie)).items[0]).toMatchObject({ window: { period: Q2 }, closedAt: null });

    // The period itself says the same: the whole closing for the agency, its date only for a member.
    const read = async (cookie: string) => {
      const response = await team.call('GET', `/payroll/periods/${Q1}`, cookie);
      expect(response.statusCode, response.body).toBe(200);
      return PayrollPeriodSchema.parse(response.json()).closing;
    };
    const rates = [expect.objectContaining({ currency: 'USD', day: '2025-05-15', rateMicros: 920_000 })];
    for (const cookie of [team.owner, monaCookie])
      expect(await read(cookie)).toMatchObject({ closedAt, closedBy: team.ownerId, exchangeRates: rates });
    for (const cookie of [theoCookie, leaCookie])
      expect(await read(cookie)).toEqual({ period: Q1, closedAt, closedBy: null, exchangeRates: null });
  });

  it('pages from the most recent period, and refuses a cursor it did not give', async () => {
    const first = await list(team.owner, '?limit=1');
    expect(first.items.map((item) => item.window.period)).toEqual([Q2]);
    expect(first.nextCursor).not.toBeNull();
    const second = await list(team.owner, `?limit=1&cursor=${first.nextCursor ?? ''}`);
    expect([second.items.map((item) => item.window.period), second.nextCursor]).toEqual([[Q1], null]);

    for (const cursor of ['nope', Buffer.from('2025-05-17').toString('base64url')]) {
      const refused = await team.call('GET', `/payroll/periods?cursor=${cursor}`, team.owner);
      expect([refused.statusCode, team.refusal(refused).code]).toEqual([400, 'cursor_invalid']);
    }
  });

  it('counts a carry-over and owes an amount once the statement is validated, as the period itself does', async () => {
    expect((await team.validate(team.owner, theo, Q2)).statusCode).toBe(200);
    const theosQ2 = await team.statementOf(theo, Q2);
    const owners = await list(team.owner);
    expect(owners.items[0]).toMatchObject({
      window: { period: Q2 },
      ...(await expected(Q2, [theo, lea, mona])),
    });
    // Théo's validated total went over to the next period; Léa's, still to validate, is neither owed nor carried.
    expect(owners.items[0]).toMatchObject({
      statements: { draft: 1, validated: 1, paid: 0, carried: 1 },
      validatedPayableMinor: theosQ2.payableMinor,
      carriedMinor: theosQ2.carryOverOutMinor,
    });
    expect(theosQ2.carryOverOutMinor).toBeGreaterThan(0);

    // Léa's total below zero is carried too, negative: over the team, the sum is a net of both kinds.
    expect((await team.validate(team.owner, lea, Q2)).statusCode).toBe(200);
    const leasQ2 = await team.statementOf(lea, Q2);
    expect(leasQ2.carryOverOutMinor).toBeLessThan(0);
    const after = (await list(team.owner)).items[0];
    expect(after).toMatchObject({ ...(await expected(Q2, [theo, lea, mona])) });
    expect(after).toMatchObject({
      statements: { draft: 0, validated: 2, paid: 0, carried: 2 },
      carriedMinor: theosQ2.carryOverOutMinor + leasQ2.carryOverOutMinor,
    });
    // Each member reads their own carry-over with its sign.
    expect(q2Of(await list(leaCookie))?.carriedMinor).toBe(leasQ2.carryOverOutMinor);
  });
});

const q1Of = (page: PayPeriodPage) => page.items.find((item) => item.window.period === Q1);
const q2Of = (page: PayPeriodPage) => page.items.find((item) => item.window.period === Q2);
