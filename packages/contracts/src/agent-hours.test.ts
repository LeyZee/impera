import { describe, expect, it } from 'vitest';

import {
  AgentHoursSchema,
  DEFAULT_AGENT_HOURS,
  MinuteRangeSchema,
  nextFollowUpAllowed,
  nextReplyOpening,
  nightAt,
  followUpQuietAt,
  replyOpenAt,
  replyOpenedAt,
  SUGGESTED_REPLY_SLOTS,
  type AgentHours,
  type AgentSlot,
} from './agent-hours';

const PARIS = 'Europe/Paris';
const slot = (day: number, start: string, end: string, enabled = true): AgentSlot => {
  const minute = (hhmm: string): number => {
    const [h, m] = hhmm.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  return { day, startMinute: minute(start), endMinute: minute(end), enabled };
};
const withSlots = (...slots: AgentSlot[]): AgentHours => ({
  ...DEFAULT_AGENT_HOURS,
  reply: { mode: 'slots', slots },
});
const SUGGESTED = withSlots(...SUGGESTED_REPLY_SLOTS);
// Tuesday 27 October 2026, winter time in Paris (UTC+1).
const paris = (iso: string): Date => new Date(`${iso}+01:00`);

describe('agent hours (P3-14)', () => {
  it('keeps today’s behaviour without a setting: always open, quiet 23:00–9:00, night 22:00–7:00', () => {
    expect(AgentHoursSchema.parse(DEFAULT_AGENT_HOURS)).toEqual(DEFAULT_AGENT_HOURS);
    expect(replyOpenAt(DEFAULT_AGENT_HOURS, PARIS, paris('2026-10-27T03:00:00'))).toBe(true);
    expect(followUpQuietAt(DEFAULT_AGENT_HOURS, PARIS, paris('2026-10-27T23:00:00'))).toBe(true);
    expect(followUpQuietAt(DEFAULT_AGENT_HOURS, PARIS, paris('2026-10-27T09:00:00'))).toBe(false);
    expect(nightAt(DEFAULT_AGENT_HOURS, PARIS, paris('2026-10-27T22:30:00'))).toBe(true);
    expect(nightAt(DEFAULT_AGENT_HOURS, PARIS, paris('2026-10-27T07:00:00'))).toBe(false);
  });

  it('answers a message at 3:00 when her 9:00 slot opens, and at midnight at once', () => {
    const three = paris('2026-10-27T03:00:00');
    expect(replyOpenAt(SUGGESTED, PARIS, three)).toBe(false);
    expect(nextReplyOpening(SUGGESTED, PARIS, three)).toEqual(paris('2026-10-27T09:00:00'));
    // Monday's slot runs until 1:00 on Tuesday.
    const midnight = paris('2026-10-27T00:30:00');
    expect(replyOpenAt(SUGGESTED, PARIS, midnight)).toBe(true);
    expect(nextReplyOpening(SUGGESTED, PARIS, midnight)).toEqual(midnight);
  });

  it('sends no follow-up before 9:00 even in an open slot, and none out of a slot', () => {
    const midnight = paris('2026-10-27T00:30:00');
    expect(nextFollowUpAllowed(SUGGESTED, PARIS, midnight)).toEqual(paris('2026-10-27T09:00:00'));
    const lateSlots = withSlots(slot(2, '10:00', '12:00'));
    expect(nextFollowUpAllowed(lateSlots, PARIS, paris('2026-10-27T08:00:00'))).toEqual(
      paris('2026-10-27T10:00:00'),
    );
    expect(nextFollowUpAllowed(SUGGESTED, PARIS, paris('2026-10-27T15:00:00'))).toEqual(
      paris('2026-10-27T15:00:00'),
    );
  });

  it('skips a switched-off slot without deleting it', () => {
    const hours = withSlots(slot(2, '09:00', '12:00', false), slot(2, '14:00', '18:00'));
    expect(replyOpenAt(hours, PARIS, paris('2026-10-27T10:00:00'))).toBe(false);
    expect(nextReplyOpening(hours, PARIS, paris('2026-10-27T10:00:00'))).toEqual(
      paris('2026-10-27T14:00:00'),
    );
  });

  it('carries Sunday night into Monday, and finds next week’s only slot', () => {
    const sunday = withSlots(slot(7, '22:00', '02:00'));
    // Monday 26 October, 1:30: still Sunday's slot.
    expect(replyOpenAt(sunday, PARIS, paris('2026-10-26T01:30:00'))).toBe(true);
    expect(replyOpenAt(sunday, PARIS, paris('2026-10-26T02:00:00'))).toBe(false);
    expect(nextReplyOpening(sunday, PARIS, paris('2026-10-27T12:00:00'))).toEqual(
      paris('2026-11-01T22:00:00'),
    );
  });

  it('keeps her clock across both changes of time in Paris', () => {
    // 29 March 2026: 2:00 jumps to 3:00 (UTC+1 to UTC+2). A Sunday slot from 1:00 to 4:00 spans the jump.
    const spring = withSlots(slot(7, '01:00', '04:00'), slot(1, '09:00', '10:00'));
    expect(replyOpenAt(spring, PARIS, new Date('2026-03-29T01:30:00Z'))).toBe(true); // 3:30 summer time
    expect(replyOpenAt(spring, PARIS, new Date('2026-03-29T02:00:00Z'))).toBe(false); // 4:00
    expect(nextReplyOpening(spring, PARIS, new Date('2026-03-29T02:00:00Z'))).toEqual(
      new Date('2026-03-30T07:00:00Z'), // Monday 9:00 summer time
    );
    // A slot opening at 2:30, an hour that does not exist that day, opens at the first minute after the jump.
    const gap = withSlots(slot(7, '02:30', '05:00'));
    expect(nextReplyOpening(gap, PARIS, new Date('2026-03-28T23:00:00Z'))).toEqual(
      new Date('2026-03-29T01:00:00Z'), // 3:00 summer time
    );
    // 25 October 2026: 3:00 falls back to 2:00. A 9:00 opening that day is 9:00 winter time.
    const autumn = withSlots(slot(7, '09:00', '12:00'));
    expect(nextReplyOpening(autumn, PARIS, new Date('2026-10-24T20:00:00Z'))).toEqual(
      new Date('2026-10-25T08:00:00Z'),
    );
    expect(replyOpenAt(autumn, PARIS, new Date('2026-10-25T08:00:00Z'))).toBe(true);
  });

  it('says the rule of a range that starts where it ends, not a fact', () => {
    const range = MinuteRangeSchema.safeParse({ startMinute: 600, endMinute: 600 });
    expect(range.success).toBe(false);
    expect(range.error?.issues).toEqual([
      expect.objectContaining({
        path: ['endMinute'],
        message: 'Une plage doit commencer et finir à des heures différentes',
      }),
    ]);
  });

  it('refuses a whole-day quiet range, slots all off, and two active slots that overlap', () => {
    const parse = (hours: unknown) => AgentHoursSchema.safeParse(hours).success;
    expect(parse(SUGGESTED)).toBe(true);
    expect(parse({ ...DEFAULT_AGENT_HOURS, followUpQuiet: { startMinute: 600, endMinute: 600 } })).toBe(
      false,
    );
    expect(parse(withSlots(slot(1, '09:00', '12:00', false)))).toBe(false);
    expect(parse(withSlots(slot(1, '09:00', '12:00'), slot(1, '11:00', '13:00')))).toBe(false);
    // Monday's slot runs past midnight into Tuesday's.
    expect(parse(withSlots(slot(1, '22:00', '02:00'), slot(2, '01:00', '03:00')))).toBe(false);
    // Sunday night into Monday morning, read around the week.
    expect(parse(withSlots(slot(7, '23:00', '02:00'), slot(1, '01:00', '03:00')))).toBe(false);
    // An overlap with a switched-off slot is allowed: it does not answer.
    expect(parse(withSlots(slot(1, '09:00', '12:00'), slot(1, '11:00', '13:00', false)))).toBe(true);
  });

  it('dates the open stretch from its slot’s opening, slots that follow one another as one', () => {
    expect(replyOpenedAt(DEFAULT_AGENT_HOURS, PARIS, paris('2026-10-27T03:00:00'))).toEqual(new Date(0));
    expect(replyOpenedAt(SUGGESTED, PARIS, paris('2026-10-27T03:00:00'))).toBeNull();
    // Tuesday 0:30 is still Monday's slot, opened Monday at 9:00.
    expect(replyOpenedAt(SUGGESTED, PARIS, paris('2026-10-27T00:30:00'))).toEqual(
      paris('2026-10-26T09:00:00'),
    );
    const chained = withSlots(
      slot(2, '09:00', '13:00'),
      slot(2, '13:00', '18:00'),
      slot(1, '14:00', '20:00'),
    );
    expect(replyOpenedAt(chained, PARIS, paris('2026-10-27T15:00:00'))).toEqual(paris('2026-10-27T09:00:00'));
    // Monday's 14:00 start is not the opening of Tuesday morning's slot.
    expect(replyOpenedAt(chained, PARIS, paris('2026-10-27T10:00:00'))).toEqual(paris('2026-10-27T09:00:00'));
  });

  it('finds no follow-up minute when her slots all fall in her quiet hours', () => {
    const night = withSlots(...[1, 2, 3, 4, 5, 6, 7].map((day) => slot(day, '23:00', '01:00')));
    expect(nextFollowUpAllowed(night, PARIS, paris('2026-10-27T15:00:00'))).toBeNull();
    expect(nextFollowUpAllowed(night, PARIS, paris('2026-10-27T23:30:00'))).toBeNull();
  });

  it('walks a full week of night slots before it finds the one out of her quiet hours', () => {
    // 28 slots, four a night in her quiet hours, but Sunday's last at 10:00: a whole week to walk.
    const nights = ['23:00', '00:00', '01:00', '02:00'];
    const slots = [1, 2, 3, 4, 5, 6, 7].flatMap((day) =>
      nights.map((start, i) =>
        day === 7 && i === 3 ? slot(7, '10:00', '11:00') : slot(day, start, `${start.slice(0, 2)}:30`),
      ),
    );
    const hours = withSlots(...slots);
    expect(AgentHoursSchema.safeParse(hours).success).toBe(true);
    expect(nextFollowUpAllowed(hours, PARIS, paris('2026-10-26T15:00:00'))).toEqual(
      paris('2026-11-01T10:00:00'),
    );
  });

  it('reads a slot that ends at its start as a whole day', () => {
    const saturday = withSlots(slot(6, '00:00', '00:00'), slot(7, '00:00', '00:00'));
    expect(AgentHoursSchema.safeParse(saturday).success).toBe(true);
    expect(replyOpenAt(saturday, PARIS, paris('2026-10-31T00:00:00'))).toBe(true);
    expect(replyOpenAt(saturday, PARIS, paris('2026-10-31T23:59:00'))).toBe(true);
    expect(replyOpenAt(saturday, PARIS, paris('2026-11-02T00:00:00'))).toBe(false);
    expect(replyOpenedAt(saturday, PARIS, paris('2026-11-01T15:00:00'))).toEqual(
      paris('2026-10-31T00:00:00'),
    );
    // A whole Monday from 9:00 runs to Tuesday 9:00, over Tuesday's 8:00 slot.
    expect(
      AgentHoursSchema.safeParse(withSlots(slot(1, '09:00', '09:00'), slot(2, '08:00', '10:00'))).success,
    ).toBe(false);
  });

  it('marks each slot that overlaps an earlier one, at its place in the list, naming the other', () => {
    const hours = withSlots(
      slot(1, '09:00', '01:00'),
      slot(3, '10:00', '12:00', false),
      slot(2, '00:30', '02:00'),
      slot(1, '20:00', '21:30'),
    );
    const result = AgentHoursSchema.safeParse(hours);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => ({ path: issue.path, message: issue.message }))).toEqual([
      {
        path: ['reply', 'slots', 2, 'startMinute'],
        message: 'Chevauche le créneau du lundi, 9\u00a0h\u00a0–\u00a01\u00a0h',
      },
      {
        path: ['reply', 'slots', 3, 'startMinute'],
        message: 'Chevauche le créneau du lundi, 9\u00a0h\u00a0–\u00a01\u00a0h',
      },
    ]);
  });
});
