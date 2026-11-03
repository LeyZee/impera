import {
  CreatorIdSchema,
  PlatformAccountIdSchema,
  TeamMemberIdSchema,
  type AgentHours,
  type AgentMode,
} from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import {
  agentReplySpans,
  coverageOf,
  gridSlots,
  slotsToFill,
  workloadOf,
  type CreatorAgent,
} from '../calendar';

/* Invented creators and members (ADR 0010). Paris is UTC+2 until 25/10/2026 at 3:00, UTC+1 after. */
const at = (value: string): Date => new Date(value);
const NORA = CreatorIdSchema.parse('0199f2a0-0000-7000-8000-000000000001');
const LEA = CreatorIdSchema.parse('0199f2a0-0000-7000-8000-000000000002');
const NORA_REVEAL = PlatformAccountIdSchema.parse('0199f2a0-0000-7000-8000-000000000011');
const LEA_REVEAL = PlatformAccountIdSchema.parse('0199f2a0-0000-7000-8000-000000000012');
const KOFI = TeamMemberIdSchema.parse('0199f2a0-0000-7000-8000-000000000021');
const AMA = TeamMemberIdSchema.parse('0199f2a0-0000-7000-8000-000000000022');
const SETTINGS = { timeZone: 'Europe/Paris', slotStartMinute: 0, slotLengthMinutes: 360 } as const;

const slots = (...ranges: [day: number, start: number, end: number][]): AgentHours['reply'] => ({
  mode: 'slots',
  slots: ranges.map(([day, startMinute, endMinute]) => ({ day, startMinute, endMinute, enabled: true })),
});
const agentOn = (creatorId: typeof NORA, mode: AgentMode, reply: AgentHours['reply']): CreatorAgent => ({
  creatorId,
  timeZone: 'Europe/Paris',
  mode,
  reply,
});
const iso = (spans: readonly { from: Date; to: Date }[]) =>
  spans.map((span) => [span.from.toISOString(), span.to.toISOString()]);

describe('when the agent answers (ADR 0048)', () => {
  const week = { from: at('2026-11-01T23:00:00Z'), to: at('2026-11-08T23:00:00Z') }; // Monday 2 to Monday 9, Paris

  it('answers the whole window when always open, and never under Arrêt', () => {
    expect(iso(agentReplySpans(agentOn(NORA, 'copilot', { mode: 'always' }), week))).toEqual([
      ['2026-11-01T23:00:00.000Z', '2026-11-08T23:00:00.000Z'],
    ]);
    expect(agentReplySpans(agentOn(NORA, 'stop', { mode: 'always' }), week)).toEqual([]);
  });

  it('reads her slots on her clock, a slot past midnight ending the next day', () => {
    // Monday 9:00 to Tuesday 1:00, Paris (UTC+1).
    expect(iso(agentReplySpans(agentOn(NORA, 'auto', slots([1, 540, 60])), week))).toEqual([
      ['2026-11-02T08:00:00.000Z', '2026-11-03T00:00:00.000Z'],
    ]);
  });

  it('keeps a slot’s hours across the change of time, and catches a Sunday slot that runs into Monday', () => {
    // Sunday 25/10 is the night Paris goes back to UTC+1: 0:00–6:00 lasts 7 hours.
    const sunday = { from: at('2026-10-24T22:00:00Z'), to: at('2026-10-25T23:00:00Z') };
    expect(iso(agentReplySpans(agentOn(NORA, 'auto', slots([7, 0, 360])), sunday))).toEqual([
      ['2026-10-24T22:00:00.000Z', '2026-10-25T05:00:00.000Z'],
    ]);
    // Sunday 22:00 to 2:00, read from Monday 0:00: the last two hours.
    const monday = { from: at('2026-11-01T23:00:00Z'), to: at('2026-11-02T23:00:00Z') };
    expect(iso(agentReplySpans(agentOn(NORA, 'auto', slots([7, 1320, 120])), monday))).toEqual([
      ['2026-11-01T23:00:00.000Z', '2026-11-02T01:00:00.000Z'],
    ]);
  });

  it('lasts a whole day for a slot that ends at its start', () => {
    const tuesday = { from: at('2026-11-02T23:00:00Z'), to: at('2026-11-03T23:00:00Z') };
    expect(iso(agentReplySpans(agentOn(NORA, 'auto', slots([2, 600, 600])), tuesday))).toEqual([
      ['2026-11-03T09:00:00.000Z', '2026-11-03T23:00:00.000Z'],
    ]);
  });
});

describe('the créneaux of the grid', () => {
  it('cuts each day at the agency’s hours, one créneau an hour longer the night of the change of time', () => {
    const sunday = { from: at('2026-10-24T22:00:00Z'), to: at('2026-10-25T23:00:00Z') };
    const lengths = gridSlots(SETTINGS, sunday).map(
      (slot) => (slot.to.getTime() - slot.from.getTime()) / 3_600_000,
    );
    expect(lengths).toEqual([7, 6, 6, 6]);
  });
});

