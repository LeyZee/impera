import type { AlertTestBody, AlertTestResult } from '@nirvana/contracts';
import { brainAlertId, type LlmGateway } from '@nirvana/llm';

import { alertKeywordsIn } from '../domain/alerts';

/** Who she is for the brain: her name and her sheet. */
export interface AlertTesterPersona {
  readonly creatorName: string;
  readonly personaSheet: string;
}

export interface AlertTesterDeps {
  readonly gateway: Pick<LlmGateway, 'brain' | 'health'>;
  /**
   * The persona of the creator the test names: her active version (recette M13), as on her real messages; `null`
   * when she has none. A failed read throws, and the phrase is not read.
   */
  readonly personaOf: (creatorId: string) => Promise<AlertTesterPersona | null>;
}

/** Réglages › Alertes: an alert being written, tried on an example message (`POST /v1/alerts/test`, P4-01). */
export interface AlertTester {
  test(body: AlertTestBody): Promise<AlertTestResult>;
}

const NO_BRAIN =
  'Aucun modèle n’est joignable pour lire la phrase : ajoute la clé Grok dans Réglages › Modèles IA.';
const BRAIN_FAILED = 'Le modèle n’a pas pu lire la phrase cette fois : réessaie.';
const BUDGET_REACHED = 'Le budget IA du jour est atteint : la phrase sera lisible après minuit.';
const NO_PERSONA =
  'Cette créatrice n’a pas de persona active : active une version dans Créatrices › Persona pour tester la phrase.';
const PERSONA_UNREADABLE = 'Sa persona active n’a pas pu être lue : réessaie.';

/** Her persona, or why the phrase cannot be read without it: never another creator's, never the demo one. */
async function personaFor(
  deps: AlertTesterDeps,
  creatorId: string,
): Promise<AlertTesterPersona | { readonly reason: string }> {
  try {
    return (await deps.personaOf(creatorId)) ?? { reason: NO_PERSONA };
  } catch {
    return { reason: PERSONA_UNREADABLE };
  }
}

/**
 * The same reading as on a real message: her words in code, without a model; her phrase by the brain, with her
 * active persona, given as her only alert, on that message alone. Unlike a real message, the phrase is asked even when a word matched, so that she
 * sees both. Nothing is stored and nothing is sent.
 */
export function createAlertTester(deps: AlertTesterDeps): AlertTester {
  const brainReachable = (): boolean => {
    const brain = deps.gateway.health().roles.find((r) => r.role === 'brain');
    return brain !== undefined && (brain.hasKey || brain.fallback?.hasKey === true);
  };

  return {
    async test({ creatorId, alert, message }) {
      const keywords = alertKeywordsIn(message, alert.keywords);
      if (alert.phrase === null) return { keywords, phraseMatched: null, reason: null };
      if (!brainReachable()) return { keywords, phraseMatched: null, reason: NO_BRAIN };
      const persona = await personaFor(deps, creatorId);
      if ('reason' in persona) return { keywords, phraseMatched: null, reason: persona.reason };
      const id = brainAlertId(0);
      const result = await deps.gateway.brain({
        creatorName: persona.creatorName,
        personaSheet: persona.personaSheet,
        fanNotes: '',
        history: [{ from: 'fan', text: message }],
        alerts: [{ id, phrase: alert.phrase }],
      });
      if (!result.ok) {
        const reason = result.error.code === 'budget_reached' ? BUDGET_REACHED : BRAIN_FAILED;
        return { keywords, phraseMatched: null, reason };
      }
      return { keywords, phraseMatched: (result.value.output.alertsSeen ?? []).includes(id), reason: null };
    },
  };
}
