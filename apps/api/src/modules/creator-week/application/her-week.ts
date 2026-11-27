import {
  CreatorProgressSchema,
  CreatorWeekSchema,
  type CreatorProgress,
  type CreatorWeek,
  type DeliveryLine,
  type DropCategory,
  type WeekNeed,
} from '@impera/contracts';

import type { HerWeekFrame, HerWeekRead, WeekAgendaStore } from '../../creator-tasks';
import { addDays, wallClockToInstant } from '../../scheduling/pure';
import { DAY_DEFAULTS, dayLines } from '../domain/day';
import { deliveryAsks, deliveryDue } from '../domain/plan';
import type { AcceptSuggestion, DayTickStore, WeekFactsReader } from '../domain/ports';

import { videosFor } from './her-day';

export interface HerWeekDeps {
  readonly agenda: Pick<WeekAgendaStore, 'herWeek'>;
  readonly facts: Pick<WeekFactsReader, 'arrivals'>;
}

/** The drop category that answers a need, `null` for a script (its request) and an idea (no category of its own). */
const CATEGORY: Readonly<Record<WeekNeed, DropCategory | null>> = {
  script: null,
  feed_shoot: 'feed_shoot',
  feed_video: 'feed_video',
  mass_dm: 'mass_dm',
  idea: null,
  reveal_story: 'reveal_story',
};

/**
 * « Livrer ma semaine » (ADR 0140 § 25): what the week asks, need by need, and what arrived since her Monday; a script
 * counts as received once a drop answers its request, whenever it came. Done by her drops, never by a tick.
 */
function deliveryLines(
  frames: readonly HerWeekFrame[],
  arrived: {
    readonly byCategory: Readonly<Partial<Record<DropCategory, number>>>;
    readonly answered: ReadonlySet<string>;
  },
): DeliveryLine[] {
  const lines = frames
    .filter((frame) => frame.role === 'shoot_day' && frame.state !== 'declined')
    .flatMap((frame) => frame.lines);
  const answeredScripts = new Set(
    lines.flatMap((line) =>
      line.requestId !== null && arrived.answered.has(line.requestId) ? [line.requestId] : [],
    ),
  );
  // The next script, asked without a request: answered by any script drop of the week beyond those of the requests.
  const freeScripts = lines.filter((line) => line.need === 'script' && line.requestId === null).length;
  const freeArrived = Math.min(
    freeScripts,
    Math.max(0, (arrived.byCategory.script ?? 0) - answeredScripts.size),
  );
  return [...deliveryAsks(lines).entries()].map(([need, count]) => {
    const category = CATEGORY[need];
    const received =
      need === 'script'
        ? answeredScripts.size + freeArrived
        : category === null
          ? 0
          : (arrived.byCategory[category] ?? 0);
    return { need, asked: count, received: Math.min(received, count) };
  });
}

/** Her week from its frames and what arrived of it: the same reading for her and for her team. */
async function weekOf(
  read: HerWeekRead,
  week: string,
  arrivals: (
    window: { readonly from: Date; readonly to: Date },
    requestIds: readonly string[],
  ) => ReturnType<WeekFactsReader['arrivals']>,
): Promise<CreatorWeek> {
  const shootDays = read.frames.filter((frame) => frame.role === 'shoot_day');
  const delivery = read.frames.find((frame) => frame.role === 'delivery') ?? null;
  const from = wallClockToInstant(week, 0, read.timeZone);
  const to = wallClockToInstant(addDays(week, 7), 0, read.timeZone);
  const requestIds = shootDays.flatMap((frame) =>
    frame.lines.flatMap((line) => (line.requestId === null ? [] : [line.requestId])),
  );
  const arrived =
    delivery === null
      ? { byCategory: {}, answered: new Set<string>() }
      : await arrivals({ from, to }, requestIds);
  const lines = deliveryLines(read.frames, arrived);
  return CreatorWeekSchema.parse({
    week,
    toAccept: read.frames.some((frame) => frame.state === 'suggested' && frame.day >= read.today),
    shootDays: shootDays.map((frame) => ({
      suggestionId: frame.suggestionId,
      taskId: frame.taskId,
      state: frame.state,
      day: frame.day,
      items: frame.lines.map((line) => ({
        id: line.id,
        need: line.need,
        label: line.label,
        sheet: line.sheet,
        count: line.count,
        done: line.done,
      })),
    })),
    delivery:
      delivery === null
        ? null
        : {
            suggestionId: delivery.suggestionId,
            taskId: delivery.taskId,
            state: delivery.state,
            dueAt: deliveryDue(week, read.timeZone).toISOString(),
            lines,
            delivered: lines.every((line) => line.received >= line.asked),
          },
  });
}

