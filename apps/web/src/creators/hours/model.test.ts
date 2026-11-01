import { DEFAULT_AGENT_HOURS, SUGGESTED_REPLY_SLOTS, type AgentHours } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import {
  barsOf,
  canAddSlot,
  clockHeader,
  isDefaultHours,
  issuesOf,
  newSlotOn,
  noSlotWhy,
  noFollowUpEver,
  orderedSlots,
  rangeIssue,
  slotIssue,
  slotNote,
  slotsByDay,
  slotsToOffer,
  sortedHours,
  slotWords,
  WEEK_FULL,
} from './model';

const NBSP = '\u00a0';
const slots = (reply: Extract<AgentHours['reply'], { mode: 'slots' }>): AgentHours => ({
  ...DEFAULT_AGENT_HOURS,
  reply,
});

describe('her hours in words (P3-14)', () => {
  it('says a slot as the planning does, with no-break spaces', () => {
    expect(slotWords({ startMinute: 540, endMinute: 60 })).toBe(
      `9${NBSP}h${NBSP}–${NBSP}1${NBSP}h, jusqu’au lendemain`,
    );
    expect(slotWords({ startMinute: 570, endMinute: 1080 })).toBe(
      `9${NBSP}h${NBSP}30${NBSP}–${NBSP}18${NBSP}h`,
    );
    expect(slotWords({ startMinute: 0, endMinute: 0 })).toBe('toute la journée');
    // Ending at 0 h closes her day: nothing falls on the next one.
    expect(slotWords({ startMinute: 1080, endMinute: 0 })).toBe(`18${NBSP}h${NBSP}–${NBSP}0${NBSP}h`);
  });

  it('names whose clock the page reads, by her first name and her city', () => {
    expect(clockHeader('Nora Vidal', 'Europe/Paris')).toBe('À l’heure de Nora (Paris)');
    expect(clockHeader('Nora', 'America/Sao_Paulo')).toBe('À l’heure de Nora (São Paulo)');
  });
});

describe('her week', () => {
  it('draws an overnight slot on two days, Sunday night going on to Monday', () => {
    expect(
      barsOf([
        { day: 7, startMinute: 1380, endMinute: 120, enabled: true },
        { day: 2, startMinute: 600, endMinute: 600, enabled: false },
        { day: 3, startMinute: 1200, endMinute: 0, enabled: true },
      ]),
    ).toEqual([
      { day: 7, from: 1380, to: 1440, enabled: true, continued: false, index: 0 },
      { day: 1, from: 0, to: 120, enabled: true, continued: true, index: 0 },
      { day: 2, from: 0, to: 1440, enabled: false, continued: false, index: 1 },
      { day: 3, from: 1200, to: 1440, enabled: true, continued: false, index: 2 },
    ]);
  });

  it('lists the slots in the order of the week, each with its place in the setting', () => {
    const list = orderedSlots([
      { day: 3, startMinute: 600, endMinute: 700, enabled: true },
      { day: 1, startMinute: 800, endMinute: 900, enabled: true },
      { day: 1, startMinute: 300, endMinute: 400, enabled: true },
    ]);
    expect(list.map((l) => l.index)).toEqual([2, 1, 0]);
  });

  it('sorts her slots only when asked, and groups them by day in the order of the setting', () => {
    const unsorted = [
      { day: 3, startMinute: 600, endMinute: 700, enabled: true },
      { day: 1, startMinute: 800, endMinute: 900, enabled: true },
      { day: 1, startMinute: 300, endMinute: 400, enabled: true },
    ];
    const sorted = sortedHours({ ...DEFAULT_AGENT_HOURS, reply: { mode: 'slots', slots: unsorted } });
    expect(sorted.reply.mode === 'slots' && sorted.reply.slots.map((s) => s.startMinute)).toEqual([
      300, 800, 600,
    ]);
    const days = slotsByDay(unsorted);
    expect(days).toHaveLength(7);
    expect(days[0]?.lines.map((l) => l.index)).toEqual([1, 2]);
    expect(days[1]?.lines).toEqual([]);
    expect(days[2]?.lines.map((l) => l.index)).toEqual([0]);
  });

  it('says in words only what the two hours do not', () => {
    expect(slotNote({ startMinute: 540, endMinute: 780 })).toBeNull();
    expect(slotNote({ startMinute: 1080, endMinute: 60 })).toBe('jusqu’au lendemain');
    expect(slotNote({ startMinute: 1080, endMinute: 0 })).toBeNull();
    expect(slotNote({ startMinute: 0, endMinute: 0 })).toBe('toute la journée');
  });

  it('adds 9 h – 1 h on a day without a slot, else its first free stretch, and stops at 28', () => {
    expect(newSlotOn([{ day: 1, startMinute: 0, endMinute: 0, enabled: true }], 2)).toEqual({
      day: 2,
      startMinute: 540,
      endMinute: 60,
      enabled: true,
    });
    // Every day taken (recette 28/10): the first free stretch of that day, never a line that overlaps at once.
    const added = newSlotOn(SUGGESTED_REPLY_SLOTS, 1);
    expect(added).toEqual({ day: 1, startMinute: 60, endMinute: 540, enabled: true });
    if (added === null) throw new Error('a free stretch is left');
    expect(issuesOf(slots({ mode: 'slots', slots: [...SUGGESTED_REPLY_SLOTS, added] })).size).toBe(0);
    expect(newSlotOn(SUGGESTED_REPLY_SLOTS, 3)).toEqual({
      day: 3,
      startMinute: 60,
      endMinute: 540,
      enabled: true,
    });
    // A day-long slot on Tuesday leaves no room for 9 h – 1 h on Monday: Monday's first free stretch instead.
    const tuesday = [
      { day: 2, startMinute: 0, endMinute: 0, enabled: true },
      ...[3, 4, 5, 6, 7].map((day) => ({ day, startMinute: 600, endMinute: 1200, enabled: true })),
    ];
    expect(newSlotOn(tuesday, 1)).toEqual({ day: 1, startMinute: 0, endMinute: 960, enabled: true });
    expect(newSlotOn(tuesday, 2)).toBeNull();
    const week = [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, startMinute: 0, endMinute: 0, enabled: true }));
    expect(newSlotOn(week, 4)).toBeNull();
    const one = { day: 1, startMinute: 540, endMinute: 60, enabled: true };
    expect(canAddSlot(Array.from({ length: 27 }, () => one))).toBe(true);
    expect(canAddSlot(Array.from({ length: 28 }, () => one))).toBe(false);
  });

  it('says in words why « Ajouter » adds nothing that day, and leaves a full week to its one line', () => {
    const tuesday = [{ day: 2, startMinute: 0, endMinute: 0, enabled: true }];
    expect(noSlotWhy(tuesday, 1)).toBeNull();
    expect(noSlotWhy(tuesday, 2)).toBe('Plus une heure de libre ce jour-là : raccourcis un créneau d’abord.');
    const one = { day: 1, startMinute: 540, endMinute: 600, enabled: true };
    expect(
      noSlotWhy(
        Array.from({ length: 28 }, () => one),
        3,
      ),
    ).toBeNull();
    expect(WEEK_FULL).toBe('28 créneaux au plus dans la semaine : retires-en un d’abord.');
  });

  it('offers back the slots she had, or 9 h – 1 h every day', () => {
    const kept = [{ day: 4, startMinute: 600, endMinute: 900, enabled: true }];
    expect(slotsToOffer(kept)).toEqual(kept);
    expect(slotsToOffer(null)).toEqual(SUGGESTED_REPLY_SLOTS);
    expect(slotsToOffer([])).toEqual(SUGGESTED_REPLY_SLOTS);
  });
});

