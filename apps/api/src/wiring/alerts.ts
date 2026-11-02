import { createAlertsModule, type AlertsModule } from '../modules/alerts';

import type { Routes, Shared } from './shared';

export interface WiredAlerts {
  readonly module: AlertsModule;
  readonly routes: readonly Routes[];
}

/** Before Telegram and the composer: Telegram names her alerts, the agent checks his messages against them (P4-01). */
export function wireAlerts(shared: Shared): WiredAlerts {
  const module = createAlertsModule({ db: shared.db, requireRole: shared.requireRole });
  return { module, routes: [module.routes] };
}
