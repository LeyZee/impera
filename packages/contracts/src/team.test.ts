import { describe, expect, it } from 'vitest';

import {
  BasisPointsSchema,
  COUNTRY_CODES,
  CountryCodeSchema,
  KnownCountryCodeSchema,
  MeSchema,
  teamScopeFor,
} from './team';

describe('teamScopeFor', () => {
  it('gives the owner every row, an active manager the team, anyone else his own rows', () => {
    expect(teamScopeFor('owner', null)).toBe('owner');
    expect(teamScopeFor('operator', { teamRole: 'manager', status: 'active' })).toBe('agency');
    expect(teamScopeFor('operator', { teamRole: 'chatter', status: 'active' })).toBe('self');
    expect(teamScopeFor('operator', null)).toBe('self');
    expect(teamScopeFor('creator', null)).toBe('self');
  });

  it('takes the team back from a manager who is not active', () => {
    for (const status of ['on_leave', 'sick', 'travelling', 'suspended', 'left'] as const) {
      expect(teamScopeFor('operator', { teamRole: 'manager', status })).toBe('self');
    }
  });
});

describe('team values', () => {
  it('keeps rates in basis points and countries in ISO codes', () => {
    expect(BasisPointsSchema.safeParse(10_000).success).toBe(true);
    expect(BasisPointsSchema.safeParse(10_001).success).toBe(false);
    expect(BasisPointsSchema.safeParse(12.5).success).toBe(false);
    expect(CountryCodeSchema.safeParse('BJ').success).toBe(true);
    expect(CountryCodeSchema.safeParse('bj').success).toBe(false);
  });

  it('refuses a country that does not exist in what is written', () => {
    expect(KnownCountryCodeSchema.safeParse('BJ').success).toBe(true);
    expect(KnownCountryCodeSchema.safeParse('ZZ').success).toBe(false);
    expect(KnownCountryCodeSchema.safeParse('bj').success).toBe(false);
    expect(COUNTRY_CODES).toHaveLength(249);
  });
});

describe('MeSchema', () => {
  const user = {
    id: 'u1',
    email: 'chatter@example.test',
    name: 'Chatteur',
    role: 'operator',
    creatorIds: [],
    routedCreatorIds: [],
  };

  it('carries the team role and the scope, never the session token', () => {
    const me = { ...user, team: { role: 'chatter', status: 'active' }, teamScope: 'self' };
    expect(MeSchema.parse({ ...me, token: 'secret' })).toEqual(me);
    expect(MeSchema.parse({ ...user, role: 'owner', team: null, teamScope: 'owner' }).team).toBeNull();
  });

  it('refuses an unknown team role or scope', () => {
    expect(
      MeSchema.safeParse({ ...user, team: { role: 'va', status: 'active' }, teamScope: 'self' }).success,
    ).toBe(false);
    expect(MeSchema.safeParse({ ...user, team: null, teamScope: 'admin' }).success).toBe(false);
  });
});
