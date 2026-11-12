import {
  AccountPayRulesIdSchema,
  newId,
  PayPeriodSchema,
  PaySaleDecisionIdSchema,
  SalesLineIdSchema,
  ShiftIdSchema,
  type TeamMember,
} from '@impera/contracts';
import { and, eq, schema } from '@impera/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

// Everything below is invented (ADR 0010). Periods of 2025: they have ended.
const P0 = PayPeriodSchema.parse('2025-04-16');
const P1 = PayPeriodSchema.parse('2025-05-01');
const P2 = PayPeriodSchema.parse('2025-05-16');
const P3 = PayPeriodSchema.parse('2025-06-01');
const CauseSchema = z.object({ cause: z.object({ code: z.string(), message: z.string() }) });
const HeldListSchema = z.object({
  period: z.string(),
  sales: z.array(
    z.object({
      platformSaleId: z.string(),
      event: z.string(),
      memberId: z.string().nullable(),
      memberLeftOn: z.string().nullable(),
      platformChatterId: z.string().nullable(),
      reason: z.string().nullable(),
      decision: z.string().nullable(),
      outcomes: z.array(z.string()),
    }),
  ),
});
const DecisionSchema = z.object({ id: z.string(), revision: z.number(), outcome: z.string() });
const SaleEntrySchema = z.object({ platformSaleId: z.string(), lateFrom: z.string().optional() });
const FinalRulesSchema = z.object({ final: z.boolean(), minimumPayoutMinor: z.number().int() });

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
 * The sales a period holds and the validator's decision on them (CRM-03 lot b3, ADR 0050 § 5, ADR 0032): Anna's
 * account is paid on the platform's net from P1 on. The rules and the register's lines are written here as fixtures:
 * the API still refuses `detected` until the switch's guard (CRM-03).
 */
