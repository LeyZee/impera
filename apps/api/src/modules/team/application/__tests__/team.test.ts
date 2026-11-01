import {
  CommissionRateSchema,
  DomainError,
  TeamRoleChangeSchema,
  TeamMemberIdSchema,
  UserIdSchema,
  type PayPeriod,
  type TeamRoleChange,
} from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import type { TeamStore } from '../../domain/ports';
import { createTeamService } from '../team';

/** Invented ids only (ADR 0010). */
const MEMBER = TeamMemberIdSchema.parse('0199f2a0-0000-7000-8000-0000000000a1');
const OWNER = { userId: UserIdSchema.parse('0199f2a0-0000-7000-8000-0000000000e1'), ip: null };

const unused = (): never => {
  throw new Error('not used here');
};

interface AskedRole {
  readonly role: TeamRoleChange;
  readonly today: string;
  readonly running: PayPeriod;
}

/** A store that keeps the period each new rate asks pay to compute again, and each role asked with its day. */
function storeKeeping(asked: (PayPeriod | null)[], roles: AskedRole[] = []): TeamStore {
  return {
    members: unused,
    member: unused,
    create: unused,
    update: unused,
    changeStatus: unused,
    addRate: (_actor, _id, rate, recalculate) => {
      asked.push(recalculate);
      return Promise.resolve(CommissionRateSchema.parse(rate));
    },
    rates: unused,
    addRole: (_actor, _id, role, when) => {
      const change = TeamRoleChangeSchema.parse({
        teamRole: role.teamRole,
        effectiveFrom: role.effectiveFrom,
      });
      roles.push({ role: change, ...when });
      return Promise.resolve(change);
    },
    roles: unused,
    presets: unused,
    addPreset: unused,
    notes: unused,
    addNote: unused,
  };
}

const serviceAt = (instant: string, asked: (PayPeriod | null)[], roles: AskedRole[] = []) =>
  createTeamService(
    storeKeeping(asked, roles),
    { existing: unused },
    { live: unused },
    { agencyTimeZone: 'Europe/Paris', now: () => new Date(instant) },
  );

describe('a member’s new rate', () => {
  it('starts the 1st or the 16th, and has pay compute the running period when it starts today', async () => {
    const asked: (PayPeriod | null)[] = [];
    const onTheFirst = serviceAt('2026-11-01T10:00:00Z', asked);
    await onTheFirst.setCommission(OWNER, MEMBER, {
      commission: { rateBps: 1500 },
      teamShareBps: null,
      effectiveFrom: '2026-11-01',
    });
    await onTheFirst.setCommission(OWNER, MEMBER, {
      commission: { rateBps: 1600 },
      teamShareBps: null,
      effectiveFrom: '2026-11-16',
    });
    expect(asked).toEqual(['2026-11-01', null]);

    const midPeriod = serviceAt('2026-10-28T10:00:00Z', asked).setCommission(OWNER, MEMBER, {
      commission: { rateBps: 1500 },
      teamShareBps: null,
      effectiveFrom: '2026-10-29',
    });
    await expect(midPeriod).rejects.toBeInstanceOf(DomainError);
    await expect(midPeriod).rejects.toMatchObject({ code: 'commission_date_invalid' });
    expect(asked).toHaveLength(2);
  });
});

describe('a member’s change of role (Charles, 28/10)', () => {
  it('starts the 1st or the 16th, today at the earliest, and tells the store which day is today', async () => {
    const roles: AskedRole[] = [];
    const onTheSixteenth = serviceAt('2026-11-16T09:00:00Z', [], roles);
    await onTheSixteenth.setRole(OWNER, MEMBER, { teamRole: 'manager', effectiveFrom: '2026-11-16' });
    await onTheSixteenth.setRole(OWNER, MEMBER, { teamRole: 'chatter', effectiveFrom: '2026-12-01' });
    expect(roles).toEqual([
      {
        role: { teamRole: 'manager', effectiveFrom: '2026-11-16' },
        today: '2026-11-16',
        running: '2026-11-16',
      },
      {
        role: { teamRole: 'chatter', effectiveFrom: '2026-12-01' },
        today: '2026-11-16',
        running: '2026-11-16',
      },
    ]);

    // Half past midnight on the 16th in Paris is still the 15th in UTC: the agency's day decides, the role starts today.
    await serviceAt('2026-11-15T23:30:00Z', [], roles).setRole(OWNER, MEMBER, {
      teamRole: 'chatter',
      effectiveFrom: '2026-11-16',
    });
    expect(roles.at(-1)).toMatchObject({ today: '2026-11-16', running: '2026-11-16' });

    for (const effectiveFrom of ['2026-11-17', '2026-11-01', '2026-10-16']) {
      const refused = onTheSixteenth.setRole(OWNER, MEMBER, { teamRole: 'manager', effectiveFrom });
      await expect(refused).rejects.toBeInstanceOf(DomainError);
      await expect(refused).rejects.toMatchObject({ code: 'role_date_invalid' });
    }
    expect(roles).toHaveLength(3);
  });
});
