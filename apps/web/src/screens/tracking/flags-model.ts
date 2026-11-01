import {
  AGE_DISPUTE_FORBIDDEN,
  AGE_DISPUTE_REASON_INVALID,
  ApiErrorSchema,
  SPENDING_LIMIT_MAX_MINOR,
  type FanFlags,
  type SalesFreezeReason,
} from '@nirvana/contracts';

import { withFirstOfMonth } from '@/scheduling/time';

/** The switches of the fan's limits: on or off, nothing else to say when setting them. */
export type SwitchFlag = 'doNotContact' | 'salesFrozen' | 'noExplicit' | 'fragile';

/** In the order a chatter reads them: what stops everything first, then what softens. */
export const SWITCHES: readonly { flag: SwitchFlag; label: string; meaning: string }[] = [
  { flag: 'doNotContact', label: 'Ne plus lui écrire', meaning: 'L’agent ne lui écrit plus rien.' },
  {
    flag: 'salesFrozen',
    label: 'Ventes gelées',
    meaning: 'Aucune offre, aucun chouinage, aucune relance de vente.',
  },
  { flag: 'noExplicit', label: 'Rien d’explicite', meaning: 'L’agent reste suggestif, jamais explicite.' },
  { flag: 'fragile', label: 'Fan fragile', meaning: 'Douceur seulement : pas de chouinage non plus.' },
];

/** Why sales stopped, as the policy or a human said it. */
export const FREEZE_REASON_LABELS: Readonly<Record<SalesFreezeReason, string>> = {
  money_trouble: 'il a dit manquer d’argent',
  spending_limit: 'son plafond est atteint',
  distress: 'il allait mal',
  operator: 'décision d’un humain',
};

export const isOn = (flags: FanFlags, flag: SwitchFlag): boolean => flags[flag] !== undefined;

/** A limit that stops the agent from writing or selling: the one thing the summary shows in amber. */
export const isBlocking = (flags: FanFlags): boolean =>
  flags.doNotContact !== undefined || flags.salesFrozen !== undefined;

const dayOf = (iso: string): string =>
  withFirstOfMonth(
    new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).formatToParts(new Date(iso)),
  );

/** « 50 € » for a round amount, « 49,90 € » otherwise: never « 49,9 € » (ADR 0011). */
export const euros = (minor: number): string =>
  `${(minor / 100).toLocaleString('fr-FR', {
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}\u00a0€`;

/** What a switch adds once it is on: since when sales stopped, and why. */
export function switchDetail(flags: FanFlags, flag: SwitchFlag): string | null {
  if (flag !== 'salesFrozen' || flags.salesFrozen === undefined) return null;
  return `Depuis le ${dayOf(flags.salesFrozen.since)} : ${FREEZE_REASON_LABELS[flags.salesFrozen.reason]}.`;
}

/**
 * His age taken back, by a sign of a minor the agent read or by a human (P3-09): a suspected minor, never to be read
 * as an age nobody checked yet. Amber wherever it shows.
 */
export const isAgeDisputed = (flags: FanFlags): boolean => flags.ageDisputed !== undefined;

/** What the summary shows in amber: a limit that stops the agent, or a suspected minor. */
export const needsAttention = (flags: FanFlags): boolean => isBlocking(flags) || isAgeDisputed(flags);

/**
 * The line under « Âge »: a disputed age says who may lift it to a reader who may not (SUIVI-04), so that the missing
 * button is never a mystery.
 */
export function ageLine(flags: FanFlags, mayConfirmDisputedAge = false): string {
  if (flags.ageDisputed !== undefined) {
    const day = dayOf(flags.ageDisputed.since);
    const who = mayConfirmDisputedAge ? '' : ' Seuls le propriétaire et les managers peuvent le confirmer.';
    return flags.ageDisputed.by === 'policy'
      ? `Contesté le ${day} : l’agent a relevé un signe de minorité. Rien d’explicite.${who}`
      : `Contesté le ${day} par un humain. Rien d’explicite.${who}`;
  }
  return flags.ageConfirmedAt === undefined
    ? 'Pas encore confirmé : rien d’explicite tant qu’il ne l’est pas.'
    : `Majeur, confirmé le ${dayOf(flags.ageConfirmedAt)}.`;
}

/** The question before confirming: lifting a dispute is said, since the agent then reads him as an adult. */
export const ageQuestion = (flags: FanFlags): string =>
  flags.ageDisputed === undefined
    ? 'Tu as vérifié qu’il est majeur ? L’agent pourra devenir explicite.'
    : 'Tu as vérifié qu’il est majeur ? Écris comment, c’est gardé au journal. Ça lève la contestation : l’agent pourra devenir explicite.';

