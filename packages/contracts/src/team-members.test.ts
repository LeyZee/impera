import { describe, expect, it } from 'vitest';

import {
  CommissionChoiceSchema,
  CreateCommissionPresetBodySchema,
  CreateTeamMemberBodySchema,
  FollowTimeZoneBodySchema,
  SetCommissionRateBodySchema,
  SetTeamRoleBodySchema,
  TeamMemberSchema,
  TeamMemberTimeZoneHistorySchema,
  TimeZoneChangesQuerySchema,
  UpdateTeamMemberBodySchema,
} from './team-members';

const CREATOR = '0199f2a0-0000-7000-8000-0000000000c1';
const PRESET = '0199f2a0-0000-7000-8000-0000000000b1';

const created = {
  email: 'theo@example.test',
  firstName: 'Théo',
  lastName: 'Martin',
  displayName: 'Théo',
  teamRole: 'chatter',
  country: 'BJ',
  timeZone: 'Africa/Porto-Novo',
  joinedOn: '2026-10-27',
  commission: { presetId: PRESET },
};

describe('team members', () => {
  it('adds a member with a preset in one gesture, no creator and no colour yet', () => {
    const body = CreateTeamMemberBodySchema.parse(created);
    expect(body.creatorIds).toEqual([]);
    expect(body.color).toBeNull();
    expect(body.teamShareBps).toBeNull();
  });

  it('refuses an unknown time zone, an unknown or lower-case country and a rate over 100 %', () => {
    expect(CreateTeamMemberBodySchema.safeParse({ ...created, timeZone: 'Mars/Olympus' }).success).toBe(
      false,
    );
    expect(CreateTeamMemberBodySchema.safeParse({ ...created, country: 'bj' }).success).toBe(false);
    // A country that does not exist (EQ-01).
    expect(CreateTeamMemberBodySchema.safeParse({ ...created, country: 'ZZ' }).success).toBe(false);
    expect(UpdateTeamMemberBodySchema.safeParse({ country: 'ZZ' }).success).toBe(false);
    expect(CommissionChoiceSchema.safeParse({ rateBps: 10_001 }).success).toBe(false);
    expect(CommissionChoiceSchema.safeParse({ rateBps: 1250 }).success).toBe(true);
  });

  it('refuses a rate given twice, rather than dropping one of the two', () => {
    expect(CommissionChoiceSchema.safeParse({ presetId: PRESET, rateBps: 1250 }).success).toBe(false);
  });

  it('gives a share of the team’s net to a manager only', () => {
    const manager = { ...created, teamRole: 'manager', teamShareBps: 500 };
    expect(CreateTeamMemberBodySchema.safeParse(manager).success).toBe(true);
    expect(CreateTeamMemberBodySchema.safeParse({ ...manager, teamRole: 'chatter' }).success).toBe(false);
  });

  it('has no hourly rate anywhere: a member is paid by commission only (ADR 0023)', () => {
    const keys = [
      ...Object.keys(CreateTeamMemberBodySchema.parse(created)),
      ...Object.keys(SetCommissionRateBodySchema.shape),
    ];
    expect(keys.join(' ')).not.toMatch(/hour/iu);
  });

  it('changes only what is sent, and refuses an empty change', () => {
    expect(UpdateTeamMemberBodySchema.parse({ color: '#e8a33d' })).toEqual({ color: '#e8a33d' });
    expect(UpdateTeamMemberBodySchema.safeParse({}).success).toBe(false);
    // Typed in capitals, a colour is written as the database keeps it.
    expect(UpdateTeamMemberBodySchema.parse({ color: '#E8A33D' })).toEqual({ color: '#e8a33d' });
    expect(UpdateTeamMemberBodySchema.safeParse({ color: '#E8A33' }).success).toBe(false);
  });

  it('dates a change of role on its own route, never through the record (Charles, 28/10)', () => {
    expect(UpdateTeamMemberBodySchema.safeParse({ teamRole: 'manager' }).success).toBe(false);
    expect(SetTeamRoleBodySchema.parse({ teamRole: 'manager', effectiveFrom: '2026-11-16' })).toEqual({
      teamRole: 'manager',
      effectiveFrom: '2026-11-16',
    });
    expect(SetTeamRoleBodySchema.safeParse({ teamRole: 'manager' }).success).toBe(false);
    expect(SetTeamRoleBodySchema.safeParse({ teamRole: 'owner', effectiveFrom: '2026-11-16' }).success).toBe(
      false,
    );
  });

  it('reads a member whose invitation is still waiting and who has no rate yet', () => {
    const member = TeamMemberSchema.parse({
      ...created,
      id: '0199f2a0-0000-7000-8000-0000000000a1',
      userId: '0199f2a0-0000-7000-8000-0000000000e1',
      status: 'active',
      color: null,
      creatorIds: [CREATOR],
      commission: null,
      invitationPending: true,
      invitationExpiresAt: '2026-10-30T16:00:00.000Z',
    });
    expect(member.invitationPending).toBe(true);
  });

  it('names a preset and its rate from a day on, trimmed', () => {
    const body = CreateCommissionPresetBodySchema.parse({
      name: '  Palier inventé ',
      rateBps: 1250,
      effectiveFrom: '2026-11-01',
    });
    expect(body.name).toBe('Palier inventé');
    expect(CreateCommissionPresetBodySchema.safeParse({ ...body, name: ' ' }).success).toBe(false);
    expect(CreateCommissionPresetBodySchema.safeParse({ ...body, rateBps: 10_001 }).success).toBe(false);
  });
});

describe('the zone a phone gives (recette CHT-01)', () => {
  const follows = (timeZone: unknown) => FollowTimeZoneBodySchema.safeParse({ timeZone }).success;

  it('takes a « Région/Ville » of the IANA regions, a city in a country included', () => {
    for (const zone of [
      'Europe/Paris',
      'Africa/Porto-Novo',
      'America/Argentina/Buenos_Aires',
      'Asia/Ho_Chi_Minh',
    ]) {
      expect(follows(zone), zone).toBe(true);
    }
  });

  it('refuses what is not a place: Etc/, posix/, UTC, Factory, localtime, an unknown city, a long text', () => {
    for (const zone of [
      'Etc/GMT+3',
      'posix/Europe/Paris',
      'UTC',
      'Factory',
      'localtime',
      'Europe/Nulle_Part',
      'Europe/Paris; drop',
      `Europe/${'A'.repeat(60)}`,
      '',
      3,
    ]) {
      expect(follows(zone), String(zone)).toBe(false);
    }
  });

  it('names no member: the body holds the zone and nothing else', () => {
    expect(FollowTimeZoneBodySchema.safeParse({ timeZone: 'Europe/Paris', memberId: CREATOR }).success).toBe(
      false,
    );
  });

  it('pages the owner’s trace by the change it ends on', () => {
    expect(TimeZoneChangesQuerySchema.safeParse({}).success).toBe(true);
    expect(TimeZoneChangesQuerySchema.safeParse({ before: 'x' }).success).toBe(false);
    expect(TimeZoneChangesQuerySchema.safeParse({ before: CREATOR, memberId: CREATOR }).success).toBe(false);
    const page = {
      changes: [
        { id: CREATOR, from: 'Africa/Porto-Novo', to: 'Europe/Paris', at: '2026-11-16T17:00:00.000Z' },
      ],
      nextBefore: null,
    };
    expect(TeamMemberTimeZoneHistorySchema.parse(page)).toEqual(page);
  });
});
