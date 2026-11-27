import { isPerMinute, type CustomFormat } from '@impera/contracts';

/**
 * Where a fan's cam falls (ADR 0159 § 5, Charles 26/11): only in a dispo cam she opened, over nothing of hers, never
 * during her absence. The code picks the hour, never the prompt; the fan hears it only once everything is paid.
 */

/** She is told, then gets ready: a cam never starts sooner than this after the question. */
export const CAM_NOTICE_MINUTES = 15;
/** Between two cams, the time to breathe: a booked cam holds this much more on each side. */
export const CAM_MARGIN_MINUTES = 15;
/** A cam that can start within this is « tout de suite » for the fan; later, it is another slot. */
const CAM_SOON_MINUTES = 60;
/** How many of her absences in a row the search steps over before it gives up. */
const CAM_ABSENCE_STEPS = 8;

const MINUTE_MS = 60_000;

export interface CamInterval {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** A cam's slot as the code proposes it: soon (« tout de suite ») or later. */
export interface CamSlot extends CamInterval {
  readonly soon: boolean;
}

/** A call and a video call take her live, so they fall in a dispo cam; anything else is made, not met. */
export const needsCamSlot = (format: CustomFormat | null): boolean => format !== null && isPerMinute(format);

/** The cams already booked as what a new one never falls on: each widened by the margin. */
export function bookedAsBusy(booked: readonly CamInterval[]): CamInterval[] {
  const margin = CAM_MARGIN_MINUTES * MINUTE_MS;
  return booked.map((cam) => ({
    startsAt: new Date(cam.startsAt.getTime() - margin),
    endsAt: new Date(cam.endsAt.getTime() + margin),
  }));
}

export interface CamSlotPorts {
  /** Her first room of `minutes` in her dispos cam (`creator-tasks`), past the day `after` when given. */
  readonly room: (ask: {
    readonly minutes: number;
    readonly from: Date;
    readonly busy: readonly CamInterval[];
    readonly after: string | null;
  }) => Promise<CamInterval | null>;
  /** Her absence at an instant (`creator-limits`): its last day, or null. */
  readonly absence: (at: Date) => Promise<{ readonly until: string } | null>;
  /** The cams already booked with her. */
  readonly booked: () => Promise<readonly CamInterval[]>;
}

/**
 * The first slot of `minutes` for a fan's cam from `now`: in a dispo cam, after the notice, over nothing of hers nor
 * of a booked cam and its margin, never on a day of her absence. Null when none in two weeks: no hour is promised.
 */
export async function camSlotOf(ports: CamSlotPorts, minutes: number, now: Date): Promise<CamSlot | null> {
  if (minutes <= 0) return null;
  const from = new Date(now.getTime() + CAM_NOTICE_MINUTES * MINUTE_MS);
  const busy = bookedAsBusy(await ports.booked());
  let after: string | null = null;
  for (let step = 0; step <= CAM_ABSENCE_STEPS; step += 1) {
    const room = await ports.room({ minutes, from, busy, after });
    if (room === null) return null;
    // Absences are whole days of hers: a cam that starts or ends on one waits for the day after it.
    const away =
      (await ports.absence(room.startsAt)) ?? (await ports.absence(new Date(room.endsAt.getTime() - 1)));
    if (away === null) {
      const soon = room.startsAt.getTime() - now.getTime() <= CAM_SOON_MINUTES * MINUTE_MS;
      return { startsAt: room.startsAt, endsAt: room.endsAt, soon };
    }
    if (after !== null && away.until <= after) return null;
    after = away.until;
  }
  return null;
}
