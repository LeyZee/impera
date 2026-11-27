/** Public entry point of the `creator-messages` module (trous béants n° 13). Other modules import this file only. */
import type { CreatorId } from '@impera/contracts';
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { createDrizzleMessageStore } from './infra/db/store';
import { createMessageRoutes, type RequireRole } from './infra/http/routes';

export interface CreatorMessagesModule {
  readonly name: 'creator-messages';
  /** Mounted under `/v1`: her `/creator-space/messages`; the agency's `/creator-messages/waiting` and answers. */
  readonly routes: FastifyPluginAsyncZod;
}

export interface CreatorMessagesDeps {
  readonly db: Database;
  readonly requireRole: RequireRole;
  readonly allCreatorIds: () => Promise<readonly CreatorId[]>;
  /** Tests only: another clock than the server's. */
  readonly clock?: () => Date;
}

export function createCreatorMessagesModule(deps: CreatorMessagesDeps): CreatorMessagesModule {
  return {
    name: 'creator-messages',
    routes: createMessageRoutes({
      store: createDrizzleMessageStore(deps.db),
      requireRole: deps.requireRole,
      allCreatorIds: deps.allCreatorIds,
      ...(deps.clock !== undefined && { clock: deps.clock }),
    }),
  };
}
