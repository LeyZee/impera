import type { AgencyInsights, AgencySaleKind, DashboardSalesSeller } from '@impera/contracts';

import { clockOf } from '@/scheduling/time';

/*
 * The agency's insights as the screen says them (ADR 0078): pure, from the server's answer. Money comes in cents and
 * leaves as euros; every colour is a series token in a fixed order, following the entity, never its rank.
 */

/**
 * One palette per axis, none shared between blocks (relecture 06/11): the kinds of sale take the cyan ramp
 * (`--nv-kind-1..4`, light to dark, apart from the money's rose and blue, avenant du 17/11 à l'ADR 0106 § 10, choix B
 * de Charles le 19/11), then « Autres ventes » the neutral fold; who sold takes the team's ink, the agent's violet and the data gold; a total, the
 * creators' bars and the hours' ramp take the data ink alone.
 */
export const KINDS = [
  'var(--nv-kind-1)',
  'var(--nv-kind-2)',
  'var(--nv-kind-3)',
  'var(--nv-kind-4)',
] as const;
/** The four categorical series, for what is not money (the AI's providers and uses, Consommation IA). */
export const SERIES = [
  'var(--nv-series-1)',
  'var(--nv-series-2)',
  'var(--nv-series-3)',
  'var(--nv-series-4)',
] as const;
export const OTHER = 'var(--nv-series-other)';

/**
 * A number in French, its thousands apart with a no-break space: the narrow one `toLocaleString` writes all but
 * vanishes in Geist at small sizes (« 2185,12 € » beside « 6 828,50 € », Design 27/11). Every figure of the
 * Dashboard goes through here.
 */
export function frNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString('fr-FR', options).replace(/\u202f/gu, '\u00a0');
}

/** « 1 846 € », « 10,50 € » from cents: the cents only when there are some (ADR 0011: exact money). */
export function euros(cents: number): string {
  const digits = cents % 100 === 0 ? 0 : 2;
  return `${frNumber(cents / 100, { minimumFractionDigits: digits, maximumFractionDigits: digits })}\u00a0€`;
}

