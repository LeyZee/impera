import type { AgencyInsights, AgencySteering } from '@impera/contracts';

import { bestSlot, euros, kindSlices, moneyShares, sellerRanking, shareOf, slotLabel } from './view';

/*
 * The owner's Dashboard (maquette du 27/11, lot 1): what its money band and its folded cards say, computed from the
 * figures the server already sends. Pure, so every sentence is tested.
 */

/** The running total of `values`, one per day (or hour): what the month's curve draws. */
export function cumulative(values: readonly number[]): number[] {
  let sum = 0;
  return values.map((value) => {
    sum += value;
    return sum;
  });
}

type Objectives = NonNullable<AgencyInsights['objectives']>;

/** Where the month stands against its objective: the bar, its mark and the pill under the figure. */
export interface Pace {
  readonly goalMinor: number;
  readonly revenueMinor: number;
  /** The bar's fill, in % of the objective, at most 100. */
  readonly fill: number;
  /** Where the month should be by now, in % of the objective: the mark on the bar; null once the month is over. */
  readonly mark: number | null;
  /** The month's end at this pace, null once it is over. */
  readonly projectedMinor: number | null;
  /** On its way (or reached), or short. */
  readonly tone: 'up' | 'down';
  /** « Dans les clous », « En retard », « Objectif atteint », « Objectif manqué ». */
  readonly word: string;
}

/** Nothing to say without an objective set: the band then says the figure alone and where to set one. */
export function paceOf(objectives: Objectives | null): Pace | null {
  if (objectives === null) return null;
  const goal = objectives.objectiveMinor;
  if (goal === null || goal <= 0) return null;
  const over = objectives.projectedMinor === null;
  const ahead = over ? objectives.revenueMinor >= goal : (objectives.projectedMinor ?? 0) >= goal;
  return {
    goalMinor: goal,
    revenueMinor: objectives.revenueMinor,
    fill: Math.min(100, shareOf(objectives.revenueMinor, goal)),
    mark: over ? null : Math.min(100, Math.round((objectives.daysGone / objectives.days) * 100)),
    projectedMinor: objectives.projectedMinor,
    tone: ahead ? 'up' : 'down',
    word: over ? (ahead ? 'Objectif atteint' : 'Objectif manqué') : ahead ? 'Dans les clous' : 'En retard',
  };
}

/** The three destinations of the period's revenue, adding up to 100 %: the agency, the creators, the rest. */
export interface MoneyThird {
  readonly key: 'agency' | 'creator' | 'rest';
  readonly label: string;
  readonly cents: number;
  readonly share: number;
}

export function moneyThirds(
  current: AgencyInsights['totals']['current'],
  several: boolean,
): readonly MoneyThird[] {
  const shares = moneyShares(current).ofRevenue;
  const rest = Math.max(0, current.revenueMinor - current.agencyMinor - current.creatorMinor);
  return [
    { key: 'agency', label: 'Agence', cents: Math.max(0, current.agencyMinor), share: shares.agency },
    {
      key: 'creator',
      label: several ? 'Créatrices' : 'Créatrice',
      cents: Math.max(0, current.creatorMinor),
      share: shares.creator,
    },
    { key: 'rest', label: 'Plateforme et TVA', cents: rest, share: shares.fansVat + shares.commission },
  ];
}

/** Today's revenue and yesterday's, read in the steering's last days (its last day is today). */
export function todayAndYesterday(
  steering: AgencySteering | undefined,
): { readonly today: number; readonly yesterday: number | null } | null {
  if (steering === undefined) return null;
  const days = steering.daily.days;
  const last = days.at(-1);
  const before = days.at(-2);
  return {
    today: steering.daily.todayMinor,
    yesterday: last?.day === steering.today && before !== undefined ? before.revenueMinor : null,
  };
}

const SELLER_SHORT: Readonly<Record<'agent' | 'unlinked' | 'none', string>> = {
  agent: 'L’IA',
  unlinked: 'Un chatteur non relié',
  none: 'Sans chatteur',
};

/** « Inès en tête · l’IA fait 24 % des ventes »; null when nobody sold. */
export function sellersLine(insights: Pick<AgencyInsights, 'sellers' | 'totals'>): string | null {
  const { ranked } = sellerRanking(insights.sellers);
  const top = ranked[0];
  const total = insights.totals.current.revenueMinor;
  if (top === undefined || total <= 0) return null;
  const name = top.seller.kind === 'member' ? top.seller.name : SELLER_SHORT[top.seller.kind];
  const agent = insights.sellers.find((one) => one.seller.kind === 'agent');
  const lead = `${name} en tête, ${String(shareOf(top.revenueMinor, total))} %`;
  if (agent === undefined || top.seller.kind === 'agent') return lead;
  return `${lead} · l’IA fait ${String(shareOf(agent.revenueMinor, total))} % des ventes`;
}

