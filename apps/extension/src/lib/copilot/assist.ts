import type {
  CopilotAssist,
  CopilotCut,
  CopilotDraftReason,
  CopilotNextMove,
  CopilotSaleBlock,
  CopilotSaleState,
  DesireBand,
} from '@impera/contracts';

import { DESIRE_WORDS, type Standing } from './standing';

/**
 * What the agent already computed, said to the chatter without a new AI call (ADR 0141, lot a): what to do now and why,
 * where the sale stands, the signals not to miss. The gestures, prices and reasons are the code's; the panel only words
 * them. A cut (§ 9) is the server's, said again here; the panel adds its own when it cannot read his limits.
 */

/**
 * One tone per state (§ 12, Design 16/11): red for what the top line says in red, « Âge contesté », « Ne plus lui
 * écrire » and « Ventes gelées »; amber when the sale is blocked otherwise.
 */
export type AssistTone = 'neutral' | 'amber' | 'red';

const REREAD = 'Relis le brouillon avant de l’envoyer.';

/**
 * The one sentence that replaces « quoi faire » under a cut (§ 12): why, never a sale gesture. Said once: the draft
 * adds no line of its own under it. The words are the glossary's (« Âge contesté », « fragile »).
 */
export const CUT_LINES: Readonly<Record<CopilotCut, { readonly text: string; readonly tone: AssistTone }>> = {
  age_doubt: { text: 'Âge contesté\u00a0: un humain doit le lever avant tout.', tone: 'red' },
  do_not_contact: { text: 'Ne plus lui écrire\u00a0: on ne lui vend rien.', tone: 'red' },
  care: { text: `Fan fragile\u00a0: on ne lui vend rien. ${REREAD}`, tone: 'amber' },
  care_exit: { text: `Fan fragile qui va mieux\u00a0: ni vente ni rien de coquin. ${REREAD}`, tone: 'amber' },
  sales_frozen: { text: `Ventes gelées\u00a0: on ne lui vend rien. ${REREAD}`, tone: 'red' },
  limits_unread: {
    text: 'Limites non lues\u00a0: rien à vendre tant qu’elles ne sont pas lues.',
    tone: 'amber',
  },
};

/** Several cuts at once: the one said is the gravest. */
const CUT_ORDER: readonly CopilotCut[] = [
  'age_doubt',
  'do_not_contact',
  'care',
  'care_exit',
  'sales_frozen',
  'limits_unread',
];

/**
 * The cut the panel says, or null. Closed by default, as for the draft: limits not read, « Ne plus lui écrire » or
 * « Âge contesté » read by the panel itself cut the sale even when the server's view does not say so yet.
 */
export function cutOf(assist: CopilotAssist | null, standing: Standing): CopilotCut | null {
  const cuts = new Set(assist?.cuts ?? []);
  if (standing.unread) cuts.add('limits_unread');
  if (standing.noContact) cuts.add('do_not_contact');
  if (standing.ageDisputed) cuts.add('age_doubt');
  return CUT_ORDER.find((cut) => cuts.has(cut)) ?? null;
}

/** The code's sale blocks (§ 2), in the code's words. */
const BLOCK_WORDS: Readonly<Record<CopilotSaleBlock, string>> = {
  do_not_contact: 'Ne plus lui écrire',
  risk: 'Un risque bloque la vente',
  sales_frozen: 'Ventes gelées',
  age_unconfirmed: 'Âge pas encore confirmé',
  no_budget: 'Il a dit ne pas avoir d’argent',
  cooldown: 'Offre trop récente',
  low_desire: 'Désir encore trop bas',
};

/**
 * Notes on the draft, not reasons for the gesture (Design 16/11): they go with the draft, never in « pourquoi ».
 */
const DRAFT_NOTES: ReadonlySet<CopilotDraftReason> = new Set([
  'rewritten_once',
  'media_not_seen',
  'llm_unavailable',
]);

/** The reasons recorded with the draft that are notes on its text, in the server's words. */
export const draftNotes = (reasons: CopilotAssist['reasons']): readonly string[] =>
  reasons.filter(({ code }) => DRAFT_NOTES.has(code)).map(({ label }) => label);

export interface MoveLines {
  /** The gesture, verb first, in bold. */
  readonly what: string;
  /** Why, in small: the reason to propose, or the block, then the gesture's reasons; null when there is none. */
  readonly why: string | null;
  readonly tone: AssistTone;
}

/** What the panel knows that says why a step is proposed: his desire and where the script stands. */
export interface MoveContext {
  readonly band: DesireBand | null;
  readonly sale: CopilotSaleState | null;
}

