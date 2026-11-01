import type {
  BriefIntent,
  Destination,
  PlaygroundAnswer,
  PlaygroundMedia,
  PlaygroundState,
  RejectReason,
  Verdict,
} from '@nirvana/contracts';

/**
 * Screen-side vocabulary of the playground. The data shapes live in `@nirvana/contracts` (playground.ts, P3-06);
 * this file only adds what the screen needs on top: names for parts of them, and French labels.
 */

export type MediaKind = PlaygroundMedia['kind'];
export type Turn = PlaygroundState['history'][number];
/** A media the trainer has her send: what it shows, and whether it is paid and blurred. */
export type CreatorMedia = PlaygroundMedia & { readonly isLocked: boolean };

export const DESTINATION_LABELS: Readonly<Record<Destination, string>> = {
  voice_example: 'Exemple de voix',
  rule: 'Règle',
  test: 'Test',
};
export const DESTINATION_HINTS: Readonly<Record<Destination, string>> = {
  voice_example: 'Rejoint les exemples donnés à la voix.',
  rule: 'Part au propriétaire pour validation, puis devient du code.',
  test: 'Rejoué à chaque changement de prompt ou de modèle.',
};
/** Said once the lesson is filed: where it went and what it changes. */
const DESTINATION_ACKS: Readonly<Record<Destination, string>> = {
  voice_example: 'Rangée en Exemple de voix : elle rejoint les exemples donnés à la voix.',
  rule: 'Rangée en Règle : elle part au propriétaire pour validation.',
  test: 'Rangée en Test : rejouée à chaque changement de prompt ou de modèle.',
};

/** The line under the conversation once a lesson is filed; the demo saves nothing, and says so as its bar does. */
export const filedAck = (destination: Destination, isDemo: boolean): string =>
  isDemo ? 'Démo : rien n’est rangé pour de vrai.' : DESTINATION_ACKS[destination];

/**
 * Why an answer was rejected, kept in view while its destination is chosen: the reason first, since it decides where
 * the lesson goes (a rule for some reasons), then the trainer's note when there is one.
 */
export function rejectedWords(
  verdict: Extract<Verdict, { kind: 'rejected' }>,
  reasons: PlaygroundState['rejectReasons'],
): { reason: string; note: string | null } {
  const reason = reasons.find((r) => r.id === verdict.reason)?.label ?? verdict.reason;
  const note = verdict.note?.trim() ?? '';
  return { reason, note: note === '' ? null : note };
}

/** A risk the trap already explains in words: listed once, under « Piège ». */
const TRAP_RISKS: readonly string[] = ['manipulation_attempt'];

/** The brain's risks worth a line of their own next to the trap's signals. */
export function risksBesideTrap(risks: readonly string[], hasTrap: boolean): string[] {
  return hasTrap ? risks.filter((r) => !TRAP_RISKS.includes(r)) : [...risks];
}

const RULE_REASONS: readonly RejectReason[] = ['too_early_sexual', 'missed_sale', 'forgot_fact'];

/**
 * The destination proposed for a lesson: the engine's own rule (calibration.ts, suggestDestination), shown before
 * the rating so the trainer can change it. The server keeps the one sent.
 */
export function suggestedDestination(verdict: Verdict): Destination | undefined {
  if (verdict.kind === 'validated') return undefined;
  if (verdict.kind === 'corrected') return 'voice_example';
  return RULE_REASONS.includes(verdict.reason) ? 'rule' : 'test';
}

/** Every intent of the contract has its words: an intent added to `BRIEF_INTENTS` breaks the typecheck here. */
const INTENTS: Readonly<Record<BriefIntent, string>> = {
  small_talk: 'Il discute',
  kyc_answer: 'Il parle de lui',
  flirt: 'Il flirte',
  sexting: 'Il veut du sexto',
  media_reaction: 'Il réagit à un média',
  asks_for_media: 'Il demande un média',
  price_objection: 'Il discute le prix',
  asks_if_bot: 'Il demande si elle est un bot',
  asks_to_meet: 'Il veut la rencontrer',
  asks_personal_contact: 'Il veut ses coordonnées',
  asks_for_service: 'Il demande un service (sur mesure, appel, cam, vocal)',
  distress: 'Il va mal',
  complaint: 'Il se plaint',
  off_topic_request: 'Il demande autre chose (recette, code…)',
  other: 'Autre chose',
};
const SENTIMENTS: Readonly<Record<string, string>> = {
  positive: 'de bonne humeur',
  neutral: 'neutre',
  negative: 'contrarié',
  aroused: 'excité',
  frustrated: 'frustré',
};
const ACTIONS: Readonly<Record<string, string>> = {
  reply: 'Répondre, sans offre',
  offer: 'Proposer un script',
  wait: 'Attendre avant de répondre',
  follow_up: 'Relancer',
  handoff: 'Se taire : un humain reprend la main',
};
const RISKS: Readonly<Record<string, string>> = {
  minor_suspected: 'Mineur suspecté',
  distress: 'Détresse',
  meet_request: 'Demande de rencontre',
  off_platform_payment: 'Paiement hors plateforme',
  dispute: 'Litige',
  harassment: 'Harcèlement',
  self_harm: 'Idées noires',
  money_trouble: 'Argent difficile',
  manipulation_attempt: 'Tentative de manipulation',
  dangerous_request: 'Demande dangereuse',
  real_abuse: 'Récit de violences réelles',
};
/** Safety flags of a media (MediaDescription.flags): any of them hands the fan over to a human. */
export const MEDIA_FLAG_LABELS: Readonly<Record<string, string>> = {
  possible_minor: 'Mineur possible',
  possible_non_consent: 'Non-consentement possible',
  identifiable_third_party: 'Tiers identifiable',
  weapon: 'Arme',
  drugs: 'Drogue',
  self_harm: 'Automutilation',
};

/** The brain's codes in the team's words; an unknown code shows as is, never as an empty line. */
export const intentLabel = (intent: BriefIntent): string => INTENTS[intent];
export const sentimentLabel = (code: string): string => SENTIMENTS[code] ?? code;
export const actionLabel = (code: string): string => ACTIONS[code] ?? code;
export const riskLabel = (code: string): string => RISKS[code] ?? code;

/** A human takes over: a flag on his media, or the brain decided to step back. Nothing was written. */
export function isHandoff(answer: PlaygroundAnswer | null): boolean {
  if (answer === null) return false;
  return (answer.handoff?.length ?? 0) > 0 || answer.brief?.action === 'handoff';
}

/** Why a human takes over, in words, without repeats. */
export function handoffReasons(answer: PlaygroundAnswer): string[] {
  const flags = (answer.handoff ?? []).map((f) => MEDIA_FLAG_LABELS[f] ?? f);
  const risks = answer.brief?.action === 'handoff' ? answer.brief.risks.map(riskLabel) : [];
  return [...new Set([...flags, ...risks])];
}
