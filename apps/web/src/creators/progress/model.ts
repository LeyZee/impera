import type { CreatorProgress } from '@impera/contracts';

/*
 * « Où elle en est » (trous béants n° 11), in words: the answer first (how many days she held her essentials), then a
 * ring per day, then her week of shooting and her delivery. Pure: the band and its tests share it.
 */

const WEEKDAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'UTC' });

/** « lun. », « mar. »: the day's column head. */
export const weekdayWord = (day: string): string => WEEKDAY.format(new Date(`${day}T00:00:00Z`));

export interface ProgressDayView {
  readonly day: string;
  readonly weekday: string;
  readonly done: number;
  readonly asked: number;
  readonly extra: number;
  readonly today: boolean;
  /** After today: an empty ring, nothing said. */
  readonly ahead: boolean;
  /** Every essential done that day. */
  readonly held: boolean;
  /** What a screen reader says of it. */
  readonly words: string;
}

export interface ProgressRow {
  readonly key: 'shoot' | 'delivery';
  readonly label: string;
  readonly done: number;
  readonly asked: number;
  readonly percent: number;
  readonly words: string;
}

export interface ProgressView {
  readonly title: string;
  readonly line: string;
  readonly days: readonly ProgressDayView[];
  readonly rows: readonly ProgressRow[];
}

const percentOf = (done: number, asked: number): number =>
  asked === 0 ? 0 : Math.round((Math.min(done, asked) / asked) * 100);

const plural = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;

export function progressOf(progress: CreatorProgress): ProgressView {
  const days = progress.days.map((day): ProgressDayView => {
    const held = !day.ahead && day.essentialsAsked > 0 && day.essentialsDone >= day.essentialsAsked;
    const extra = Math.max(0, day.done - day.essentialsDone);
    return {
      day: day.day,
      weekday: weekdayWord(day.day),
      done: day.essentialsDone,
      asked: day.essentialsAsked,
      extra,
      today: day.day === progress.today,
      ahead: day.ahead,
      held,
      words: day.ahead
        ? `${weekdayWord(day.day)} : à venir`
        : `${weekdayWord(day.day)} : essentiel ${String(day.essentialsDone)} sur ${String(day.essentialsAsked)}${
            extra > 0 ? `, ${plural(extra, 'bonus', 'bonus')}` : ''
          }`,
    };
  });
  const past = days.filter((day) => !day.ahead);
  const held = past.filter((day) => day.held).length;
  const rows: ProgressRow[] = [];
  if (progress.shoot !== null && progress.shoot.asked > 0) {
    const { done, asked } = progress.shoot;
    rows.push({
      key: 'shoot',
      label: 'Tournage',
      done,
      asked,
      percent: percentOf(done, asked),
      words: `${String(done)} sur ${String(asked)} ${asked === 1 ? 'ligne tournée' : 'lignes tournées'}`,
    });
  }
  if (progress.delivery !== null) {
    const asked = progress.delivery.lines.reduce((sum, line) => sum + line.asked, 0);
    const done = progress.delivery.lines.reduce((sum, line) => sum + Math.min(line.received, line.asked), 0);
    if (asked > 0)
      rows.push({
        key: 'delivery',
        label: 'Livraison',
        done,
        asked,
        percent: percentOf(done, asked),
        words: progress.delivery.delivered
          ? 'Tout est livré'
          : `${String(done)} sur ${String(asked)} ${asked === 1 ? 'reçu' : 'reçus'}`,
      });
  }
  return {
    title: 'Où elle en est',
    line:
      past.length === 0
        ? 'Sa semaine n’a pas commencé.'
        : `L’essentiel tenu ${String(held)} ${held === 1 ? 'jour' : 'jours'} sur ${String(past.length)}.`,
    days,
    rows,
  };
}
