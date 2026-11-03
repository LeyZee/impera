/** Public entry point of the `trends` module (VEI-01, ADR 0060). Other modules import this file only. */
import type { Database } from '@impera/db';
import type { LlmGateway } from '@impera/llm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { createDrizzleExtensionLinkStore } from './infra/db/link-store';
import { createDrizzleReadingStore } from './infra/db/reading-store';
import { createDrizzleSignalStore } from './infra/db/signal-store';
import { createTrendRoutes, type RequireRole } from './infra/http/routes';
import { createGatewayCaptureVision } from './infra/vision';

export interface TrendsModule {
  readonly name: 'trends';
  /** Mounted under `/v1` by the server: `/trends/links`, `/trends/extension-links`, `/trends/readings` and its captures. */
  readonly routes: FastifyPluginAsyncZod;
}

export interface TrendsDeps {
  /** Application role: a pasted link and a reading under the person's own policies. */
  readonly db: Database;
  /** Owner role: `extension_links`, out of the application role's reach (migration 0100). */
  readonly adminDb: Database;
  readonly requireRole: RequireRole;
  /** The app's LLM gateway: the vision of a marked post's captures, a trend watch call (ADR 0060 § 7). */
  readonly gateway: Pick<LlmGateway, 'describeTrendCaptures'>;
}

export function createTrendsModule(deps: TrendsDeps): TrendsModule {
  return {
    name: 'trends',
    routes: createTrendRoutes(
      {
        signals: createDrizzleSignalStore(deps.db),
        links: createDrizzleExtensionLinkStore(deps.adminDb),
        readings: createDrizzleReadingStore(deps.db),
        vision: createGatewayCaptureVision(deps.gateway),
      },
      deps.requireRole,
    ),
  };
}
