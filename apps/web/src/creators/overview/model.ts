import type { AgentMode, CreatorOverview, CreatorTodoCount } from '@impera/contracts';

import { MODE_LABEL } from '@/agent/mode';
import { clockAt } from '@/scheduling/time';
import { categoryName, dueOf } from '@/screens/content/model';
import { eur } from '@/screens/dashboard/logic';

/*
 * What a card of the list of Créatrices says (« ok liste-créatrices », 06/11), in words: pure, so that the card only
 * lays it out and the tests read it without a browser. Red is kept for what is urgent, amber for what waits.
 */

export type Tone = 'ok' | 'warn' | 'bad' | 'calm';

const MONTHS = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
] as const;

/** Her agent: Automatique is what runs alone, Arrêt what a person must lift. */
export function modeOf(mode: AgentMode): { readonly label: string; readonly tone: Tone } {
  return { label: MODE_LABEL[mode], tone: mode === 'auto' ? 'ok' : mode === 'stop' ? 'warn' : 'calm' };
}

/** « du 16 au 20 nov. », « le 16 nov. » on the fortnight's first day. */
export function fortnightOf(from: string, to: string): string {
  const day = (iso: string): number => Number(iso.slice(8, 10));
  const month = MONTHS[Number(to.slice(5, 7)) - 1] ?? '';
  return from === to
    ? `le ${String(day(to))} ${month}`
    : `du ${String(day(from))} au ${String(day(to))} ${month}`;
}

/** Her fortnight's revenue, or why there is none. */
export function salesOf(sales: CreatorOverview['sales']): {
  readonly value: string;
  readonly note: string;
} {
  if (sales === null) return { value: '—', note: 'Registre des ventes non relié' };
  const period = fortnightOf(sales.from, sales.to);
  return {
    value: eur(sales.revenueMinor / 100),
    note: sales.usdLeftOut ? `${period}, hors ventes en dollars` : period,
  };
}

/** « Théo jusqu’à 23 h », « Théo et Nora », « Personne en ce moment ». */
export function onShiftOf(onShift: NonNullable<CreatorOverview['onShift']>, zone: string): string {
  const [first, second, ...others] = onShift;
  if (first === undefined) return 'Personne en ce moment';
  if (second === undefined) return `${first.name} jusqu’à ${clockAt(first.endsAt, zone)}`;
  if (others.length === 0) return `${first.name} et ${second.name}`;
  return `${first.name}, ${second.name} et ${String(others.length)} autre${others.length > 1 ? 's' : ''}`;
}

/** The first content due, and how many more wait; `null` when nothing does. */
export function requestOf(
  requests: NonNullable<CreatorOverview['requests']>,
  today: string,
): { readonly value: string; readonly note: string; readonly late: boolean } | null {
  if (requests.next === null) return null;
  const due = dueOf(requests.next.dueOn, today);
  const more = requests.open - 1;
  return {
    value: categoryName(requests.next.category),
    note:
      more > 0
        ? `${due.text} · ${String(more)} autre${more > 1 ? 's' : ''} attendu${more > 1 ? 's' : ''}`
        : due.text,
    late: due.late,
  };
}

/** « 3 à traiter, dont 1 urgent » from « À traiter » (the same count as Suivi). */
export function todosOf(count: CreatorTodoCount | undefined): { readonly text: string; readonly tone: Tone } {
  if (count === undefined || count.todos === 0) return { text: 'Rien à traiter', tone: 'calm' };
  const text = `${String(count.todos)} à traiter`;
  if (count.grave === 0) return { text, tone: 'warn' };
  return { text: `${text}, dont ${String(count.grave)} urgent${count.grave > 1 ? 's' : ''}`, tone: 'bad' };
}
