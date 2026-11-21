import type {
  AgencyPeriod,
  FanHolder,
  FanListFilter,
  FanListItem,
  FanListSort,
  FanListState,
  FanPaid,
} from '@impera/contracts';

/** The filters, « Tous » first, as the chips say them (ADR 0124 § 2). */
export function filterLabel(filter: FanListFilter, lapsedDays: number): string {
  const labels: Readonly<Record<FanListFilter, string>> = {
    all: 'Tous',
    big_payers: 'Gros payeurs',
    lapsed: `Ont décroché (${String(lapsedDays)}\u00a0j)`,
    payers: 'Payeurs',
    never_paid: 'N’ont jamais payé',
    unanswered: 'Sans réponse de nous',
  };
  return labels[filter];
}

export const FILTERS: readonly FanListFilter[] = [
  'all',
  'big_payers',
  'lapsed',
  'payers',
  'never_paid',
  'unanswered',
];

/** One sentence when a filter keeps nobody, said as a fact. */
export const EMPTY_LINES: Readonly<Record<FanListFilter, string>> = {
  all: 'Aucun fan pour l’instant : ils arrivent ici dès qu’ils écrivent sur Reveal.',
  big_payers: 'Aucun fan n’a payé sur la période.',
  lapsed: 'Aucun fan n’a décroché.',
  payers: 'Aucun fan n’a encore payé.',
  never_paid: 'Tous ses fans ont déjà payé.',
  unanswered: 'Personne n’attend de réponse.',
};

export const SORT_LABELS: Readonly<Record<FanListSort, string>> = {
  last_message: 'Dernier message',
  paid: 'Payé depuis toujours',
  last_payment: 'Dernier paiement',
};

export const PERIOD_LABELS: Readonly<Partial<Record<AgencyPeriod, string>>> = {
  week: '7\u00a0jours',
  month: '30\u00a0jours',
  quarter: '90\u00a0jours',
};

/** His states with Suivi's words, the urgent in red, the warnings in amber (ADR 0124 § 1). */
export const STATE_WORDS: Readonly<
  Record<FanListState, { readonly label: string; readonly tone: 'bad' | 'warn' }>
> = {
  age_disputed: { label: 'Âge contesté', tone: 'bad' },
  do_not_contact: { label: 'Ne plus lui écrire', tone: 'bad' },
  care: { label: 'Mode soin', tone: 'warn' },
  sales_frozen: { label: 'Ventes gelées', tone: 'warn' },
};

/** Two states at most on a line, the urgent first; the others counted (« +2 »). */
export function shownStates(states: readonly FanListState[]): {
  shown: FanListState[];
  more: number;
} {
  const ordered = [...states].sort(
    (a, b) => Number(STATE_WORDS[a].tone === 'warn') - Number(STATE_WORDS[b].tone === 'warn'),
  );
  return { shown: ordered.slice(0, 2), more: Math.max(0, ordered.length - 2) };
}

export function holderLine(item: Pick<FanListItem, 'holder' | 'holderName'>): string {
  const words: Readonly<Record<FanHolder, string>> = {
    agent: 'Agent',
    copilot: 'Copilote',
    human: item.holderName ?? 'Un humain',
    none: '—',
  };
  return words[item.holder];
}

const EUROS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const DOLLARS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD' });

/** What he paid, one line a currency as it is; « — » for nothing (never a converted guess). */
export function paidLines(paid: FanPaid): string[] {
  const parts = [
    ...(paid.eurMinor === 0 ? [] : [EUROS.format(paid.eurMinor / 100)]),
    ...(paid.usdMinor === 0 ? [] : [DOLLARS.format(paid.usdMinor / 100)]),
  ];
  return parts.length === 0 ? ['—'] : parts;
}

const DAY_MONTH = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

/** « il y a 12 min », « il y a 3 h », « il y a 4 j », then « 16 nov. » (with the year when it is another); « — ». */
export function shortWhen(at: string | null, now: Date): string {
  if (at === null) return '—';
  const then = new Date(at);
  const minutes = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 60_000));
  if (minutes < 60) return minutes < 1 ? 'à l’instant' : `il y a ${String(minutes)}\u00a0min`;
  if (minutes < 24 * 60) return `il y a ${String(Math.floor(minutes / 60))}\u00a0h`;
  const days = Math.floor(minutes / (24 * 60));
  if (days < 7) return `il y a ${String(days)}\u00a0j`;
  return then.getFullYear() === now.getFullYear() ? DAY_MONTH.format(then) : DAY_MONTH_YEAR.format(then);
}

/** « 1 fan », « 42 fans », with a thin space in the thousands. */
export function countLine(total: number): string {
  return `${new Intl.NumberFormat('fr-FR').format(total)} ${total > 1 ? 'fans' : 'fan'}`;
}
