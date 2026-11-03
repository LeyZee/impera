import { CalendarAgentSchema, CalendarSchema, type Calendar, type CalendarAgent } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  agentRowLabel,
  agentSlotLabel,
  calendarRows,
  cellAgentWords,
  monthMarks,
  monthBounds,
  monthWindow,
} from './calendar';
import { zonedInstant } from './time';

import { settingsOf } from '@/test/settings';

const PARIS = 'Europe/Paris';
const id = (n: number): string => `0199f2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const INES = id(1);
const KOFI = id(21);
const ADA = id(22);
const DAY = '2026-11-04';
const at = (minute: number, day = DAY): string => zonedInstant(day, minute, PARIS).toISOString();
const NBSP = ' ';
const words = (text: string): string => text.replaceAll(NBSP, ' ');

/** Four créneaux of 6 h from midnight, one creator, the agent as given. */
const calendarOf = (patch: Partial<z.input<typeof CalendarSchema>> = {}): Calendar =>
  CalendarSchema.parse({
    view: 'team',
    settings: settingsOf(),
    creators: [{ id: INES, name: 'Inès' }],
    members: [
      { id: KOFI, displayName: 'Kofi', color: '#7aa2ff' },
      { id: ADA, displayName: 'Ada', color: '#5fd0b5' },
    ],
    shifts: [],
    agent: [],
    agency: null,
    ...patch,
  });

const agentOf = (
  mode: 'auto' | 'copilot' | 'stop',
  answers: [number, number][],
  reply: z.input<typeof CalendarAgentSchema>['reply'] = { mode: 'always' },
): CalendarAgent =>
  CalendarAgentSchema.parse({
    creatorId: INES,
    timeZone: PARIS,
    mode,
    reply,
    answers: answers.map(([from, to]) => ({ startsAt: at(from), endsAt: at(to) })),
  });

const cellsOf = (calendar: Calendar, now: string, day = DAY) => {
  const [row] = calendarRows(calendar, [day], new Date(now));
  return row?.days.get(day) ?? [];
};

describe('calendarRows', () => {
  it('cuts the day into the agency créneaux and draws a shift on each créneau it touches', () => {
    const cells = cellsOf(
      calendarOf({ shifts: [{ memberId: KOFI, creatorId: INES, startsAt: at(600), endsAt: at(960) }] }),
      at(0, '2026-11-01'),
    );
    expect(cells.map((cell) => cell.from.toISOString())).toEqual([at(0), at(360), at(720), at(1080)]);
    // 10 h – 16 h touches the créneau of 12 h too, and is drawn there with its own hours (ADR 0049 § 1).
    expect(cells.map((cell) => cell.shifts.length)).toEqual([0, 1, 1, 0]);
    expect(cells.map((cell) => cell.held)).toEqual([false, true, true, false]);
  });

  it('draws a shift begun before the window in the first créneau', () => {
    const cells = cellsOf(
      calendarOf({
        shifts: [{ memberId: ADA, creatorId: INES, startsAt: at(-120), endsAt: at(180) }],
      }),
      at(0, '2026-11-01'),
    );
    expect(cells[0]?.shifts.map((one) => one.memberId)).toEqual([ADA]);
  });

  it('says how much of each créneau the agent answers', () => {
    const cells = cellsOf(calendarOf({ agent: [agentOf('copilot', [[540, 1440]])] }), at(0, '2026-11-01'));
    expect(cells[0]?.agent).toBeNull();
    const [, morning, afternoon] = cells;
    expect(morning?.agent?.full).toBe(false);
    expect(words(agentSlotLabel(morning?.agent ?? never(), morning ?? never(), PARIS))).toBe('IA dès 9 h');
    expect(afternoon?.agent?.full).toBe(true);
    expect(agentSlotLabel(afternoon?.agent ?? never(), afternoon ?? never(), PARIS)).toBe('IA');
    expect(words(cellAgentWords(morning?.agent ?? null, morning ?? never(), PARIS))).toBe(
      ' ; l’IA en copilote dès 9 h',
    );
  });

  it('ends the agent part where he stops answering', () => {
    const [night] = cellsOf(calendarOf({ agent: [agentOf('auto', [[0, 60]])] }), at(0, '2026-11-01'));
    expect(words(agentSlotLabel(night?.agent ?? never(), night ?? never(), PARIS))).toBe('IA jusqu’à 1 h');
  });

  it('holds « IA seule » for a créneau with no chatter that the agent answers whole in Automatique', () => {
    const shifts = [{ memberId: KOFI, creatorId: INES, startsAt: at(720), endsAt: at(900) }];
    const auto = cellsOf(calendarOf({ shifts, agent: [agentOf('auto', [[0, 1440]])] }), at(0, '2026-11-01'));
    // The créneau of 12 h has a chatter for part of it: not « IA seule », whatever the agent covers.
    expect(auto.map((cell) => cell.aiAlone)).toEqual([true, true, false, true]);
    const copilot = cellsOf(
      calendarOf({ shifts, agent: [agentOf('copilot', [[0, 1440]])] }),
      at(0, '2026-11-01'),
    );
    expect(copilot.some((cell) => cell.aiAlone)).toBe(false);
    const stopped = cellsOf(calendarOf({ shifts, agent: [agentOf('stop', [])] }), at(0, '2026-11-01'));
    expect(stopped.every((cell) => cell.agent === null && !cell.aiAlone)).toBe(true);
  });

  it('measures a créneau under way on what is left of it', () => {
    const shifts = [{ memberId: KOFI, creatorId: INES, startsAt: at(720), endsAt: at(900) }];
    const calendar = calendarOf({ shifts, agent: [agentOf('auto', [[960, 1440]])] });
    // At 15 h 30 the shift is over and the agent answers from 16 h: the rest still has an hole.
    expect(cellsOf(calendar, at(930))[2]?.aiAlone).toBe(false);
    // At 16 h 00 m 20 s, the rest opens at the next minute: nobody but the agent is left on it.
    expect(cellsOf(calendar, new Date(Date.parse(at(960)) + 20_000).toISOString())[2]?.aiAlone).toBe(true);
  });

  it('keeps the wall-clock créneaux on the night the clocks go back', () => {
    const day = '2026-10-25';
    const cells = cellsOf(calendarOf(), at(0, '2026-10-20'), day);
    const hours = cells.map((cell) => (cell.to.getTime() - cell.from.getTime()) / 3_600_000);
    expect(hours).toEqual([7, 6, 6, 6]);
  });

  it('keeps the wall-clock créneaux on the night the clocks go forward', () => {
    // 28 March 2027 in Paris: 0 h – 6 h lasts five hours.
    const day = '2027-03-28';
    const cells = cellsOf(calendarOf(), at(0, '2027-03-20'), day);
    const hours = cells.map((cell) => (cell.to.getTime() - cell.from.getTime()) / 3_600_000);
    expect(hours).toEqual([5, 6, 6, 6]);
  });
});

describe('agentRowLabel', () => {
  it('says the mode and the hours of the agent', () => {
    expect(agentRowLabel(agentOf('auto', []))).toBe('IA automatique · jour et nuit');
    expect(agentRowLabel(agentOf('stop', []))).toBe('IA à l’arrêt');
    const week = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
      day,
      startMinute: 540,
      endMinute: 60,
      enabled: true,
    }));
    expect(words(agentRowLabel(agentOf('copilot', [], { mode: 'slots', slots: week })))).toBe(
      'IA copilote · 9 h – 1 h',
    );
    const weekdays = week.map((slot) => ({ ...slot, enabled: slot.day < 6 }));
    expect(words(agentRowLabel(agentOf('auto', [], { mode: 'slots', slots: weekdays })))).toBe(
      'IA automatique · 9 h – 1 h, certains jours',
    );
    const uneven = week.map((slot) => (slot.day === 6 ? { ...slot, endMinute: 180 } : slot));
    expect(agentRowLabel(agentOf('auto', [], { mode: 'slots', slots: uneven }))).toBe(
      'IA automatique · selon les jours',
    );
  });
});

describe('monthWindow', () => {
  it('reads six weeks from the Monday of the week of the 1st', () => {
    const window = monthWindow('2026-12', PARIS);
    expect(window.days[0]).toBe('2026-11-30');
    expect(window.days).toHaveLength(42);
    expect(window.to.getTime() - window.from.getTime()).toBe(42 * 24 * 3_600_000);
  });

  it('cuts back the hour the autumn change adds, so that the server reads it', () => {
    const window = monthWindow('2026-10', PARIS);
    expect(window.days[0]).toBe('2026-09-28');
    expect(window.to.getTime() - window.from.getTime()).toBe(42 * 24 * 3_600_000);
    expect(window.from.toISOString()).toBe(at(0, '2026-09-28'));
  });
});

describe('monthBounds', () => {
  it('reads the month itself, 1st to 1st at midnight, the autumn hour included', () => {
    const bounds = monthBounds('2026-10', PARIS);
    expect(bounds.from.toISOString()).toBe('2026-09-30T22:00:00.000Z');
    expect(bounds.to.toISOString()).toBe('2026-10-31T23:00:00.000Z');
    expect(bounds.to.getTime() - bounds.from.getTime()).toBe((31 * 24 + 1) * 3_600_000);
  });

  it('crosses the year', () => {
    expect(monthBounds('2026-12', PARIS).to.toISOString()).toBe('2026-12-31T23:00:00.000Z');
  });
});

describe('monthMarks', () => {
  it('marks each créneau with its member, the agent alone, or a gap ahead', () => {
    const calendar = calendarOf({
      shifts: [{ memberId: KOFI, creatorId: INES, startsAt: at(360), endsAt: at(720) }],
      agent: [agentOf('auto', [[1080, 1440]])],
    });
    const now = at(0, '2026-11-01');
    expect(monthMarks(cellsOf(calendar, now), new Date(now))).toEqual([
      { kind: 'gap', ahead: true },
      { kind: 'shift', memberId: KOFI },
      { kind: 'gap', ahead: true },
      { kind: 'ai' },
    ]);
    // Past créneaux are no longer gaps to fill.
    const later = at(0, '2026-11-05');
    expect(monthMarks(cellsOf(calendar, later), new Date(later))[0]).toEqual({ kind: 'gap', ahead: false });
  });
});

function never(): never {
  throw new Error('missing');
}