/** « 1,2 k€ », « 18 k€ »: an axis label, never a figure to read. */
export function shortEuros(cents: number): string {
  const value = cents / 100;
  if (Math.abs(value) >= 1000) {
    const thousands = value / 1000;
    return `${frNumber(thousands, { maximumFractionDigits: Math.abs(thousands) < 10 ? 1 : 0 })}\u00a0k€`;
  }
  return `${frNumber(Math.round(value))}\u00a0€`;
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

/**
 * The shares of `parts` in `whole`, in whole %, that add up to the rounded share of their sum: 100 when the parts make
 * the whole. Largest remainder: each part gets its share rounded down, and the points left go to the parts with the
 * largest fractions, the first one on a tie. Only the percentages move, never an amount (recette du 13/11 : 17 + 17 +
 * 42 + 25 = 101 %). Zeros for an empty whole.
 */
export function sharesOf(parts: readonly number[], whole: number, points = 100): number[] {
  if (whole <= 0) return parts.map(() => 0);
  // In whole cents × points, never in floats: two equal remainders stay equal, the tie goes to the first part.
  const scaled = parts.map((part) => Math.max(0, part) * points);
  const shares = scaled.map((one) => Math.floor(one / whole));
  const target = Math.round(scaled.reduce((sum, one) => sum + one, 0) / whole);
  const order = scaled
    .map((one, index) => ({ index, rest: one - (shares[index] ?? 0) * whole }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index);
  let left = target - shares.reduce((sum, one) => sum + one, 0);
  for (const { index } of order) {
    if (left <= 0) break;
    shares[index] = (shares[index] ?? 0) + 1;
    left -= 1;
  }
  return shares;
}

/** « 37,5 % », « 62 % »: a share with its tenth when it has one, a non-breaking space before the sign. */
export function percentText(share: number): string {
  return `${frNumber(share, { maximumFractionDigits: 1 })}\u00a0%`;
}

/** Euros to the cent, always: a figure read in a tip, never rounded away (ADR 0106 § 12). */
export function exactEuros(cents: number): string {
  return `${frNumber(cents / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\u00a0€`;
}

type MoneyFigures = Pick<
  AgencyInsights['totals']['current'],
  'revenueMinor' | 'revenueExclVatMinor' | 'netMinor' | 'agencyMinor' | 'creatorMinor'
>;

/** One part of « Où va l'argent » (ADR 0106 § 5): what the fans paid, split in four, in the order money leaves. */
export interface MoneyPart {
  readonly key: 'fansVat' | 'commission' | 'creator' | 'agency';
  readonly label: string;
  readonly cents: number;
  readonly previousCents: number;
  /** The net's two parts say their share of the net too. */
  readonly ofNet: boolean;
  readonly note: string;
}

function split(figures: MoneyFigures): Record<MoneyPart['key'], number> {
  const at = (cents: number): number => Math.max(0, cents);
  return {
    fansVat: at(figures.revenueMinor - figures.revenueExclVatMinor),
    commission: at(figures.revenueExclVatMinor - figures.netMinor),
    creator: at(figures.creatorMinor),
    agency: at(figures.agencyMinor),
  };
}

/** What each money figure says in %, from the same split everywhere, so a tile, the bar and its legend agree. */
export interface MoneyShares {
  /** Of the revenue, the four parts adding up to 100. */
  readonly ofRevenue: Readonly<Record<MoneyPart['key'], number>>;
  /**
   * Of the net, the two parts adding up to 100, to the tenth: a percentage agreed with a creator is often a half
   * (37,5 %), and her sheet says it so; the Dashboard never says « 37 % » for it (PAY-16).
   */
  readonly ofNet: Readonly<Record<'creator' | 'agency', number>>;
}

export function moneyShares(figures: MoneyFigures): MoneyShares {
  const parts = split(figures);
  const [fansVat = 0, commission = 0, creator = 0, agency = 0] = sharesOf(
    [parts.fansVat, parts.commission, parts.creator, parts.agency],
    figures.revenueMinor,
  );
  const [creatorOfNet = 0, agencyOfNet = 0] = sharesOf(
    [parts.creator, parts.agency],
    figures.netMinor,
    1_000,
  );
  return {
    ofRevenue: { fansVat, commission, creator, agency },
    ofNet: { creator: creatorOfNet / 10, agency: agencyOfNet / 10 },
  };
}

/**
 * The period's revenue split in four, the platform's amounts as they are: the VAT the fans paid (revenue less its
 * amount without VAT), the platform's commission (that less the net), then the net's two parts, each beside the same
 * part of the period before. A part never drawn below zero: refunds heavier than sales leave an empty bar, never a
 * negative block.
 */
export function moneyParts(current: MoneyFigures, previous: MoneyFigures, several: boolean): MoneyPart[] {
  const now = split(current);
  const then = split(previous);
  const part = (key: MoneyPart['key'], label: string, ofNet: boolean, note: string): MoneyPart => ({
    key,
    label,
    cents: now[key],
    previousCents: then[key],
    ofNet,
    note,
  });
  return [
    part(
      'fansVat',
      'TVA payée par les fans',
      false,
      'La plateforme la reverse à l’État : elle n’est à personne.',
    ),
    part('commission', 'Commission de la plateforme', false, 'Ce que la plateforme garde sur chaque vente.'),
    part(
      'creator',
      several ? 'Part des créatrices' : 'Part de la créatrice',
      true,
      several
        ? 'Ce que la plateforme leur verse, son propre chiffre.'
        : 'Ce que la plateforme lui verse, son propre chiffre.',
    ),
    part('agency', 'Part de l’agence', true, 'Ce que la plateforme verse à l’agence, son propre chiffre.'),
  ];
}

/**
 * The tip of a money figure (ADR 0106 § 12): the amount to the cent, the period before and how it changed, its share
 * of the revenue and, for a part of the net, of the net; one sentence in plain ink.
 */
export function moneyTip(input: {
  readonly title: string;
  readonly cents: number;
  readonly previousCents: number | null;
  readonly revenueMinor: number;
  readonly netMinor: number | null;
  readonly text: string;
  /** The share already settled with the figure's siblings (`moneyShares`), in place of rounding it alone. */
  readonly revenueShare?: number;
  readonly netShare?: number;
}): { title: string; rows: (readonly [string, string])[]; text: string } {
  const rows: (readonly [string, string])[] = [['Montant', exactEuros(input.cents)]];
  if (input.previousCents !== null) {
    const change = changeOf(input.cents, input.previousCents);
    rows.push([
      'Période d’avant',
      change === null
        ? exactEuros(input.previousCents)
        : `${exactEuros(input.previousCents)} (${deltaText(change)})`,
    ]);
  }
  if (input.revenueMinor > 0)
    rows.push([
      'Part du chiffre d’affaires',
      `${String(input.revenueShare ?? shareOf(input.cents, input.revenueMinor))}\u00a0%`,
    ]);
  if (input.netMinor !== null && input.netMinor > 0)
    rows.push(['Part du net', percentText(input.netShare ?? shareOf(input.cents, input.netMinor))]);
  return { title: input.title, rows, text: input.text };
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

/**
 * Each kind's step of the ramp, by its usual weight (relecture Design 19/11): the PPV, the biggest, the strongest tone,
 * then the subscriptions, the tips, the Mass DM; « Autres ventes » the neutral fold. Fixed per kind, never by the
 * period's rank: a filter or another month never repaints a kind (dataviz: colour follows the entity).
 */
const KIND_STEP: Readonly<Record<string, number>> = { ppv: 0, subscriptions: 1, tips: 2, mass_dm: 3 };

function kindColour(key: string): string {
  const step = KIND_STEP[key];
  return step === undefined ? OTHER : (KINDS[step] ?? OTHER);
}

/** The kinds' ring: every slice in its fixed colour, empty ones kept out (a slice of nothing says nothing). */
export function kindSlices(kinds: AgencyInsights['kinds']): Slice[] {
  return KIND_SLICES.map((slice) => {
    const mine = kinds.filter((one) => slice.kinds.includes(one.kind));
    return {
      key: slice.key,
      label: slice.label,
      colour: kindColour(slice.key),
      cents: mine.reduce((sum, one) => sum + one.revenueMinor, 0),
      previousCents: mine.reduce((sum, one) => sum + one.previousRevenueMinor, 0),
      sales: mine.reduce((sum, one) => sum + one.sales, 0),
    };
  }).filter((slice) => slice.cents > 0 || slice.previousCents > 0);
}

/** What a line of « Qui a vendu » that is not a member stands for, in its tip. */
export const SELLER_NOTES: Readonly<Record<DashboardSalesSeller['kind'], string>> = {
  member: 'Les ventes des membres de l’équipe, reliés à leur compte Reveal.',
  agent: 'Ce que l’agent a vendu seul, sur la clé de l’agence.',
  unlinked:
    'Un compte de chatteur Reveal que personne n’a encore relié à un membre (Équipe › Comptes Reveal).',
  none: 'Une vente sans chatteur : un abonnement, un renouvellement, un tip spontané.',
};

/** The lines of « Qui a vendu » that are no one's sale: under the sellers, in this order, never ranked. */
const NOT_A_SELLER: readonly DashboardSalesSeller['kind'][] = ['unlinked', 'none'];

/**
 * « Qui a vendu » answers with sellers first (recette visuelle 16/11, PIL-03): the members and the agent ranked by
 * revenue, the biggest first; then the sales of a chatter nobody linked and those with no chatter, unranked, at the
 * bottom. The amounts are the server's, untouched.
 */
export function sellerRanking(sellers: AgencyInsights['sellers']): {
  ranked: AgencyInsights['sellers'];
  rest: AgencyInsights['sellers'];
} {
  const ranked = sellers
    .filter((one) => !NOT_A_SELLER.includes(one.seller.kind))
    .toSorted((a, b) => b.revenueMinor - a.revenueMinor);
  const rest = NOT_A_SELLER.flatMap((kind) => sellers.filter((one) => one.seller.kind === kind));
  return { ranked, rest };
}

/** One stack of the chart of the period: a kind's part of a day or an hour. */
export interface Stack {
  readonly key: string;
  readonly label: string;
  readonly colour: string;
}

/** The stacks of the chart of the period: the kinds, in the ring's order and colours (the agency's as one creator's). */
export const STACKS: readonly Stack[] = KIND_SLICES.map((slice) => ({
  key: slice.key,
  label: slice.label,
  colour: kindColour(slice.key),
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

/** The busiest slot of three hours of the week, summed over the days: « 21 h – 0 h ». */
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

/** « 18 h », an hour of the day as the rest of the CRM writes it (recette 11/11, ADM-08). */
export const hourLabel = (hour: number): string => clockOf(hour * 60);

/** « 18 h – 21 h », never cut between two lines: `hours` from `from`. */
export const hoursLabel = (from: number, hours = 1): string =>
  `${hourLabel(from)}\u00a0–\u00a0${hourLabel((from + hours) % 24)}`;

/** « 21 h – 0 h » for the slot of three hours that starts at 21 h. */
export const slotLabel = (from: number): string => hoursLabel(from, 3);

/** A heat level from 0 to 1 against the busiest cell (a sequential ramp of one hue). */
export function heatOf(cents: number, max: number): number {
  return max > 0 ? Math.round((cents / max) * 100) / 100 : 0;
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
  const text = frNumber(Math.abs(n));
  return n > 0 ? `+${text}` : n < 0 ? `−${text}` : '0';
}

/** A refund's kind, one sale's word (ADR 0092 § 4): the ring's names, the folded ones said each. */
export const REFUND_KIND: Readonly<Record<AgencySaleKind, string>> = {
  subscriptions: 'Abonnement',
  ppv: 'PPV en privé',
  mass_dm: 'Mass DM',
  tips: 'Tip',
  payment_links: 'Lien de paiement',
  boudoir: 'Boudoir',
  paid_messages: 'Message payant',
  other: 'Autre vente',
};

/** How long after its sale a refund came: « le jour même », « 3 jours après »; none for a sale out of the register. */
export function refundDelayLabel(days: number | null): string {
  if (days === null) return 'vente hors registre';
  if (days === 0) return 'le jour même';
  return `${frNumber(days)} jour${days > 1 ? 's' : ''} après`;
}

/** When a refund came, always with its day: « 6 nov., 14 h 05 », in the platform's zone. */
export function refundDateLabel(iso: string, timeZone: string): string {
  const at = new Date(iso);
  const time = at
    .toLocaleTimeString('fr-FR', { timeZone, hour: 'numeric', minute: '2-digit' })
    .replace(':', '\u00a0h\u00a0');
  return `${at.toLocaleDateString('fr-FR', { timeZone, day: 'numeric', month: 'short' })}, ${time}`;
}

/** A seller's key in the refunds' filter: a member by id, the others by kind. */
export const sellerKeyOf = (seller: DashboardSalesSeller): string =>
  seller.kind === 'member' ? `member:${seller.memberId}` : seller.kind;

/** The refunds a filter keeps: one creator or all, one seller or all (`'all'`). */
export function refundsKept(
  list: AgencyInsights['refundList'],
  creatorId: string,
  seller: string,
): AgencyInsights['refundList'] {
  return list.filter(
    (one) =>
      (creatorId === 'all' || one.creatorId === creatorId) &&
      (seller === 'all' || sellerKeyOf(one.seller) === seller),
  );
}
