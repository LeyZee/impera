import type { AgendaView } from './AgendaPage';

/** `/agenda?jour=YYYY-MM-DD&vue=semaine`: the day shown (today without it) and the view (Jour without it). */
export interface AgendaSearch {
  readonly jour?: string;
  readonly vue?: 'semaine';
}

const DAY = /^\d{4}-\d{2}-\d{2}$/u;

export function parseAgendaSearch(search: Record<string, unknown>): AgendaSearch {
  const { jour, vue } = search;
  return {
    ...(typeof jour === 'string' && DAY.test(jour) && !Number.isNaN(Date.parse(jour)) ? { jour } : {}),
    ...(vue === 'semaine' ? { vue } : {}),
  };
}

export const viewOf = (search: AgendaSearch): AgendaView => (search.vue === 'semaine' ? 'week' : 'day');
