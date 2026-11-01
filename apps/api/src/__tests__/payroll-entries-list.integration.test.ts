import {
  BonusIdSchema,
  newId,
  PayAdjustmentIdSchema,
  PayPeriodSchema,
  PAYROLL_ENTRIES_MAX,
  PayrollEntriesSchema,
  PayrollPeriodSchema,
  penaltyApplies,
  PenaltyIdSchema,
  type PayPeriod,
  type TeamMember,
} from '@nirvana/contracts';
import { schema } from '@nirvana/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

const Q1 = PayPeriodSchema.parse('2025-05-01');
const Q2 = PayPeriodSchema.parse('2025-05-16');
const Q3 = PayPeriodSchema.parse('2025-06-01');
const CROWDED = PayPeriodSchema.parse('2025-06-16');
const FULL = PayPeriodSchema.parse('2025-07-01');

describe('Paie › Primes et malus : les saisies d’une quinzaine (EQ-05)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;
  let lea: TeamMember;
  let mona: TeamMember;
  let theoCookie: string;
  let leaCookie: string;
  let monaCookie: string;
  const ids = {
    theosBonus: newId(BonusIdSchema),
    leasBonus: newId(BonusIdSchema),
    leasPenalty: newId(PenaltyIdSchema),
    theosLaterPenalty: newId(PenaltyIdSchema),
    theosAdjustment: newId(PayAdjustmentIdSchema),
  };

  const list = async (cookie: string, period: PayPeriod) => {
    const response = await team.call('GET', `/payroll/entries?period=${period}`, cookie);
    expect(response.statusCode, response.body).toBe(200);
    return PayrollEntriesSchema.parse(response.json());
  };
  const at = (minute: number) => new Date(`2025-05-20T10:${String(minute).padStart(2, '0')}:00Z`);

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'));
    ({ member: theo, cookie: theoCookie } = await team.addMember('theo@example.test', 'Théo'));
    ({ member: lea, cookie: leaCookie } = await team.addMember('lea@example.test', 'Léa'));
    ({ member: mona, cookie: monaCookie } = await team.addMember('mona@example.test', 'Mona', 'manager'));

    const { db } = team.test.admin;
    await db.insert(schema.bonuses).values([
      {
        id: ids.theosBonus,
        memberId: theo.id,
        period: Q2,
        amountMinor: 3_000,
        reason: 'A formé Basile aux relances.',
        createdBy: team.ownerId,
        createdAt: at(1),
      },
      {
        id: ids.leasBonus,
        memberId: lea.id,
        period: Q2,
        amountMinor: 2_000,
        reason: 'Soirée de renfort.',
        createdBy: mona.userId,
        createdAt: at(2),
        cancelledAt: at(3),
        cancelledBy: team.ownerId,
      },
    ]);
    await db.insert(schema.penalties).values([
      // From the first period to the third, cancelled from the third on: it still counts in the second.
      {
        id: ids.leasPenalty,
        memberId: lea.id,
        fromPeriod: Q1,
        toPeriod: Q3,
        kind: 'fixed',
        amountMinor: 1_500,
        reason: 'Shift commencé en retard.',
        createdBy: team.ownerId,
        createdAt: at(4),
        cancelledAt: at(5),
        cancelledBy: mona.userId,
        cancelledFrom: Q3,
      },
      {
        id: ids.theosLaterPenalty,
        memberId: theo.id,
        fromPeriod: Q3,
        toPeriod: Q3,
        kind: 'percent',
        bps: 1_000,
        reason: 'Relances hors des heures prévues.',
        createdBy: team.ownerId,
        createdAt: at(6),
      },
    ]);
    await db.insert(schema.payAdjustments).values({
      id: ids.theosAdjustment,
      memberId: theo.id,
      period: Q2,
      amountMinor: -1_240,
      reason: 'Rapport compté deux fois.',
      createdBy: mona.userId,
      createdAt: at(7),
    });
  });

  afterAll(() => team.close());

  it('lists the team’s entries for the agency, cancelled ones included, the newest first, with their authors', async () => {
    const owners = await list(team.owner, Q2);
    expect(
      owners.bonuses.map((bonus) => [bonus.id, bonus.createdBy, bonus.cancellation?.cancelledBy]),
    ).toEqual([
      [ids.leasBonus, mona.userId, team.ownerId],
      [ids.theosBonus, team.ownerId, undefined],
    ]);
    expect(owners.penalties.map((penalty) => [penalty.id, penalty.createdBy])).toEqual([
      [ids.leasPenalty, team.ownerId],
    ]);
    expect(owners.adjustments).toEqual([
      expect.objectContaining({ id: ids.theosAdjustment, amountMinor: -1_240, createdBy: mona.userId }),
    ]);
    // An active manager reads what the owner reads.
    expect(await list(monaCookie, Q2)).toEqual(owners);
  });

  it('gives a member their own entries, never who made or cancelled them', async () => {
    const theos = await list(theoCookie, Q2);
    expect(theos.bonuses).toEqual([
      expect.objectContaining({
        id: ids.theosBonus,
        amountMinor: 3_000,
        createdBy: null,
        cancellation: null,
      }),
    ]);
    expect(theos.penalties).toEqual([]);
    expect(theos.adjustments).toEqual([
      expect.objectContaining({ id: ids.theosAdjustment, createdBy: null }),
    ]);

    const leas = await list(leaCookie, Q2);
    expect(leas.bonuses).toEqual([
      expect.objectContaining({
        id: ids.leasBonus,
        createdBy: null,
        cancellation: { cancelledAt: at(3).toISOString(), cancelledBy: null },
      }),
    ]);
    expect(leas.penalties).toEqual([
      expect.objectContaining({
        id: ids.leasPenalty,
        createdBy: null,
        cancellation: { cancelledAt: at(5).toISOString(), cancelledBy: null, cancelledFrom: Q3 },
      }),
    ]);
    expect(leas.adjustments).toEqual([]);
  });

  it('lists a penalty in each period it covers, counting until the period its cancellation starts from', async () => {
    const [second] = (await list(team.owner, Q2)).penalties;
    expect(second && penaltyApplies(second, Q2)).toBe(true);

    const third = await list(team.owner, Q3);
    expect(third.penalties.map((penalty) => [penalty.id, penaltyApplies(penalty, Q3)])).toEqual([
      [ids.theosLaterPenalty, true],
      [ids.leasPenalty, false],
    ]);
    expect((await list(team.owner, Q1)).penalties.map((penalty) => penalty.id)).toEqual([ids.leasPenalty]);
  });

  it('gives empty lists for a period nobody wrote in, and refuses a day that is not a period', async () => {
    expect(await list(team.owner, PayPeriodSchema.parse('2030-01-01'))).toEqual({
      period: '2030-01-01',
      bonuses: [],
      penalties: [],
      adjustments: [],
    });
    const refused = await team.call('GET', '/payroll/entries?period=2025-05-02', team.owner);
    expect(refused.statusCode).toBe(400);
  });

  it('refuses a list longer than its cap rather than cut it short', async () => {
    const bonusesOf = (period: PayPeriod, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: newId(BonusIdSchema),
        memberId: theo.id,
        period,
        amountMinor: 100,
        reason: `Prime ${String(index + 1)}`,
        createdBy: team.ownerId,
      }));
    await team.test.admin.db.insert(schema.bonuses).values(bonusesOf(FULL, PAYROLL_ENTRIES_MAX));
    await team.test.admin.db.insert(schema.bonuses).values(bonusesOf(CROWDED, PAYROLL_ENTRIES_MAX + 1));

    expect((await list(team.owner, FULL)).bonuses).toHaveLength(PAYROLL_ENTRIES_MAX);
    const refused = await team.call('GET', `/payroll/entries?period=${CROWDED}`, team.owner);
    expect([refused.statusCode, team.refusal(refused)]).toEqual([
      422,
      expect.objectContaining({
        code: 'payroll_entries_too_many_unprocessable',
        details: { max: PAYROLL_ENTRIES_MAX },
      }),
    ]);
  });

  it('reads a statement’s entries the same way: a member sees no author in their own, the agency sees them', async () => {
    await team.report(theo, Q2, 10_000);
    await team.report(lea, Q2, 20_000);
    await team.recalculate(Q2);
    const statementsOf = async (cookie: string) => {
      const response = await team.call('GET', `/payroll/periods/${Q2}`, cookie);
      expect(response.statusCode, response.body).toBe(200);
      return PayrollPeriodSchema.parse(response.json()).statements;
    };
    const entriesOf = async (cookie: string, whose: TeamMember) => {
      const found = (await statementsOf(cookie)).find((statement) => statement.memberId === whose.id);
      if (found === undefined) throw new Error(`no statement of ${whose.displayName}`);
      return {
        bonuses: found.bonuses.map((bonus) => [bonus.id, bonus.createdBy]),
        penalties: found.penalties.map((penalty) => [
          penalty.id,
          penalty.createdBy,
          penalty.cancellation?.cancelledBy,
        ]),
        adjustments: found.adjustments.map((adjustment) => [adjustment.id, adjustment.createdBy]),
      };
    };

    // What Théo's statement counts: his bonus and his adjustment; Léa's: her penalty, cancelled only from Q3 on.
    expect(await entriesOf(team.owner, theo)).toEqual({
      bonuses: [[ids.theosBonus, team.ownerId]],
      penalties: [],
      adjustments: [[ids.theosAdjustment, mona.userId]],
    });
    expect(await entriesOf(monaCookie, lea)).toEqual({
      bonuses: [],
      penalties: [[ids.leasPenalty, team.ownerId, mona.userId]],
      adjustments: [],
    });
    expect(await entriesOf(theoCookie, theo)).toEqual({
      bonuses: [[ids.theosBonus, null]],
      penalties: [],
      adjustments: [[ids.theosAdjustment, null]],
    });
    expect(await entriesOf(leaCookie, lea)).toEqual({
      bonuses: [],
      penalties: [[ids.leasPenalty, null, null]],
      adjustments: [],
    });
  });
});