describe('Équipe › Paie : la décision du valideur sur une vente en attente (CRM-03)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;
  let theoCookie: string;
  let leaCookie: string;
  let lea: TeamMember;

  const sale = (values: {
    readonly id: string;
    readonly at: string;
    readonly chatter: string | null;
    readonly net: number;
    readonly status?: 'paid' | 'other';
  }) => ({
    id: newId(SalesLineIdSchema),
    creatorId: team.anna,
    platformAccountId: team.annas,
    platform: 'reveal',
    platformSaleId: values.id,
    event: 'sale',
    saleType: 'ppv',
    status: values.status ?? 'paid',
    occurredAt: new Date(values.at),
    platformModelId: 'model_test_01',
    platformChatterId: values.chatter,
    platformFanId: null,
    currency: 'EUR',
    grossInclVatMinor: values.net * 2,
    grossExclVatMinor: values.net * 2,
    netMinor: values.net,
    agencyMinor: values.net,
    creatorMinor: 0,
    position: `${values.id}:sale`,
    inputsHash: 'hash_test',
    recordedAt: new Date(values.at),
  });

  const held = async (period: string, cookie = team.owner) => {
    const response = await team.call('GET', `/payroll/periods/${period}/held-sales`, cookie);
    expect(response.statusCode).toBe(200);
    return HeldListSchema.parse(response.json()).sales.map((one) => [
      one.platformSaleId,
      one.reason,
      one.decision,
      one.outcomes,
    ]);
  };

  const decide = (
    values: {
      period: string;
      sale: string;
      outcome: 'count' | 'exclude' | 'withdraw';
      id?: string;
      note?: string | null;
    },
    cookie = team.owner,
  ) =>
    team.call('POST', '/payroll/sale-decisions', cookie, {
      id: values.id ?? newId(PaySaleDecisionIdSchema),
      period: values.period,
      platform: 'reveal',
      platformSaleId: values.sale,
      outcome: values.outcome,
      note: values.note ?? null,
    });

  const salesOf = async (member: TeamMember, period: string) => {
    const statement = await team.statementOf(member, PayPeriodSchema.parse(period));
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
      .map((one) => [one.platformSaleId, one.lateFrom ?? null]);
  };

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'));
    ({ member: theo, cookie: theoCookie } = await team.addMember('theo@example.test', 'Théo', 'manager'));
    ({ member: lea, cookie: leaCookie } = await team.addMember('lea@example.test', 'Léa'));
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
    await db.insert(schema.platformSales).values([
      sale({ id: 'sale_on', at: '2025-05-05T10:00:00Z', chatter: 'chatter_theo', net: 10_000 }),
      sale({ id: 'sale_off', at: '2025-05-07T20:00:00Z', chatter: 'chatter_theo', net: 3_000 }),
      sale({
        id: 'sale_odd',
        at: '2025-05-05T11:00:00Z',
        chatter: 'chatter_theo',
        net: 1_000,
        status: 'other',
      }),
      sale({ id: 'sale_new', at: '2025-05-06T09:00:00Z', chatter: 'chatter_new', net: 2_000 }),
    ]);
  });

  afterAll(async () => {
    await team.close();
  });

  it('lists what an open period holds to the owner and an active manager, never to a chatter', async () => {
    expect(await held(P1)).toEqual([
      ['sale_new', 'chatter_unlinked', null, ['exclude']],
      ['sale_odd', 'status_unknown', null, ['count', 'exclude']],
      ['sale_off', 'off_shift', null, ['count', 'exclude']],
    ]);
    expect(await held(P1, theoCookie)).toHaveLength(3);
    const refused = await team.call('GET', `/payroll/periods/${P1}/held-sales`, leaCookie);
    expect(refused.statusCode).toBe(403);
    expect(team.refusal(refused).code).toBe('payroll_forbidden');
  });

  it('names the platform account of each line held, linked or not, for the validator to know who made it', async () => {
    const response = await team.call('GET', `/payroll/periods/${P1}/held-sales`, team.owner);
    expect(
      HeldListSchema.parse(response.json()).sales.map((one) => [
        one.platformSaleId,
        one.memberId,
        one.platformChatterId,
      ]),
    ).toEqual([
      ['sale_new', null, 'chatter_new'],
      ['sale_odd', theo.id, 'chatter_theo'],
      ['sale_off', theo.id, 'chatter_theo'],
    ]);
  });

  it('refuses a decision on one’s own sale, an outcome the sale does not offer, and a sale it does not hold', async () => {
    const own = await decide({ period: P1, sale: 'sale_off', outcome: 'count' }, theoCookie);
    expect(own.statusCode).toBe(403);
    expect(team.refusal(own).code).toBe('payroll_own_forbidden');
    const unlinked = await decide({ period: P1, sale: 'sale_new', outcome: 'count' });
    expect(team.refusal(unlinked)).toEqual(
      expect.objectContaining({ code: 'pay_sale_outcome_conflict', details: { outcomes: ['exclude'] } }),
    );
    const unknown = await decide({ period: P1, sale: 'sale_none', outcome: 'exclude' });
    expect(unknown.statusCode).toBe(404);
    expect(team.refusal(unknown).code).toBe('pay_sale_not_found');
    // The same sale in a period that does not take it (before the first closing, a later one does: it would close
    // first and leave the sale held).
    expect(team.refusal(await decide({ period: P0, sale: 'sale_off', outcome: 'count' })).code).toBe(
      'pay_sale_not_found',
    );
    expect(await team.audited('pay_sale_decision.create')).toBe(0);
  });

  it('counts a sale off shift for its member once decided, and a decision sent again gives back the same one', async () => {
    const id = newId(PaySaleDecisionIdSchema);
    const first = await decide({
      id,
      period: P1,
      sale: 'sale_off',
      outcome: 'count',
      note: 'Renfort du soir',
    });
    expect(first.statusCode).toBe(201);
    expect(DecisionSchema.parse(first.json())).toEqual({ id, revision: 1, outcome: 'count' });
    const again = await decide({
      id,
      period: P1,
      sale: 'sale_off',
      outcome: 'count',
      note: 'Renfort du soir',
    });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(first.json());
    expect(team.refusal(await decide({ id, period: P1, sale: 'sale_off', outcome: 'exclude' })).code).toBe(
      'pay_sale_decision_conflict',
    );
    expect(await team.jobsFor(P1)).not.toHaveLength(0);

    await team.recalculate(P1);
    expect(await salesOf(theo, P1)).toEqual([
      ['sale_off', null],
      ['sale_on', null],
    ]);
    // Counted, it still shows with its decision, which can be changed or taken back until a closing counts it.
    expect(await held(P1)).toEqual([
      ['sale_new', 'chatter_unlinked', null, ['exclude']],
      ['sale_odd', 'status_unknown', null, ['count', 'exclude']],
      ['sale_off', 'off_shift', 'count', ['exclude', 'withdraw']],
    ]);
  });

  it('takes back any decision until a closing counts the sale: a paid sale excluded by mistake is paid again', async () => {
    expect((await decide({ period: P1, sale: 'sale_on', outcome: 'exclude' })).statusCode).toBe(201);
    await team.recalculate(P1);
    expect(await salesOf(theo, P1)).toEqual([['sale_off', null]]);
    expect(await held(P1)).toContainEqual(['sale_on', null, 'exclude', ['withdraw']]);
    expect(team.refusal(await decide({ period: P1, sale: 'sale_on', outcome: 'count' }))).toEqual(
      expect.objectContaining({ code: 'pay_sale_outcome_conflict', details: { outcomes: ['withdraw'] } }),
    );

    const back = await decide({ period: P1, sale: 'sale_on', outcome: 'withdraw', note: 'Erreur de saisie' });
    expect(back.statusCode).toBe(201);
    expect(DecisionSchema.parse(back.json())).toEqual(
      expect.objectContaining({ revision: 2, outcome: 'withdraw' }),
    );
    await team.recalculate(P1);
    expect(await salesOf(theo, P1)).toEqual([
      ['sale_off', null],
      ['sale_on', null],
    ]);
    expect((await held(P1)).map(([id]) => id)).not.toContain('sale_on');
    expect(team.refusal(await decide({ period: P1, sale: 'sale_on', outcome: 'withdraw' }))).toEqual(
      expect.objectContaining({ code: 'pay_sale_outcome_conflict', details: { outcomes: ['exclude'] } }),
    );
  });

  it('keeps at its closing what it leaves held, and a decision after it counts the sale late in the first open period', async () => {
    expect((await team.validate(team.owner, theo, P1)).statusCode).toBe(200);
    const left = await team.test.admin.db
      .select()
      .from(schema.payPeriodHeldSales)
      .orderBy(schema.payPeriodHeldSales.platformSaleId);
    expect(left.map((one) => [one.platformSaleId, one.period, one.reason])).toEqual([
      ['sale_new', P1, 'chatter_unlinked'],
      ['sale_odd', P1, 'status_unknown'],
    ]);
    expect(await held(P1)).toEqual([]);
    expect(await held(P2)).toEqual([
      ['sale_new', 'chatter_unlinked', null, ['exclude']],
      ['sale_odd', 'status_unknown', null, ['count', 'exclude']],
    ]);

    expect((await decide({ period: P2, sale: 'sale_odd', outcome: 'count' })).statusCode).toBe(201);
    expect((await decide({ period: P2, sale: 'sale_new', outcome: 'exclude' })).statusCode).toBe(201);
    await team.recalculate(P2);
    expect(await salesOf(theo, P2)).toEqual([['sale_odd', P1]]);
    expect(await held(P2)).toEqual([
      ['sale_new', 'chatter_unlinked', 'exclude', ['withdraw']],
      ['sale_odd', 'status_unknown', 'count', ['exclude', 'withdraw']],
    ]);
  });

  it('lets an exclusion lapse on a new link, even after a closing that leaves the sale held again', async () => {
    // Linked to Léa three days ago: the exclusion was made on a chatter not linked, it lapses, and Léa was not on
    // shift. Older than the late lines' window, the link alone would not bring the sale back after a closing.
    const linked = new Date(Date.now() - 3 * 24 * 3_600_000);
    await team.test.admin.db.insert(schema.salesFeedChatters).values({
      platform: 'reveal',
      platformChatterId: 'chatter_new',
      kind: 'member',
      memberId: lea.id,
      linkVersionAt: linked,
      linkedAt: linked,
    });
    expect(await held(P2)).toEqual([
      ['sale_new', 'off_shift', null, ['count', 'exclude']],
      ['sale_odd', 'status_unknown', 'count', ['exclude', 'withdraw']],
    ]);

    // P2 closes without deciding again: the sale stays, and the first open period still shows it, the old exclusion
    // under the chatter not linked left aside.
    expect((await team.validate(team.owner, theo, P2)).statusCode).toBe(200);
    expect(await held(P2)).toEqual([]);
    expect(await held(P3)).toEqual([['sale_new', 'off_shift', null, ['count', 'exclude']]]);
    expect((await decide({ period: P3, sale: 'sale_new', outcome: 'count' })).statusCode).toBe(201);
    await team.recalculate(P3);
    expect(await salesOf(lea, P3)).toEqual([['sale_new', P1]]);
  });

  it('never decides a sale a closing counted, and keeps both tables added only', async () => {
    expect(team.refusal(await decide({ period: P2, sale: 'sale_on', outcome: 'exclude' })).code).toBe(
      'pay_sale_not_found',
    );
    const db = team.test.admin.db;
    const decision = (platformSaleId: string, revision: number, outcome = 'exclude') => ({
      id: newId(PaySaleDecisionIdSchema),
      platform: 'reveal',
      platformSaleId,
      revision,
      platformAccountId: team.annas,
      outcome,
      decidedBy: team.ownerId,
    });
    const refused = async (write: () => PromiseLike<unknown>, message: string) => {
      const cause = await refusalOf(write);
      expect(cause.code).toBe('23001');
      expect(cause.message).toContain(message);
    };
    await refused(
      () => db.insert(schema.paySaleDecisions).values(decision('sale_on', 3)),
      'pay keeps its past',
    );
    await refused(() => db.insert(schema.paySaleDecisions).values(decision('sale_odd', 3)), 'next number');
    await db
      .insert(schema.platformSales)
      .values(sale({ id: 'sale_late', at: '2025-06-02T09:00:00Z', chatter: 'chatter_theo', net: 500 }));
    await refused(
      () => db.insert(schema.paySaleDecisions).values(decision('sale_late', 1, 'withdraw')),
      'takes back a decision',
    );
    await refused(
      () =>
        db.insert(schema.payPeriodHeldSales).values({
          platform: 'reveal',
          platformSaleId: 'sale_on',
          event: 'sale',
          period: P1,
          platformAccountId: team.annas,
          reason: 'off_shift',
        }),
      'closing of its own transaction',
    );
    await refused(() => db.delete(schema.payPeriodHeldSales), 'pay keeps its past');
    await refused(() => db.delete(schema.paySaleDecisions), 'pay keeps its past');
  });
});