describe('the créneaux to fill (ADR 0045 § 2, ADR 0048 § 1)', () => {
  // Tuesday 3/11 in Paris: four créneaux, 0–6, 6–12, 12–18, 18–24.
  const day = { from: at('2026-11-02T23:00:00Z'), to: at('2026-11-03T23:00:00Z') };
  const accounts = [
    { id: NORA_REVEAL, creatorId: NORA },
    { id: LEA_REVEAL, creatorId: LEA },
  ];
  const shift = (platformAccountId: typeof NORA_REVEAL, startsAt: string, endsAt: string) => ({
    platformAccountId,
    startsAt: at(startsAt),
    endsAt: at(endsAt),
  });
  const starts = (cells: readonly { platformAccountId: string; startsAt: Date }[]) =>
    cells.map(
      (cell) => `${cell.platformAccountId === NORA_REVEAL ? 'nora' : 'lea'} ${cell.startsAt.toISOString()}`,
    );

  it('counts each créneau ahead that no shift touches, a créneau partly held being held', () => {
    const { toFill, aiAlone } = slotsToFill({
      settings: SETTINGS,
      accounts,
      // Nora: 0–6 held; 7–9 touches 6–12. Léa: nothing.
      shifts: [
        shift(NORA_REVEAL, '2026-11-02T23:00:00Z', '2026-11-03T05:00:00Z'),
        shift(NORA_REVEAL, '2026-11-03T06:00:00Z', '2026-11-03T08:00:00Z'),
      ],
      agents: [],
      window: day,
      // 13:00 in Paris: the créneau under way still counts, the two before are over.
      now: at('2026-11-03T12:00:00Z'),
    });
    expect(starts(toFill)).toEqual([
      'nora 2026-11-03T11:00:00.000Z',
      'nora 2026-11-03T17:00:00.000Z',
      'lea 2026-11-03T11:00:00.000Z',
      'lea 2026-11-03T17:00:00.000Z',
    ]);
    expect(aiAlone).toEqual([]);
  });

  it('leaves out a créneau the agent holds alone in Automatique, never one in Copilote nor one he holds in part', () => {
    const now = at('2026-11-02T23:00:00Z');
    // Nora's agent answers 9:00–1:00 on Tuesday: 12–18 and 18–24 whole, 6–12 in part.
    const nora = agentOn(NORA, 'auto', slots([2, 540, 60]));
    const lea = agentOn(LEA, 'copilot', { mode: 'always' });
    const { toFill, aiAlone } = slotsToFill({
      settings: SETTINGS,
      accounts,
      shifts: [],
      agents: [nora, lea],
      window: day,
      now,
    });
    expect(starts(aiAlone)).toEqual(['nora 2026-11-03T11:00:00.000Z', 'nora 2026-11-03T17:00:00.000Z']);
    expect(starts(toFill)).toEqual([
      'nora 2026-11-02T23:00:00.000Z',
      'nora 2026-11-03T05:00:00.000Z',
      'lea 2026-11-02T23:00:00.000Z',
      'lea 2026-11-03T05:00:00.000Z',
      'lea 2026-11-03T11:00:00.000Z',
      'lea 2026-11-03T17:00:00.000Z',
    ]);
    // Under the stop, everything is to fill again.
    const stopped = slotsToFill({
      settings: SETTINGS,
      accounts,
      shifts: [],
      agents: [{ ...nora, mode: 'stop' }],
      window: day,
      now,
    });
    expect(stopped.aiAlone).toEqual([]);
    expect(stopped.toFill).toHaveLength(8);
  });

  it('keeps to fill a créneau a shift holds in part, with its open stretches, as Planning counts it (EQ-01)', () => {
    // Créneaux from 8:00: a shift 10:00–16:00, across two créneaux, leaves 8–10 open in 8–14 and 16–20 in 14–20.
    const across = (mode: AgentMode) =>
      slotsToFill({
        settings: { ...SETTINGS, slotStartMinute: 480 },
        accounts: [{ id: NORA_REVEAL, creatorId: NORA }],
        shifts: [shift(NORA_REVEAL, '2026-11-03T09:00:00Z', '2026-11-03T15:00:00Z')],
        agents: [agentOn(NORA, mode, { mode: 'always' })],
        window: { from: at('2026-11-03T07:00:00Z'), to: at('2026-11-03T19:00:00Z') },
        now: at('2026-11-02T12:00:00Z'),
      });
    const copilot = across('copilot');
    expect(copilot.toFill.map((cell) => iso(cell.open))).toEqual([
      [['2026-11-03T07:00:00.000Z', '2026-11-03T09:00:00.000Z']],
      [['2026-11-03T15:00:00.000Z', '2026-11-03T19:00:00.000Z']],
    ]);
    expect(copilot.aiAlone).toEqual([]);
    // In Automatique too: a créneau with a chatter on it is never « IA seule », and its hole is never hidden.
    expect(across('auto')).toEqual(copilot);
  });

  it('says « IA seule » on what is left of a créneau under way once its shift is over', () => {
    // 6–12 in Paris: a shift 6:00–8:00 is over at 9:00; the agent answers the rest from 8:00 in Automatique.
    const { toFill, aiAlone } = slotsToFill({
      settings: SETTINGS,
      accounts: [{ id: NORA_REVEAL, creatorId: NORA }],
      shifts: [shift(NORA_REVEAL, '2026-11-03T05:00:00Z', '2026-11-03T07:00:00Z')],
      agents: [agentOn(NORA, 'auto', slots([2, 480, 720]))],
      window: { from: at('2026-11-03T05:00:00Z'), to: at('2026-11-03T11:00:00Z') },
      now: at('2026-11-03T08:00:00Z'),
    });
    expect(toFill).toEqual([]);
    expect(iso(aiAlone.flatMap((cell) => cell.open))).toEqual([
      ['2026-11-03T08:00:00.000Z', '2026-11-03T11:00:00.000Z'],
    ]);
  });

  it('opens a créneau under way from the next minute, and holds one a shift covers whole', () => {
    const { toFill } = slotsToFill({
      settings: SETTINGS,
      accounts: [{ id: NORA_REVEAL, creatorId: NORA }],
      // 6–12 (Paris) covered until 10:00 only; 12–18 covered whole by two shifts end to end.
      shifts: [
        shift(NORA_REVEAL, '2026-11-03T05:00:00Z', '2026-11-03T09:00:00Z'),
        shift(NORA_REVEAL, '2026-11-03T11:00:00Z', '2026-11-03T14:00:00Z'),
        shift(NORA_REVEAL, '2026-11-03T14:00:00Z', '2026-11-03T17:00:00Z'),
      ],
      agents: [],
      window: { from: at('2026-11-03T05:00:00Z'), to: at('2026-11-03T17:00:00Z') },
      // 8:30:20 in Paris: the open stretch of 6–12 starts at 10:00, after the shift.
      now: at('2026-11-03T07:30:20Z'),
    });
    expect(toFill.map((cell) => iso(cell.open))).toEqual([
      [['2026-11-03T09:00:00.000Z', '2026-11-03T11:00:00.000Z']],
    ]);
  });

  it('asks the agent for what is left of a créneau under way only', () => {
    // 10:00 in Paris; the agent answers from 9:00: the rest of 6–12 is his.
    const { aiAlone } = slotsToFill({
      settings: SETTINGS,
      accounts: [accounts[0] ?? { id: NORA_REVEAL, creatorId: NORA }],
      shifts: [],
      agents: [agentOn(NORA, 'auto', slots([2, 540, 60]))],
      window: day,
      now: at('2026-11-03T09:00:00Z'),
    });
    expect(starts(aiAlone)[0]).toBe('nora 2026-11-03T05:00:00.000Z');
  });
});

