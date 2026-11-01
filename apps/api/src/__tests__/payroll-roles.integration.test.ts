import {
  CommissionRateIdSchema,
  MemberRoleIdSchema,
  newId,
  PayPeriodSchema,
  type TeamMember,
  type TeamRole,
} from '@nirvana/contracts';
import { schema } from '@nirvana/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

/** Periods of 2025: they have ended. Invented people only (ADR 0010). */
const P1 = PayPeriodSchema.parse('2025-05-01');
const P2 = PayPeriodSchema.parse('2025-05-16');

describe('Équipe › Paie : le rôle d’une quinzaine est celui de son dernier jour, daté (Charles, 28/10)', () => {
  let team: PayrollTeam;
  let mia: TeamMember;
  let nina: TeamMember;
  let leo: TeamMember;

  /**
   * A role and a rate from P2, as the owner would have set them before that day (the API refuses a day already past):
   * written here on the admin connection, the record keeping the role it had.
   */
  const datedRole = async (member: TeamMember, teamRole: TeamRole, teamShareBps: number | null) => {
    await team.test.admin.db.insert(schema.memberRoles).values({
      id: newId(MemberRoleIdSchema),
      memberId: member.id,
      teamRole,
      effectiveFrom: P2,
      createdBy: team.ownerId,
    });
    await team.test.admin.db.insert(schema.memberCommissionRates).values({
      id: newId(CommissionRateIdSchema),
      memberId: member.id,
      rateBps: 2_000,
      teamShareBps,
      effectiveFrom: P2,
      createdBy: team.ownerId,
    });
  };

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'));
    ({ member: mia } = await team.addMember('mia@example.test', 'Mia'));
    ({ member: nina } = await team.addMember('nina@example.test', 'Nina', 'manager'));
    ({ member: leo } = await team.addMember('leo@example.test', 'Léo'));
    // Nina's share of the team's net as a manager, from before the periods computed here.
    await team.test.admin.db.insert(schema.memberCommissionRates).values({
      id: newId(CommissionRateIdSchema),
      memberId: nina.id,
      rateBps: 2_000,
      teamShareBps: 500,
      effectiveFrom: '2025-04-01',
      createdBy: team.ownerId,
    });
  });

  afterAll(async () => {
    await team.close();
  });

  it('gives a chatter made a manager on the 16th the team share from that period only, and takes it from a manager made a chatter', async () => {
    await datedRole(mia, 'manager', 500);
    await datedRole(nina, 'chatter', null);
    for (const period of [P1, P2]) {
      await team.report(leo, period, 10_000);
      await team.report(mia, period, 1_000);
      await team.report(nina, period, 1_000);
      await team.recalculate(period);
    }

    // Before the 16th, Mia is a chatter and Nina a manager: Nina has 5 % of the others' net (80 € + 8 €), Mia none.
    expect(await team.statementOf(mia, P1)).toMatchObject({ teamShareBps: null, teamShareMinor: null });
    expect(await team.statementOf(nina, P1)).toMatchObject({
      teamShareBps: 500,
      teamShareBaseMinor: 8_800,
      teamShareMinor: 440,
    });
    // From the 16th, the whole period: Mia has the share, Nina has none, though her rate row still carries one.
    expect(await team.statementOf(mia, P2)).toMatchObject({
      teamShareBps: 500,
      teamShareBaseMinor: 8_800,
      teamShareMinor: 440,
    });
    expect(await team.statementOf(nina, P2)).toMatchObject({ teamShareBps: null, teamShareMinor: null });

    // The records still say what they said: pay read the dated roles, not the role of today.
    const records = await team.test.admin.db
      .select({ id: schema.teamMembers.id, teamRole: schema.teamMembers.teamRole })
      .from(schema.teamMembers);
    expect(new Map(records.map((row) => [row.id, row.teamRole]))).toEqual(
      new Map([
        [mia.id, 'chatter'],
        [nina.id, 'manager'],
        [leo.id, 'chatter'],
      ]),
    );
  });
});