/**
 * A member who left, linked to his platform account after his departure (REC-PAIE-01, relecture Équipe de #695), and a
 * sale made after it (Charles, 11/11/2026): Marie and Jules leave on the 10th of May, in P1. A sale made on shift
 * before the departure goes on a final statement once the link exists, whether P1 is still open (a) or closed with the
 * sale left « chatteur non relié » (b). A sale made after the departure is never dismissed by itself: it waits « hors
 * poste » and, counted, goes on a final statement of its fortnight (c), with no payout minimum (ADR 0072 § 2). The
 * links are written as fixtures: `sales-feed-team.integration.test.ts` tests the route that writes them.
 */
describe('Équipe › Paie : les ventes d’un membre parti relié après son départ (REC-PAIE-01)', () => {
  const LEFT_ON = '2025-05-10';
  let team: PayrollTeam;
  let marie: TeamMember;
  let jules: TeamMember;
  /** The team's clock: the system's, unless a member leaves on a day already past. */
  let teamNow: Date | null = null;

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

  const shift = (member: TeamMember, from: string, to: string) => ({
    id: newId(ShiftIdSchema),
    creatorId: team.anna,
    platformAccountId: team.annas,
    memberId: member.id,
    startsAt: new Date(from),
    endsAt: new Date(to),
    createdBy: team.ownerId,
    updatedBy: team.ownerId,
  });

  /** Links the platform's account to the member now, as Équipe › Reveal does once he has left. */
  const link = async (chatter: string, member: TeamMember) => {
    const now = new Date();
    await team.test.admin.db.insert(schema.salesFeedChatters).values({
      platform: 'reveal',
      platformChatterId: chatter,
      kind: 'member',
      memberId: member.id,
      linkVersionAt: now,
      linkedAt: now,
    });
  };

  const held = async (period: string) => {
    const response = await team.call('GET', `/payroll/periods/${period}/held-sales`, team.owner);
    expect(response.statusCode).toBe(200);
    return HeldListSchema.parse(response.json()).sales.map((one) => [
      one.platformSaleId,
      one.memberLeftOn,
      one.reason,
      one.decision,
      one.outcomes,
    ]);
  };

  const salesOf = async (member: TeamMember, period: string) => {
    const statement = await team.statementOf(member, PayPeriodSchema.parse(period));
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
      .map((one) => [one.platformSaleId, one.lateFrom ?? null]);
  };

  /** His statement of `period` is final and pays its whole total, carrying nothing: its total, and the minimum. */
  const paidInFull = async (member: TeamMember, period: string) => {
    const statement = await team.statementOf(member, PayPeriodSchema.parse(period));
    const rules = FinalRulesSchema.parse(statement.rules);
    expect(rules.final).toBe(true);
    expect(statement.totalMinor).toBeGreaterThan(0);
    expect(statement).toMatchObject({ carryOverOutMinor: 0, payableMinor: statement.totalMinor });
    return { totalMinor: statement.totalMinor, minimumPayoutMinor: rules.minimumPayoutMinor };
  };

  /** A small sale on a final statement: paid although under the minimum (ADR 0072 § 2, ADR 0038). */
  const underTheMinimum = ({
    totalMinor,
    minimumPayoutMinor,
  }: {
    totalMinor: number;
    minimumPayoutMinor: number;
  }) => totalMinor < minimumPayoutMinor;

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'), { teamClock: () => teamNow ?? new Date() });
    ({ member: marie } = await team.addMember('marie@example.test', 'Marie'));
    ({ member: jules } = await team.addMember('jules@example.test', 'Jules'));
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
    await db
      .insert(schema.shifts)
      .values([
        shift(marie, '2025-05-05T08:00:00Z', '2025-05-05T12:00:00Z'),
        shift(jules, '2025-05-06T08:00:00Z', '2025-05-06T12:00:00Z'),
      ]);
    // Both accounts still to link; Marie's last sale is made after she left, in P2, with no shift of hers.
    await db
      .insert(schema.platformSales)
      .values([
        sale('sale_before_open', '2025-05-05T10:00:00Z', 'chatter_marie', 10_000),
        sale('sale_before_closed', '2025-05-06T10:00:00Z', 'chatter_jules', 500),
        sale('sale_after', '2025-05-20T10:00:00Z', 'chatter_marie', 500),
      ]);
    teamNow = new Date(`${LEFT_ON}T10:00:00Z`);
    try {
      for (const member of [marie, jules]) {
        const left = await team.call('PUT', `/team/members/${member.id}/status`, team.owner, {
          status: 'left',
        });
        expect(left.statusCode, left.body).toBe(200);
      }
    } finally {
      teamNow = null;
    }
  });

  afterAll(async () => {
    await team.close();
  });

  it('(a) counts on her final statement a sale made on shift before she left, once linked, while her fortnight is open', async () => {
    expect(await held(P1)).toEqual([
      ['sale_before_closed', null, 'chatter_unlinked', null, ['exclude']],
      ['sale_before_open', null, 'chatter_unlinked', null, ['exclude']],
    ]);
    await link('chatter_marie', marie);
    await team.recalculate(P1);
    expect(await salesOf(marie, P1)).toEqual([['sale_before_open', null]]);
    await paidInFull(marie, P1);
    expect(await held(P1)).toEqual([['sale_before_closed', null, 'chatter_unlinked', null, ['exclude']]]);
  });

  it('(b) counts on a final statement of the first open fortnight a sale the closing of his left « chatteur non relié »', async () => {
    expect((await team.validate(team.owner, marie, P1)).statusCode).toBe(200);
    expect(await team.closingOf(P1)).toBeDefined();
    const left = await team.test.admin.db.select().from(schema.payPeriodHeldSales);
    expect(left.map((one) => [one.platformSaleId, one.period, one.reason])).toEqual([
      ['sale_before_closed', P1, 'chatter_unlinked'],
    ]);

    // Linked after the closing: his shift of the closed P1 is read again, and the sale is his without a decision.
    await link('chatter_jules', jules);
    expect((await held(P2)).map(([id]) => id)).not.toContain('sale_before_closed');
    await team.recalculate(P2);
    expect(await salesOf(jules, P2)).toEqual([['sale_before_closed', P1]]);
    expect(underTheMinimum(await paidInFull(jules, P2))).toBe(true);
  });

  it('(c) never dismisses a sale made after she left: it waits « hors poste », and counted goes on a final statement of its fortnight', async () => {
    expect(await held(P2)).toEqual([['sale_after', LEFT_ON, 'off_shift', null, ['count', 'exclude']]]);
    await expect(team.statementOf(marie, P2)).rejects.toThrow('no statement');

    const counted = await team.call('POST', '/payroll/sale-decisions', team.owner, {
      id: newId(PaySaleDecisionIdSchema),
      period: P2,
      platform: 'reveal',
      platformSaleId: 'sale_after',
      outcome: 'count',
      note: null,
    });
    expect(counted.statusCode, counted.body).toBe(201);
    await team.recalculate(P2);
    expect(await salesOf(marie, P2)).toEqual([['sale_after', null]]);
    expect(underTheMinimum(await paidInFull(marie, P2))).toBe(true);
  });
});
