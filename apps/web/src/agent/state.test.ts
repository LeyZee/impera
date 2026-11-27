import { AgentStatusSchema, CreatorOverviewSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { agentStateOf, pauseChoices, pillStatusLabel, withPersona, type AgentStateInput } from './state';

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

  it('without an active persona, waits for it, never « IA active »; an Arrêt is still said (PRO1-03)', () => {
    expect(agentStateOf(input({ hasActivePersona: false }), PARIS, NOW)).toEqual({
      kind: 'idle',
      label: 'IA en attente de sa persona',
      detail: 'aucun brouillon tant qu’aucune persona n’est active',
      tone: 'warn',
    });
    expect(agentStateOf(input({ mode: 'stop', hasActivePersona: false }), PARIS, NOW).kind).toBe('off');
    expect(agentStateOf(input({ hasActivePersona: true }), PARIS, NOW).kind).toBe('on');
    // Unknown to the reader: the mode alone, as before.
    expect(withPersona(input(), undefined)).toEqual(input());
    expect(agentStateOf(withPersona(input(), false), PARIS, NOW).kind).toBe('idle');
  });

  it('a Reveal session expired says so, never « IA active »; a pause or an Arrêt is still said (REV-05)', () => {
    expect(agentStateOf(input({ expiredSessions: ['reveal'] }), PARIS, NOW)).toEqual({
      kind: 'expired',
      label: 'Session Reveal expirée',
      detail: 'reconnecte-la depuis l’extension : rien n’est lu ni envoyé d’ici là',
      tone: 'warn',
    });
    expect(agentStateOf(input({ mode: 'stop', expiredSessions: ['reveal'] }), PARIS, NOW).kind).toBe('off');
    expect(agentStateOf(input({ expiredSessions: [] }), PARIS, NOW).kind).toBe('on');
  });

  it('a manager reads it from her card, without her « Mise en route » (PRO1-03)', () => {
    const card = CreatorOverviewSchema.parse({
      creatorId: '018f0000-0000-7000-8000-000000000001',
      mode: 'copilot',
      hasActivePersona: false,
      sales: null,
      onShift: [],
      requests: null,
    });
    expect(agentStateOf(withPersona(card, undefined), PARIS, NOW).kind).toBe('idle');
    expect(agentStateOf(withPersona(card, true), PARIS, NOW).kind).toBe('on');
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

describe('what runs, as the server says it (recette 27/11, G18, PRO-03, PRO-15)', () => {
  it('never says « IA active · Copilote » beside « aucun script prêt » or drafts off', () => {
    expect(agentStateOf(input({ agentStatus: 'no_scripts' }), PARIS, NOW)).toEqual({
      kind: 'no_scripts',
      label: 'IA en attente de scripts',
      detail: 'aucun script prêt dans Reveal : l’agent n’a rien à proposer',
      tone: 'warn',
    });
    expect(agentStateOf(input({ agentStatus: 'drafts_off' }), PARIS, NOW)).toEqual({
      kind: 'drafts_off',
      label: 'IA prête · brouillons éteints',
      detail: 'les chatteurs écrivent seuls dans Reveal',
      tone: 'calm',
    });
  });

  it('follows the server over the fields, and the fields when it says nothing', () => {
    expect(agentStateOf(input({ hasActivePersona: true, agentStatus: 'no_persona' }), PARIS, NOW).kind).toBe(
      'idle',
    );
    expect(agentStateOf(input({ agentStatus: null, hasActivePersona: false }), PARIS, NOW).kind).toBe('idle');
    expect(agentStateOf(input({ agentStatus: 'copilot' }), PARIS, NOW).label).toBe('IA active · Copilote');
  });

  it('gives every state of the closed set its own words, « IA active » only for a mode that runs', () => {
    const kinds = AgentStatusSchema.options.map((status) => {
      const state = agentStateOf(input({ agentStatus: status }), PARIS, NOW);
      expect(state.label.startsWith('IA active')).toBe(status === 'copilot' || status === 'auto');
      return state.kind;
    });
    expect(kinds).toEqual([
      'global',
      'paused',
      'off',
      'expired',
      'idle',
      'no_scripts',
      'out',
      'drafts_off',
      'on',
      'on',
    ]);
  });

  it('gives the menu’s pill a word for what holds, none while a mode runs (PRO-15)', () => {
    expect(pillStatusLabel('no_persona')).toBe('en attente de persona');
    expect(pillStatusLabel('no_scripts')).toBe('en attente de scripts');
    expect(pillStatusLabel('drafts_off')).toBe('brouillons éteints');
    expect(pillStatusLabel('copilot')).toBeNull();
    expect(pillStatusLabel(null)).toBeNull();
  });
});
