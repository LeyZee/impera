import {
  BonusTierSetIdSchema,
  BonusTierSetSchema,
  calendarDayAt,
  CollectiveGoalIdSchema,
  CollectiveGoalSchema,
  collectiveGoalWindow,
  ExchangeRatesSchema,
  newId,
  nextPayPeriod,
  payPeriodOfDay,
  PayoutMinimumIdSchema,
  PayoutMinimumSchema,
  PayPeriodSchema,
  PayrollPeriodSchema,
  PayrollSettingsSchema,
  type PayPeriod,
  type TeamMember,
} from '@nirvana/contracts';
import { eq, schema } from '@nirvana/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

/** Periods of 2025: they have ended. */
const R0 = PayPeriodSchema.parse('2025-08-16');
const R1 = PayPeriodSchema.parse('2025-09-01');
const R2 = PayPeriodSchema.parse('2025-09-16');

const BRONZE = { thresholdMinor: 5_000, bonusMinor: 3_000, label: 'Bronze' };
const GOAL_TIERS = [{ reachedBps: 5_000, bonusMinor: 1_000 }];

describe('Équipe › Paie : paliers, objectif collectif, minimum et délai de versement, taux (EQ-04, PAIE-22, PAIE-32)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;
  let lea: TeamMember;
  let mona: TeamMember;
  let theoCookie: string;
  let monaCookie: string;

  const post = (url: string, cookie: string, payload: object) => team.call('POST', url, cookie, payload);
  const tiers = (fromPeriod: PayPeriod, list: readonly object[] = [BRONZE]) => ({
    id: newId(BonusTierSetIdSchema),
    fromPeriod,
    tiers: list,
  });
  const goal = (period: PayPeriod) => ({
    id: newId(CollectiveGoalIdSchema),
    period,
    targetMinor: 10_000,
    tiers: GOAL_TIERS,
  });
  const minimumFrom = (fromPeriod: PayPeriod, minimumPayoutMinor: number) => ({
    id: newId(PayoutMinimumIdSchema),
    fromPeriod,
    minimumPayoutMinor,
  });
  const refused = async (response: Promise<{ json: () => unknown }>) => team.refusal(await response);
  /** Today in the agency's zone, as the server reads it. */
  const today = () => calendarDayAt(new Date(), 'Europe/Paris');
  const current = () => payPeriodOfDay(today());
  const settings = async (cookie: string) =>
    PayrollSettingsSchema.parse((await team.call('GET', '/payroll/settings', cookie)).json());
  /** A rule set before the fortnight it starts with, as the owner could: written as the owner, past the API's date. */
  const recordedBefore = {
    tiers: (fromPeriod: PayPeriod, list: readonly object[] = [BRONZE]) =>
      team.test.admin.db
        .insert(schema.bonusTierSets)
        .values({ ...tiers(fromPeriod, list), createdBy: team.ownerId }),
    goal: (period: PayPeriod) =>
      team.test.admin.db.insert(schema.collectiveGoals).values({ ...goal(period), createdBy: team.ownerId }),
    minimum: (fromPeriod: PayPeriod, minimumPayoutMinor: number) =>
      team.test.admin.db
        .insert(schema.payoutMinimums)
        .values({ ...minimumFrom(fromPeriod, minimumPayoutMinor), createdBy: team.ownerId }),
  };

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'));
    ({ member: theo, cookie: theoCookie } = await team.addMember('theo@example.test', 'Théo'));
    ({ member: lea } = await team.addMember('lea@example.test', 'Léa'));
    ({ member: mona, cookie: monaCookie } = await team.addMember('mona@example.test', 'Mona', 'manager'));
  });

  afterAll(() => team.close());

  it('lets the owner alone set the team’s rules, anyone in the team read the settings, the agency the rate', async () => {
    expect(await settings(theoCookie)).toEqual({
      minimumPayoutMinor: 1_500,
      nextMinimum: null,
      payoutDelayBusinessDays: null,
    });
    const none = await team.call('GET', '/payroll/exchange-rates', team.owner);
    expect([none.statusCode, none.json()]).toEqual([200, { usd: null }]);
    await team.test.admin.db.insert(schema.exchangeRates).values(
      ['2025-09-30', '2025-10-01'].map((day, index) => ({
        currency: 'USD',
        day,
        rateMicros: 920_000 + index,
        source: 'Banque centrale européenne',
        fetchedAt: new Date(`${day}T15:00:00Z`),
      })),
    );
    const latest = ExchangeRatesSchema.parse(
      (await team.call('GET', '/payroll/exchange-rates', monaCookie)).json(),
    );
    expect(latest.usd).toMatchObject({ currency: 'USD', day: '2025-10-01', rateMicros: 920_001 });
    // A chatter reads the rate of their own statement's lines, never the latest one; nor does a manager on leave.
    const { member: nina, cookie: ninaCookie } = await team.addMember('nina@example.test', 'Nina', 'manager');
    await team.test.admin.db
      .update(schema.teamMembers)
      .set({ status: 'on_leave' })
      .where(eq(schema.teamMembers.id, nina.id));
    for (const cookie of [theoCookie, ninaCookie]) {
      const refusal = await team.call('GET', '/payroll/exchange-rates', cookie);
      expect([refusal.statusCode, team.refusal(refusal).code]).toEqual([403, 'payroll_forbidden']);
    }

    const ahead = nextPayPeriod(current());
    for (const cookie of [monaCookie, theoCookie]) {
      expect(await refused(post('/payroll/bonus-tiers', cookie, tiers(ahead)))).toMatchObject({
        code: 'payroll_forbidden',
      });
      expect(await refused(post('/payroll/collective-goals', cookie, goal(ahead)))).toMatchObject({
        code: 'payroll_forbidden',
      });
      expect(await refused(post('/payroll/payout-minimums', cookie, minimumFrom(ahead, 0)))).toMatchObject({
        code: 'payroll_forbidden',
      });
      const put = await team.call('PUT', '/payroll/settings', cookie, { payoutDelayBusinessDays: 3 });
      expect(team.refusal(put).code).toBe('payroll_forbidden');
    }
    expect(await team.test.admin.db.select().from(schema.bonusTierSets)).toEqual([]);
    expect(await team.test.admin.db.select().from(schema.collectiveGoals)).toEqual([]);
    expect(await team.test.admin.db.select().from(schema.payoutMinimums)).toEqual([]);
    expect(await team.test.admin.db.select().from(schema.payrollSettings)).toEqual([]);
  });

  it('refuses tiers and a minimum from a period that has begun, and a goal past its 3rd day (PAIE-22)', async () => {
    for (const period of [R0, R1]) {
      expect(await refused(post('/payroll/bonus-tiers', team.owner, tiers(period)))).toEqual(
        expect.objectContaining({ code: 'pay_rule_started_invalid', details: { period } }),
      );
      expect(await refused(post('/payroll/payout-minimums', team.owner, minimumFrom(period, 0)))).toEqual(
        expect.objectContaining({ code: 'pay_rule_started_invalid', details: { period } }),
      );
      expect(await refused(post('/payroll/collective-goals', team.owner, goal(period)))).toEqual(
        expect.objectContaining({ code: 'collective_goal_late_invalid', details: { period } }),
      );
    }
    expect(await team.test.admin.db.select().from(schema.bonusTierSets)).toEqual([]);
    expect(await team.test.admin.db.select().from(schema.payoutMinimums)).toEqual([]);

    // Today's period: tiers only on its first day, as a rate; its goal until its 3rd day.
    const now = current();
    const tiersNow = await post('/payroll/bonus-tiers', team.owner, tiers(now, []));
    expect(tiersNow.statusCode, tiersNow.body).toBe(today() === now ? 201 : 400);
    const goalNow = await post('/payroll/collective-goals', team.owner, goal(now));
    expect(goalNow.statusCode, goalNow.body).toBe(
      collectiveGoalWindow(now, today()) === 'started' ? 201 : 400,
    );
  });

  it('sets tiers from a period not begun, gives a retry back, and refuses the same id with other tiers', async () => {
    const ahead = nextPayPeriod(current());
    const sent = tiers(ahead);
    const created = await post('/payroll/bonus-tiers', team.owner, sent);
    expect(created.statusCode, created.body).toBe(201);
    const set = BonusTierSetSchema.parse(created.json());
    expect(set).toMatchObject({ id: sent.id, fromPeriod: ahead, tiers: [BRONZE], createdBy: team.ownerId });
    expect(await team.audited('bonus_tier_set.create')).toBeGreaterThanOrEqual(1);
    // No draft of a period worked is touched.
    expect(await team.jobsFor(R1)).toEqual([]);

    // The same tiers, their keys in another order: a retry, given back as recorded.
    const retried = await post('/payroll/bonus-tiers', team.owner, {
      tiers: [{ label: 'Bronze', bonusMinor: 3_000, thresholdMinor: 5_000 }],
      fromPeriod: ahead,
      id: sent.id,
    });
    expect([retried.statusCode, retried.json()]).toEqual([200, created.json()]);
    for (const other of [
      { ...sent, tiers: [{ ...BRONZE, bonusMinor: 3_001 }] },
      { ...sent, tiers: [] },
      { ...sent, fromPeriod: nextPayPeriod(ahead) },
    ]) {
      expect(await refused(post('/payroll/bonus-tiers', team.owner, other))).toMatchObject({
        code: 'bonus_tier_set_conflict',
      });
    }
  });

  it('pays tiers set before their fortnight, and the database refuses any rule on a period validated', async () => {
    await team.report(theo, R1, 10_000);
    await team.report(lea, R1, 1_000);
    await recordedBefore.tiers(R1);
    await team.recalculate(R1);
    const statement = await team.statementOf(theo, R1);
    expect(statement.tierBonus).toEqual(BRONZE);
    expect(statement.totalMinor).toBe(1_600 + 3_000);
    const view = PayrollPeriodSchema.parse(
      (await team.call('GET', `/payroll/periods/${R1}`, theoCookie)).json(),
    );
    expect(view.bonusTiers?.fromPeriod).toBe(R1);
    expect(view.settings).toEqual({
      minimumPayoutMinor: 1_500,
      nextMinimum: null,
      payoutDelayBusinessDays: null,
    });

    expect((await team.validate(team.owner, theo, R1)).statusCode).toBe(200);
    // Léa's statement of the period is still a draft: the team's rules of the period are settled all the same.
    expect((await team.statementOf(lea, R1)).status).toBe('draft');
    for (const write of [
      () => recordedBefore.tiers(R1),
      () => recordedBefore.goal(R1),
      () => recordedBefore.minimum(R1, 0),
      () => recordedBefore.minimum(R0, 0),
    ]) {
      await expect(write()).rejects.toMatchObject({ cause: { code: '23001' } });
    }
  });

  it('pays the goal of a period to each chatter, sales or not, and takes one ahead without touching any draft', async () => {
    await team.report(theo, R2, 10_000);
    await recordedBefore.goal(R2);
    await team.recalculate(R2);
    // The team made 8 000 of 10 000: the 50 % tier, for Théo and for Léa who sold nothing; never for Mona.
    expect((await team.statementOf(theo, R2)).collectiveBonusMinor).toBe(1_000);
    expect((await team.statementOf(lea, R2)).collectiveBonusMinor).toBe(1_000);
    await expect(team.statementOf(mona, R2)).rejects.toThrow('no statement');

    const ahead = nextPayPeriod(current());
    const sent = goal(ahead);
    const created = await post('/payroll/collective-goals', team.owner, sent);
    expect(created.statusCode, created.body).toBe(201);
    expect(CollectiveGoalSchema.parse(created.json())).toMatchObject({ period: ahead, targetMinor: 10_000 });
    expect(await team.jobsFor(ahead)).toEqual([]);
    const retried = await post('/payroll/collective-goals', team.owner, sent);
    expect([retried.statusCode, retried.json()]).toEqual([200, created.json()]);
    expect(
      await refused(post('/payroll/collective-goals', team.owner, { ...sent, targetMinor: 10_001 })),
    ).toMatchObject({ code: 'collective_goal_conflict' });
  });

  it('sets a minimum from a period not begun: the drafts already worked keep theirs (PAIE-22)', async () => {
    for (const period of [R1, R2]) await team.forgetJobs(period);
    const ahead = nextPayPeriod(current());
    // The minimum waits for a validation: the period's drafts are computed with one minimum, never half of each.
    const lock = await team.holding(['payroll.close']);
    const sent = minimumFrom(ahead, 50_000);
    let posted: ReturnType<typeof post> | undefined;
    try {
      posted = post('/payroll/payout-minimums', team.owner, sent);
      await team.until(async () => (await team.waiting()) === 1);
    } finally {
      await lock.release();
    }
    const created = await posted;
    expect(created.statusCode, created.body).toBe(201);
    expect(PayoutMinimumSchema.parse(created.json())).toMatchObject({
      fromPeriod: ahead,
      minimumPayoutMinor: 50_000,
      createdBy: team.ownerId,
    });
    expect(await team.audited('payout_minimum.create')).toBe(1);
    expect(await settings(theoCookie)).toEqual({
      minimumPayoutMinor: 1_500,
      nextMinimum: { fromPeriod: ahead, minimumPayoutMinor: 50_000 },
      payoutDelayBusinessDays: null,
    });
    expect(await team.jobsFor(R1)).toEqual([]);
    expect(await team.jobsFor(R2)).toEqual([]);
    const retried = await post('/payroll/payout-minimums', team.owner, sent);
    expect([retried.statusCode, retried.json()]).toEqual([200, created.json()]);
    expect(
      await refused(post('/payroll/payout-minimums', team.owner, { ...sent, minimumPayoutMinor: 49_999 })),
    ).toMatchObject({ code: 'payout_minimum_conflict' });
    const negative = await post('/payroll/payout-minimums', team.owner, minimumFrom(ahead, -1));
    expect(negative.statusCode).toBe(400);

    // A minimum dated from R2 (set before it began) counts in R2's drafts, and the newest of a period wins.
    await recordedBefore.minimum(R2, 50_000);
    await team.recalculate(R2);
    const carried = await team.statementOf(theo, R2);
    expect(carried.carryOverOutMinor).toBe(carried.totalMinor);
    expect(carried.payableMinor).toBe(0);
    await recordedBefore.minimum(R2, 1_500);
    await team.recalculate(R2);
    expect((await team.statementOf(theo, R2)).payableMinor).toBeGreaterThan(0);
  });

  it('keeps the payout delay as a setting the whole team reads, never in the code (PAIE-32)', async () => {
    const put = await team.call('PUT', '/payroll/settings', team.owner, { payoutDelayBusinessDays: 3 });
    expect([put.statusCode, put.json()]).toMatchObject([200, { payoutDelayBusinessDays: 3 }]);
    expect((await settings(theoCookie)).payoutDelayBusinessDays).toBe(3);
    expect(await team.audited('payroll_settings.update')).toBe(1);
    const same = await team.call('PUT', '/payroll/settings', team.owner, { payoutDelayBusinessDays: 3 });
    expect(same.statusCode).toBe(200);
    expect(await team.audited('payroll_settings.update')).toBe(1);
    for (const wrong of [0, 31, 2.5]) {
      const refusal = await team.call('PUT', '/payroll/settings', team.owner, {
        payoutDelayBusinessDays: wrong,
      });
      expect(refusal.statusCode).toBe(400);
    }
    // The delay changes no statement: the single minimum stays, and nothing is recalculated.
    expect(await team.jobsFor(R2)).toEqual([]);
    const [row] = await team.test.admin.db.select().from(schema.payrollSettings);
    expect(row).toMatchObject({ minimumPayoutMinor: 1_500, payoutDelayBusinessDays: 3 });
    const off = await team.call('PUT', '/payroll/settings', team.owner, { payoutDelayBusinessDays: null });
    expect([off.statusCode, off.json()]).toMatchObject([200, { payoutDelayBusinessDays: null }]);
  });

  it('refuses the validation of a statement computed before new tiers, then validates it computed again', async () => {
    const stale = await team.statementOf(theo, R2);
    const raised = { ...BRONZE, bonusMinor: 4_000, label: 'Bronze renforcé' };
    await recordedBefore.tiers(R2, [raised]);
    expect(team.refusal(await team.validate(team.owner, theo, R2)).code).toBe(
      'commission_statement_changed_conflict',
    );
    expect((await team.statementOf(theo, R2)).revision).toBe(stale.revision);

    await team.recalculate(R2);
    expect((await team.validate(team.owner, theo, R2)).statusCode).toBe(200);
    expect((await team.statementOf(theo, R2)).tierBonus).toEqual(raised);
  });
});
