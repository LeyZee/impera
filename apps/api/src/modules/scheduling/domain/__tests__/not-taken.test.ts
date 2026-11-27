import type { TeamMemberStatus } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { NOT_TAKEN_LOOKBACK_MS, notTakenShifts, type NotTakenCandidate } from '../not-taken';

/** Invented ids; the shift starts at 14 h (13:00Z), and the agency's delay is 15 minutes in these tests. */
const CREATOR = 'creator-a';
const shift = (over: Partial<NotTakenCandidate> = {}): NotTakenCandidate => ({
  id: 'shift-1',
  creatorId: CREATOR,
  platformAccountId: 'account-a',
  memberId: 'member-1',
  startsAt: new Date('2026-11-20T13:00:00Z'),
  endsAt: new Date('2026-11-20T19:00:00Z'),
  stoppedAt: null,
  checkedInAt: null,
  ...over,
});
type Members = ReadonlyMap<string, { status: TeamMemberStatus; creatorIds: string[] }>;
const holding: Members = new Map([['member-1', { status: 'active', creatorIds: [CREATOR] }]]);
const at = (iso: string) => new Date(iso);
const due = (input: { shifts: NotTakenCandidate[]; now: Date; members?: Members }) =>
  notTakenShifts({
    shifts: input.shifts,
    members: input.members ?? holding,
    delayMinutes: 15,
    now: input.now,
  }).map((one) => one.id);

describe('chatteur pas là (ADR 0094 § 1, lot b)', () => {
  it('keeps a shift not taken from the delay after its start, never before', () => {
    expect(due({ shifts: [shift()], now: at('2026-11-20T13:14:59Z') })).toEqual([]);
    expect(due({ shifts: [shift()], now: at('2026-11-20T13:15:00Z') })).toEqual(['shift-1']);
    expect(due({ shifts: [shift()], now: at('2026-11-20T13:20:00Z') })).toEqual(['shift-1']);
  });

  it('lets go of it past the lookback, so that a late run does not tell an old absence', () => {
    const late = new Date(Date.parse('2026-11-20T13:15:00Z') + NOT_TAKEN_LOOKBACK_MS);
    expect(due({ shifts: [shift()], now: late })).toEqual([]);
  });

  it('says nothing of a shift taken, stopped or over', () => {
    const now = at('2026-11-20T13:20:00Z');
    expect(due({ shifts: [shift({ checkedInAt: at('2026-11-20T13:10:00Z') })], now })).toEqual([]);
    expect(due({ shifts: [shift({ stoppedAt: at('2026-11-20T13:05:00Z') })], now })).toEqual([]);
    expect(due({ shifts: [shift({ endsAt: at('2026-11-20T13:20:00Z') })], now })).toEqual([]);
  });

  it('leaves a shift its member no longer holds to « compte sans personne »', () => {
    const now = at('2026-11-20T13:20:00Z');
    const away: Members = new Map([['member-1', { status: 'on_leave', creatorIds: [CREATOR] }]]);
    const elsewhere: Members = new Map([['member-1', { status: 'active', creatorIds: ['creator-b'] }]]);
    expect(due({ shifts: [shift()], now, members: away })).toEqual([]);
    expect(due({ shifts: [shift()], now, members: elsewhere })).toEqual([]);
    expect(due({ shifts: [shift()], now, members: new Map() })).toEqual([]);
  });
});
