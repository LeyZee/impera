/** Public entry point of the `redirect-links` module (INS-03, ADR 0121 § 1). Other modules import this file only. */
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { createDrizzleRedirectLinkStore } from './infra/db/link-store';
import { createRedirectLinkRoutes, type RequireRole } from './infra/http/routes';

export interface RedirectLinksModule {
  readonly name: 'redirect-links';
  /** Mounted under `/v1`: `/creators/:creatorId/redirect-links` for the agency, `/creator-space/links` for her. */
  readonly routes: FastifyPluginAsyncZod;
}

export interface RedirectLinksDeps {
  /** Application role: each person reads under their own policies. */
  readonly db: Database;
  /** Service role: the table has no write policy, a write goes through it after the right is read. */
  readonly adminDb: Database;
  readonly requireRole: RequireRole;
}

export function createRedirectLinksModule(deps: RedirectLinksDeps): RedirectLinksModule {
  return {
    name: 'redirect-links',
    routes: createRedirectLinkRoutes(createDrizzleRedirectLinkStore(deps.db, deps.adminDb), deps.requireRole),
  };
}
