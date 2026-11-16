import type {
  CopilotAssist,
  CopilotCut,
  CopilotDraftReason,
  CopilotNextMove,
  CopilotSaleBlock,
  CopilotSaleState,
  DesireBand,
  SaleCondition,
  SaleMoment,
  SaleMomentVerdict,
} from '@impera/contracts';

import { hourOf } from '../hour';

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

/**
 * The sale in one line under the core (Design 16/11, lot 0141-3): « Soirée d'essai 2/4 · ensuite « La suite » 15 € ».
 * The script and its step, then the next step and its price; the detail opens under it.
 */
export function saleLine(
  sale: CopilotSaleState,
  { withNext = true }: { readonly withNext?: boolean } = {},
): string {
  const now =
    sale.script === null
      ? null
      : `${sale.script.name} ${String(sale.script.stepIndex + 1)}/${String(sale.script.stepCount)}`;
  const next =
    sale.nextStep === null || !withNext
      ? null
      : `${step(sale.nextStep.name)} ${eurosOf(sale.nextStep.priceMinor)}`;
  if (now === null && next === null) return 'Rien de vendu ni proposé pour l’instant';
  if (now === null) return `Prochaine étape ${next ?? ''}`;
  return next === null ? now : `${now} · ensuite ${next}`;
}

/** Where a step stands among the script's, for its dot: past, the one in progress, still to come. */
export type StepDot = 'done' | 'now' | 'next';

/** Most steps a line of dots says; past it, the words « 5/12 » say it alone. */
const MAX_DOTS = 8;

/** One dot per step of the script in progress (Design 16/11): none without a script, nor for a long one. */
export function stepDots(sale: CopilotSaleState): readonly StepDot[] {
  if (sale.script === null || sale.script.stepCount > MAX_DOTS) return [];
  const { stepIndex, stepCount } = sale.script;
  return Array.from({ length: stepCount }, (_, index) =>
    index < stepIndex ? 'done' : index === stepIndex ? 'now' : 'next',
  );
}

/**
 * The detail under the sale line (§ 3): what the line does not say, each said once. The script and the next step are
 * on the line itself.
 */
export function saleRows(
  sale: CopilotSaleState,
  { withNext = false }: { readonly withNext?: boolean } = {},
): { readonly label: string; readonly value: string }[] {
  const rows: { label: string; value: string }[] = [];
  // When the line leaves it out (« Ne rien vendre »), the next step and its price are said here instead.
  if (withNext && sale.nextStep !== null)
    rows.push({
      label: 'Prochaine étape',
      value: `${step(sale.nextStep.name)} ${eurosOf(sale.nextStep.priceMinor)}`,
    });
  if (sale.offerPending) rows.push({ label: 'Offre faite', value: 'Pas encore de réponse' });
  if (sale.refusedSteps.length > 0)
    rows.push({ label: 'Étapes refusées', value: sale.refusedSteps.map(step).join(', ') });
  if (sale.usedObjections.length > 0)
    rows.push({ label: 'Objections déjà servies', value: sale.usedObjections.join(', ') });
  if (sale.customOrderOpen) rows.push({ label: 'Commande perso', value: 'Ouverte' });
  return rows;
}

/** The moment to sell in words (ADR 0141 § 4 bis): a closed list, the panel's. */
const MOMENT_WORDS: Readonly<Record<SaleMomentVerdict, string>> = {
  good: 'Bon moment',
  soon: 'Bientôt',
  not_yet: 'Pas encore',
};

/** The conditions in words: the server sends only the code, the panel words it. */
const CONDITION_WORDS: Readonly<Record<SaleCondition, string>> = {
  desire_below_threshold: 'Son désir est encore bas',
  not_sexualizing: 'Il n’a pas encore pris le ton coquin',
  availability_unconfirmed: 'On ne sait pas s’il est dispo',
  cooldown: 'Une offre est trop récente',
  no_budget: 'Il a dit ne pas pouvoir payer',
  step_waiting: 'Une étape attend son achat',
  age_unconfirmed: 'Son âge n’est pas encore confirmé',
  fan_messages: 'Il faut encore des messages de lui',
  fan_asks_for_paid: 'Il demande du contenu lui-même',
};

type SaleMomentCondition = SaleMoment['conditions'][number];

/** One condition in the panel's words, with the hour a cooldown ends and the count of messages still needed. */
export function conditionWords(condition: SaleMomentCondition): string {
  const { code, remaining, until } = condition;
  if (code === 'fan_messages' && remaining != null)
    return `Il faut encore ${String(remaining)}\u00a0${remaining === 1 ? 'message' : 'messages'} de lui`;
  if (code === 'cooldown' && until != null)
    return `${CONDITION_WORDS.cooldown}, jusqu’à ${hourOf(new Date(until))}`;
  return CONDITION_WORDS[code];
}

/** The sale blocks a condition says when the server sends it (« Désir encore trop bas » is « Son désir est encore bas »). */
const BLOCK_CONDITIONS: Readonly<Partial<Record<CopilotSaleBlock, SaleCondition>>> = {
  low_desire: 'desire_below_threshold',
  cooldown: 'cooldown',
  no_budget: 'no_budget',
  age_unconfirmed: 'age_unconfirmed',
};

const lowerFirst = (words: string): string => words.charAt(0).toLowerCase() + words.slice(1);

export interface MomentLine {
  /** One notch per condition, filled when it is met. */
  readonly notches: readonly boolean[];
  /** « Pas encore · il manque : son désir est encore bas », « Bon moment · il demande du contenu lui-même ». */
  readonly text: string;
  readonly verdict: SaleMomentVerdict;
}

/**
 * The line under the gesture when the server says the moment to sell (§ 4 bis; Design 16/11): it takes the place of
 * « pourquoi », the verdict, then what is missing in the panel's words. A block of the code that no condition sent says
 * (« Un risque bloque la vente ») is said too, so a « Ne rien vendre » never goes without its reason.
 */
export function momentLine(moment: SaleMoment, move: CopilotNextMove | null): MomentLine {
  const sent = new Set(moment.conditions.map(({ code }) => code));
  const missing = moment.conditions
    .filter(({ met }) => !met)
    .map((condition) => lowerFirst(conditionWords(condition)));
  const block = move?.kind === 'no_sale' ? move.block : null;
  const covering = block === null ? undefined : BLOCK_CONDITIONS[block];
  const blockWords =
    block === null || (covering !== undefined && sent.has(covering))
      ? null
      : (move?.blockLabel ?? BLOCK_WORDS[block]);
  const asks =
    moment.verdict === 'good' &&
    moment.conditions.some(({ code, met }) => code === 'fan_asks_for_paid' && met)
      ? lowerFirst(CONDITION_WORDS.fan_asks_for_paid)
      : null;
  const parts = [
    MOMENT_WORDS[moment.verdict],
    asks,
    blockWords,
    missing.length === 0 ? null : `il manque\u00a0: ${missing.join(', ')}`,
  ].filter((part): part is string => part !== null);
  return {
    notches: moment.conditions.map(({ met }) => met),
    text: parts.join(' · '),
    verdict: moment.verdict,
  };
}
