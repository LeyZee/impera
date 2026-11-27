import { CreatorIdSchema, PlatformAccountIdSchema, type AgentHours, type AgentMode } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { CreatorAgent } from '../calendar';
import { uncoveredSlotStarts } from '../uncovered';

/* Invented creators (ADR 0010). Friday 20/11/2026: Paris is UTC+1, the 12 h créneau begins at 11:00Z. */
const at = (value: string): Date => new Date(value);
const NORA = CreatorIdSchema.parse('0199f2a0-0000-7000-8000-000000000001');
const LEA = CreatorIdSchema.parse('0199f2a0-0000-7000-8000-000000000002');
const NORA_REVEAL = PlatformAccountIdSchema.parse('0199f2a0-0000-7000-8000-000000000011');
const LEA_REVEAL = PlatformAccountIdSchema.parse('0199f2a0-0000-7000-8000-000000000012');

/** Four créneaux of 6 h from midnight, Paris. */
const SETTINGS = {
  timeZone: 'Europe/Paris',
  versions: [
    {
      id: null,
      effectiveAt: null,
      seats: [],
      slots: [0, 1, 2, 3].map((index) => ({
        startMinute: index * 360,
        endMinute: ((index + 1) * 360) % 1440,
        name: null,
      })),
    },
  ],
};
const ACCOUNTS = [
  { id: NORA_REVEAL, creatorId: NORA },
  { id: LEA_REVEAL, creatorId: LEA },
];
const ALWAYS: AgentHours['reply'] = { mode: 'always' };
const agentOn = (
  creatorId: typeof NORA,
  mode: AgentMode,
  reply: AgentHours['reply'] = ALWAYS,
): CreatorAgent => ({
  creatorId,
  timeZone: 'Europe/Paris',
  mode,
  reply,
});
const COPILOT = [agentOn(NORA, 'copilot'), agentOn(LEA, 'copilot')];
const shift = (account: typeof NORA_REVEAL, from: string, to: string) => ({
  platformAccountId: account,
  startsAt: at(from),
  endsAt: at(to),
});

const run = (input: {
  shifts?: ReturnType<typeof shift>[];
  agents?: CreatorAgent[];
  now?: string;
}): string[] =>
  uncoveredSlotStarts({
    settings: SETTINGS,
    accounts: ACCOUNTS,
    shifts: input.shifts ?? [],
    agents: input.agents ?? COPILOT,
    now: at(input.now ?? '2026-11-20T11:03:00Z'),
  }).map((slot) => `${slot.creatorId === NORA ? 'nora' : 'lea'} ${slot.startsAt.toISOString()}`);

describe('compte sans personne (ADR 0094 § 1)', () => {
  it('names each account whose créneau began with no chatter and the agent in Copilote', () => {
    const slots = uncoveredSlotStarts({
      settings: SETTINGS,
      accounts: ACCOUNTS,
      shifts: [shift(LEA_REVEAL, '2026-11-20T11:00:00Z', '2026-11-20T17:00:00Z')],
      agents: COPILOT,
      now: at('2026-11-20T11:03:00Z'),
    });
    expect(slots).toEqual([
      {
        creatorId: NORA,
        platformAccountId: NORA_REVEAL,
        startsAt: at('2026-11-20T11:00:00Z'),
        endsAt: at('2026-11-20T17:00:00Z'),
      },
    ]);
  });

  it('counts the créneau’s start: a chatter who arrives later leaves it without anybody at its start', () => {
    expect(run({ shifts: [shift(NORA_REVEAL, '2026-11-20T11:30:00Z', '2026-11-20T17:00:00Z')] })).toContain(
      'nora 2026-11-20T11:00:00.000Z',
    );
  });

  it('is quiet when a shift began before the créneau and holds its start', () => {
    expect(
      run({
        shifts: [
          shift(NORA_REVEAL, '2026-11-20T09:00:00Z', '2026-11-20T13:00:00Z'),
          shift(LEA_REVEAL, '2026-11-20T11:00:00Z', '2026-11-20T12:00:00Z'),
        ],
      }),
    ).toEqual([]);
  });

  it('is quiet when the agent answers its start in Automatique, and not when he is stopped', () => {
    expect(run({ agents: [agentOn(NORA, 'auto'), agentOn(LEA, 'stop')] })).toEqual([
      'lea 2026-11-20T11:00:00.000Z',
    ]);
  });

  it('counts an Automatique whose hours begin after the créneau’s start', () => {
    // Friday (5), from 14 h to 18 h, Paris: the créneau begins at 12 h with nobody.
    const later: AgentHours['reply'] = {
      mode: 'slots',
      slots: [{ day: 5, startMinute: 14 * 60, endMinute: 18 * 60, enabled: true }],
    };
    expect(run({ agents: [agentOn(NORA, 'auto', later), agentOn(LEA, 'auto')] })).toEqual([
      'nora 2026-11-20T11:00:00.000Z',
    ]);
  });

  it('looks back a quarter of an hour only, and never ahead', () => {
    expect(run({ now: '2026-11-20T11:14:00Z' })).toHaveLength(2);
    expect(run({ now: '2026-11-20T11:16:00Z' })).toEqual([]);
    expect(run({ now: '2026-11-20T10:59:00Z' })).toEqual([]);
  });
});
