import {
  CommissionPresetSchema,
  TeamMemberSchema,
  TimezoneSchema,
  type TeamMember,
} from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import {
  FIRST_COUNTRIES,
  formatRate,
  invitationState,
  lastRate,
  listMembers,
  longDay,
  matches,
  noteDay,
  OTHER_COUNTRIES,
  parsePlanningSearch,
  parseRate,
  parseReportsSearch,
  parseTeamSearch,
  rateAhead,
  rateLine,
  suggestedZone,
  periodStartsFrom,
  teamSummary,
} from './model';

import { countryName } from '@/lib/country';

/* Invented members: no real data (ADR 0010). */
let next = 0;
function member(patch: Partial<TeamMember> = {}): TeamMember {
  next += 1;
  return TeamMemberSchema.parse({
    id: `0199f2a0-0000-7000-8000-0000000000${String(10 + next)}`,
    userId: `0199f2a0-0000-7000-8000-0000000001${String(10 + next)}`,
    email: 'theo@example.test',
    firstName: 'Théo',
    lastName: 'Martin',
    displayName: 'Théo',
    teamRole: 'chatter',
    status: 'active',
    country: 'BJ',
    timeZone: 'Africa/Porto-Novo',
    color: null,
    joinedOn: '2026-10-01',
    creatorIds: [],
    commission: null,
    invitationPending: false,
    invitationExpiresAt: null,
    ...patch,
  });
}

const PRESET = '0199f2a0-0000-7000-8000-0000000000b1';
const presets = [
  CommissionPresetSchema.parse({ id: PRESET, name: 'Confirmé', rateBps: 1500, effectiveFrom: '2026-10-01' }),
];

describe('the list', () => {
  const team = [
    member({ displayName: 'Basile', status: 'on_leave' }),
    member({ displayName: 'Théo' }),
    member({ displayName: 'Aïcha', status: 'suspended' }),
    member({ displayName: 'Jules', status: 'left' }),
    member({ displayName: 'Inès', teamRole: 'manager' }),
  ];

  it('puts those at work first, then away, then suspended, and folds those who left apart', () => {
    const lists = listMembers(team, 'chatter', '');
    expect(lists.current.map((m) => m.displayName)).toEqual(['Théo', 'Basile', 'Aïcha']);
    expect(lists.gone.map((m) => m.displayName)).toEqual(['Jules']);
  });

  it('counts each tab without those who left, whatever the search', () => {
    expect(listMembers(team, 'manager', 'zzz').counts).toEqual({ chatter: 3, manager: 1 });
  });

  it('finds a member by name, e-mail or country, accents and case aside', () => {
    const aicha = member({ displayName: 'Aïcha', firstName: 'Aïcha', lastName: 'Kpadé', country: 'MG' });
    expect(matches(aicha, 'aicha')).toBe(true);
    expect(matches(aicha, 'KPADE')).toBe(true);
    expect(matches(aicha, 'madag')).toBe(true);
    expect(matches(aicha, 'benin')).toBe(false);
    expect(matches(aicha, '  ')).toBe(true);
  });

  it('says how many work, are away and still have to sign in', () => {
    const now = new Date('2026-10-28T12:00:00Z');
    expect(teamSummary(team, now)).toBe('2 actifs · 1 absent');
    expect(teamSummary([member({ invitationPending: true })], now)).toBe('1 actif · 1 invitation en attente');
    expect(teamSummary([member({ status: 'left' })], now)).toBeNull();
    // A dead link is counted apart: it asks for a new one (EQ-06).
    expect(
      teamSummary(
        [
          member({ invitationPending: true, invitationExpiresAt: '2026-10-30T12:00:00Z' }),
          member({ invitationPending: true, invitationExpiresAt: '2026-10-27T12:00:00Z' }),
        ],
        now,
      ),
    ).toBe('2 actifs · 1 invitation en attente · 1 lien expiré');
  });
});

describe('rates', () => {
  it('reads basis points as people do', () => {
    expect(formatRate(1250)).toMatch(/^12,5\s%$/u);
    expect(formatRate(1500)).toMatch(/^15\s%$/u);
  });

  it('takes a rate typed with a comma or a dot, and nothing over 100 % or finer than a hundredth', () => {
    expect(parseRate('12,5')).toBe(1250);
    expect(parseRate('12.5 %')).toBe(1250);
    expect(parseRate('100')).toBe(10_000);
    expect(parseRate('100,01')).toBeNull();
    expect(parseRate('1,255')).toBeNull();
    expect(parseRate('')).toBeNull();
    expect(parseRate('douze')).toBeNull();
  });

  it('names the preset a rate comes from', () => {
    const from = { rateBps: 1500, presetId: PRESET };
    expect(rateLine(from, presets)).toMatch(/^Confirmé · 15\s%$/u);
    expect(rateLine({ rateBps: 1250, presetId: null }, presets)).toMatch(/^12,5\s%$/u);
    expect(rateLine(null, presets)).toBe('Pas encore de taux');
  });
});

describe('days', () => {
  it('says the first of the month « 1er »', () => {
    expect(longDay('2026-10-01')).toBe('1er octobre 2026');
    expect(longDay('2026-10-27')).toBe('27 octobre 2026');
    // An internal note's day (PAIE-19), at noon so that every reader's zone keeps it.
    expect(noteDay('2026-11-01T12:00:00Z')).toBe('1er nov.');
    expect(noteDay('2026-10-27T12:00:00Z')).toBe('27 oct.');
    expect(longDay('2026-10-11')).toBe('11 octobre 2026');
  });
});

