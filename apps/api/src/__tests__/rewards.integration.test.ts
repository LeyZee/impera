import {
  AccountPayRulesIdSchema,
  newId,
  PayPeriodSchema,
  RewardGainIdSchema,
  SalesLineIdSchema,
  ShiftIdSchema,
  ShiftReportIdSchema,
  TrophyCaseSchema,
  type TeamMember,
  type TrophyCase,
} from '@impera/contracts';
import { schema, withMember } from '@impera/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

// Everything below is invented (ADR 0010). A period of 2025: it has ended.
const P1 = PayPeriodSchema.parse('2025-05-01');
const HOUR = 3_600_000;

/**
 * The chatter's game (ADR 0104 § 12 to § 20, CHF-01): the job notes what each chatter earned from their own
 * statements and reports, once; each reads their own case and marks their own reveals; nothing of it reaches pay.
 * Théo sold twice on Anna's account and reported late; Léa held five shifts with their report on time, around one
 * the agency cancelled, and sold nothing.
 */
describe('Jeu du chatteur : gains notés une fois, chacun sa vitrine (ADR 0104)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;
  let lea: TeamMember;
  let theoCookie: string;
  let leaCookie: string;

  const caseOf = async (cookie: string): Promise<TrophyCase> => {
    const response = await team.call('GET', '/rewards/my-trophy-case', cookie);
    expect(response.statusCode, response.body).toBe(200);
    return TrophyCaseSchema.parse(response.json());
  };
  const earned = (trophyCase: TrophyCase) =>
    trophyCase.items.filter((item) => item.earnedAt !== null).map((item) => item.kind);
  const evaluate = () => team.app.modules.rewards.jobs.evaluate();

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'));
    ({ member: theo, cookie: theoCookie } = await team.addMember('theo@example.test', 'Théo'));
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
    // Théo's shift: his own report came twenty hours after its end, so it is late and his streak is zero. The agency
    // then corrected it; the correction's date is forced before his report, to prove that a line written by the
    // agency never counts as the report handed in (§ 13).
    const theosShift = newId(ShiftIdSchema);
    await db.insert(schema.shifts).values({
      id: theosShift,
      creatorId: team.anna,
      platformAccountId: team.annas,
      memberId: theo.id,
      startsAt: new Date('2025-05-05T08:00:00Z'),
      endsAt: new Date('2025-05-05T12:00:00Z'),
      createdBy: team.ownerId,
      updatedBy: team.ownerId,
    });
    const theosEnd = new Date('2025-05-05T12:00:00Z');
    const theosReport = newId(ShiftReportIdSchema);
    const late = new Date(theosEnd.getTime() + 20 * HOUR);
    const corrected = new Date(theosEnd.getTime() + HOUR);
    await db.insert(schema.shiftReports).values({
      id: theosReport,
      creatorId: team.anna,
      platformAccountId: team.annas,
      shiftId: theosShift,
      memberId: theo.id,
      period: P1,
      amountMinor: 0,
      currency: 'EUR',
      status: 'submitted',
      submittedBy: theo.userId,
      submittedAt: late,
      createdBy: theo.userId,
      createdAt: late,
    });
    await db.insert(schema.shiftReports).values({
      id: newId(ShiftReportIdSchema),
      creatorId: team.anna,
      platformAccountId: team.annas,
      shiftId: theosShift,
      memberId: theo.id,
      period: P1,
      correctsId: theosReport,
      amountMinor: 100,
      currency: 'EUR',
      status: 'validated',
      byAgency: true,
      submittedBy: team.ownerId,
      submittedAt: corrected,
      reviewedBy: team.ownerId,
      reviewedAt: corrected,
      createdBy: team.ownerId,
      createdAt: corrected,
    });
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
    await db
      .insert(schema.platformSales)
      .values([sale('sale_a', '2025-05-05T10:00:00Z', 4_000), sale('sale_b', '2025-05-05T11:00:00Z', 2_500)]);
    // Léa: five shifts on Béa's account, each with its report handed in an hour after its end.
    for (const day of ['02', '03', '04', '05', '06']) {
      const shiftId = newId(ShiftIdSchema);
      const startsAt = new Date(`2025-05-${day}T14:00:00Z`);
      const endsAt = new Date(startsAt.getTime() + 4 * HOUR);
      const reportedAt = new Date(endsAt.getTime() + HOUR);
      await db.insert(schema.shifts).values({
        id: shiftId,
        creatorId: team.bea,
        platformAccountId: team.beas,
        memberId: lea.id,
        startsAt,
        endsAt,
        createdBy: team.ownerId,
        updatedBy: team.ownerId,
      });
      await db.insert(schema.shiftReports).values({
        id: newId(ShiftReportIdSchema),
        creatorId: team.bea,
        platformAccountId: team.beas,
        shiftId,
        memberId: lea.id,
        period: P1,
        amountMinor: 0,
        currency: 'EUR',
        status: 'submitted',
        submittedBy: lea.userId,
        submittedAt: reportedAt,
        createdBy: lea.userId,
        createdAt: reportedAt,
      });
    }
    // A shift of Léa's the agency cancelled, in the middle of her five and without a report: it was not hers to hold,
    // so it does not break her streak (§ 13).
    await db.insert(schema.shifts).values({
      id: newId(ShiftIdSchema),
      creatorId: team.bea,
      platformAccountId: team.beas,
      memberId: lea.id,
      startsAt: new Date('2025-05-04T08:00:00Z'),
      endsAt: new Date('2025-05-04T12:00:00Z'),
      cancelledAt: new Date('2025-05-03T09:00:00Z'),
      createdBy: team.ownerId,
      updatedBy: team.ownerId,
    });
    await team.recalculate(P1);
  });

  afterAll(async () => {
    await team.close();
  });

  it('shows every trophy still ahead before the job has run', async () => {
    const before = await caseOf(theoCookie);
    expect(earned(before)).toEqual([]);
    expect(before.streaks).toEqual([{ kind: 'shift', current: 0, best: 0 }]);
    expect(before.level).toBeNull();
  });

  it('notes what each chatter earned from their own facts, and nothing from a colleague’s', async () => {
    const { players, gained } = await evaluate();
    expect(players).toBe(2);
    expect(gained).toBe(3);

    // His late report keeps him at zero, and the agency's correction, though dated earlier, does not stand for it.
    const theos = await caseOf(theoCookie);
    expect(earned(theos)).toEqual(['first_sale']);
    expect(theos.streaks).toEqual([{ kind: 'shift', current: 0, best: 0 }]);

    const leas = await caseOf(leaCookie);
    expect(earned(leas).toSorted()).toEqual(['fortnight_on_time', 'streak_5']);
    // Five in a row, across the shift the agency cancelled.
    expect(leas.streaks).toEqual([{ kind: 'shift', current: 5, best: 5 }]);
    expect(leas.items.find((item) => item.kind === 'streak_10')?.progress).toEqual({
      current: 5,
      target: 10,
      unit: 'shift',
    });
    // Nothing is revealed yet: the reveal waits for them to open the app.
    expect([...theos.items, ...leas.items].every((item) => item.revealedAt === null)).toBe(true);
  });

  it('is replayable: a second run writes nothing and keeps the date of each gain', async () => {
    const before = await caseOf(leaCookie);
    expect(await evaluate()).toEqual({ players: 2, gained: 0 });
    expect(await caseOf(leaCookie)).toEqual(before);
    expect(await team.test.admin.db.select().from(schema.rewardGains)).toHaveLength(3);
  });

  it('marks the reveals of the session’s own gains, once, and never a colleague’s', async () => {
    // Léa names Théo's trophy: she has no such gain, nothing changes for him.
    const foreign = await team.call('POST', '/rewards/my-trophy-case/reveals', leaCookie, {
      kinds: ['first_sale'],
    });
    expect(foreign.statusCode).toBe(200);
    expect(
      (await caseOf(theoCookie)).items.find((item) => item.kind === 'first_sale')?.revealedAt,
    ).toBeNull();

    const seen = await team.call('POST', '/rewards/my-trophy-case/reveals', theoCookie, {
      kinds: ['first_sale'],
    });
    expect(seen.statusCode).toBe(200);
    const first = TrophyCaseSchema.parse(seen.json()).items.find((item) => item.kind === 'first_sale');
    expect(first?.revealedAt).not.toBeNull();
    // Seen again, the date of the first reveal stays.
    const again = await team.call('POST', '/rewards/my-trophy-case/reveals', theoCookie, {
      kinds: ['first_sale'],
    });
    expect(TrophyCaseSchema.parse(again.json()).items.find((item) => item.kind === 'first_sale')).toEqual(
      first,
    );
  });

  it('refuses the owner, a request without a session and a body that names anything else', async () => {
    expect((await team.call('GET', '/rewards/my-trophy-case', team.owner)).statusCode).toBe(403);
    expect((await team.call('GET', '/rewards/my-trophy-case', '')).statusCode).toBe(401);
    for (const body of [{}, { kinds: [] }, { kinds: ['first_sale'], userId: lea.userId }]) {
      expect((await team.call('POST', '/rewards/my-trophy-case/reveals', theoCookie, body)).statusCode).toBe(
        400,
      );
    }
  });

  it('lets the application write no gain of its own: the job is the only writer', async () => {
    const write = withMember(team.app.db.db, theo.userId, (tx) =>
      tx.insert(schema.rewardGains).values({
        id: newId(RewardGainIdSchema),
        userId: theo.userId,
        kind: 'streak_25',
        scopeKey: '',
        earnedAt: new Date(),
      }),
    );
    await expect(write).rejects.toThrow();
    expect(earned(await caseOf(theoCookie))).toEqual(['first_sale']);
  });

  it('never reaches pay: the job leaves the statement as it was and asks for no recalculation (§ 17)', async () => {
    await team.forgetJobs(P1);
    const before = await team.statementOf(theo, P1);
    await evaluate();
    expect(await team.statementOf(theo, P1)).toEqual(before);
    expect(await team.jobsFor(P1)).toEqual([]);
  });
});
