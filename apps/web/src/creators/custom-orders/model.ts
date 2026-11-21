import {
  CUSTOM_DETAIL_KEYS,
  customDepositMinor,
  type CustomDetailKey,
  type CustomOrderState,
  type CustomOrderView,
} from '@impera/contracts';

import { euros, FORMAT_LABELS } from '../custom-prices/model';

/*
 * His custom order as the screens say it (ADR 0159 § A): where it stands, its steps up to delivery, what he asked.
 * Pure, so each sentence is tested once and the dashboard and her sheet say the same.
 */

/** The colour of a state: amber waits on her, blue runs, green is done, grey is closed. Red is kept for urgencies. */
export type OrderTone = 'warn' | 'info' | 'ok' | 'muted';

export const STATE_LABELS: Readonly<Record<CustomOrderState, string>> = {
  gathering: 'Elle lui pose ses questions',
  awaiting_creator: 'Attend sa réponse',
  creator_yes: 'Elle a dit oui',
  creator_no: 'Elle a refusé',
  deposit_paid: 'Acompte reçu',
  delivered: 'Livrée',
  expired: 'Expirée',
  cancelled: 'Annulée',
};

export const STATE_TONES: Readonly<Record<CustomOrderState, OrderTone>> = {
  gathering: 'info',
  awaiting_creator: 'warn',
  creator_yes: 'info',
  creator_no: 'muted',
  deposit_paid: 'info',
  delivered: 'ok',
  expired: 'muted',
  cancelled: 'muted',
};

export const DETAIL_LABELS: Readonly<Record<CustomDetailKey, string>> = {
  what: 'Ce qu’il veut',
  when: 'Pour quand',
  name_to_say: 'Prénom ou mot',
  pose: 'Pose',
  outfit: 'Tenue',
  written_text: 'Texte écrit',
  photo_count: 'Nombre de photos',
  duration: 'Durée',
  scenario: 'Déroulé',
  words: 'Ce qu’elle dit',
  photo_received: 'Sa photo',
  tone: 'Ton',
  availability: 'Ses disponibilités',
};

export interface OrderStep {
  readonly label: string;
  readonly done: boolean;
}

/** Whether her price asks a deposit: known once she said yes; before, a video or a call will. */
function takesDeposit(order: Pick<CustomOrderView, 'format' | 'depositMinor' | 'priceMinor'>): boolean {
  if (order.priceMinor !== null) return order.depositMinor !== null;
  // Any price gives the same answer: the rule is the format's (`customDepositMinor`).
  return customDepositMinor(order.format, 10_000) !== null;
}

/** Her price asks it all before: a call or a video call (`customDepositMinor`). */
function paidInFull(order: Pick<CustomOrderView, 'format' | 'depositMinor' | 'priceMinor'>): boolean {
  if (order.priceMinor !== null) return order.depositMinor === order.priceMinor;
  return customDepositMinor(order.format, 10_000) === 10_000;
}

/**
 * The steps up to delivery, each done or not: Demande, Son oui, Acompte (when her price asks one), Livrée. A closed
 * order (refused, cancelled, expired) shows its steps as they stood.
 */
export function stepsOf(order: CustomOrderView): OrderStep[] {
  const rank: Readonly<Record<CustomOrderState, number>> = {
    gathering: 0,
    awaiting_creator: 1,
    creator_no: 1,
    expired: 1,
    cancelled: order.priceMinor === null ? 1 : 2,
    creator_yes: 2,
    deposit_paid: 3,
    delivered: 4,
  };
  const reached = rank[order.state];
  const steps: { label: string; at: number }[] = [
    { label: 'Demande', at: 1 },
    { label: 'Son oui', at: 2 },
    // Paid in full before (a call, a video call): the step says « Payé », not a deposit.
    ...(takesDeposit(order) ? [{ label: paidInFull(order) ? 'Payé' : 'Acompte', at: 3 }] : []),
    { label: 'Livrée', at: 4 },
  ];
  return steps.map((step) => ({ label: step.label, done: reached >= step.at }));
}

/** What he asked, in a few words: « Vidéo pour lui · 3 min ». */
export function headlineOf(order: Pick<CustomOrderView, 'format' | 'minutes'>): string {
  const format = order.format === null ? 'Demande à préciser' : FORMAT_LABELS[order.format];
  return order.minutes === null ? format : `${format} · ${String(order.minutes)} min`;
}

/** The details he gave, in the order of the contract, labelled. */
export function detailLines(order: Pick<CustomOrderView, 'details'>): { label: string; value: string }[] {
  return CUSTOM_DETAIL_KEYS.flatMap((key) => {
    const value = order.details[key];
    return value === undefined ? [] : [{ label: DETAIL_LABELS[key], value }];
  });
}

/** The price her grid proposes, prefilled in « Elle accepte à … € »; null when the grid gives none. */
export function proposedMinor(order: Pick<CustomOrderView, 'card'>): number | null {
  const quote = order.card?.quote;
  return quote?.kind === 'price' && quote.totalMinor >= 100 ? quote.totalMinor : null;
}

/** What the grid says on the card, for her to read before answering. */
export function quoteLine(order: Pick<CustomOrderView, 'card'>): string {
  const quote = order.card?.quote ?? null;
  if (quote === null) return 'Sa grille ne propose pas de prix.';
  if (quote.kind === 'price') return `Sa grille propose ${euros(quote.totalMinor)}.`;
  if (quote.kind === 'declined') return 'Sa grille dit qu’elle ne le fait pas.';
  return 'Hors de sa grille : à elle de fixer le prix.';
}

/** Her price and what he pays first: « 50 € · acompte 25 € », « 50 € payés d’avance », « 20 € à la livraison ». */
export function priceLine(order: Pick<CustomOrderView, 'priceMinor' | 'depositMinor'>): string | null {
  if (order.priceMinor === null) return null;
  if (order.depositMinor === null) return `${euros(order.priceMinor)} à la livraison`;
  if (order.depositMinor === order.priceMinor) return `${euros(order.priceMinor)} payés d’avance`;
  return `${euros(order.priceMinor)} · acompte ${euros(order.depositMinor)}`;
}

export type OrderAction =
  | { readonly kind: 'decide' }
  | {
      readonly kind: 'advance';
      readonly to: 'deposit_paid' | 'delivered' | 'cancelled';
      readonly label: string;
    };

/** What the owner can do next on it; nothing on a closed order. */
export function actionsOf(order: CustomOrderView): OrderAction[] {
  const cancel = { kind: 'advance', to: 'cancelled', label: 'Annuler' } as const;
  const deliver = { kind: 'advance', to: 'delivered', label: 'Livrée' } as const;
  switch (order.state) {
    case 'gathering':
    case 'awaiting_creator':
      return [{ kind: 'decide' }];
    case 'creator_yes':
      return order.depositMinor === null
        ? [deliver, cancel]
        : [
            {
              kind: 'advance',
              to: 'deposit_paid',
              label: order.depositMinor === order.priceMinor ? 'Paiement reçu' : 'Acompte reçu',
            },
            deliver,
            cancel,
          ];
    case 'deposit_paid':
      return [deliver, cancel];
    case 'creator_no':
    case 'delivered':
    case 'expired':
    case 'cancelled':
      return [];
  }
}
