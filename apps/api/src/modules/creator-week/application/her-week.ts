import {
  CreatorWeekSchema,
  type CreatorWeek,
  type DeliveryLine,
  type DropCategory,
  type WeekNeed,
} from '@impera/contracts';

import type { HerWeekFrame, WeekAgendaStore } from '../../creator-tasks';
import { addDays, wallClockToInstant } from '../../scheduling/pure';
import { deliveryDue } from '../domain/plan';
import type { AcceptSuggestion, WeekFactsReader } from '../domain/ports';

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
  const asked = new Map<WeekNeed, number>();
  const answeredScripts = new Set<string>();
  for (const frame of frames) {
    if (frame.role !== 'shoot_day' || frame.state === 'declined') continue;
    for (const line of frame.lines) {
      asked.set(line.need, (asked.get(line.need) ?? 0) + line.count);
      if (line.requestId !== null && arrived.answered.has(line.requestId))
        answeredScripts.add(line.requestId);
    }
  }
  return [...asked.entries()].map(([need, count]) => {
    const category = CATEGORY[need];
    const received =
      need === 'script' ? answeredScripts.size : category === null ? 0 : (arrived.byCategory[category] ?? 0);
    return { need, asked: count, received: Math.min(received, count) };
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
      : await deps.facts.arrivals(read.creatorId, { from, to }, requestIds);
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