/** « PPV en privé 71 % · Abonnements 18 % · Tips 8 % »: the three biggest kinds; null without a sale. */
export function kindsLine(kinds: AgencyInsights['kinds']): string | null {
  const slices = kindSlices(kinds).filter((slice) => slice.cents > 0);
  const total = slices.reduce((sum, slice) => sum + slice.cents, 0);
  if (total <= 0) return null;
  return slices
    .toSorted((a, b) => b.cents - a.cents)
    .slice(0, 3)
    .map((slice) => `${slice.label} ${String(shareOf(slice.cents, total))} %`)
    .join(' · ');
}

/** « Léa en tête, 70 % »: the creator who brought the most; null with one creator or no sale. */
export function creatorsLine(
  insights: Pick<AgencyInsights, 'byCreator' | 'creators' | 'totals'>,
): string | null {
  const total = insights.totals.current.revenueMinor;
  if (insights.creators.length < 2 || total <= 0) return null;
  const top = insights.byCreator.toSorted((a, b) => b.revenueMinor - a.revenueMinor)[0];
  const name = insights.creators.find((one) => one.creatorId === top?.creatorId)?.name;
  if (top === undefined || name === undefined) return null;
  return `${name} en tête, ${String(shareOf(top.revenueMinor, total))} % du chiffre`;
}

/** « 366 premiers achats, dont 92 déjà revenus » over the steering's 30 days; null when nobody bought. */
export function trafficLine(traffic: AgencySteering['traffic']): string | null {
  if (traffic.firstPurchase === 0) return null;
  const first = `${traffic.firstPurchase.toLocaleString('fr-FR')} ${traffic.firstPurchase === 1 ? 'premier achat' : 'premiers achats'}`;
  return traffic.regular === 0
    ? `${first} sur 30 jours`
    : `${first} sur 30 jours, dont ${traffic.regular.toLocaleString('fr-FR')} déjà revenus`;
}

/** « 5 fans font 46 % du chiffre · 2 ont décroché »; null without a sale on the 30 days. */
export function dependencyLine(dependency: AgencySteering['dependency']): string | null {
  if (dependency.totalMinor <= 0 || dependency.payingFans === 0) return null;
  const five = shareOf(dependency.topOneMinor + dependency.nextFourMinor, dependency.totalMinor);
  const head =
    dependency.payingFans <= 5
      ? `${String(dependency.payingFans)} ${dependency.payingFans === 1 ? 'fan fait' : 'fans font'} tout le chiffre`
      : `5 fans font ${String(five)} % du chiffre`;
  const gone = dependency.lapsed.length;
  return gone === 0
    ? `${head} · aucun n’a décroché`
    : `${head} · ${String(gone)} ${gone === 1 ? 'a décroché' : 'ont décroché'}`;
}

/** « Surtout entre 21 h et 0 h »; null without a sale. */
export function hoursLine(hours: AgencyInsights['hours']): string | null {
  const slot = bestSlot(hours);
  if (slot === null) return null;
  return `Surtout ${slotLabel(slot.from)}, ${String(slot.share)} % des ventes`;
}

/** « 1 480 abonnés actifs · +52 nouveaux »; null before the platform's statistics are read. */
export function subscribersLine(subscribers: AgencyInsights['subscribers']): string | null {
  if (subscribers === null) return null;
  const { activeAtEnd, newSubscribers } = subscribers.current;
  const fresh = `+${newSubscribers.toLocaleString('fr-FR')} ${newSubscribers === 1 ? 'nouveau' : 'nouveaux'}`;
  return activeAtEnd === null ? fresh : `${activeAtEnd.toLocaleString('fr-FR')} actifs · ${fresh}`;
}

/** « 3 remboursements, 84 € »; null when none. */
export function refundsLine(insights: Pick<AgencyInsights, 'refundList'>): string | null {
  const list = insights.refundList;
  if (list.length === 0) return null;
  const amount = list.reduce((sum, one) => sum + (one.amountMinor ?? 0), 0);
  return `${String(list.length)} ${list.length === 1 ? 'remboursement' : 'remboursements'}, ${euros(amount)}`;
}

/** « Net 6 970 € · 94 ventes »: the answer of the detail of the money. */
export function detailLine(current: AgencyInsights['totals']['current']): string {
  return `Net ${euros(current.netMinor)} · ${current.sales.toLocaleString('fr-FR')} ventes`;
}
