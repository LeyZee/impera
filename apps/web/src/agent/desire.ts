import { type DesireBand, type DesirePoint, type DesireSignal } from '@nirvana/contracts';

/*
 * The desire score in words (P3-12, glossary « Note de désir »): its bands, the signals that moved it, and what a
 * point of the curve says. The server cools the score and picks its band; the screens only say them.
 */

export const DESIRE_BAND_LABELS: Readonly<Record<DesireBand, string>> = {
  neutral: 'neutre',
  playful: 'joueur',
  hot: 'chaud',
};

/** What each signal means, as the reader says it under a point of the curve. */
export const DESIRE_SIGNAL_LABELS: Readonly<Record<DesireSignal, string>> = {
  steers_to_intimate: 'il ramène vers l’intime',
  body_compliment: 'compliment sur son corps',
  asks_about_her_body: 'questions sur son corps',
  states_desire: 'il dit son envie',
  explicit_language: 'mots explicites',
  hot_media_reaction: 'réaction chaude à un média',
  roleplay: 'jeu de rôle',
  changes_subject: 'il change de sujet',
  cold_reply: 'réponse froide',
  busy_now: 'il est occupé',
  slows_down: 'il ralentit',
  discomfort: 'il est mal à l’aise',
  'intent:flirt': 'il flirte',
  'intent:sexting': 'sexto',
  'intent:asks_for_media': 'il demande un média',
  'sentiment:aroused': 'il est excité',
  long_reply: 'réponse longue',
  short_reply: 'réponse courte',
  quick_reply: 'réponse rapide',
  slow_reply: 'réponse lente',
  suggestive_emoji: 'emoji suggestif',
  several_messages: 'plusieurs messages d’affilée',
  minor_suspected: 'remise à zéro : mineur possible',
  age_disputed: 'remise à zéro : âge douteux',
  frozen: 'figée : vente arrêtée sur ce message',
};

/** « il ramène vers l’intime, réponse longue, emoji suggestif ×2 »: a repeated code counts once per time. */
export function signalsLine(signals: readonly DesireSignal[]): string {
  const counts = new Map<DesireSignal, number>();
  for (const signal of signals) counts.set(signal, (counts.get(signal) ?? 0) + 1);
  const words = [...counts].map(([signal, count]) =>
    count === 1 ? DESIRE_SIGNAL_LABELS[signal] : `${DESIRE_SIGNAL_LABELS[signal]} ×${String(count)}`,
  );
  const line = words.join(', ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** What one message moved: « +14 », « −8 », or the first score, which nothing came before. */
export function movementOf(point: Pick<DesirePoint, 'before' | 'score'>): string {
  if (point.before === null) return `Première note : ${String(point.score)}`;
  const moved = point.score - point.before;
  if (moved === 0) return '0';
  return moved > 0 ? `+${String(moved)}` : `−${String(-moved)}`;
}
