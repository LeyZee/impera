import { createHash } from 'node:crypto';

import {
  CALENDAR_FEED_PREFIX,
  CalendarLinkTokenSchema,
  type CalendarLinkCreated,
  type CalendarLinkState,
  type UserId,
} from '@nirvana/contracts';

import { feedWindow, icsOf, type FeedEvent } from '../domain/calendar-feed';
import { CalendarFeedNotFound, CalendarLinkForbidden } from '../domain/errors';
import type { Actor, CalendarLinkStore, CalendarReads, CreatorDirectory } from '../domain/ports';

/** Moi › Mon agenda and the feed it gives (CR-12, ADR 0045 § 5). */
export interface CalendarLinkService {
  state(actor: UserId): Promise<CalendarLinkState>;
  /** A new address, which revokes the one before; the token leaves the server here, once. */
  create(actor: Actor): Promise<CalendarLinkCreated>;
  revoke(actor: Actor): Promise<void>;
  /** The feed of a link, `text/calendar`; any link that does not answer throws one same `CalendarFeedNotFound`. */
  feed(token: string): Promise<string>;
}

const FEED_NAME = 'Nirvana · mes shifts';

/** Stable for a shift that keeps its member, creator and start: a calendar updates it in place when its end moves. */
const uidOf = (memberId: string, creatorId: string, startsAt: Date): string =>
  `${createHash('sha256').update(`${memberId}|${creatorId}|${startsAt.toISOString()}`).digest('base64url')}@nirvana`;

export function createCalendarLinkService(
  store: CalendarLinkStore,
  reads: CalendarReads,
  creators: CreatorDirectory,
  now: () => Date = () => new Date(),
): CalendarLinkService {
  return {
    state: async (actor) => {
      const live = await store.live(actor);
      return { link: live === null ? null : { createdAt: live.createdAt.toISOString() } };
    },

    create: async (actor) => {
      const made = await store.replace(actor);
      if (made === null) throw new CalendarLinkForbidden();
      return { path: `${CALENDAR_FEED_PREFIX}${made.token}.ics`, createdAt: made.createdAt.toISOString() };
    },

    revoke: async (actor) => {
      await store.revoke(actor);
    },

    feed: async (token) => {
      if (!CalendarLinkTokenSchema.safeParse(token).success) throw new CalendarFeedNotFound();
      const holder = await store.holder(token);
      if (holder === null) throw new CalendarFeedNotFound();
      const at = now();
      const directory = await creators.list();
      // Read with the holder's own rights (`calendar_shifts` decides), then his own shifts only: the link is his.
      const read = await reads.read(
        holder.userId,
        feedWindow(at),
        directory.map((creator) => creator.id),
      );
      const names = new Map(directory.map((creator) => [creator.id, creator.displayName]));
      const events: FeedEvent[] = read.shifts
        .filter((row) => row.memberId === holder.memberId)
        .map((row) => {
          const creator = names.get(row.creatorId) ?? 'une créatrice';
          return {
            uid: uidOf(row.memberId, row.creatorId, row.startsAt),
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            summary: `Shift · ${creator}`,
            description: `${row.memberName} sur ${creator}`,
          };
        });
      return icsOf({ name: FEED_NAME, events, stamp: at });
    },
  };
}
