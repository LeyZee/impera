/** Public entry point of the `creator-messages` module (trous béants n° 13). Other modules import this file only. */
import type { CreatorId, NotificationOutcome, NotificationRequest, ToAgencyMessage } from '@impera/contracts';
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { tellAgency, tellHer } from './application/tell';
import { createMessagePhones } from './infra/db/phones';
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
  /**
   * Her message rings her owners and managers, the answer rings her (recette 27/11): the service role reads who, the
   * `notifications` module's `notify` rings. Absent, or `notify` null while push is off: nothing rings.
   */
  readonly phones?: {
    readonly adminDb: Database;
    readonly agencyTimeZone: () => Promise<string>;
    readonly notify: ((request: NotificationRequest, at: Date) => Promise<NotificationOutcome>) | null;
  };
  /** Tests only: another clock than the server's. */
  readonly clock?: () => Date;
}

export function createCreatorMessagesModule(deps: CreatorMessagesDeps): CreatorMessagesModule {
  const notify = deps.phones?.notify ?? null;
  const told =
    deps.phones === undefined || notify === null
      ? null
      : { phones: createMessagePhones(deps.phones.adminDb, deps.phones.agencyTimeZone), notify };
  const tell =
    told === null
      ? undefined
      : {
          agency: (message: ToAgencyMessage, now: Date) => tellAgency(told, message, now),
          her: (message: ToAgencyMessage, now: Date) => tellHer(told, message, now),
        };
  return {
    name: 'creator-messages',
    routes: createMessageRoutes({
      store: createDrizzleMessageStore(deps.db),
      requireRole: deps.requireRole,
      allCreatorIds: deps.allCreatorIds,
      ...(deps.clock !== undefined && { clock: deps.clock }),
      ...(tell !== undefined && { tell }),
    }),
  };
}
