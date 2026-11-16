import { createRedirectLinksModule, type RedirectLinksModule } from '../modules/redirect-links';

import type { Routes, Shared } from './shared';

/** Her redirect links (INS-03): the agency sets them, she reads « Mes liens ». A leaf: it needs no other module. */
export function wireRedirectLinks(shared: Shared): {
  readonly module: RedirectLinksModule;
  readonly routes: readonly Routes[];
} {
  const module = createRedirectLinksModule({
    db: shared.db,
    adminDb: shared.adminDb,
    requireRole: shared.requireRole,
  });
  return { module, routes: [module.routes] };
}
