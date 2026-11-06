import { createHash } from 'node:crypto';

import {
  CALENDAR_FEED_PREFIX,
  CREATOR_REPLIES_EMOJI,
  CalendarLinkTokenSchema,
  PLATFORM_NAMES,
  type CalendarLinkChoice,
  type CalendarLinkCreated,
  type CalendarLinkState,
  type UserId,
} from '@impera/contracts';

import { feedWindow, icsOf, type FeedEvent } from '../domain/calendar-feed';
import { CalendarFeedNotFound, CalendarLinkForbidden, CalendarLinkNotFound } from '../domain/errors';
import type {
  Actor,
  CalendarLinkStore,
  CalendarReads,
  CreatorAgendaFeed,
  CreatorDirectory,
  CreatorFeedShift,
  CreatorShiftsFeed,
} from '../domain/ports';

/** Moi › Calendrier for a member, Agenda › « Dans mon téléphone » for a creator, and the feed each gives (CR-12, CR-05). */
export interface CalendarLinkService {
  state(actor: UserId): Promise<CalendarLinkState>;
  /** A new address, which revokes the one before; the token leaves the server here, once. */
  create(actor: Actor): Promise<CalendarLinkCreated>;
  revoke(actor: Actor): Promise<void>;
  /** A creator's choice of her accounts' shifts in her live link (ADR 0045 § 5); `CalendarLinkNotFound` without one. */
  choose(actor: Actor, choice: CalendarLinkChoice): Promise<CalendarLinkState>;
  /** The feed of a link, `text/calendar`; any link that does not answer throws one same `CalendarFeedNotFound`. */
  feed(token: string): Promise<string>;
}

const FEED_NAME = 'Impera · mes shifts';
const AGENDA_FEED_NAME = 'Impera · mon agenda';

/** Stable for a shift that keeps its member, creator and start: a calendar updates it in place when its end moves. */
const uidOf = (memberId: string, creatorId: string, startsAt: Date): string =>
  `${createHash('sha256').update(`${memberId}|${creatorId}|${startsAt.toISOString()}`).digest('base64url')}@nirvana`;

/**
 * « 👥 Kofi répond à tes fans », on Reveal (ADR 0045 § 5): the range and the name in the team, nothing else. Its id is
 * the shift's, hashed: a shift given to someone else is renamed in her calendar, not doubled.
 */
const shiftEventOf = (shift: CreatorFeedShift): FeedEvent => ({
  uid: `${createHash('sha256').update(`shift|${shift.shiftId}`).digest('base64url')}@nirvana`,
  startsAt: shift.startsAt,
  endsAt: shift.endsAt,
  summary: `${CREATOR_REPLIES_EMOJI} ${shift.displayName} répond à tes fans`,
  description: `Sur ${PLATFORM_NAMES[shift.platform]}`,
  free: true,
});

export function createCalendarLinkService(
  store: CalendarLinkStore,
  reads: CalendarReads,
  creators: CreatorDirectory,
  agendaOf: CreatorAgendaFeed,
  shiftsOf: CreatorShiftsFeed,
  now: () => Date = () => new Date(),
): CalendarLinkService {
  return {
    state: async (actor) => {
      const live = await store.live(actor);
      return {
        link: live === null ? null : { createdAt: live.createdAt.toISOString(), withShifts: live.withShifts },
      };
    },

    create: async (actor) => {
      const made = await store.replace(actor);
      if (made === null) throw new CalendarLinkForbidden();
      return { path: `${CALENDAR_FEED_PREFIX}${made.token}.ics`, createdAt: made.createdAt.toISOString() };
    },

    revoke: async (actor) => {
      await store.revoke(actor);
    },

    choose: async (actor, choice) => {
      const live = await store.choose(actor, choice.withShifts);
      if (live === null) throw new CalendarLinkNotFound();
      return { link: { createdAt: live.createdAt.toISOString(), withShifts: live.withShifts } };
    },

    feed: async (token) => {
      if (!CalendarLinkTokenSchema.safeParse(token).success) throw new CalendarFeedNotFound();
      const holder = await store.holder(token);
      if (holder === null) throw new CalendarFeedNotFound();
      const at = now();
      // Her link is her agenda's (CR-05, ADR 0042 § 4), and her accounts' shifts when she chose them (ADR 0045 § 5),
      // both read with her own rights.
      if (holder.kind === 'creator') {
        const window = feedWindow(at);
        const [tasks, shifts] = await Promise.all([
          agendaOf(holder.userId, window),
          holder.withShifts ? shiftsOf(holder.userId, window) : Promise.resolve([]),
        ]);
        return icsOf({ name: AGENDA_FEED_NAME, events: [...tasks, ...shifts.map(shiftEventOf)], stamp: at });
      }
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
