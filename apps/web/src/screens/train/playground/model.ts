import type {
  BriefIntent,
  Destination,
  PlaygroundAnswer,
  PlaygroundBrief,
  PlaygroundMedia,
  PlaygroundState,
  RejectReason,
  Verdict,
} from '@impera/contracts';

/**
 * Screen-side vocabulary of the playground. The data shapes live in `@impera/contracts` (playground.ts, P3-06);
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
/**
 * What each destination does today, honestly (Charles, 16/11) : her drafts read her examples of the version she
 * writes with (ADR 0102), and nothing takes up a rule or replays a test on its own yet. These words change with that work.
 */
export const DESTINATION_HINTS: Readonly<Record<Destination, string>> = {
  voice_example: 'Sert d’exemple à sa voix, ici et avec ses vrais fans, sur cette version de sa persona.',
  rule: 'Gardée pour être relue. Elle ne change rien toute seule pour l’instant.',
  test: 'Gardé pour être rejoué à la main, pas encore automatiquement.',
};
/** Said once the lesson is filed: where it went and what it changes. */
const DESTINATION_ACKS: Readonly<Record<Destination, string>> = {
  voice_example: 'Rangée en Exemple de voix : sa voix s’en sert, ici et avec ses vrais fans.',
  rule: 'Rangée en Règle : gardée pour être relue, elle ne change rien toute seule pour l’instant.',
  test: 'Rangée en Test : gardée pour être rejouée à la main.',
};

/** A guard's label inside a sentence, after a colon: « elle dit être une IA ». */
export const inSentence = (label: string): string => label.charAt(0).toLocaleLowerCase('fr') + label.slice(1);

/** Whether the line under the conversation warns: a correction kept out of her bank (ADR 0102 § 4). */
export const isFiledWarning = (destination: Destination, blockedBy: readonly string[]): boolean =>
  destination === 'voice_example' && blockedBy.length > 0;

/**
 * The line under the conversation once a lesson is filed; the demo saves nothing, and says so as its bar does. A
 * correction a hard guard stops stays a correction, out of her bank, and the line says which guard (ADR 0102 § 4).
 */
export const filedAck = (
  destination: Destination,
  isDemo: boolean,
  blockedBy: readonly string[] = [],
): string => {
  if (isDemo) return 'Démo : rien n’est rangé pour de vrai.';
  if (isFiledWarning(destination, blockedBy))
    return `Gardée comme correction, mais pas dans sa banque : ${blockedBy.map(inSentence).join(', ')}.`;
  return DESTINATION_ACKS[destination];
};

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
export function suggestedDestination(verdict: Verdict, mayFileExamples = true): Destination | undefined {
  if (verdict.kind === 'validated') return undefined;
  // A manager's correction is kept for the owner to read; she alone files it in her bank (ADR 0092 § 8).
  if (verdict.kind === 'corrected') return mayFileExamples ? 'voice_example' : 'rule';
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
  payment_help: 'Il demande comment payer',
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
  minor_fantasy: 'Fantasme sur des mineurs',
  distress: 'Détresse',
  meet_request: 'Demande de rencontre',
  off_platform_payment: 'Paiement hors plateforme',
  dispute: 'Litige',
  harassment: 'Harcèlement',
  insult: 'Insulte',
  self_harm: 'Idées noires',
  money_trouble: 'Argent difficile',
  no_budget: 'À sec pour l’instant',
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

/**
 * Nothing was written because no model answered or the day's AI budget is spent, not because a guard stopped a
 * sentence: said as such in words, the models' error staying in « Détails techniques » (recette AGT 06/11).
 */
export function unansweredReason(answer: PlaygroundAnswer | null): string | null {
  if (answer === null || !answer.isBlocked || answer.failure === undefined) return null;
  if (answer.violations.some((v) => v.severity === 'blocking') || answer.bubbles.length > 0) return null;
  // The server's words for the daily cap (playground `session.ts`, pinned by its test).
  return answer.failure === 'plafond du jour atteint'
    ? 'le budget IA du jour est atteint, rien ne s’écrit avant demain'
    : 'aucun modèle IA n’a répondu, régénère dans un instant';
}

/** A human takes over: a flag on his media, or the brain decided to step back. Nothing was written. */
export function isHandoff(answer: PlaygroundAnswer | null): boolean {
  if (answer === null) return false;
  return (
    (answer.handoff?.length ?? 0) > 0 || answer.brief?.action === 'handoff' || answer.hold?.kind === 'handoff'
  );
}

/** He said he would come back: as in production, she waits and writes nothing (AGE-01). */
export function isWaiting(answer: PlaygroundAnswer | null): boolean {
  return answer?.hold?.kind === 'no_reply';
}

/** She answers his distress with care, as in production: nothing sold, a human validates every word (ADR 0088). */
export function isCare(answer: PlaygroundAnswer | null): boolean {
  return answer?.hold?.kind === 'care';
}

/** Why a human takes over, in words, without repeats. */
export function handoffReasons(answer: PlaygroundAnswer): string[] {
  const flags = (answer.handoff ?? []).map((f) => MEDIA_FLAG_LABELS[f] ?? f);
  const risks = answer.brief?.action === 'handoff' ? answer.brief.risks.map(riskLabel) : [];
  // The risk policy's own reasons: a risk the brain read even while suggesting a plain reply.
  const held =
    answer.hold?.kind === 'handoff'
      ? answer.hold.detail.filter((d) => d !== 'brain' && d !== 'safety_net').map(riskLabel)
      : [];
  return [...new Set([...flags, ...risks, ...held])];
}

/** The brain's reading in one line, shown while the voice writes (a turn takes about 20 s). */
export function readingLine(brief: PlaygroundBrief): string {
  return `${intentLabel(brief.intent)}, ${sentimentLabel(brief.sentiment)} · ${actionLabel(brief.action)}`;
}
