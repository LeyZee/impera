/** Public entry point of the `redirect-links` module (INS-03, ADR 0121 § 1). Other modules import this file only. */
import type { CreatorId, RedirectLink } from '@impera/contracts';
import type { Database } from '@impera/db';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { DetectLinks } from './domain/ports';
import { createDrizzleRedirectLinkStore } from './infra/db/link-store';
import { createRedirectLinkRoutes, type RequireRole } from './infra/http/routes';

export interface RedirectLinksModule {
  readonly name: 'redirect-links';
  /** Mounted under `/v1`: `/creators/:creatorId/redirect-links` for the agency, `/creator-space/links` for her. */
  readonly routes: FastifyPluginAsyncZod;
  /**
   * Her links that are on, as her channel reads them (ADR 0080 § 4): a name, an address, where it leads. Null when
   * the table holds no link of hers: the channel falls back on its own setting, for one version.
   */
  channelLinks(creatorId: CreatorId): Promise<readonly RedirectLink[] | null>;
}

export interface RedirectLinksDeps {
  /** Application role: each person reads under their own policies. */
  readonly db: Database;
  /** Service role: the table has no write policy, a write goes through it after the right is read. */
  readonly adminDb: Database;
  readonly requireRole: RequireRole;
  /** `requireRecentLogin` (ADR 0016), for the writes. */
  readonly recentLogin: preValidationAsyncHookHandler;
  /** `connectors.detectedLinks`: the redirect service read now, for « Détecter ses liens ». */
  readonly detectLinks: DetectLinks;
}

export function createRedirectLinksModule(deps: RedirectLinksDeps): RedirectLinksModule {
  const store = createDrizzleRedirectLinkStore(deps.db, deps.adminDb);
  return {
    name: 'redirect-links',
    routes: createRedirectLinkRoutes(store, deps.requireRole, deps.recentLogin, deps.detectLinks),
    channelLinks: async (creatorId) => {
      const links = await store.enabledUnscoped(creatorId);
      return links === null
        ? null
        : links.map(({ id, name, url, destination }) => ({ id, name, url, destination }));
    },
  };
}
