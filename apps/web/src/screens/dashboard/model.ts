import type { TelegramNight } from '@/settings/telegram/NightBanner';

/**
 * What the Dashboard shows, in the shape the screen needs: `GET /v1/dashboard` written in French (`live.ts`). Nothing
 * stands in for it: before any creator, the screen asks for one (DASH-13).
 * Money is in euros, durations in minutes, rates in % (0 to 100).
 */

/** `idle`: nothing wrong, nothing running yet (Reveal never linked): neutral, no colour. */
export type Tone = 'ok' | 'warn' | 'bad' | 'idle';
export type Period = 'day' | 'week' | 'month';

export const PERIODS: readonly { readonly id: Period; readonly label: string }[] = [
  { id: 'day', label: 'Aujourd’hui' },
  { id: 'week', label: '7 jours' },
  { id: 'month', label: '30 jours' },
];

/** One line of « À traiter »: it opens its conversation in Suivi. */
export interface Todo {
  readonly id: string;
  readonly tone: Tone;
  /** The kind, in the trade's words: « Mineur possible », « Demande de rencontre », « À valider dans Suivi ». */
  readonly kind: string;
  readonly title: string;
  /** One sentence: why it waits for a human, and what the agent does meanwhile. */
  readonly why: string;
  /** How long it has waited, « depuis 19 min » (DASH-11), amber past 10 min (`late`). */
  readonly waiting: string;
  readonly late: boolean;
  /** « Reçu à 23 h 41 », her time: the exact hour, in the line's tip. */
  readonly at: string;
  readonly conversationId: string;
}

/**
 * One card of the « L'agent » fold: its value, one useful sentence under it (`sub`), the rest in its tip (`rows`,
 * DASH-17). `gauge` is a spend or a rate against a mark.
 */
export interface AgentCard {
  readonly id: string;
  readonly tone: Tone;
  readonly title: string;
  readonly value: string;
  readonly sub: string;
  readonly rows: readonly (readonly [label: string, value: string])[];
  /** A spend against its budget (neutral, amber from 70 %, neon from 90 %) or a rate against its target (tone). */
  readonly gauge?: { readonly kind: 'spend' | 'rate'; readonly value: number; readonly mark: number };
  /**
   * What the fold's title says when this card is the worst of the agent's health (DASH-06), or nothing when the card
   * never darkens the fold: the handoffs to a human are the job, and the live rate is a goal, not a fault.
   */
  readonly alarm?: string;
}

export interface AgentState {
  readonly tone: Tone;
  /** The eyebrow over the sentence, after the mode: how many conversations it follows. */
  readonly eyebrow: string;
  /** The state sentence; the part between ** is lit in the tone. */
  readonly headline: string;
  readonly lead: string;
  /** The one action of the screen, when there is one (« Voir l'urgence »). */
  readonly action?: string;
  /** Nothing is written, in a tone that is not red (its key is missing): its sentence still leads the hero. */
  readonly stalled?: true;
  /** Where the action leads, when it is a page and not the first todo (« Poser la clé » › Réglages). */
  readonly actionTo?: '/reglages/modeles-ia';
  /** The lead read by whoever cannot open `actionTo` (Réglages is the owner's alone): who does it, and where. */
  readonly leadWithoutAction?: string;
  /**
   * The AI budget past its alert, in one sentence for the hero (« À 18,62 € sur 20 €, l’agent s’arrêtera bientôt. »,
   * DASH-06); absent below it and for a creator, whose agency's spend is not hers.
   */
  readonly budgetNote?: string;
  /** The fold's title (« L'agent fonctionne normalement ») and its one-line summary. */
  readonly foldTitle: string;
  readonly foldSummary: string;
  readonly cards: readonly AgentCard[];
}

/** A figure the corpus says moves sales, against the period before. */
export interface Lever {
  readonly id: 'first-offer-bought' | 'time-to-first-offer' | 'blocked-at-payment';
  readonly label: string;
  readonly current: number;
  readonly previous: number;
  readonly tip: readonly [title: string, text: string];
}

export interface SalesSeries {
  /** One label per point: hours (« 14 h ») for a day, dates (« 12 oct. ») otherwise. */
  readonly labels: readonly string[];
  readonly agent: readonly number[];
  readonly chatters: readonly number[];
  /** Yesterday, same hours, agent only: shown dotted on the day view. */
  readonly past?: readonly number[];
}

export interface Sales {
  readonly agent: number;
  readonly chatters: number;
  /** What the agent sold over the period before, for the delta. */
  readonly agentBefore: number;
  readonly series: SalesSeries;
  readonly levers: readonly Lever[];
  /** Head counts per funnel step, this period and the one before. */
  readonly funnel: { readonly counts: readonly number[]; readonly before: readonly number[] };
}

export interface Fan {
  readonly id: string;
  readonly name: string;
  /** The conversation of his latest purchase over the period: a click opens it in Suivi (DASH-14). */
  readonly conversationId: string;
  /** « depuis 3 semaines »: how long ago he first wrote. */
  readonly line: string;
  readonly spent: number;
  readonly byAgent: number;
}

export interface Dashboard {
  readonly creator: { readonly name: string; readonly platform: string; readonly now: string };
  readonly agent: AgentState;
  readonly todos: readonly Todo[];
  /** Null on the server's data until the Reveal connector observes purchases: nothing stands in for them. */
  readonly sales: Readonly<Record<Period, Sales>> | null;
  /** Best fans first. */
  readonly fans: readonly Fan[];
  /**
   * One discreet sentence under the best fans on how their dollars were counted: converted at an ECB day's rate, or
   * left out for want of one (`usdNote`). Absent when no dollar sale falls in the period, and on sample data.
   */
  readonly usdNote?: string;
  /** Telegram's coverage of her night (`telegramNightOf`); absent on sample data. */
  readonly telegram?: TelegramNight;
}
