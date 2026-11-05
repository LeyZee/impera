import type { CreatorAccountShift, Platform } from '@impera/contracts';
import { useCallback, useState } from 'react';

import { platformName } from '@/scheduling/model';
import { addDays, clockAt, rangeAt, zonedInstant } from '@/scheduling/time';

/*
 * « Qui répond à tes fans » (CR-05 c3, ADR 0045 § 1): the shifts of her accounts, a layer of her Agenda that she can
 * hide. Never on the frieze of her day: a line under the Programme, one per platform, the name of the platform from
 * the account (the core does not know the platforms). Only a name in the team and hours.
 */

/** The instants her Agenda reads, from the start of her first day to the end of her last, in her zone. */
export function shiftRangeOf(
  range: { readonly from: string; readonly to: string },
  zone: string,
): { readonly from: string; readonly to: string } {
  return {
    from: zonedInstant(range.from, 0, zone).toISOString(),
    to: zonedInstant(addDays(range.to, 1), 0, zone).toISOString(),
  };
}

/** Someone who answers her fans on a day, and when: « 14 h – 18 h », « jusqu’à 2 h », « toute la journée ». */
export interface Reply {
  readonly key: string;
  readonly name: string;
  readonly when: string;
}

/** The people of one platform on a day. */
export interface ReplyLine {
  readonly platform: Platform;
  readonly label: string;
  readonly replies: readonly Reply[];
}

/**
 * Who answers her fans on `day`, by platform: the shifts that overlap her day, by start. A shift that started the day
 * before says when it ends; one that goes past midnight keeps its range on the day it starts.
 */
export function repliesOn(shifts: readonly CreatorAccountShift[], day: string, zone: string): ReplyLine[] {
  const start = zonedInstant(day, 0, zone).getTime();
  const end = zonedInstant(addDays(day, 1), 0, zone).getTime();
  const lines = new Map<Platform, Reply[]>();
  for (const shift of shifts) {
    const from = Date.parse(shift.startsAt);
    const to = Date.parse(shift.endsAt);
    if (to <= start || from >= end) continue;
    const when =
      from >= start
        ? rangeAt(shift.startsAt, shift.endsAt, zone)
        : to > end
          ? 'toute la journée'
          : `jusqu’à ${clockAt(shift.endsAt, zone)}`;
    const replies = lines.get(shift.platform) ?? [];
    replies.push({ key: `${shift.startsAt}-${shift.displayName}`, name: shift.displayName, when });
    lines.set(shift.platform, replies);
  }
  return [...lines].map(([platform, replies]) => ({ platform, label: platformName(platform), replies }));
}

/** « Kofi 14 h – 18 h, Awa jusqu’à 2 h ». */
export const repliesText = (line: ReplyLine): string =>
  line.replies.map((reply) => `${reply.name} ${reply.when}`).join(', ');

const SHOWN_KEY = 'impera.agenda.replies';

function readShown(): boolean {
  try {
    return globalThis.localStorage.getItem(SHOWN_KEY) !== 'hidden';
  } catch {
    return true;
  }
}

/** Whether she shows the layer, kept on this device; shown until she hides it. */
export function useRepliesShown(): readonly [boolean, (shown: boolean) => void] {
  const [shown, setShown] = useState(readShown);
  const set = useCallback((next: boolean) => {
    setShown(next);
    try {
      if (next) globalThis.localStorage.removeItem(SHOWN_KEY);
      else globalThis.localStorage.setItem(SHOWN_KEY, 'hidden');
    } catch {
      // A private window: the choice holds until the page closes.
    }
  }, []);
  return [shown, set] as const;
}
