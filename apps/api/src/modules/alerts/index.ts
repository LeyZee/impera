/** Public entry point of the `alerts` module (P4-01). Other modules import this file only. */
import type { CreatorId, NotificationOutcome, NotificationRequest } from '@impera/contracts';
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { remindSafety, routeAgencyAlerts } from './application/agency';
import { routeAlerts } from './application/route';
import { remindSessions } from './application/session-reminders';
import type { SessionReminderClock } from './domain/agency/session-reminder';
import type { AlertStore } from './domain/ports';
import { createDrizzleAlertStore } from './infra/db/alert-store';
import { createRouterReads } from './infra/db/router-reads';
import { createAlertRoutes, type RequireRole } from './infra/http/routes';

export interface AlertsModule {
  readonly name: 'alerts';
  /** Her alerts: written from Réglages › Alertes, read by the agent (`activeFor`, `systemOn`). */
  readonly store: AlertStore;
  /** Mounted under `/v1` by the server: `/alerts`. */
  readonly routes: FastifyPluginAsyncZod;
}

export interface AlertsDeps {
  /** Application role: the alert tables are under RLS, crossed one creator at a time for the owner. */
  readonly db: Database;
  readonly requireRole: RequireRole;
}

export function createAlertsModule(deps: AlertsDeps): AlertsModule {
  const store = createDrizzleAlertStore(deps.db);
  return { name: 'alerts', store, routes: createAlertRoutes(store, deps.requireRole) };
}

export interface AlertRouterDeps {
  /** The service role: the router reads the outbox and every creator's choices. */
  readonly adminDb: Database;
  /** The agency's time zone, the owners' day and quiet hours. */
  readonly agencyTimeZone: () => Promise<string>;
  /** Who is on shift on her accounts at `at` (`scheduling`). */
  readonly onShift: (creatorId: CreatorId, at: Date) => Promise<readonly { readonly memberId: string }[]>;
  /** The `notifications` module's `notify`. */
  readonly notify: (request: NotificationRequest, at: Date) => Promise<NotificationOutcome>;
  readonly onLinesUnread?: (creatorId: CreatorId, error: unknown) => void;
  /** A role unread or an account not notified: logged, the others are told all the same (relecture Sécurité). */
  readonly onFailure?: (step: string, error: unknown) => void;
}

/**
 * `alerts.agency` and `alerts.remind_safety` (27/11/2026): the agency's alerts to the owners, and the safety relays
 * nobody took, rung again. Built as the router, with the same reads.
 */
export function createAgencyAlerts(deps: AlertRouterDeps): {
  readonly route: (now: Date) => Promise<number>;
  readonly remindSafety: (now: Date) => Promise<number>;
} {
  const agencyDeps = {
    reads: createRouterReads(deps.adminDb, deps.agencyTimeZone),
    onShift: deps.onShift,
    notify: deps.notify,
    ...(deps.onFailure !== undefined && { onFailure: deps.onFailure }),
  };
  return {
    route: (now) => routeAgencyAlerts(agencyDeps, now),
    remindSafety: (now) => remindSafety(agencyDeps, now),
  };
}

export interface SessionReminderWiring {
  readonly adminDb: Database;
  readonly agencyTimeZone: () => Promise<string>;
  /** Every account holding a session, with its token's expiry (`connectors.sessions.clocks`). */
  readonly clocks: () => Promise<readonly SessionReminderClock[]>;
  /** The agency's minute for the reminder and its clock (`scheduling.sessionReminderClock`). */
  readonly reminder: () => Promise<{ readonly minute: number; readonly timeZone: string }>;
  readonly notify: (request: NotificationRequest, at: Date) => Promise<NotificationOutcome>;
  readonly onFailure?: (step: string, error: unknown) => void;
}

/**
 * `alerts.remind_sessions` (décision du 27/11/2026): the daily reminder to every owner to reconnect the AI's platform
 * sessions, once more an hour later, and 2 h before a token dies.
 */
export function createSessionReminders(deps: SessionReminderWiring): (now: Date) => Promise<number> {
  const reads = createRouterReads(deps.adminDb, deps.agencyTimeZone);
  return (now) =>
    remindSessions(
      {
        owners: () => reads.owners(),
        clocks: deps.clocks,
        reminder: deps.reminder,
        notify: deps.notify,
        ...(deps.onFailure !== undefined && { onFailure: deps.onFailure }),
      },
      now,
    );
}

/** `alerts.route` (ADR 0150 lot 2): built by the composition root once `notifications` and `scheduling` exist. */
export function createAlertRouter(deps: AlertRouterDeps): (now: Date) => Promise<number> {
  const reads = createRouterReads(deps.adminDb, deps.agencyTimeZone);
  return (now) =>
    routeAlerts(
      {
        reads,
        onShift: deps.onShift,
        notify: deps.notify,
        ...(deps.onLinesUnread !== undefined && { onLinesUnread: deps.onLinesUnread }),
        ...(deps.onFailure !== undefined && { onFailure: deps.onFailure }),
      },
      now,
    );
}
