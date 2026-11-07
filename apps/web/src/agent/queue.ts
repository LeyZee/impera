import type { DashboardTodo } from '@impera/contracts';

/**
 * « À traiter » as the screens show it (recette AGT-05). One failure of the agent (no model answers, the day's AI
 * budget spent, no active persona) gives every waiting fan the same line: twenty lines « IA indisponible » hid the one
 * draft to approve. Those causes are the agent's state, not the fan's: said once, with how many fans wait behind them.
 * The screen sorts itself, whatever order the route gives: the grave lines first (a possible minor, consent, distress),
 * then what a person can act on, then these failures; the longest waiting first inside each.
 */

/** The causes one failure gives every fan at once. */
const SYSTEM_CAUSES: ReadonlySet<DashboardTodo['kind']> = new Set([
  'llm_unavailable',
  'budget',
  'persona_inactive',
]);

export type QueueEntry<T extends DashboardTodo> =
  | { readonly kind: 'one'; readonly todo: T }
  | {
      readonly kind: 'group';
      readonly cause: DashboardTodo['kind'];
      /** Every line behind it, the longest waiting first. */
      readonly todos: readonly T[];
      /** The longest waiting: its wait and its sentence are the group's. */
      readonly oldest: T;
      /** The latest: the conversation the group opens. */
      readonly latest: T;
    };

/** A persona is missing for one creator: her lines group apart from another's. The other failures are everyone's. */
function keyOf(todo: DashboardTodo): string {
  const creator = 'creatorId' in todo && typeof todo.creatorId === 'string' ? todo.creatorId : '';
  return todo.kind === 'persona_inactive' ? `${todo.kind}:${creator}` : todo.kind;
}

const rankOf = (todo: DashboardTodo): number =>
  todo.tone === 'bad' ? 0 : SYSTEM_CAUSES.has(todo.kind) ? 2 : 1;

const byWait = (a: DashboardTodo, b: DashboardTodo): number =>
  b.waitingMinutes - a.waitingMinutes || Date.parse(a.at) - Date.parse(b.at);

export function queueEntries<T extends DashboardTodo>(todos: readonly T[]): QueueEntry<T>[] {
  const groups = new Map<string, T[]>();
  for (const todo of todos) {
    if (!SYSTEM_CAUSES.has(todo.kind) || todo.tone === 'bad') continue;
    const key = keyOf(todo);
    groups.set(key, [...(groups.get(key) ?? []), todo]);
  }
  const entries: { readonly entry: QueueEntry<T>; readonly lead: T }[] = [];
  const placed = new Set<string>();
  for (const todo of todos) {
    const key = keyOf(todo);
    const members = rankOf(todo) === 2 ? (groups.get(key) ?? []) : [];
    if (members.length < 2) {
      entries.push({ entry: { kind: 'one', todo }, lead: todo });
      continue;
    }
    if (placed.has(key)) continue;
    placed.add(key);
    const sorted = members.toSorted(byWait);
    const oldest = sorted[0] ?? todo;
    const latest = sorted[sorted.length - 1] ?? todo;
    entries.push({ entry: { kind: 'group', cause: todo.kind, todos: sorted, oldest, latest }, lead: oldest });
  }
  return entries
    .toSorted((a, b) => rankOf(a.lead) - rankOf(b.lead) || byWait(a.lead, b.lead))
    .map(({ entry }) => entry);
}

/** « 20 fans »: how many wait behind a group. */
export const fansWaiting = (count: number): string => `${String(count)} fans`;
