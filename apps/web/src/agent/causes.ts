import type { HandoffCause } from '@impera/contracts';

/** Why the agent hands a conversation to a human, in the trade's words: the Dashboard and Suivi say it the same way. */
export const CAUSE_LABELS: Readonly<Record<HandoffCause, string>> = {
  minor: 'Mineur possible',
  non_consent: 'Sans consentement',
  distress: 'Détresse',
  meeting: 'Demande de rencontre',
  manipulation: 'Manipulation',
  guard: 'Réponse bloquée',
  budget: 'Plafond IA atteint',
  keyword: 'Mot surveillé',
  llm_unavailable: 'IA indisponible',
  other: 'À reprendre',
  custom_alert: 'Alerte personnalisée',
  identity_doubt: 'Doute sur la personne',
  persona_inactive: 'Pas de persona active pour cette créatrice',
  custom_order: 'Demande sur mesure',
  sale_trouble: 'Vente qui coince',
};

/** The cause, with the word he wrote when a watched word set it off (IA-05): the human never guesses which. */
export const handoffCauseLabel = (cause: HandoffCause, keyword?: string): string =>
  keyword === undefined ? CAUSE_LABELS[cause] : `${CAUSE_LABELS[cause]} : « ${keyword} »`;