/** The folded line of the section: a disputed age first, then the limits on, or that there are none. */
export function flagsSummary(flags: FanFlags): string {
  const on = [
    ...(isAgeDisputed(flags) ? ['Âge contesté'] : []),
    ...SWITCHES.filter((s) => isOn(flags, s.flag)).map((s) => s.label),
  ];
  if (flags.spendingLimitMinor !== undefined) on.push(`plafond de ${euros(flags.spendingLimitMinor)}`);
  if (on.length === 0) return 'Aucune';
  const [first = '', ...rest] = on;
  return [
    first.charAt(0).toUpperCase() + first.slice(1),
    ...rest.map((label) => label.charAt(0).toLowerCase() + label.slice(1)),
  ].join(' · ');
}

/** « 50 », « 49,90 », « 49.9 € »: cents, or null when it is not an amount. */
export function centsOf(text: string): number | null {
  const clean = text.replace(/\s|€/gu, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/u.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** Why the ceiling typed cannot be saved, under the field; null while it can, or while nothing is typed yet. */
export function ceilingProblem(text: string): string | null {
  if (text.trim() === '') return null;
  const cents = centsOf(text);
  if (cents === null) return 'Un montant en euros, par exemple 50 ou 49,90.';
  if (cents === 0) return 'Un plafond de 0 € n’en est pas un : pour arrêter ses achats, gèle les ventes.';
  if (cents > SPENDING_LIMIT_MAX_MINOR) return `Au plus ${euros(SPENDING_LIMIT_MAX_MINOR)}.`;
  return null;
}

/** Why a change was refused (`fan_not_found` 404, `creator_forbidden` or a creator's role 403): nothing changed. */
export function flagError(status: number, body: unknown): string {
  const answer = ApiErrorSchema.safeParse(body);
  const code = answer.success ? answer.data.error.code : null;
  // A disputed age (SUIVI-04): the refusal says which rule, not « not accepted as is ».
  if (code === AGE_DISPUTE_FORBIDDEN)
    return 'Seuls le propriétaire et les managers confirment un âge contesté : rien n’a changé.';
  if (code === AGE_DISPUTE_REASON_INVALID) return 'Écris pourquoi tu confirmes son âge : rien n’a changé.';
  if (status === 404) return 'Ce fan n’existe plus.';
  // A creator has no switch: a 403 is a member this fan's conversation is not open to (EQ-13).
  if (status === 403) return 'Tu ne peux pas changer les limites de ce fan : rien n’a changé.';
  if (status === 401) return 'Ta session a expiré : reconnecte-toi.';
  if (status === 400) return 'Ce changement n’est pas accepté tel quel.';
  return 'Le serveur ne répond pas : rien n’a changé. Réessaie dans un instant.';
}

/** What the fan's sheet holds, as its folded line reads it. */
export interface SheetFacts {
  /** His limits, or why they could not be read; `loading` says nothing yet. */
  readonly flags: FanFlags | 'refused' | 'down' | 'loading';
  /** How many canvas lines are left to learn; null when not read (a creator, the server down). */
  readonly toLearn: number | null;
  /** The band of his desire score in a word, null before a first score. */
  readonly band: string | null;
}

/** A switch that stops the agent from writing or selling. */
const STOPS: readonly SwitchFlag[] = ['doNotContact', 'salesFrozen'];

/**
 * The fan's sheet folded to one line (limits, what is left to learn, desire): what stops the agent or flags a minor
 * first, in amber, then the rest, quiet. Each part is left out when it has nothing to say.
 */
export function sheetSummary(facts: SheetFacts): { readonly urgent: string | null; readonly rest: string } {
  const urgent: string[] = [];
  const rest: string[] = [];
  const { flags } = facts;
  if (flags === 'down') rest.push('limites non lues');
  else if (typeof flags === 'object') {
    if (isAgeDisputed(flags)) urgent.push('Âge contesté');
    let quiet = flags.spendingLimitMinor === undefined ? 0 : 1;
    for (const s of SWITCHES) {
      if (!isOn(flags, s.flag)) continue;
      if (STOPS.includes(s.flag)) urgent.push(s.label);
      else quiet += 1;
    }
    if (quiet > 0) rest.push(quiet === 1 ? '1 limite' : `${String(quiet)} limites`);
  }
  if (facts.toLearn !== null && facts.toLearn > 0) rest.push(`${String(facts.toLearn)} à apprendre`);
  if (facts.band !== null) rest.push(`désir ${facts.band}`);
  return {
    urgent: urgent.length === 0 ? null : urgent.join(' · '),
    rest: rest.length === 0 && urgent.length === 0 ? 'Rien à signaler' : rest.join(' · '),
  };
}
