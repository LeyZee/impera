import { AgentStatusSchema, type AgentMode, type AgentStatus } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { agentStatusOf, type AgentStatusFacts } from '../agent-status';

const RUNNING: AgentStatusFacts = {
  mode: 'copilot',
  globalStop: false,
  paused: false,
  sessionExpired: false,
  hasActivePersona: true,
  scripts: { day: 1, night: 1 },
  hoursOpen: true,
  draftsOn: true,
};

const MODES: readonly AgentMode[] = ['auto', 'copilot', 'stop'];
const BOOLS = [false, true] as const;
const SCRIPTS = [null, { day: 0, night: 0 }, { day: 1, night: 0 }, { day: 2, night: 3 }] as const;
const DRAFTS = [null, false, true] as const;

/** Every combination of the facts: 3 modes × 2⁵ switches × 4 script readings × 3 draft readings. */
function* everyCombination(): Generator<AgentStatusFacts> {
  for (const mode of MODES)
    for (const globalStop of BOOLS)
      for (const paused of BOOLS)
        for (const sessionExpired of BOOLS)
          for (const hasActivePersona of BOOLS)
            for (const scripts of SCRIPTS)
              for (const hoursOpen of BOOLS)
                for (const draftsOn of DRAFTS)
                  yield {
                    mode,
                    globalStop,
                    paused,
                    sessionExpired,
                    hasActivePersona,
                    scripts,
                    hoursOpen,
                    draftsOn,
                  };
}

describe('agentStatusOf (recette 27/11, G18)', () => {
  it.each<[string, Partial<AgentStatusFacts>, AgentStatus]>([
    ['runs in Copilote, drafts on', {}, 'copilot'],
    ['runs in Automatique', { mode: 'auto' }, 'auto'],
    ['the agency stopped everyone', { globalStop: true }, 'global_stop'],
    ['her pause', { mode: 'stop', paused: true }, 'paused'],
    ['her Arrêt', { mode: 'stop' }, 'stopped'],
    ['a Reveal session expired', { sessionExpired: true }, 'session_expired'],
    ['no active persona (PRO-15)', { hasActivePersona: false }, 'no_persona'],
    ['no script ready at all (PRO-03)', { scripts: { day: 0, night: 0 } }, 'no_scripts'],
    ['out of her hours', { hoursOpen: false }, 'off_hours'],
    ['Copilote with the drafts off (PRO-03)', { draftsOn: false }, 'drafts_off'],
    ['Automatique whatever the extension’s drafts', { mode: 'auto', draftsOn: false }, 'auto'],
    ['a script of the day only is not « no script »', { scripts: { day: 1, night: 0 } }, 'copilot'],
    ['scripts unread by a scope of one’s own', { scripts: null }, 'copilot'],
    ['drafts unread', { draftsOn: null }, 'copilot'],
  ])('%s', (_, patch, expected) => {
    expect(agentStatusOf({ ...RUNNING, ...patch })).toBe(expected);
  });

  it('never says Copilote beside « aucun script prêt » and drafts off, the header of PRO-03', () => {
    expect(agentStatusOf({ ...RUNNING, scripts: { day: 0, night: 0 }, draftsOn: false })).toBe('no_scripts');
    expect(agentStatusOf({ ...RUNNING, scripts: { day: 3, night: 2 }, draftsOn: false })).toBe('drafts_off');
  });

  it('gives, for every combination, the first state that holds, and only a mode when everything runs', () => {
    let seen = 0;
    for (const facts of everyCombination()) {
      seen += 1;
      const status = agentStatusOf(facts);
      expect(AgentStatusSchema.options).toContain(status);
      const noScripts = facts.scripts !== null && facts.scripts.day === 0 && facts.scripts.night === 0;
      const expected: AgentStatus = facts.globalStop
        ? 'global_stop'
        : facts.mode === 'stop'
          ? facts.paused
            ? 'paused'
            : 'stopped'
          : facts.sessionExpired
            ? 'session_expired'
            : !facts.hasActivePersona
              ? 'no_persona'
              : noScripts
                ? 'no_scripts'
                : !facts.hoursOpen
                  ? 'off_hours'
                  : facts.mode === 'copilot' && facts.draftsOn === false
                    ? 'drafts_off'
                    : facts.mode;
      expect(status).toBe(expected);
      // « IA active » (copilot, auto) only when everything it needs is there.
      if (status === 'copilot' || status === 'auto') {
        expect(facts.hasActivePersona && facts.hoursOpen && !facts.sessionExpired && !noScripts).toBe(true);
      }
    }
    expect(seen).toBe(3 * 2 ** 5 * 4 * 3);
  });
});
