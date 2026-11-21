/**
 * « L'essentiel du jour », on top of her Aujourd'hui (Charles, 21/11): the one big thing she sees. Not a fixed list:
 * it counts what is asked of her today wherever it lives, her day's essentials (what she posts), the tasks of her
 * agenda for today, and what the agency asked her to send that is due today or late. Pure: the page reads, this sums.
 */

export interface DayHeroSource {
  /** Her day's essentials: ticks done out of the target. */
  readonly essentials: { readonly done: number; readonly total: number } | null;
  /** Today's tasks of her agenda. */
  readonly tasks: { readonly done: number; readonly total: number } | null;
  /** Requests of the agency due today or late: each one is still to send, never ticked here. */
  readonly toSend: number | null;
}

export type DayHeroPart = 'essentials' | 'tasks' | 'toSend';

export interface DayHeroChip {
  readonly part: DayHeroPart;
  /** The legend's words: what it is. */
  readonly label: string;
  readonly done: number;
  readonly total: number;
  readonly words: string;
  readonly settled: boolean;
  /** One series token a source (design system, « Figures partagées »): never red nor amber. */
  readonly colour: string;
}

export interface DayHero {
  readonly done: number;
  readonly total: number;
  /** From 0 to 1, for the ring. */
  readonly share: number;
  readonly title: string;
  readonly line: string;
  readonly chips: readonly DayHeroChip[];
}

const plural = (n: number, one: string, many: string): string => `${String(n)} ${n > 1 ? many : one}`;

export function dayHeroOf(source: DayHeroSource): DayHero | null {
  const { essentials, tasks, toSend } = source;
  if (essentials === null && tasks === null && toSend === null) return null;
  const sent = toSend ?? 0;
  const done = (essentials?.done ?? 0) + (tasks?.done ?? 0);
  const total = (essentials?.total ?? 0) + (tasks?.total ?? 0) + sent;
  const chips: DayHeroChip[] = [];
  if (essentials !== null && essentials.total > 0)
    chips.push({
      part: 'essentials',
      label: 'À poster',
      done: essentials.done,
      total: essentials.total,
      words: `À poster ${String(essentials.done)}/${String(essentials.total)}`,
      settled: essentials.done >= essentials.total,
      colour: 'var(--nv-series-1)',
    });
  if (tasks !== null && tasks.total > 0)
    chips.push({
      part: 'tasks',
      label: 'Tâches',
      done: tasks.done,
      total: tasks.total,
      words: `Tâches ${String(tasks.done)}/${String(tasks.total)}`,
      settled: tasks.done >= tasks.total,
      colour: 'var(--nv-series-2)',
    });
  if (sent > 0)
    chips.push({
      part: 'toSend',
      label: 'À envoyer à l’agence',
      done: 0,
      total: sent,
      words: `${plural(sent, 'envoi', 'envois')} à faire`,
      settled: false,
      colour: 'var(--nv-series-3)',
    });
  const left = total - done;
  return {
    done,
    total,
    share: total === 0 ? 0 : done / total,
    title: total === 0 ? 'Rien d’attendu aujourd’hui' : left === 0 ? 'Tout est fait' : 'L’essentiel du jour',
    line:
      total === 0
        ? 'Profite : rien ne t’attend pour l’instant.'
        : left === 0
          ? 'Ta journée est bouclée. Le bonus reste là si tu as envie.'
          : `Encore ${plural(left, 'chose', 'choses')} pour boucler ta journée.`,
    chips,
  };
}
