import type { ProviderNextAction, ProviderStatus } from '@impera/contracts';

import { profileOf } from './catalog';

/** The one thing the top of the Services section asks for (contract: `ProviderNextAction`). */
export type NextAction = ProviderNextAction;

/**
 * Priority (fiche P3-03): a refused key first, then low credit, then the next service not connected, in the order
 * of the list (Grok first: without it the agent is stopped). The one service the agent cannot write without comes
 * before any optional one: Grok missing outranks a refused Gemini key or ElevenLabs running low (recette AGT 06/11).
 */
export function nextAction(statuses: readonly ProviderStatus[]): NextAction {
  // A key read from the environment (development) works: nothing to connect.
  const missing = statuses.filter((s) => s.state === 'not_connected' && s.source !== 'environment');
  const requiredMissing = missing.find((s) => profileOf(s.provider).isRequired);
  const refusedAll = statuses.filter((s) => s.state === 'needs_reconnect');
  const refused = refusedAll.find((s) => profileOf(s.provider).isRequired) ?? refusedAll[0];
  if (refused !== undefined && (requiredMissing === undefined || profileOf(refused.provider).isRequired)) {
    return {
      kind: 'replace_key',
      provider: refused.provider,
      lead: refused.message,
      // An unreadable key is Impera's own problem: nothing to fix at the provider, and a check would call no one.
      detail: refused.isUnreadable
        ? `Remplace la clé : rien n’est à régler chez ${profileOf(refused.provider).vendor}.`
        : `Remplace la clé, ou règle le souci chez ${profileOf(refused.provider).vendor} puis « Vérifier maintenant ».`,
    };
  }
  if (requiredMissing !== undefined) return connect(requiredMissing, missing.length);
  const low = statuses.find((s) => s.state === 'low_credit');
  if (low !== undefined) {
    return {
      kind: 'top_up',
      provider: low.provider,
      lead: `Crédits ${profileOf(low.provider).vendor} presque épuisés`,
      detail: low.message,
    };
  }
  const first = missing[0];
  if (first !== undefined) return connect(first, missing.length);
  return {
    kind: 'all_set',
    lead: 'Tout est connecté',
    detail: 'Impera revérifie les clés toutes les 15 minutes et te prévient au moindre souci.',
  };
}

function connect(status: ProviderStatus, missingCount: number): NextAction {
  const profile = profileOf(status.provider);
  const detail = profile.isRequired
    ? 'Indispensable : c’est lui qui écrit. Mistral ne sert que de relais.'
    : missingCount === 1
      ? 'C’est le dernier. Tu peux aussi le faire plus tard.'
      : `${profile.role}.`;
  return { kind: 'connect', provider: status.provider, lead: `Connecte ${profile.service}`, detail };
}
