import {
  AccountPayRulesIdSchema,
  newId,
  PayPeriodSchema,
  PayrollPeriodSchema,
  SalesLineIdSchema,
  ShiftIdSchema,
  type PlatformAccountId,
  type TeamMember,
} from '@impera/contracts';
import { and, eq, schema, sql } from '@impera/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createLogger } from '../logger';
import { enqueuePayoutCertificateLock } from '../modules/contractors';
import { invoicesAfterValidation, payoutGate } from '../modules/invoicing';
import { createPayrollModule } from '../modules/payroll';
import { buildServer } from '../server';
import { payInputReadsOf } from '../wiring/payroll';

import { testConfig } from './support/config';
import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

// Everything below is invented (ADR 0010). Periods of 2025: they have ended.
const P0 = PayPeriodSchema.parse('2025-04-16');
const P1 = PayPeriodSchema.parse('2025-05-01');
const P2 = PayPeriodSchema.parse('2025-05-16');
const quiet = { warn: () => undefined, error: () => undefined };
const CauseSchema = z.object({ cause: z.object({ code: z.string(), message: z.string() }) });

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
 * The platform's sales in pay (CRM-03 lot b2, ADR 0050 §§ 5, 7 and 8, ADR 0032): Anna's account is paid on the
 * platform's net from P0 on. The rules are written here as a fixture: the API still refuses `detected` until the
 * switch's guard (CRM-03), which this test does not go around in production code.
 */