const capital = (text: string): string => text.charAt(0).toLocaleUpperCase('fr-FR') + text.slice(1);

/** « Désir chaud, étape 2 sur 4 »: why a step is proposed, from what is already known, no number invented. */
function offerWhy({ band, sale }: MoveContext): string | null {
  const parts = [
    band === null ? null : `désir ${DESIRE_WORDS[band]}`,
    sale?.script == null
      ? null
      : `étape ${String(sale.script.stepIndex + 1)} sur ${String(sale.script.stepCount)}`,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : capital(parts.join(', '));
}

/** « Quoi faire » and « pourquoi », one block of two lines (§ 1, § 2, § 12). */
export function moveLines(
  move: CopilotNextMove,
  reasons: CopilotAssist['reasons'],
  context: MoveContext,
): MoveLines {
  const block = move.kind === 'no_sale' && move.block !== null ? move.block : null;
  const lead =
    block !== null
      ? (move.blockLabel ?? BLOCK_WORDS[block])
      : move.kind === 'offer_step'
        ? offerWhy(context)
        : null;
  const why = [
    ...(lead === null ? [] : [lead]),
    ...reasons.filter(({ code }) => !DRAFT_NOTES.has(code)).map(({ label }) => label),
  ];
  return {
    what: move.label,
    why: why.length === 0 ? null : why.join(' · '),
    tone:
      move.kind !== 'no_sale'
        ? 'neutral'
        : block === 'do_not_contact' || block === 'sales_frozen'
          ? 'red'
          : 'amber',
  };
}

/** A price of the code, in euros, « 15 € » or « 14,90 € ». */
export function eurosOf(minor: number): string {
  const whole = minor % 100 === 0;
  const text = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(minor / 100);
  return `${text}\u00a0€`;
}

/** A step's name as the panel says it, between guillemets (Design 16/11): « La suite ». */
const step = (name: string): string => `«\u00a0${name}\u00a0»`;

/** The fold's summary line (§ 14): the step in progress, and the next one with its price. */
export function saleSummary(sale: CopilotSaleState): string {
  const now =
    sale.script === null
      ? 'Pas de script en cours'
      : `${sale.script.name}, étape ${String(sale.script.stepIndex + 1)} sur ${String(sale.script.stepCount)}`;
  return sale.nextStep === null
    ? now
    : `${now} · ensuite ${step(sale.nextStep.name)} à ${eurosOf(sale.nextStep.priceMinor)}`;
}

/** The fold's rows (§ 3): what is known of the sale, each said once. */
export function saleRows(sale: CopilotSaleState): { readonly label: string; readonly value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (sale.script !== null)
    rows.push({
      label: 'Script en cours',
      value: `${sale.script.name}, étape ${String(sale.script.stepIndex + 1)} sur ${String(sale.script.stepCount)}`,
    });
  if (sale.nextStep !== null)
    rows.push({
      label: 'Prochaine étape',
      value: `${step(sale.nextStep.name)} à ${eurosOf(sale.nextStep.priceMinor)}`,
    });
  if (sale.offerPending) rows.push({ label: 'Offre faite', value: 'Pas encore de réponse' });
  if (sale.refusedSteps.length > 0)
    rows.push({ label: 'Étapes refusées', value: sale.refusedSteps.map(step).join(', ') });
  if (sale.usedObjections.length > 0)
    rows.push({
      label: 'Objections déjà servies, à ne pas resservir',
      value: sale.usedObjections.join(', '),
    });
  if (sale.customOrderOpen) rows.push({ label: 'Commande perso', value: 'Ouverte' });
  return rows;
}

const TREND_WORDS = { up: 'en hausse', down: 'en baisse' } as const;

/**
 * The signals not to miss (§ 4), added after his desire: its direction only (the figure stays in the CRM), a follow-up
 * due, an offer without an answer. None under a cut: nothing there must push to write or to sell.
 */
export function signalWords(
  assist: CopilotAssist | null,
  cut: CopilotCut | null,
): {
  readonly trend: string | null;
  readonly more: readonly string[];
} {
  if (assist === null || cut !== null) return { trend: null, more: [] };
  const { desireTrend, followUpDue } = assist.signals;
  return {
    trend: desireTrend === 'up' || desireTrend === 'down' ? TREND_WORDS[desireTrend] : null,
    more: [
      ...(followUpDue ? ['Relance due'] : []),
      ...(assist.sale?.offerPending === true ? ['Offre sans réponse'] : []),
    ],
  };
}
