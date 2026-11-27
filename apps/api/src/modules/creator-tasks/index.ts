/** Public entry point of the `creator-tasks` module (CR-05, ADR 0042 § 3 and § 4). Other modules import this file only. */
import type {
  AgencySuggestion,
  CreatorTask,
  NotificationOutcome,
  NotificationRequest,
} from '@impera/contracts';
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { remind } from './application/remind';
import type { Interval } from './domain/availability';
import type { AgendaFeedEntry } from './domain/feed';
import type { ShootGuard, ShootSuggestion, WeekAgendaStore } from './domain/ports';
import { createDrizzleCreatorAgendaStore, type BookedCamsOf } from './infra/db/agenda-store';
import { createCamRoomReader } from './infra/db/cam-reads';
import { createDrizzleAgendaFeed } from './infra/db/feed-reads';
import { createReminderSource } from './infra/db/reminder-source';
import { createDrizzleSuggestionStore } from './infra/db/suggestion-store';
import { createDrizzleWeekAgendaStore } from './infra/db/week-store';
import { createCreatorTaskRoutes, type RequireRole } from './infra/http/routes';

/** @public The fans' cams booked with her, read by the orders' module for her agenda. */
export type { BookedCamsOf } from './infra/db/agenda-store';
/** @public An interval of her time, as instants. */
export type { Interval } from './domain/availability';
export type {
  GuardedShoot,
  HerWeekFrame,
  HerWeekRead,
  ShootGuardFault,
  ShootSuggestion,
  WeekAgendaStore,
  WeekFrames,
} from './domain/ports';
/** @public Her shooting days of a week and her dispos by weekday (ADR 0140 § 1), for the week's job. */
export { dispoMinutesByWeekdayUnscoped, shootDaysOfWeekUnscoped } from './infra/db/week-store';
/** @public Her days as the creator's game counts them (ADR 0107), for the composition root. */
export { creatorDaysForGameUnscoped, type CreatorDaysForGame } from './infra/db/game-reads';

export interface CreatorTasksModule {
  readonly name: 'creator-tasks';
  /** Mounted under `/v1` by the server: her `/creator-space/agenda` and its writes, the agency's `/creators/:creatorId/suggestions`. */
  readonly routes: FastifyPluginAsyncZod;
  /**
   * A shoot suggested with its sheet (VEI-01 d: an idea validated in « Idées du jour »), in her first room or undated,
   * under the owner's or an active manager's account and her agenda's rules. The trend watch writes no table of hers.
   */
  readonly suggestShoot: (
    creatorId: string,
    userId: string,
    shoot: ShootSuggestion,
    now: Date,
  ) => Promise<AgencySuggestion>;
  /**
   * Her agenda in her calendar link's feed (CR-05 lot c2): her tasks with hours or of a day between two instants, read
   * with her own rights, as the `scheduling` feed writes them.
   */
  readonly feedOf: (
    userId: string,
    window: { readonly from: Date; readonly to: Date },
  ) => Promise<readonly AgendaFeedEntry[]>;
  /**
   * The first room of `minutes` in her dispos cam from `from`, over none of her timed tasks nor of `busy`, past the
   * day `after` when given (ADR 0159 § 5): where a fan's cam may fall. Read as the owner role, bounded to her, for the server's own
   * callers.
   */
  readonly camRoom: (
    creatorId: string,
    ask: {
      readonly minutes: number;
      readonly from: Date;
      readonly busy: readonly Interval[];
      readonly after: string | null;
    },
  ) => Promise<Interval | null>;
  /** Her week in her agenda (ADR 0140 § 22 to § 27): written by the owner's validation, read and ticked by her. */
  readonly week: WeekAgendaStore;
  /**
   * A suggestion she accepts as it is, in her own account: « Accepter ma semaine » (ADR 0140 § 27) accepts each frame
   * by its own rules (placement, the past). Replayed, it answers the task it made.
   */
  readonly accept: (userId: string, suggestionId: string, now: Date) => Promise<CreatorTask>;
  /**
   * The task of `creator_tasks.remind` (CR-05 lot b3): her accounts told that a task is coming; null when push is off
   * (the reminder is then only in her agenda).
   */
  readonly remind:
    | ((
        payload: { readonly taskId: string; readonly startsAt: string },
        at: Date,
      ) => Promise<readonly NotificationOutcome[]>)
    | null;
}

export interface CreatorTasksDeps {
  /** Application role: her own account's RLS, or the team's. */
  readonly db: Database;
  /** Owner role: what a job reads of a task and her accounts, with no account to read under. */
  readonly adminDb: Database;
  readonly requireRole: RequireRole;
  /**
   * The guards of an idea, for a shoot the agency suggests by hand for a drop category (ADR 0082 § 3): handed by the
   * composition root, from the trend watch and her persona's limits.
   */
  readonly guardShoot: ShootGuard;
  /** The `notifications` module's `notify`, null when push is off. */
  readonly notify: ((request: NotificationRequest, at: Date) => Promise<NotificationOutcome>) | null;
  /** The fans' cams booked with her (`custom-orders`), shown in her agenda; late bound by the composition root. */
  readonly bookedCams: BookedCamsOf;
  /** Tests only: another clock than the server's. */
  readonly clock?: () => Date;
}

export function createCreatorTasksModule(deps: CreatorTasksDeps): CreatorTasksModule {
  const suggestions = createDrizzleSuggestionStore(deps.db);
  const agenda = createDrizzleCreatorAgendaStore(deps.db, deps.bookedCams);
  const source = createReminderSource(deps.adminDb);
  const { notify } = deps;
  return {
    name: 'creator-tasks',
    routes: createCreatorTaskRoutes(agenda, suggestions, deps.guardShoot, deps.requireRole, deps.clock),
    feedOf: createDrizzleAgendaFeed(deps.db),
    suggestShoot: (creatorId, userId, shoot, now) => suggestions.suggestShoot(creatorId, userId, shoot, now),
    camRoom: createCamRoomReader(deps.adminDb),
    week: createDrizzleWeekAgendaStore(deps.db),
    accept: (userId, suggestionId, now) => agenda.accept(userId, suggestionId, {}, now),
    remind: notify === null ? null : (payload, at) => remind({ source, notify }, payload, at),
  };
}
