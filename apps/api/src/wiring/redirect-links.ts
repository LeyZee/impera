import type { ConnectorsModule } from '../modules/connectors';
import { createRedirectLinksModule, type RedirectLinksModule } from '../modules/redirect-links';

import type { Routes, Shared } from './shared';

/** Her redirect links (INS-03): the owner sets them, the agency reads them, she reads « Mes liens ». « Détecter ses liens » reads the redirect service through `connectors`. */
export function wireRedirectLinks(
  shared: Shared,
  deps: { readonly detectLinks: ConnectorsModule['detectedLinks'] },
): {
  readonly module: RedirectLinksModule;
  readonly routes: readonly Routes[];
} {
  const module = createRedirectLinksModule({
    db: shared.db,
    adminDb: shared.adminDb,
    requireRole: shared.requireRole,
    recentLogin: shared.recentLogin,
    detectLinks: deps.detectLinks,
  });
  return { module, routes: [module.routes] };
}
