/** Public entry point of the `creator-tasks` module (CR-05, ADR 0042 § 3 and § 4). Other modules import this file only. */
import type { NotificationOutcome, NotificationRequest } from '@impera/contracts';
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { remind } from './application/remind';
import { createDrizzleCreatorAgendaStore } from './infra/db/agenda-store';
import { createReminderSource } from './infra/db/reminder-source';
import { createDrizzleSuggestionStore } from './infra/db/suggestion-store';
import { createCreatorTaskRoutes, type RequireRole } from './infra/http/routes';

export interface CreatorTasksModule {
  readonly name: 'creator-tasks';
  /** Mounted under `/v1` by the server: her `/creator-space/agenda` and its writes, the agency's `/creators/:creatorId/suggestions`. */
  readonly routes: FastifyPluginAsyncZod;
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
  /** The `notifications` module's `notify`, null when push is off. */
  readonly notify: ((request: NotificationRequest, at: Date) => Promise<NotificationOutcome>) | null;
  /** Tests only: another clock than the server's. */
  readonly clock?: () => Date;
}

export function createCreatorTasksModule(deps: CreatorTasksDeps): CreatorTasksModule {
  const source = createReminderSource(deps.adminDb);
  const { notify } = deps;
  return {
    name: 'creator-tasks',
    routes: createCreatorTaskRoutes(
      createDrizzleCreatorAgendaStore(deps.db),
      createDrizzleSuggestionStore(deps.db),
      deps.requireRole,
      deps.clock,
    ),
    remind: notify === null ? null : (payload, at) => remind({ source, notify }, payload, at),
  };
}
