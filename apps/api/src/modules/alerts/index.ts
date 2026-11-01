/** Public entry point of the `alerts` module (P4-01). Other modules import this file only. */
import type { Database } from '@nirvana/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { AlertStore } from './domain/ports';
import { createDrizzleAlertStore } from './infra/db/alert-store';
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
