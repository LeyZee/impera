import { CreatorIdSchema, VaultSyncAskedSchema, VaultViewSchema, type CreatorId } from '@impera/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { VaultReads } from '../../application/vault';
import { VaultForbidden } from '../../domain/errors';

const ParamsSchema = z.object({ creatorId: CreatorIdSchema });

const userOf = (request: FastifyRequest): string => {
  const id = request.user?.id;
  if (id === undefined) throw new VaultForbidden();
  return id;
};

export interface VaultRoutesOptions {
  /** The owner and the team's accounts: the base decides who is an active manager of her list. */
  readonly teamGuard: preValidationAsyncHookHandler;
  /** The owner alone: a sync reads the platform with her session. */
  readonly ownerGuard: preValidationAsyncHookHandler;
  /** Asks a sync of each of her accounts that may be read now; how many were asked. */
  readonly askSync: (creatorId: CreatorId, correlationId: string) => Promise<number>;
}

/**
 * `/v1/creators/:creatorId/vault` (ADR 0099 § 2 to 4, fiche vault-sync): her vault as the last sync read it, folder by
 * folder in the platform's order, for the owner and an active manager of her list; and the owner's « Synchroniser »,
 * the only thing that starts a read of the platform's vault for now (no cron).
 */
export function createVaultRoutes(reads: VaultReads, options: VaultRoutesOptions): FastifyPluginAsyncZod {
  return (app) => {
    app.get(
      '/creators/:creatorId/vault',
      {
        preValidation: options.teamGuard,
        schema: { params: ParamsSchema, response: { 200: VaultViewSchema } },
      },
      (request) => reads.view(request.params.creatorId, userOf(request)),
    );

    app.post(
      '/creators/:creatorId/vault/sync',
      {
        preValidation: options.ownerGuard,
        schema: { params: ParamsSchema, response: { 200: VaultSyncAskedSchema } },
      },
      async (request) => {
        userOf(request);
        return { accounts: await options.askSync(request.params.creatorId, `request:${request.id}`) };
      },
    );
    return Promise.resolve();
  };
}
