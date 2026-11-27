import type { AgentMode, AgentStatus } from '@impera/contracts';

/**
 * What her agent actually does now (recette 27/11, G18, PRO-03, PRO-15): one state of a closed set, from what runs, so
 * that her header, her card and the menu's pill never say « IA active · Copilote » beside « Aucun script prêt » or
 * brouillons éteints. Pure: nothing here changes what the engine does, only what is said of it.
 */
export interface AgentStatusFacts {
  readonly mode: AgentMode;
  /** The global switch is on: Arrêt for every creator. */
  readonly globalStop: boolean;
  /** Her own Arrêt lifts itself at a set instant. */
  readonly paused: boolean;
  /** One of her accounts' sessions expired: nothing is read nor sent there (REV-05). */
  readonly sessionExpired: boolean;
  /** One of her persona versions is active: without one the agent writes nothing (PRO1-03). */
  readonly hasActivePersona: boolean;
  /**
   * Her scripts the agent may offer (ADR 0161), by when they play; `null` when the reader cannot read them (a scope of
   * one's own): the state is then said without them.
   */
  readonly scripts: { readonly day: number; readonly night: number } | null;
  /** Her hours are open now. */
  readonly hoursOpen: boolean;
  /** « Brouillons de l'IA » in the extension (ADR 0086 § 6); `null` when not read. */
  readonly draftsOn: boolean | null;
}

/**
 * The first state that holds, in this order: an Arrêt (the agency's, a pause, hers), what stops everything (a session
 * to capture, no persona), what leaves it nothing to offer (no script ready at all), her hours, then what runs: in
 * Copilote with the drafts off the chatters write alone, otherwise its mode.
 */
export function agentStatusOf(facts: AgentStatusFacts): AgentStatus {
  if (facts.globalStop) return 'global_stop';
  if (facts.mode === 'stop') return facts.paused ? 'paused' : 'stopped';
  if (facts.sessionExpired) return 'session_expired';
  if (!facts.hasActivePersona) return 'no_persona';
  if (facts.scripts !== null && facts.scripts.day === 0 && facts.scripts.night === 0) return 'no_scripts';
  if (!facts.hoursOpen) return 'off_hours';
  if (facts.mode === 'copilot' && facts.draftsOn === false) return 'drafts_off';
  return facts.mode;
}
