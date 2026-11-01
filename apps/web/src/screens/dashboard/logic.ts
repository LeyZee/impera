import type { AgentCard, AgentState, Lever, Period, SalesSeries, Todo, Tone } from './model';

import type { AgentMode } from '@/agent/mode';

/* Pure helpers of the Dashboard: formatting and the few decisions the screen makes on its data. */

/** The period in the address (`/?periode=7j`): a reload or a shared link keeps it; today is the address with none. */
export interface DashboardSearch {
  readonly periode?: '7j' | '30j';
}

const PERIOD_PARAMS = { week: '7j', month: '30j' } as const satisfies Partial<Record<Period, string>>;

/** Anything else in the address than a known period reads as today. */
export function parseDashboardSearch(search: Record<string, unknown>): DashboardSearch {
  const { periode } = search;
  return periode === '7j' || periode === '30j' ? { periode } : {};
}

export const periodOf = (search: DashboardSearch): Period =>
  search.periode === '7j' ? 'week' : search.periode === '30j' ? 'month' : 'day';

export const dashboardSearch = (period: Period): DashboardSearch =>
  period === 'day' ? {} : { periode: PERIOD_PARAMS[period] };

/** « 1 846 € », « 10,50 € »: the cents only when there are some, never rounded away (ADR 0011: exact money). */
export function eur(value: number): string {
  const cents = Math.round(value * 100);
  const digits = cents % 100 === 0 ? 0 : 2;
  return `${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} €`;
}

/** « 2 h 05 » from minutes. */
export function hoursMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(total / 60))} h ${String(total % 60).padStart(2, '0')}`;
}

/** « +12 », « −6 » (true minus sign), « 0 » */
export function signed(value: number): string {
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '−'}${String(Math.abs(value))}`;
}

/** Change of `current` against `before`, in rounded %; 0 when there was nothing before. */
export function changePercent(current: number, before: number): number {
  return before > 0 ? Math.round(((current - before) / before) * 100) : 0;
}