describe('what the contract refuses, on its line', () => {
  it('puts an overlap on the later slot, and names the other', () => {
    const hours = slots({
      mode: 'slots',
      slots: [
        { day: 1, startMinute: 540, endMinute: 60, enabled: true },
        { day: 2, startMinute: 0, endMinute: 120, enabled: true },
      ],
    });
    const issues = issuesOf(hours);
    expect(slotIssue(issues, 0)).toBeNull();
    expect(slotIssue(issues, 1)).toBe(`Chevauche le créneau du lundi, 9${NBSP}h${NBSP}–${NBSP}1${NBSP}h`);
  });

  it('says when no slot is on, and when a range starts where it ends', () => {
    const issues = issuesOf({
      ...slots({ mode: 'slots', slots: [{ day: 1, startMinute: 540, endMinute: 60, enabled: false }] }),
      night: { startMinute: 600, endMinute: 600 },
    });
    expect(issues.get('reply.slots')).toBe('Au moins un créneau actif ; pour tout couper, c’est l’arrêt');
    expect(rangeIssue(issues, 'night')).toBe('Une plage doit commencer et finir à des heures différentes');
    expect(rangeIssue(issues, 'followUpQuiet')).toBeNull();
  });

  it('knows the defaults, which are saved as none', () => {
    expect(isDefaultHours(DEFAULT_AGENT_HOURS)).toBe(true);
    expect(isDefaultHours({ ...DEFAULT_AGENT_HOURS, night: { startMinute: 1380, endMinute: 420 } })).toBe(
      false,
    );
  });

  it('warns when no follow-up could ever go out', () => {
    const now = new Date('2026-10-27T12:00:00Z');
    const lateOnly = slots({
      mode: 'slots',
      slots: [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, startMinute: 1380, endMinute: 60, enabled: true })),
    });
    expect(noFollowUpEver(lateOnly, 'Europe/Paris', now)).toBe(true);
    expect(
      noFollowUpEver(slots({ mode: 'slots', slots: [...SUGGESTED_REPLY_SLOTS] }), 'Europe/Paris', now),
    ).toBe(false);
    expect(noFollowUpEver(DEFAULT_AGENT_HOURS, 'Europe/Paris', now)).toBe(false);
    // Every slot off: the contract refuses it, and its own error says so, not this warning.
    const allOff = slots({
      mode: 'slots',
      slots: SUGGESTED_REPLY_SLOTS.map((slot) => ({ ...slot, enabled: false })),
    });
    expect(noFollowUpEver(allOff, 'Europe/Paris', now)).toBe(false);
  });
});
