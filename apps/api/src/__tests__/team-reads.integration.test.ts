import {
  newId,
  PayPeriodSchema,
  ShiftIdSchema,
  UserIdSchema,
  type TeamMember,
  type UserRole,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

/** Invented people, creators and accounts only (ADR 0010). */
const P1 = PayPeriodSchema.parse('2025-05-01');
const RANGE = { from: new Date('2025-05-01T00:00:00Z'), to: new Date('2025-05-16T00:00:00Z') };
const WRITTEN = 'Un texte que seul l’écran montre';

/** What a shift, a report and a statement may say to another door, and nothing else (ADR 0026 § 1, ADR 0105 § 4). */
const SHIFT_KEYS = [
  'creatorId',
  'endsAt',
  'id',
  'memberId',
  'memberName',
  'platformAccountId',
  'startsAt',
  'stopped',
];
const REPORT_KEYS = [
  'amountMinor',
  'byAgency',
  'correctsId',
  'creatorId',
  'currency',
  'id',
  'memberId',
  'memberName',
  'period',
  'platformAccountId',
  'reviewedAt',
  'shiftId',
  'status',
  'submittedAt',
];
const STATEMENT_KEYS = [
  'adjustmentsMinor',
  'bonusesMinor',
  'carryOverOutMinor',
  'carryOversInMinor',
  'computedAt',
  'id',
  'memberId',
  'paidAt',
  'payableMinor',
  'penaltiesMinor',
  'period',
  'revision',
  'status',
  'totalMinor',
  'validatedAt',
  'writtenOffMinor',
];

describe('Lectures pour une autre porte : shifts, rapports et relevés (ADR 0026 § 1, ADR 0105 § 4)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;
  let lou: TeamMember;
  let iris: TeamMember;

  const as = (member: TeamMember | 'owner', role: UserRole = 'operator') =>
    member === 'owner'
      ? { userId: UserIdSchema.parse(team.ownerId), role: 'owner' as const }
      : { userId: UserIdSchema.parse(member.userId), role };
  const reads = () => team.app.modules.scheduling.reads;
  const pay = () => team.app.modules.payroll.reads;

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'));
    ({ member: theo } = await team.addMember('theo@example.test', 'Théo'));
    ({ member: lou } = await team.addMember('lou@example.test', 'Lou'));
    ({ member: iris } = await team.addMember('iris@example.test', 'Iris', 'manager'));
    // Iris plans Anna alone.
    await team.test.admin.db
      .update(schema.user)
      .set({ creatorIds: [team.anna] })
      .where(eq(schema.user.id, iris.userId));
    // Théo on Anna, validated; Lou on Béa, still submitted, with a comment of hers.
    await team.report(theo, P1, 10_000);
    const lous = await team.report(lou, P1, 5_000, { account: team.beas, status: 'submitted' });
    await team.test.admin.db
      .update(schema.shiftReports)
      .set({ comment: WRITTEN, incident: WRITTEN })
      .where(eq(schema.shiftReports.id, lous));
    // A shift of Théo's the agency cancelled: no read ever shows it.
    await team.test.admin.db.insert(schema.shifts).values({
      id: newId(ShiftIdSchema),
      creatorId: team.anna,
      platformAccountId: team.annas,
      memberId: theo.id,
      startsAt: new Date('2025-05-02T08:00:00Z'),
      endsAt: new Date('2025-05-02T12:00:00Z'),
      cancelledAt: new Date('2025-05-01T08:00:00Z'),
      createdBy: team.ownerId,
      updatedBy: team.ownerId,
    });
    await team.recalculate(P1);
  });

  afterAll(async () => {
    await team.close();
  });

  it('reads the shifts the person reads, confined to the creators named, never a cancelled one', async () => {
    const all = await reads().shifts(as('owner'), 'all', RANGE);
    expect(all.map((one) => [one.memberName, one.creatorId, one.stopped])).toEqual([
      ['Théo', team.anna, false],
      ['Lou', team.bea, false],
    ]);
    expect(all.every((one) => Object.keys(one).toSorted().join() === SHIFT_KEYS.join())).toBe(true);
    expect((await reads().shifts(as('owner'), [team.bea], RANGE)).map((one) => one.memberName)).toEqual([
      'Lou',
    ]);
    // A manager reads what he plans; a chatter, his own shifts.
    expect((await reads().shifts(as(iris), 'all', RANGE)).map((one) => one.memberName)).toEqual(['Théo']);
    expect((await reads().shifts(as(lou), 'all', RANGE)).map((one) => one.memberName)).toEqual(['Lou']);
    expect(await reads().shifts(as(lou), [team.anna], RANGE)).toEqual([]);
  });

  it('reads the reports’ amounts and states, never a text a person wrote', async () => {
    const all = await reads().shiftReports(as('owner'), 'all', P1);
    expect(all.map((one) => [one.memberName, one.amountMinor, one.status])).toEqual([
      ['Théo', 10_000, 'validated'],
      ['Lou', 5_000, 'submitted'],
    ]);
    expect(all.every((one) => Object.keys(one).toSorted().join() === REPORT_KEYS.join())).toBe(true);
    expect(JSON.stringify(all)).not.toContain('écran');
    expect((await reads().shiftReports(as('owner'), [team.anna], P1)).map((one) => one.memberName)).toEqual([
      'Théo',
    ]);
    // Without a period, what the agency has to validate.
    expect((await reads().shiftReports(as('owner'), 'all', null)).map((one) => one.memberName)).toEqual([
      'Lou',
    ]);
    // The reports are the whole agency's for a manager (ADR 0023); a chatter reads his own.
    expect((await reads().shiftReports(as(iris), 'all', P1)).map((one) => one.memberName)).toEqual([
      'Théo',
      'Lou',
    ]);
    expect((await reads().shiftReports(as(theo), 'all', P1)).map((one) => one.memberName)).toEqual(['Théo']);
  });

  it('reads the statements as the screen does, cut to what tells no rate', async () => {
    const all = await pay().statements(as('owner'), P1);
    const stored = await team.test.admin.db
      .select()
      .from(schema.commissionStatements)
      .where(eq(schema.commissionStatements.period, P1));
    expect(all.map((one) => one.memberId).toSorted()).toEqual(stored.map((one) => one.memberId).toSorted());
    const theos = all.find((one) => one.memberId === theo.id);
    const written = await team.statementOf(theo, P1);
    expect(theos).toMatchObject({
      totalMinor: written.totalMinor,
      payableMinor: written.payableMinor,
      period: P1,
    });
    expect(all.every((one) => Object.keys(one).toSorted().join() === STATEMENT_KEYS.join())).toBe(true);
    expect((await pay().statements(as(theo), P1)).map((one) => one.memberId)).toEqual([theo.id]);
  });

  it('refuses a creator’s account, as the routes refuse her session', async () => {
    const creator = as(theo, 'creator');
    await expect(reads().shifts(creator, 'all', RANGE)).rejects.toMatchObject({ code: 'role_forbidden' });
    await expect(reads().shiftReports(creator, 'all', P1)).rejects.toMatchObject({ code: 'role_forbidden' });
    await expect(pay().statements(creator, P1)).rejects.toMatchObject({ code: 'role_forbidden' });
  });
});