describe('countries and zones', () => {
  it('lists every country once, Bénin, Madagascar and France first', () => {
    const codes = [...FIRST_COUNTRIES, ...OTHER_COUNTRIES.map((c) => c.code)];
    expect(codes).toHaveLength(249);
    expect(new Set(codes).size).toBe(249);
    expect(FIRST_COUNTRIES.map(countryName)).toEqual(['Bénin', 'Madagascar', 'France']);
  });

  it('proposes the zone of the country, and a real one each time', () => {
    expect(suggestedZone('BJ')).toBe('Africa/Porto-Novo');
    expect(suggestedZone('MG')).toBe('Indian/Antananarivo');
    expect(suggestedZone('FR')).toBe('Europe/Paris');
    expect(suggestedZone('AQ')).toBeNull();
    for (const country of OTHER_COUNTRIES) {
      const zone = suggestedZone(country.code);
      if (zone !== null) expect(TimezoneSchema.safeParse(zone).success, country.code).toBe(true);
    }
  });
});

describe('the first access', () => {
  const now = new Date('2026-10-27T12:00:00Z');

  it('tells a member who signed in from one still invited, with or without a live link', () => {
    expect(invitationState(member(), now).kind).toBe('signed-in');
    // A reset link out for one who signed in: said, so that a second one does not cancel it unawares.
    expect(invitationState(member({ invitationExpiresAt: '2026-10-28T12:00:00.000Z' }), now)).toEqual({
      kind: 'reset-sent',
      until: new Date('2026-10-28T12:00:00.000Z'),
    });
    expect(invitationState(member({ invitationExpiresAt: '2026-10-26T12:00:00.000Z' }), now).kind).toBe(
      'signed-in',
    );
    expect(invitationState(member({ invitationPending: true }), now).kind).toBe('no-link');
    expect(
      invitationState(
        member({ invitationPending: true, invitationExpiresAt: '2026-10-30T12:00:00.000Z' }),
        now,
      ),
    ).toEqual({ kind: 'valid', until: new Date('2026-10-30T12:00:00.000Z') });
    expect(
      invitationState(
        member({ invitationPending: true, invitationExpiresAt: '2026-10-26T12:00:00.000Z' }),
        now,
      ).kind,
    ).toBe('expired');
  });
});

describe('the address', () => {
  it('keeps the planning’s week as its Monday, and drops a day that does not exist', () => {
    expect(parsePlanningSearch({ semaine: '2026-10-26' })).toEqual({ semaine: '2026-10-26' });
    expect(parsePlanningSearch({ semaine: '2026-10-28' })).toEqual({ semaine: '2026-10-26' });
    expect(parsePlanningSearch({ semaine: '2026-02-30' })).toEqual({});
    expect(parsePlanningSearch({ semaine: 'lundi' })).toEqual({});
    expect(parsePlanningSearch({})).toEqual({});
    const theo = '0199f2a0-0000-7000-8000-0000000000a1';
    expect(parsePlanningSearch({ semaine: '2026-10-28', membre: theo })).toEqual({
      semaine: '2026-10-26',
      membre: theo,
    });
    expect(parsePlanningSearch({ semaine: 'lundi', membre: theo })).toEqual({ membre: theo });
  });

  it('keeps the period and the member of Rapports, and drops anything else (EQ-11, EQ-13)', () => {
    const theo = '0199f2a0-0000-7000-8000-0000000000a1';
    expect(parseReportsSearch({ quinzaine: '2026-10-16', membre: theo })).toEqual({
      quinzaine: '2026-10-16',
      membre: theo,
    });
    expect(parseReportsSearch({ quinzaine: '2026-10-17', membre: 'x' })).toEqual({});
  });

  it('keeps the managers tab and a member id, and drops anything else', () => {
    const id = '0199f2a0-0000-7000-8000-0000000000a1';
    expect(parseTeamSearch({ onglet: 'managers', membre: id })).toEqual({ onglet: 'managers', membre: id });
    expect(parseTeamSearch({ onglet: 'chatteurs', membre: 'x', autre: 1 })).toEqual({});
  });
});

describe('the days a new rate may start from (EQ-10)', () => {
  it('gives the 1st and the 16th ahead, today when it is one', () => {
    expect(periodStartsFrom('2026-10-29', 4)).toEqual([
      '2026-11-01',
      '2026-11-16',
      '2026-12-01',
      '2026-12-16',
    ]);
    expect(periodStartsFrom('2026-12-16', 3)).toEqual(['2026-12-16', '2027-01-01', '2027-01-16']);
    expect(periodStartsFrom('2026-11-01', 2)).toEqual(['2026-11-01', '2026-11-16']);
    expect(periodStartsFrom('2026-11-02', 1)).toEqual(['2026-11-16']);
  });
});

describe('a rate set ahead (EQ-10)', () => {
  const rate = (effectiveFrom: string, rateBps: number) => ({
    rateBps,
    teamShareBps: null,
    presetId: null,
    effectiveFrom,
  });
  const rates = [rate('2026-12-01', 4500), rate('2026-11-16', 4000), rate('2026-10-01', 3000)];

  it('reads the nearest one after today, none on the day it starts, and the one set last', () => {
    expect(rateAhead(rates, '2026-11-02')?.rateBps).toBe(4000);
    expect(rateAhead(rates, '2026-11-16')?.rateBps).toBe(4500);
    expect(rateAhead(rates, '2026-12-01')).toBeNull();
    expect(lastRate(rates)?.rateBps).toBe(4500);
    expect(lastRate([])).toBeNull();
  });
});
