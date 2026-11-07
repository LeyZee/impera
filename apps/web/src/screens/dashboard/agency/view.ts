import type { AgencyInsights, AgencyPeriod, AgencySaleKind, DashboardSalesSeller } from '@impera/contracts';

/*
 * The agency's insights as the screen says them (ADR 0078): pure, from the server's answer. Money comes in cents and
 * leaves as euros; every colour is a series token in a fixed order, following the entity, never its rank.
 */

/**
 * One palette per axis, none shared between blocks (relecture 06/11): the kinds of sale take the four categorical
 * series (validated Nuit and Jour, never violet, gold, red or cyan, the agent's, the sale's and the statuses'), then
 * « Autres ventes » the neutral fold; who sold takes the team's ink, the agent's violet and the data gold; a total, the
 * creators' bars and the hours' ramp take the data ink alone.
 */
export const SERIES = [
  'var(--nv-series-1)',
  'var(--nv-series-2)',
  'var(--nv-series-3)',
  'var(--nv-series-4)',
] as const;
export const OTHER = 'var(--nv-series-other)';

export const PERIOD_OPTIONS: readonly { readonly id: AgencyPeriod; readonly label: string }[] = [
  { id: 'day', label: 'Aujourd’hui' },
  { id: 'week', label: '7 jours' },
  { id: 'month', label: '30 jours' },
  { id: 'quarter', label: '3 mois' },
];

/** « par rapport à … »: the period the deltas compare to. */
export const AGAINST: Readonly<Record<AgencyPeriod, string>> = {
  day: 'par rapport à hier',
  week: 'par rapport aux 7 jours d’avant',
  month: 'par rapport aux 30 jours d’avant',
  quarter: 'par rapport aux 3 mois d’avant',
};

/** « 1 846 € », « 10,50 € » from cents: the cents only when there are some (ADR 0011: exact money). */
export function euros(cents: number): string {
  const digits = cents % 100 === 0 ? 0 : 2;
  return `${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}\u00a0€`;
}

/** « 1,2 k€ », « 18 k€ »: an axis label, never a figure to read. */
export function shortEuros(cents: number): string {
  const value = cents / 100;
  if (Math.abs(value) >= 1000) {
    const thousands = value / 1000;
    return `${thousands.toLocaleString('fr-FR', { maximumFractionDigits: Math.abs(thousands) < 10 ? 1 : 0 })}\u00a0k€`;
  }
  return `${Math.round(value).toLocaleString('fr-FR')}\u00a0€`;
}