describe('Équipe › Paie : les ventes de la plateforme comptées sur leur net (CRM-03)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;
  let lea: TeamMember;
  let firstLink: string;

  const sale = (values: {
    readonly id: string;
    readonly event?: 'sale' | 'refund';
    readonly at: string;
    readonly chatter: string | null;
    readonly net: number;
    readonly recorded?: Date;
    readonly account?: PlatformAccountId;
  }) => {
    const account = values.account ?? team.annas;
    return {
      id: newId(SalesLineIdSchema),
      creatorId: account === team.annas ? team.anna : team.bea,
      platformAccountId: account,
      platform: 'reveal',
      platformSaleId: values.id,
      event: values.event ?? 'sale',
      saleType: 'ppv',
      status: values.event === 'refund' ? 'refunded' : 'paid',
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
      position: `${values.id}:${values.event ?? 'sale'}`,
      inputsHash: 'hash_test',
      recordedAt: values.recorded ?? new Date(values.at),
    };
  };

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

  const registryOf = (period: string) =>
    team.test.admin.db
      .select()
      .from(schema.payPeriodSales)
      .where(eq(schema.payPeriodSales.period, period))
      .orderBy(schema.payPeriodSales.platformSaleId, schema.payPeriodSales.event);

  const linesOf = async (member: TeamMember, period: string) => {
    const statement = await team.statementOf(member, PayPeriodSchema.parse(period));
    return team.test.admin.db
      .select()
      .from(schema.commissionStatementLines)
      .where(
        and(
          eq(schema.commissionStatementLines.statementId, statement.id),
          eq(schema.commissionStatementLines.revision, statement.revision),
        ),
      );
  };

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'));
    ({ member: theo } = await team.addMember('theo@example.test', 'Théo'));
    ({ member: lea } = await team.addMember('lea@example.test', 'Léa'));
    const db = team.test.admin.db;
    await db.insert(schema.accountPayRules).values({
      id: newId(AccountPayRulesIdSchema),
      creatorId: team.anna,
      platformAccountId: team.annas,
      fromPeriod: P0,
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
        platformChatterId: 'chatter_bot',
        kind: 'agent',
        linkVersionAt: linked,
        linkedAt: linked,
      },
    ]);
    const [link] = await db
      .select({ version: schema.salesFeedChatters.linkVersion })
      .from(schema.salesFeedChatters)
      .where(eq(schema.salesFeedChatters.platformChatterId, 'chatter_theo'));
    firstLink = link?.version ?? '';
    await db
      .insert(schema.shifts)
      .values([
        shift(theo, '2025-04-20T08:00:00Z', '2025-04-20T12:00:00Z'),
        shift(theo, '2025-05-05T08:00:00Z', '2025-05-05T12:00:00Z'),
      ]);
    await db.insert(schema.platformSales).values([
      // On shift in P0, then in P1: Théo's.
      sale({ id: 'sale_p0', at: '2025-04-20T10:00:00Z', chatter: 'chatter_theo', net: 4_000 }),
      sale({ id: 'sale_p1', at: '2025-05-05T10:00:00Z', chatter: 'chatter_theo', net: 10_000 }),
      // The agent's: nobody's. Off shift: held for the validator (lot b3).
      sale({ id: 'sale_bot', at: '2025-05-05T11:00:00Z', chatter: 'chatter_bot', net: 5_000 }),
      sale({ id: 'sale_off', at: '2025-05-07T20:00:00Z', chatter: 'chatter_theo', net: 3_000 }),
    ]);
  });

  afterAll(async () => {
    await team.close();
  });

  it('counts a sale on shift on its net, and an earlier one waiting stops the first closing', async () => {
    await team.recalculate(P1);
    const [line] = await linesOf(theo, P1);
    expect(line).toMatchObject({
      platformAccountId: team.annas,
      base: 'platform_net',
      vatBps: 0,
      platformFeeBps: 0,
      grossMinor: 10_000,
      netMinor: 10_000,
      commissionMinor: 2_000,
      shiftReportIds: [],
      sales: [
        {
          platform: 'reveal',
          platformSaleId: 'sale_p1',
          event: 'sale',
          netMinor: 10_000,
          linkVersion: firstLink,
        },
      ],
    });
    // P0's sale waits: the team's first closing begins there, and the hourly job computes from there.
    expect(team.refusal(await team.validate(team.owner, theo, P1))).toEqual(
      expect.objectContaining({ code: 'pay_period_order_conflict', details: { period: P0 } }),
    );
    const outcomes = await team.app.modules.payroll.jobs.recalculateOpen(quiet);
    expect(outcomes[0]?.period).toBe(P0);
    expect((await team.validate(team.owner, theo, P0)).statusCode).toBe(200);
    expect((await registryOf(P0)).map((one) => [one.platformSaleId, one.memberId, one.netMinor])).toEqual([
      ['sale_p0', theo.id, 4_000],
    ]);
  });

  it('refuses the closing when the validator cannot read every sale it counts', async () => {
    await team.recalculate(P1);
    // A pay module that reads Béa only, as a validator who does not follow Anna would.
    const blind = createPayrollModule({
      db: team.app.db.db,
      adminDb: team.app.adminDb.db,
      reads: { ...payInputReadsOf(team.app.modules), creatorIds: () => Promise.resolve([team.bea]) },
      shiftFacts: team.app.modules.scheduling.pay.shiftFacts,
      rateJobSince: null,
      payouts: payoutGate,
      afterValidation: { ...invoicesAfterValidation, lockPayoutCertificate: enqueuePayoutCertificateLock },
    });
    const config = testConfig({ DATABASE_URL: team.test.appUrl, DATABASE_ADMIN_URL: team.test.adminUrl });
    const blindServer = await buildServer({
      config,
      logger: createLogger(config),
      routes: [blind.routes(team.app.requireRole)],
      readiness: team.app.readiness,
    });
    try {
      // Théo's sale on shift, and the one off shift the closing would keep held (lot b3): it must read both.
      expect(team.refusal(await team.validate(team.owner, theo, P1, blindServer))).toEqual(
        expect.objectContaining({ code: 'pay_period_sales_unread_conflict', details: { count: 2 } }),
      );
    } finally {
      await blindServer.close();
    }
    expect(await team.closingOf(P1)).toBeUndefined();
  });

  it('registers the sales a closing counts, which a closed period counts again without the register', async () => {
    expect((await team.validate(team.owner, theo, P1)).statusCode).toBe(200);
    expect(
      (await registryOf(P1)).map((one) => [
        one.platformSaleId,
        one.event,
        one.memberId,
        one.netMinor,
        one.linkVersion,
      ]),
    ).toEqual([['sale_p1', 'sale', theo.id, 10_000, firstLink]]);
    const validated = await team.statementOf(theo, P1);

    // The chatter linked elsewhere after the closing: the closed period keeps its member and the link's version.
    await team.test.admin.db
      .update(schema.salesFeedChatters)
      .set({ memberId: lea.id, linkVersion: sql`gen_random_uuid()`, linkVersionAt: new Date() })
      .where(eq(schema.salesFeedChatters.platformChatterId, 'chatter_theo'));
    await team.recalculate(P1);
    expect(await team.statementOf(theo, P1)).toMatchObject({
      revision: validated.revision,
      inputsHash: validated.inputsHash,
      status: 'validated',
    });
  });

  it('takes a late refund off the member its sale paid, in the first open period, and never pays a sale twice', async () => {
    await team.test.admin.db.insert(schema.platformSales).values(
      sale({
        id: 'sale_p1',
        event: 'refund',
        at: '2025-05-20T09:00:00Z',
        chatter: 'chatter_theo',
        net: 10_000,
        recorded: new Date(),
      }),
    );
    await team.recalculate(P2);
    const [line] = await linesOf(theo, P2);
    expect(line).toMatchObject({
      base: 'platform_net',
      grossMinor: -10_000,
      commissionMinor: -2_000,
      sales: [
        {
          platform: 'reveal',
          platformSaleId: 'sale_p1',
          event: 'refund',
          netMinor: -10_000,
          linkVersion: firstLink,
          lateFrom: P1,
        },
      ],
    });
    // Linked to Léa since, the sale P1 counted is read again late, and is not hers: the registry has it.
    await expect(team.statementOf(lea, P2)).rejects.toThrow('no statement');
    // The period as Paie reads it (lot b4): the line says its base and what it counted, never a sale's identifier;
    // the late refund is no pace of P2.
    const read = await team.call('GET', `/payroll/periods/${P2}`, team.owner);
    expect(read.statusCode).toBe(200);
    const period = PayrollPeriodSchema.parse(read.json());
    const [mine] = period.statements.filter((one) => one.memberId === theo.id).flatMap((one) => one.lines);
    expect(mine).toMatchObject({
      base: 'platform_net',
      grossMinor: -10_000,
      countedSales: { sales: 0, refunds: 1, late: 1, lateNetMinor: -10_000 },
    });
    expect(JSON.stringify(read.json())).not.toContain('sale_p1');
    expect(period.pace.lateNetMinor).toBe(-10_000);
  });

  it('keeps the registry added only, written by the closing of its own transaction, with the register’s net', async () => {
    const db = team.test.admin.db;
    const counted = (netMinor: number) => ({
      platform: 'reveal',
      platformSaleId: 'sale_off',
      event: 'sale',
      period: P2,
      memberId: theo.id,
      linkVersion: firstLink,
      platformAccountId: team.annas,
      currency: 'EUR',
      netMinor,
      salePeriod: P1,
    });
    const refused = async (write: () => PromiseLike<unknown>, message: string) => {
      const cause = await refusalOf(write);
      expect(cause.code).toBe('23001');
      expect(cause.message).toContain(message);
    };
    await refused(
      () => db.insert(schema.payPeriodSales).values(counted(3_000)),
      'closing of its own transaction',
    );
    // In a closing's transaction (rolled back), a net that is not the register's is refused.
    await refused(
      () =>
        db.transaction(async (tx) => {
          await tx.insert(schema.payPeriodClosings).values({
            period: P2,
            teamNetMinor: 0,
            collective: null,
            exchangeRates: [],
            closedBy: team.ownerId,
          });
          await tx.insert(schema.payPeriodSales).values(counted(2_999));
        }),
      'a line of the register',
    );
    await refused(
      () => db.delete(schema.payPeriodSales).where(eq(schema.payPeriodSales.period, P0)),
      'pay keeps its past',
    );
    expect(await registryOf(P0)).toHaveLength(1);
    expect(await team.closingOf(P2)).toBeUndefined();
  });
});
