import { describe, expect, it } from 'vitest';

import {
  oldestRemindableEnd,
  reportReminder,
  reportReminderDue,
  type ReportReminderFacts,
} from '../report-reminders';

const MINUTE = 60_000;

/** A night shift in Paris (UTC+1 in November): 23 h on the 10th to 5 h on the 11th. */
const night: ReportReminderFacts = {
  shift: {
    id: 'shift-nuit',
    startsAt: new Date('2026-11-10T22:00:00Z'),
    endsAt: new Date('2026-11-11T04:00:00Z'),
  },
  cancelled: false,
  reported: false,
  earningsSource: 'declared',
  member: { userId: 'user-theo', status: 'active', timeZone: 'Europe/Paris' },
};

const after = (facts: ReportReminderFacts, minutes: number): Date =>
  new Date(facts.shift.endsAt.getTime() + minutes * MINUTE);

describe('reportReminderDue (ADR 0077 § 1 and § 2)', () => {
  it('is the first reminder from 15 minutes after the end, until 2 hours after', () => {
    expect(reportReminderDue(night, after(night, 14))).toBeNull();
    expect(reportReminderDue(night, after(night, 15))).toBe(1);
    expect(reportReminderDue(night, after(night, 119))).toBe(1);
    expect(reportReminderDue(night, after(night, 120))).toBeNull();
  });

  it('is the second from 12 hours after the end, until 14 hours after, then nothing', () => {
    expect(reportReminderDue(night, after(night, 12 * 60 - 1))).toBeNull();
    expect(reportReminderDue(night, after(night, 12 * 60))).toBe(2);
    expect(reportReminderDue(night, after(night, 14 * 60 - 1))).toBe(2);
    expect(reportReminderDue(night, after(night, 14 * 60))).toBeNull();
    expect(reportReminderDue(night, after(night, 3 * 24 * 60))).toBeNull();
  });

  it('is nothing for a cancelled shift, a report already there, or a member who left', () => {
    const at = after(night, 20);
    expect(reportReminderDue({ ...night, cancelled: true }, at)).toBeNull();
    expect(reportReminderDue({ ...night, reported: true }, at)).toBeNull();
    expect(reportReminderDue({ ...night, member: { ...night.member, status: 'left' } }, at)).toBeNull();
  });

  it('is nothing on a fortnight paid on the sales read, or without pay rules', () => {
    const at = after(night, 20);
    expect(reportReminderDue({ ...night, earningsSource: 'detected' }, at)).toBeNull();
    expect(reportReminderDue({ ...night, earningsSource: null }, at)).toBeNull();
  });

  it('reads the shifts that ended at most 14 hours ago', () => {
    expect(oldestRemindableEnd(new Date('2026-11-11T18:00:00Z')).toISOString()).toBe(
      '2026-11-11T04:00:00.000Z',
    );
  });
});

describe('reportReminder (ADR 0077 § 3 to § 5)', () => {
  it('rings the first as the end of one’s own shift, with the hours of the shift and nothing else', () => {
    expect(reportReminder(1, night, after(night, 15))).toEqual({
      userId: 'user-theo',
      reason: 'own_shift_end',
      objectKey: 'shift-report:shift-nuit:1',
      timeZone: 'Europe/Paris',
      message: {
        title: 'Rapport de fin de shift',
        body: 'Ton shift de 23 h – 5 h est fini : fais ton rapport.',
        url: '/aujourdhui',
        tag: 'shift-report:shift-nuit',
      },
    });
  });

  it('rings the second as a plain reminder, its own object, the same tag', () => {
    const second = reportReminder(2, night, after(night, 12 * 60));
    expect(second).toMatchObject({
      reason: 'reminder',
      objectKey: 'shift-report:shift-nuit:2',
      message: {
        body: 'Ton rapport du shift d’hier, 23 h – 5 h, n’est pas encore fait.',
        tag: 'shift-report:shift-nuit',
      },
    });
  });

  it('says the day the shift started as the member reads it, and the minutes when there are', () => {
    // 0 h 30 to 6 h on the 11th in Paris, reminded at 18 h the same day.
    const early: ReportReminderFacts = {
      ...night,
      shift: {
        id: 'shift-aube',
        startsAt: new Date('2026-11-10T23:30:00Z'),
        endsAt: new Date('2026-11-11T05:00:00Z'),
      },
    };
    expect(reportReminder(2, early, after(early, 12 * 60)).message.body).toBe(
      'Ton rapport du shift d’aujourd’hui, 0 h 30 – 6 h, n’est pas encore fait.',
    );
    // Monday the 9th at 23 h to Tuesday at 23 h, reminded on Wednesday at 11 h.
    const long: ReportReminderFacts = {
      ...night,
      shift: {
        id: 'shift-long',
        startsAt: new Date('2026-11-09T22:00:00Z'),
        endsAt: new Date('2026-11-10T22:00:00Z'),
      },
    };
    expect(reportReminder(2, long, after(long, 12 * 60)).message.body).toBe(
      'Ton rapport du shift de lundi, 23 h – 23 h, n’est pas encore fait.',
    );
  });

  it('reads the hours in the member’s own zone', () => {
    const abroad: ReportReminderFacts = {
      ...night,
      member: { ...night.member, timeZone: 'America/New_York' },
    };
    expect(reportReminder(1, abroad, after(abroad, 15))).toMatchObject({
      timeZone: 'America/New_York',
      message: { body: 'Ton shift de 17 h – 23 h est fini : fais ton rapport.' },
    });
  });
});
