import type { HandoffCause } from '@nirvana/contracts';

/** Why the agent hands a conversation to a human, in the trade's words: the Dashboard and Suivi say it the same way. */
export const CAUSE_LABELS: Readonly<Record<HandoffCause, string>> = {
  minor: 'Mineur possible',
  non_consent: 'Sans consentement',
  distress: 'Détresse',
  meeting: 'Demande de rencontre',
  manipulation: 'Manipulation',
  guard: 'Réponse bloquée',
  budget: 'Plafond IA atteint',
  keyword: 'Mot d’alerte',
  llm_unavailable: 'IA indisponible',
  other: 'À reprendre',
  custom_alert: 'Alerte personnalisée',
  identity_doubt: 'Doute sur la personne',
  persona_inactive: 'Pas de persona active pour cette créatrice',
};
