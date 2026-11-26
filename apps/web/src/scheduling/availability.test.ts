import { TeamMemberSchema, type MemberAvailability, type TeamMember } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  coverOf,
  disposCountText,
  disposOn,
  draftsIssue,
  draftsOf,
  isStale,
  rangesOfDrafts,
  rangeText,
  silentText,
  weekMinuteOf,
  weekSum,
} from './availability';

/** Invented members only (ADR 0010). */
const memberOf = (n: number, displayName: string, creatorIds: string[], status = 'active'): TeamMember =>
  TeamMemberSchema.parse({
    id: `0199f2a0-0000-7000-8000-00000000010${String(n)}`,
    userId: `0199f2a0-0000-7000-8000-00000000020${String(n)}`,
    email: `m${String(n)}@example.test`,
    firstName: displayName,
    lastName: 'Inventé',
    displayName,
    teamRole: 'chatter',
    status,
    country: 'FR',
    timeZone: 'Europe/Paris',
    color: null,
    joinedOn: '2026-01-01',
    creatorIds,
    commission: null,
    invitationPending: false,
    invitationExpiresAt: null,
  });
const CREATOR = '0199f2a0-0000-7000-8000-000000000002';
const weekOf = (
  member: TeamMember,
  ranges: MemberAvailability['ranges'],
  timeZone = 'Europe/Paris',
): MemberAvailability => ({
  memberId: member.id,
  weekId: null,
  timeZone,
  ranges,
  setAt: '2026-11-20T10:00:00.000Z',
  setByMember: true,
});

// Tuesday 24 November 2026, 18 h – 0 h in Paris (UTC+1).
const FROM = new Date('2026-11-24T17:00:00.000Z');
const TO = new Date('2026-11-24T23:00:00.000Z');

describe('Les dispos de la semaine (ADR 0171, trou 16)', () => {
  it('reads an instant’s day and minute in the member’s zone', () => {
    expect(weekMinuteOf(FROM, 'Europe/Paris')).toEqual({ weekday: 2, minute: 18 * 60 });
    expect(weekMinuteOf(TO, 'Indian/Antananarivo')).toEqual({ weekday: 3, minute: 2 * 60 });
  });

  it('says whether a week covers a place, all of it, the longest part of it, or none', () => {
    const theo = memberOf(1, 'Théo', [CREATOR]);
    expect(
      coverOf(weekOf(theo, [{ weekday: 2, startMinute: 17 * 60, endMinute: 24 * 60 }]), FROM, TO),
    ).toEqual({
      kind: 'full',
    });
    expect(
      coverOf(weekOf(theo, [{ weekday: 2, startMinute: 20 * 60, endMinute: 22 * 60 }]), FROM, TO),
    ).toEqual({
      kind: 'part',
      from: new Date('2026-11-24T19:00:00.000Z'),
      to: new Date('2026-11-24T21:00:00.000Z'),
    });
    expect(coverOf(weekOf(theo, [{ weekday: 3, startMinute: 0, endMinute: 600 }]), FROM, TO)).toEqual({
      kind: 'none',
    });
    // Madagascar is two hours ahead: Paris 18 h – 0 h is his 20 h – 2 h, across his midnight.
    const lou = weekOf(
      theo,
      [
        { weekday: 2, startMinute: 20 * 60, endMinute: 24 * 60 },
        { weekday: 3, startMinute: 0, endMinute: 2 * 60 },
      ],
      'Indian/Antananarivo',
    );
    expect(coverOf(lou, FROM, TO)).toEqual({ kind: 'full' });
  });

  it('lists who can take a place: of her creator, active, free of shifts, the whole place first', () => {
    const basile = memberOf(1, 'Basile', [CREATOR]);
    const theo = memberOf(2, 'Théo', [CREATOR]);
    const lou = memberOf(3, 'Lou', [CREATOR]);
    const ines = memberOf(4, 'Inès', ['0199f2a0-0000-7000-8000-000000000003']);
    const gone = memberOf(5, 'Kofi', [CREATOR], 'left');
    const sam = memberOf(6, 'Sam', [CREATOR]);
    const evening = [{ weekday: 2, startMinute: 18 * 60, endMinute: 24 * 60 }];
    const dispos = disposOn(
      { creatorId: CREATOR, from: FROM, to: TO },
      [basile, theo, lou, ines, gone, sam],
      [
        weekOf(basile, evening),
        weekOf(theo, [{ weekday: 2, startMinute: 18 * 60, endMinute: 20 * 60 }]),
        weekOf(ines, evening),
        weekOf(gone, evening),
        weekOf(sam, evening),
      ],
      (memberId) => memberId === sam.id,
    );
    expect(dispos.full.map((one) => one.member.displayName)).toEqual(['Basile']);
    expect(dispos.part.map((one) => one.member.displayName)).toEqual(['Théo']);
    expect(dispos.silent).toBe(1);
    expect(disposCountText(dispos)).toBe('1 dispo');
    expect(silentText(dispos.silent)).toBe('1 membre n’a pas donné ses dispos.');
  });

  it('writes a plage as the member gave it, and asks to look again after 30 days', () => {
    expect(rangeText({ startMinute: 18 * 60 + 30, endMinute: 24 * 60 })).toBe('18 h 30 – 0 h');
    expect(isStale({ setAt: '2026-10-01T10:00:00.000Z' }, new Date('2026-11-26T10:00:00.000Z'))).toBe(true);
    expect(isStale({ setAt: '2026-11-20T10:00:00.000Z' }, new Date('2026-11-26T10:00:00.000Z'))).toBe(false);
    expect(isStale({ setAt: null }, new Date('2026-11-26T10:00:00.000Z'))).toBe(false);
  });
});

describe('« Mes dispos » : les plages comme il les écrit', () => {
  it('runs a plage past midnight to the next morning, and gives it back as one', () => {
    const drafts = [
      { key: 0, weekday: 7, startMinute: 22 * 60, endMinute: 2 * 60 },
      { key: 1, weekday: 1, startMinute: 18 * 60, endMinute: 0 },
    ];
    const ranges = rangesOfDrafts(drafts);
    expect(ranges).toEqual([
      { weekday: 1, startMinute: 0, endMinute: 120 },
      { weekday: 1, startMinute: 18 * 60, endMinute: 24 * 60 },
      { weekday: 7, startMinute: 22 * 60, endMinute: 24 * 60 },
    ]);
    expect(
      draftsOf(ranges ?? []).map(({ weekday, startMinute, endMinute }) => [weekday, startMinute, endMinute]),
    ).toEqual([
      [1, 18 * 60, 0],
      [7, 22 * 60, 2 * 60],
    ]);
  });

  it('says what holds the week back', () => {
    expect(draftsIssue([{ key: 0, weekday: 1, startMinute: 600, endMinute: 600 }])).toMatch(
      /finit à l’heure/u,
    );
    expect(
      draftsIssue([
        { key: 0, weekday: 2, startMinute: 600, endMinute: 900 },
        { key: 1, weekday: 2, startMinute: 840, endMinute: 960 },
      ]),
    ).toBe('Deux plages se chevauchent le mardi.');
    expect(draftsIssue([{ key: 0, weekday: 1, startMinute: 18 * 60, endMinute: 0 }])).toBeNull();
    expect(weekSum([])).toBe('Pas encore données');
    expect(
      weekSum([
        { weekday: 5, startMinute: 18 * 60, endMinute: 24 * 60 },
        { weekday: 6, startMinute: 0, endMinute: 120 },
      ]),
    ).toBe('1 jour');
  });
});
