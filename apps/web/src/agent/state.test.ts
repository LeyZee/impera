import { describe, expect, it } from 'vitest';

import { agentStateOf, pauseChoices, type AgentStateInput } from './state';

const PARIS = 'Europe/Paris';
/** Thursday 19/11/2026, 16:30 in Paris (UTC+1). */
const NOW = new Date('2026-11-19T15:30:00Z');

const input = (patch: Partial<AgentStateInput> = {}): AgentStateInput => ({
  mode: 'copilot',
  globalStop: false,
  pausedUntil: null,
  hoursNow: { open: true, changesAt: null },
  resumesAs: 'copilot',
  ...patch,
});

describe('agentStateOf (ADR 0148 § 1)', () => {
  it('says she is on, in which mode, and until when on her clock', () => {
    expect(agentStateOf(input(), PARIS, NOW)).toEqual({
      kind: 'on',
      label: 'IA active · Copilote',
      detail: null,
      tone: 'ok',
    });
    const closing = agentStateOf(
      input({ mode: 'auto', hoursNow: { open: true, changesAt: '2026-11-20T00:00:00Z' } }),
      PARIS,
      NOW,
    );
    expect(closing.label).toBe('IA active · Automatique');
    expect(closing.detail).toBe('jusqu’à demain 1 h');
  });

  it('out of her hours: calm, and when she opens again', () => {
    expect(
      agentStateOf(input({ hoursNow: { open: false, changesAt: '2026-11-19T23:00:00Z' } }), PARIS, NOW),
    ).toEqual({
      kind: 'out',
      label: 'IA hors de ses heures',
      detail: 'reprend demain à 0 h, en Copilote',
      tone: 'calm',
    });
  });

  it('a pause: amber, when it lifts itself and in which mode', () => {
    const state = agentStateOf(
      input({ mode: 'stop', pausedUntil: '2026-11-19T16:30:00Z', resumesAs: 'auto' }),
      PARIS,
      NOW,
    );
    expect(state).toMatchObject({ kind: 'paused', label: 'IA en pause', tone: 'warn' });
    expect(state.detail).toBe('reprend seule à 17\u00a0h\u00a030, en Automatique');
  });

  it('an Arrêt by hand, then the global switch over everything', () => {
    expect(agentStateOf(input({ mode: 'stop' }), PARIS, NOW).kind).toBe('off');
    expect(agentStateOf(input({ mode: 'stop', globalStop: true }), PARIS, NOW)).toMatchObject({
      kind: 'global',
      label: 'IA coupée pour toute l’agence',
    });
  });

  it('a far day is named', () => {
    const state = agentStateOf(
      input({ hoursNow: { open: false, changesAt: '2026-11-21T08:00:00Z' } }),
      PARIS,
      NOW,
    );
    expect(state.detail).toBe('reprend samedi à 9 h, en Copilote');
  });
});

describe('pauseChoices (ADR 0148 § 1)', () => {
  it('offers 1 h and tomorrow 9:00 on her clock; Arrêt without an end is « Couper »', () => {
    const choices = pauseChoices(PARIS, NOW);
    expect(choices.map((choice) => choice.key)).toEqual(['hour', 'morning']);
    expect(choices[0]?.until.toISOString()).toBe('2026-11-19T16:30:00.000Z');
    expect(choices[0]?.label).toBe('1\u00a0h, jusqu’à 17\u00a0h\u00a030');
    expect(choices[1]?.until.toISOString()).toBe('2026-11-20T08:00:00.000Z');
  });

  it('in her small hours, 9:00 tomorrow is still the next morning on her clock', () => {
    // 0:30 on Friday 20/11 in Paris: « demain 9 h » is Saturday 9:00.
    const choices = pauseChoices(PARIS, new Date('2026-11-19T23:30:00Z'));
    expect(choices[1]?.until.toISOString()).toBe('2026-11-21T08:00:00.000Z');
  });

  it('out of her hours, only what ends after she opens again (avis Design, 19/11)', () => {
    // She opens at 21:00 tonight: 1 h does nothing, tomorrow 9:00 does.
    expect(pauseChoices(PARIS, NOW, '2026-11-19T20:00:00Z').map((choice) => choice.key)).toEqual(['morning']);
    expect(pauseChoices(PARIS, NOW, '2026-11-20T10:00:00Z')).toEqual([]);
  });
});
