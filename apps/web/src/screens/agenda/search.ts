import type { AgendaView } from './AgendaPage';

/** `/agenda?jour=YYYY-MM-DD&vue=semaine|mois`: the day shown (today without it) and the view (Jour without it). */
export interface AgendaSearch {
  readonly jour?: string;
  readonly vue?: 'semaine' | 'mois';
}

const DAY = /^\d{4}-\d{2}-\d{2}$/u;

export function parseAgendaSearch(search: Record<string, unknown>): AgendaSearch {
  const { jour, vue } = search;
  return {
    ...(typeof jour === 'string' && DAY.test(jour) && !Number.isNaN(Date.parse(jour)) ? { jour } : {}),
    ...(vue === 'semaine' || vue === 'mois' ? { vue } : {}),
  };
}

export const viewOf = (search: AgendaSearch): AgendaView =>
  search.vue === 'semaine' ? 'week' : search.vue === 'mois' ? 'month' : 'day';

/** The `vue` of a view, none for Jour. */
export const vueOf = (view: AgendaView): Pick<AgendaSearch, 'vue'> =>
  view === 'week' ? { vue: 'semaine' } : view === 'month' ? { vue: 'mois' } : {};