describe('each member’s hours and the coverage of an account', () => {
  const week = { from: at('2026-11-01T23:00:00Z'), to: at('2026-11-08T23:00:00Z') };

  it('sums each member’s minutes inside the window, a shift across its edge counted in part', () => {
    expect(
      workloadOf(
        [
          { memberId: KOFI, startsAt: at('2026-11-01T20:00:00Z'), endsAt: at('2026-11-02T02:00:00Z') },
          { memberId: KOFI, startsAt: at('2026-11-03T08:00:00Z'), endsAt: at('2026-11-03T14:00:00Z') },
          { memberId: AMA, startsAt: at('2026-11-04T08:00:00Z'), endsAt: at('2026-11-04T10:00:00Z') },
        ],
        week,
      ),
    ).toEqual([
      { memberId: KOFI, minutes: 540 },
      { memberId: AMA, minutes: 120 },
    ]);
  });

  it('makes 168 h a week per account, the agent alone counted in Automatique only', () => {
    const shifts = [{ startsAt: at('2026-11-02T08:00:00Z'), endsAt: at('2026-11-02T14:00:00Z') }];
    const reply = slots([1, 540, 60]); // Monday 9:00–1:00, Paris: 8:00–0:00 UTC
    const auto = coverageOf(shifts, agentOn(NORA, 'auto', reply), week);
    expect(auto.withAgent + auto.chatterAlone + auto.agentAlone + auto.nobody).toBe(168 * 60);
    expect(auto).toEqual({ withAgent: 360, chatterAlone: 0, agentAlone: 600, nobody: 168 * 60 - 960 });
    const copilot = coverageOf(shifts, agentOn(NORA, 'copilot', reply), week);
    expect(copilot).toEqual({ withAgent: 360, chatterAlone: 0, agentAlone: 0, nobody: 168 * 60 - 360 });
    expect(coverageOf(shifts, null, week)).toEqual({
      withAgent: 0,
      chatterAlone: 360,
      agentAlone: 0,
      nobody: 168 * 60 - 360,
    });
  });

  it('makes 169 h the week Paris goes back an hour', () => {
    const week = { from: at('2026-10-18T22:00:00Z'), to: at('2026-10-25T23:00:00Z') };
    const coverage = coverageOf([], agentOn(NORA, 'auto', { mode: 'always' }), week);
    expect(coverage.agentAlone).toBe(169 * 60);
  });
});
