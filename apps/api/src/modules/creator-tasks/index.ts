/** Public entry point of the `creator-tasks` module (CR-05, ADR 0042 § 3 and § 4). Other modules import this file only. */
import type { AgencySuggestion, NotificationOutcome, NotificationRequest } from '@impera/contracts';
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { remind } from './application/remind';
import type { AgendaFeedEntry } from './domain/feed';
import type { ShootGuard, ShootSuggestion } from './domain/ports';
import { createDrizzleCreatorAgendaStore } from './infra/db/agenda-store';
import { createDrizzleAgendaFeed } from './infra/db/feed-reads';
import { createReminderSource } from './infra/db/reminder-source';
import { createDrizzleSuggestionStore } from './infra/db/suggestion-store';
import { createCreatorTaskRoutes, type RequireRole } from './infra/http/routes';

export type { GuardedShoot, ShootGuardFault, ShootSuggestion } from './domain/ports';

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
  /** Tests only: another clock than the server's. */
  readonly clock?: () => Date;
}

export function createCreatorTasksModule(deps: CreatorTasksDeps): CreatorTasksModule {
  const suggestions = createDrizzleSuggestionStore(deps.db);
  const source = createReminderSource(deps.adminDb);
  const { notify } = deps;
  return {
    name: 'creator-tasks',
    routes: createCreatorTaskRoutes(
      createDrizzleCreatorAgendaStore(deps.db),
      suggestions,
      deps.guardShoot,
      deps.requireRole,
      deps.clock,
    ),
    feedOf: createDrizzleAgendaFeed(deps.db),
    suggestShoot: (creatorId, userId, shoot, now) => suggestions.suggestShoot(creatorId, userId, shoot, now),
    remind: notify === null ? null : (payload, at) => remind({ source, notify }, payload, at),
  };
}
