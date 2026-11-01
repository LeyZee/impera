import {
  AccountPayRulesIdSchema,
  newId,
  PayPeriodSchema,
  PlatformAccountIdSchema,
  type PlatformAccountId,
  type TeamMember,
} from '@nirvana/contracts';
import { schema } from '@nirvana/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

/** The second half of March 2025: it ends on Monday the 31st, a day the ECB may publish nothing. */
const Q = PayPeriodSchema.parse('2025-03-16');

describe('Équipe › Paie : le taux qu’une clôture fige (EQ-04, ADR 0032 et 0033)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;
  let dollars: PlatformAccountId;

  const rateOn = (day: string, rateMicros: number) =>
    team.test.admin.db.insert(schema.exchangeRates).values({
      currency: 'USD',
      day,
      rateMicros,
      source: 'BCE, taux de référence',
      fetchedAt: new Date(`${day}T15:07:00Z`),
    });

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'));
    ({ member: theo } = await team.addMember('theo@example.test', 'Théo'));
    dollars = newId(PlatformAccountIdSchema);
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
    await team.report(theo, Q, 10_000, { account: dollars, currency: 'USD' });
  });

  afterAll(() => team.close());

  it('computes no statement without a rate, never a guessed one', async () => {
    await team.recalculate(Q);
    await expect(team.statementOf(theo, Q)).rejects.toThrow('no statement');
  });

  it('refuses to close on a rate five days before the period’s end, and closes on one four days before', async () => {
    // A job stopped since Wednesday the 26th: the draft computes on that rate, the closing refuses it.
    await rateOn('2025-03-26', 930_000);
    await team.recalculate(Q);
    const refused = await team.validate(team.owner, theo, Q);
    expect(team.refusal(refused)).toEqual(
      expect.objectContaining({ code: 'exchange_rate_missing_conflict', details: { currency: 'USD' } }),
    );
    expect(await team.closingOf(Q)).toBeUndefined();

    // Thursday's rate, the last one before a long Easter weekend: four days, the closing takes it.
    await rateOn('2025-03-27', 920_000);
    await team.recalculate(Q);
    const validated = await team.validate(team.owner, theo, Q);
    expect(validated.statusCode, validated.body).toBe(200);
    const closing = await team.closingOf(Q);
    expect(
      z.array(z.object({ day: z.string(), rateMicros: z.number() })).parse(closing?.exchangeRates),
    ).toEqual([expect.objectContaining({ day: '2025-03-27', rateMicros: 920_000 })]);
    // 100 $ at 0.92: 92 €, less the platform's 20 %: 73.60 €.
    expect((await team.statementOf(theo, Q)).netMinor).toBe(7_360);
  });

  it('keeps the closing’s rate once a later one is read', async () => {
    await rateOn('2025-04-01', 910_000);
    const [outcome] = await team.recalculate(Q);
    expect(outcome).toMatchObject({ period: Q, outcome: 'unchanged' });
    const rates = await team.call('GET', '/payroll/exchange-rates', team.owner);
    expect(rates.json()).toMatchObject({ usd: { day: '2025-04-01', rateMicros: 910_000 } });
  });
});
