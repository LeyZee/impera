import { KycSlotSchema, type CreatorId, type KycSlot } from '@impera/contracts';
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { createFansService, type FansService } from './application/fans';
import { factRetentionCutoff } from './domain/facts';
import { createDrizzleFactPurge } from './infra/fact-purge';
import { createDrizzleFactStore } from './infra/fact-store';
import { createDrizzleFanStore } from './infra/fan-store';
import { createDrizzleFlagStore } from './infra/flag-store';
import {
  createFlagRoutes,
  createKycRoutes,
  noFanRouted,
  type FanRoutedTo,
  type RequireRole,
} from './infra/http/flag-routes';

export type { FactProposal } from './domain/facts';

/** Public entry point of the `fans` module (ADR 0002). Other modules import this file only. */
export interface FansModule extends FansService {
  readonly name: 'fans';
  readonly jobs: {
    /** `fans.purge_facts`, daily: facts of fans not seen for a year are dropped (security.md); returns how many. */
    purgeFacts(): Promise<number>;
  };
  /**
   * Mounted under `/v1` by the server: `/fans/:id/flags`, read by the dashboard and set by a chatter, and
   * `/fans/:id/kyc`, what is left to learn among `kycSlotsOf` (her active persona's canvas lines, read at each
   * request; all of them when she has none, or without it). `fanRoutedTo` (the `conversations` module) lets a member
   * whose scope is `self` read, never write, the sheet of a fan routed to him (ADR 0025).
   */
  routes(requireRole: RequireRole, kycSlotsOf?: KycSlotsOf, fanRoutedTo?: FanRoutedTo): FastifyPluginAsyncZod;
}

/** Her persona's canvas lines (P5-01), in her order; `null` when she has no active persona version. */
type KycSlotsOf = (creatorId: CreatorId) => Promise<readonly KycSlot[] | null>;

export interface FansDeps {
  /** Application role (RLS). */
  readonly db: Database;
  /** Owner role: the retention purge runs for every creator at once. */
  readonly adminDb: Database;
}

export function createFansModule(deps: FansDeps): FansModule {
  const purge = createDrizzleFactPurge(deps.adminDb);
  const service = createFansService(
    createDrizzleFanStore(deps.db),
    createDrizzleFactStore(deps.db),
    createDrizzleFlagStore(deps.db),
  );
  return {
    name: 'fans',
    ...service,
    routes:
      (requireRole, kycSlotsOf = () => Promise.resolve(null), fanRoutedTo = noFanRouted) =>
      async (app) => {
        await app.register(createFlagRoutes(service, requireRole, undefined, fanRoutedTo));
        await app.register(
          createKycRoutes(
            service,
            requireRole,
            async (creatorId) => (await kycSlotsOf(creatorId)) ?? KycSlotSchema.options,
            fanRoutedTo,
          ),
        );
      },
    jobs: { purgeFacts: () => purge.dropFactsOfFansLastSeenBefore(factRetentionCutoff(new Date())) },
  };
}