/** Her week as she reads it (ADR 0140 § 7): her shooting days with their lines, and her delivery. Empty before validation. */
export async function herWeek(
  deps: HerWeekDeps,
  userId: string,
  week: string,
  now: Date,
): Promise<CreatorWeek> {
  const read = await deps.agenda.herWeek(userId, week, now);
  return weekOf(read, week, (window, requestIds) => deps.facts.arrivals(userId, window, requestIds));
}

export interface ProgressDeps {
  readonly agenda: Pick<WeekAgendaStore, 'teamWeek'>;
  readonly facts: Pick<WeekFactsReader, 'teamArrivals' | 'teamVideos'>;
  readonly days: Pick<DayTickStore, 'teamDays'>;
}

/**
 * « Où elle en est » (Charles, 21/11, trous béants n° 11): her seven days from her Monday, what she ticked against what
 * her day asks, and how far her validated week went, read by her owner or an active manager exactly as she reads it.
 */
export async function creatorProgress(
  deps: ProgressDeps,
  creatorId: string,
  userId: string,
  week: string,
  now: Date,
): Promise<CreatorProgress> {
  const sunday = addDays(week, 6);
  const [read, ticked] = await Promise.all([
    deps.agenda.teamWeek(creatorId, userId, week, now),
    deps.days.teamDays(creatorId, userId, week, sunday, now),
  ]);
  const herWeekRead = await weekOf(read, week, (window, requestIds) =>
    deps.facts.teamArrivals(creatorId, userId, window, requestIds),
  );
  const cover = await deps.facts.teamVideos(
    creatorId,
    userId,
    {
      from: wallClockToInstant(week, 0, ticked.timeZone),
      to: wallClockToInstant(addDays(week, 7), 0, ticked.timeZone),
    },
    ticked.timeZone,
  );
  const days = Array.from({ length: 7 }, (_, offset) => {
    const day = addDays(week, offset);
    const lines = dayLines(DAY_DEFAULTS, {
      ticked: ticked.days.get(day) ?? {},
      videos: videosFor(day, ticked.today, cover),
    });
    const essentials = lines.filter((line) => line.essential);
    return {
      day,
      essentialsDone: essentials.reduce((sum, line) => sum + line.done, 0),
      essentialsAsked: essentials.reduce((sum, line) => sum + line.target, 0),
      done: lines.reduce((sum, line) => sum + line.done, 0),
      asked: lines.reduce((sum, line) => sum + line.target, 0),
      ahead: day > ticked.today,
    };
  });
  const shot = herWeekRead.shootDays
    .filter((shootDay) => shootDay.state !== 'declined')
    .flatMap((shootDay) => shootDay.items);
  return CreatorProgressSchema.parse({
    week,
    today: ticked.today,
    days,
    shoot:
      herWeekRead.shootDays.length === 0
        ? null
        : { done: shot.filter((item) => item.done).length, asked: shot.length },
    delivery: herWeekRead.delivery,
  });
}

export interface AcceptWeekDeps {
  readonly agenda: Pick<WeekAgendaStore, 'herWeek'>;
  readonly accept: AcceptSuggestion;
}

/**
 * « Accepter ma semaine » (ADR 0140 § 12, § 27): every frame of her week still to decide and not over, accepted as it
 * is, each by its own rules. Replayable: a frame accepted already is passed over. What she declined stays declined.
 */
export async function acceptWeek(
  deps: AcceptWeekDeps,
  userId: string,
  week: string,
  now: Date,
): Promise<number> {
  const read = await deps.agenda.herWeek(userId, week, now);
  let accepted = 0;
  for (const frame of read.frames) {
    if (frame.state !== 'suggested' || frame.day < read.today) continue;
    await deps.accept(userId, frame.suggestionId, now);
    accepted += 1;
  }
  return accepted;
}