/** Share of `part` in `part + rest`, in rounded %. */
export function sharePercent(part: number, rest: number): number {
  const total = part + rest;
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

/** The benchmark of the corpus: the first offer lands about 2 h 30 after the fan's first message. */
const FIRST_OFFER_MINUTES = 150;
const FIRST_OFFER_SLACK = 20;

export interface LeverView {
  readonly value: string;
  readonly unit: string;
  /** What the delta pill says: an evolution with its unit, or the benchmark. */
  readonly delta: string;
  readonly better: boolean;
}

/**
 * How a corpus lever reads. A rate moves in points, a count of fans in fans; the time before the first offer
 * has no « shorter is better »: it is good within 20 min of 2 h 30, and its pill shows the benchmark.
 */
export function leverView(lever: Lever): LeverView {
  const diff = lever.current - lever.previous;
  switch (lever.id) {
    case 'first-offer-bought':
      return { value: String(lever.current), unit: '%', delta: `${signed(diff)} pts`, better: diff >= 0 };
    case 'time-to-first-offer':
      return {
        value: hoursMinutes(lever.current),
        unit: '',
        delta: `repère ${hoursMinutes(FIRST_OFFER_MINUTES)}`,
        better: Math.abs(lever.current - FIRST_OFFER_MINUTES) <= FIRST_OFFER_SLACK,
      };
    case 'blocked-at-payment':
      return { value: String(lever.current), unit: 'fans', delta: signed(diff), better: diff <= 0 };
  }
}

/**
 * The sparkline of a lever: the real trend of the period, from the value before to the current one, with a
 * little life in between. Never an inverted axis: up means the number went up.
 */
export function trendSeries(from: number, to: number, seed: number, points = 12): number[] {
  const swing = Math.abs(to - from) || Math.abs(from) * 0.1;
  return Array.from({ length: points }, (_, i) => {
    const edge = i === 0 || i === points - 1;
    const wobble = edge ? 0 : Math.sin(i * 1.7 + seed) * swing * 0.14;
    return from + (to - from) * (i / (points - 1)) + wobble;
  });
}

export interface ChartTip {
  readonly title: string;
  readonly agent: string;
  readonly chatters: string;
  readonly footer: string;
}

/** The chart tip at point `i`: what the agent and the chatters sold, then yesterday or the agent's share. */
export function chartTip(period: Period, series: SalesSeries, i: number): ChartTip {
  const agent = series.agent[i] ?? 0;
  const chatters = series.chatters[i] ?? 0;
  const label = series.labels[i] ?? '';
  const past = series.past?.[i];
  return {
    title: period === 'day' ? `De 0 h à ${label}` : label,
    agent: eur(agent),
    chatters: eur(chatters),
    footer:
      period === 'day' && past !== undefined
        ? `Agent hier à la même heure : ${eur(past)}`
        : `${String(sharePercent(agent, chatters))} % vendu par l’agent`,
  };
}

/** Splits a state sentence on its **lit** part. */
export function litParts(sentence: string): { text: string; lit: boolean }[] {
  return sentence
    .split('**')
    .map((text, i) => ({ text, lit: i % 2 === 1 }))
    .filter((part) => part.text !== '');
}

/** The gauge modifier of a spend (budget rule of the design system) or of a rate (its tone). */
export function gaugeClass(kind: 'spend' | 'rate', value: number, tone: Tone): string {
  if (kind === 'rate') return tone === 'ok' ? '' : 'nv-gauge--amber';
  if (value >= 90) return 'nv-gauge--neon';
  return value >= 70 ? 'nv-gauge--amber' : '';
}

export interface Hero {
  readonly tone: Tone;
  readonly headline: string;
  readonly lead: string;
  readonly action?: string;
  readonly actionTo?: AgentState['actionTo'];
  readonly leadWithoutAction?: AgentState['leadWithoutAction'];
}

/** What the hero knows beyond the agent and its list. */
export interface HeroContext {
  /** A creator's Dashboard: the agent's state only (ADR 0023), the team's chores said as the agency's. */
  readonly forCreator?: boolean;
  /** An operator's global switch holds every creator: the hero says why the agent stops (DASH-08). */
  readonly globalStop?: boolean;
}

/**
 * The state sentence follows the « À traiter » list: how many things wait, and whether one is urgent. A stopped
 * agent says so first; an agent in trouble (`bad`) keeps its own sentence; an empty list is the calm sentence.
 *
 * A creator reads the agent's state only (ADR 0023: never a conversation nor a fan): no list, no action, and the
 * team's chores (its key, the alerts) are said as the agency's.
 */
export function heroState(
  agent: AgentState,
  todos: readonly Todo[],
  mode: AgentMode,
  { forCreator = false, globalStop = false }: HeroContext = {},
): Hero {
  if (!forCreator) return teamHero(agent, todos, mode, globalStop);
  const team = teamHero(agent, [], mode, globalStop);
  const hero: Hero = { tone: team.tone, headline: team.headline, lead: team.lead };
  if (team.actionTo !== undefined) {
    return {
      ...hero,
      lead: 'L’agence s’en occupe. D’ici là, les conversations restent aux chatteurs dans Reveal.',
    };
  }
  if (hero.tone === 'ok') return { ...hero, lead: `${modeLead(mode)}. L’agence suit les conversations.` };
  return hero;
}

/**
 * The agent acts: Reveal is read and a voice answers. Not linked yet, disconnected, no longer read, its key missing or
 * its voice down: whatever the mode, nothing runs.
 */
export const agentRuns = (agent: Pick<AgentState, 'tone' | 'stalled'>): boolean =>
  agent.tone !== 'bad' && agent.tone !== 'idle' && agent.stalled !== true;

const modeLead = (mode: AgentMode): string =>
  mode === 'auto' ? 'L’agent écrit seul' : 'L’agent propose, les chatteurs valident dans Reveal';

const GLOBAL_STOP_LEAD =
  'Un arrêt général est posé pour toutes les créatrices : seul un opérateur peut le lever.';

/** A sentence, then the AI budget past its alert when there is one (DASH-06). */
const withBudget = (lead: string, agent: AgentState): string =>
  agent.budgetNote === undefined ? lead : lead === '' ? agent.budgetNote : `${lead} ${agent.budgetNote}`;

function teamHero(agent: AgentState, todos: readonly Todo[], mode: AgentMode, globalStop: boolean): Hero {
  if (mode === 'stop') {
    // On Arrêt the list keeps the grave lines only: said in the lead, the headline stays the stop. Under a global
    // stop the lead says first why, next to the sentence it explains, not in a corner of the screen (DASH-08).
    const urgent = todos.filter((todo) => todo.tone === 'bad').length;
    const why = globalStop ? GLOBAL_STOP_LEAD : 'Plus rien ne part en son nom.';
    return {
      tone: 'bad',
      headline: 'L’agent est **arrêté**',
      lead:
        urgent === 0
          ? `${why} Les chatteurs gardent la main dans Reveal.`
          : `${why} ${urgent === 1 ? 'Une urgence reste' : `${String(urgent)} urgences restent`} à traiter quand même.`,
      action: 'Repasser en copilote',
    };
  }
  // An agent that writes nothing says so before what waits (Reveal, the voice, its key): its own sentence leads.
  if (!agentRuns(agent)) return agent;
  if (todos.length === 0) {
    return {
      tone: 'ok',
      headline: 'Tout va bien. **Rien ne t’attend.**',
      lead: `${modeLead(mode)}. ${agent.budgetNote ?? 'Les alertes arrivent ici et sur ton téléphone.'}`,
    };
  }
  const urgent = todos.filter((todo) => todo.tone === 'bad').length;
  const waiting =
    todos.length === 1 ? '**Une chose** t’attend' : `**${String(todos.length)} choses** t’attendent`;
  if (urgent === 0) {
    return {
      tone: 'warn',
      headline: waiting,
      lead: withBudget('Rien d’urgent : l’agent continue sur les autres conversations.', agent),
    };
  }
  // Only urgencies: named as such. Otherwise how many of them are.
  const headline =
    urgent === todos.length
      ? urgent === 1
        ? '**Une urgence** t’attend'
        : `**${String(urgent)} urgences** t’attendent`
      : `${waiting}, dont ${urgent === 1 ? 'une urgente' : `${String(urgent)} urgentes`}`;
  return {
    tone: 'warn',
    headline,
    lead: withBudget(agent.lead, agent),
    ...(agent.action === undefined ? {} : { action: agent.action }),
  };
}

export interface Fold {
  readonly tone: Tone;
  readonly title: string;
  /** Red: the dot beats, as the hero's orb. */
  readonly live: boolean;
}

const RANK: Readonly<Record<Tone, number>> = { bad: 2, warn: 1, ok: 0, idle: 0 };

/**
 * The title and dot of the « L’agent » fold: they follow the worst card that can alarm (Reveal read late, the voice,
 * waiting fans or blocked jobs, the budget), never « fonctionne normalement » over an amber card (DASH-06). A creator
 * reads that the agency handles it (DASH-21): none of it is hers to do.
 */
export function foldOf(agent: AgentState, stopped: boolean, forCreator: boolean): Fold {
  const own = agent.tone === 'bad' || agent.tone === 'idle' || agent.stalled === true;
  const worst = agent.cards
    .filter((card) => card.alarm !== undefined && RANK[card.tone] > 0)
    .reduce<AgentCard | null>(
      (pick, card) => (pick === null || RANK[card.tone] > RANK[pick.tone] ? card : pick),
      null,
    );
  const tone = own ? agent.tone : (worst?.tone ?? 'ok');
  const agency = forCreator && RANK[tone] > 0;
  const title = agency
    ? 'L’agence s’en occupe'
    : own
      ? agent.foldTitle
      : (worst?.alarm ?? (stopped ? 'Le reste fonctionne normalement' : agent.foldTitle));
  return { tone, title, live: tone === 'bad' };
}