/** The change against the period before, in %, rounded; `null` when there was nothing before to compare with. */
export function changeOf(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** « +18 % », « −4 % », « 0 % »: a delta's text, the true minus sign. */
export function deltaText(change: number): string {
  if (change === 0) return '0\u00a0%';
  return `${change > 0 ? '+' : '−'}${String(Math.abs(change))}\u00a0%`;
}

/** The share of `part` in `whole`, in %, rounded; 0 for an empty whole. */
export function shareOf(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** A slice of a ring: its label, colour, amount, and how it compares. */
export interface Slice {
  readonly key: string;
  readonly label: string;
  readonly colour: string;
  readonly cents: number;
  readonly previousCents: number;
  readonly sales: number;
}

/** The kinds as the ring shows them: four named, the rest folded in « Autres ventes ». */
const KIND_SLICES: readonly {
  readonly key: string;
  readonly label: string;
  readonly kinds: readonly AgencySaleKind[];
}[] = [
  { key: 'subscriptions', label: 'Abonnements', kinds: ['subscriptions'] },
  { key: 'ppv', label: 'PPV en privé', kinds: ['ppv'] },
  { key: 'mass_dm', label: 'Mass DM', kinds: ['mass_dm'] },
  { key: 'tips', label: 'Tips', kinds: ['tips'] },
  {
    key: 'other',
    label: 'Autres ventes',
    kinds: ['payment_links', 'boudoir', 'paid_messages', 'other'],
  },
];

/** What « Autres ventes » holds, for its tip. */
export const OTHER_KINDS_NOTE = 'Liens de paiement, boudoir, messages payants et le reste.';

/** The kinds' ring: every slice in its fixed colour, empty ones kept out (a slice of nothing says nothing). */
export function kindSlices(kinds: AgencyInsights['kinds']): Slice[] {
  return KIND_SLICES.map((slice, i) => {
    const mine = kinds.filter((one) => slice.kinds.includes(one.kind));
    return {
      key: slice.key,
      label: slice.label,
      colour: SERIES[i] ?? OTHER,
      cents: mine.reduce((sum, one) => sum + one.revenueMinor, 0),
      previousCents: mine.reduce((sum, one) => sum + one.previousRevenueMinor, 0),
      sales: mine.reduce((sum, one) => sum + one.sales, 0),
    };
  }).filter((slice) => slice.cents > 0 || slice.previousCents > 0);
}

/** Who sold, by family: the chatters together, the agent, a chatter nobody linked, no chatter. */
const SELLER_SLICES: readonly {
  readonly key: DashboardSalesSeller['kind'];
  readonly label: string;
  readonly colour: string;
}[] = [
  { key: 'member', label: 'Chatteurs', colour: 'var(--nv-data-1)' },
  { key: 'agent', label: 'Agent IA', colour: 'var(--nv-agent)' },
  { key: 'unlinked', label: 'Chatteur non relié', colour: 'var(--nv-data-2)' },
  { key: 'none', label: 'Sans chatteur', colour: OTHER },
];

export const SELLER_NOTES: Readonly<Record<DashboardSalesSeller['kind'], string>> = {
  member: 'Les ventes des membres de l’équipe, reliés à leur compte Reveal.',
  agent: 'Ce que l’agent a vendu seul, sur la clé de l’agence.',
  unlinked: 'Un compte de chatteur Reveal que personne n’a encore relié à un membre (Réglages › Ventes).',
  none: 'Une vente sans chatteur : un abonnement, un renouvellement, un tip spontané.',
};

export function sellerSlices(sellers: AgencyInsights['sellers']): Slice[] {
  return SELLER_SLICES.map((slice) => {
    const mine = sellers.filter((one) => one.seller.kind === slice.key);
    return {
      key: slice.key,
      label: slice.label,
      colour: slice.colour,
      cents: mine.reduce((sum, one) => sum + one.revenueMinor, 0),
      previousCents: mine.reduce((sum, one) => sum + one.previousRevenueMinor, 0),
      sales: mine.reduce((sum, one) => sum + one.sales, 0),
    };
  }).filter((slice) => slice.cents > 0);
}

/** One stack of the chart of the period: a kind's part of a day or an hour. */
export interface Stack {
  readonly key: string;
  readonly label: string;
  readonly colour: string;
}

/** The stacks of the chart of the period: the kinds, in the ring's order and colours (the agency's as one creator's). */
export const STACKS: readonly Stack[] = KIND_SLICES.map((slice, i) => ({
  key: slice.key,
  label: slice.label,
  colour: SERIES[i] ?? OTHER,
}));

/** A day's (or an hour's) amounts by kind, in the stacks' order. */
export function dayStacks(day: Pick<AgencyInsights['days'][number], 'byKind'>): number[] {
  return KIND_SLICES.map((slice) =>
    day.byKind
      .filter((one) => slice.kinds.includes(one.kind))
      .reduce((sum, one) => sum + one.revenueMinor, 0),
  );
}

/**
 * Three months on a phone: a column a week, a day being too thin to see. The week starts at the first day shown, the
 * last one may be shorter.
 */
export interface Column {
  readonly key: string;
  readonly label: string;
  readonly title: string;
  readonly parts: readonly number[];
  readonly total: number;
}

export function byWeek(columns: readonly Column[]): Column[] {
  const weeks: Column[] = [];
  for (let i = 0; i < columns.length; i += 7) {
    const days = columns.slice(i, i + 7);
    const first = days[0];
    if (first === undefined) continue;
    weeks.push({
      key: first.key,
      label: first.label,
      title: `Semaine du ${first.title}`,
      parts: first.parts.map((_, s) => days.reduce((sum, day) => sum + (day.parts[s] ?? 0), 0)),
      total: days.reduce((sum, day) => sum + day.total, 0),
    });
  }
  return weeks;
}

const DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const SHORT_FORMAT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** « mar. 4 nov. »: a day of the chart, in its tip. */
export function dayLabel(day: string): string {
  return DAY_FORMAT.format(new Date(`${day}T12:00:00Z`));
}

/** « 4 nov. »: a day under the chart's axis. */
export function shortDay(day: string): string {
  return SHORT_FORMAT.format(new Date(`${day}T12:00:00Z`));
}

export const WEEKDAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'] as const;
export const WEEKDAYS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const;

/** The busiest cell of the hours and where it is, for the sentence above the map; `null` without a sale. */
export function busiest(hours: AgencyInsights['hours']): { day: number; hour: number; cents: number } | null {
  let best: { day: number; hour: number; cents: number } | null = null;
  hours.forEach((row, day) => {
    row.forEach((cents, hour) => {
      if (cents > 0 && (best === null || cents > best.cents)) best = { day, hour, cents };
    });
  });
  return best;
}

/** The busiest slot of three hours of the week, summed over the days: « 21h–0h ». */
export function bestSlot(hours: AgencyInsights['hours']): { from: number; share: number } | null {
  const total = hours.flat().reduce((sum, cents) => sum + cents, 0);
  if (total <= 0) return null;
  let best = { from: 0, cents: -1 };
  for (let from = 0; from < 24; from += 3) {
    const cents = hours.reduce(
      (sum, row) => sum + (row[from] ?? 0) + (row[from + 1] ?? 0) + (row[from + 2] ?? 0),
      0,
    );
    if (cents > best.cents) best = { from, cents };
  }
  return { from: best.from, share: shareOf(best.cents, total) };
}

/** « 21h–0h » for the slot of three hours that starts at 21h. */
export function slotLabel(from: number): string {
  return `${String(from)}h–${String((from + 3) % 24)}h`;
}

/** A heat level from 0 to 1 against the busiest cell (a sequential ramp of one hue). */
export function heatOf(cents: number, max: number): number {
  return max > 0 ? Math.round((cents / max) * 100) / 100 : 0;
}

/** An arc of a ring of `radius`: its dash and where it starts, clockwise from the top, a gap between arcs. */
export function arcs(
  values: readonly number[],
  radius: number,
  gap = 2,
): { readonly dash: string; readonly offset: number }[] {
  const circumference = 2 * Math.PI * radius;
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  const shown = values.filter((value) => value > 0).length;
  const round = (n: number): number => Math.round(n * 100) / 100;
  let start = 0;
  return values.map((value) => {
    const length = total > 0 ? (Math.max(0, value) / total) * circumference : 0;
    const visible = shown > 1 ? Math.max(0, length - gap) : length;
    const arc = {
      dash: `${String(round(visible))} ${String(round(circumference))}`,
      offset: start === 0 ? 0 : round(-start),
    };
    start += length;
    return arc;
  });
}

/** « heure de Paris » for the platform's zone: the city of an IANA zone, its last part. */
export function zoneLabel(timeZone: string): string {
  const city = timeZone.split('/').pop()?.replaceAll('_', ' ') ?? timeZone;
  return `heure de ${city}`;
}

/** « 14 h 05 » today, « 6 nov., 14 h 05 » another day: when the platform's statistics were last read, in `timeZone`. */
export function readAtLabel(iso: string, timeZone: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const dayOf = (date: Date): string => date.toLocaleDateString('fr-CA', { timeZone });
  const time = at
    .toLocaleTimeString('fr-FR', { timeZone, hour: '2-digit', minute: '2-digit' })
    .replace(':', ' h ');
  if (dayOf(at) === dayOf(now)) return time;
  return `${at.toLocaleDateString('fr-FR', { timeZone, day: 'numeric', month: 'short' })}, ${time}`;
}

/** PPV bought out of PPV sent, in % rounded; null when nothing was sent or the platform still computes it. */
export function ppvRate(sent: number | null, purchased: number): number | null {
  if (sent === null || sent <= 0) return null;
  return Math.round((purchased / sent) * 100);
}

/** « +12 », « −3 », « 0 »: a change in subscribers, the true minus sign. */
export function signedCount(n: number): string {
  const text = Math.abs(n).toLocaleString('fr-FR');
  return n > 0 ? `+${text}` : n < 0 ? `−${text}` : '0';
}
