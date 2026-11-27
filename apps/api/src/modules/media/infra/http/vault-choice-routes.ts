import {
  CreatorIdSchema,
  VaultChoicesChangeSchema,
  VaultChoicesViewSchema,
  VaultDescribeAnswerSchema,
  VaultDescribeAskSchema,
} from '@impera/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  askVaultDescriptions,
  readVaultChoices,
  setVaultChoices,
  type VaultChoiceDeps,
} from '../../application/vault-choices';
import { VaultChoiceForbidden } from '../../domain/errors';

const ParamsSchema = z.object({ creatorId: CreatorIdSchema });

const userOf = (request: FastifyRequest): string => {
  const id = request.user?.id;
  if (id === undefined) throw new VaultChoiceForbidden('read');
  return id;
};

export interface VaultChoiceRoutesOptions {
  /** The owner and the team's accounts: the base decides who is an active manager of her list. */
  readonly teamGuard: preValidationAsyncHookHandler;
  /** The owner alone: what enters the CRM and what is described are hers to choose. */
  readonly ownerGuard: preValidationAsyncHookHandler;
}

/**
 * `/v1/creators/:creatorId/vault/choices` and `/vault/describe` (ADR 0145 § 5, amendment of 17/11): what of her vault
 * enters the CRM, ticked by folder or by media, and the description by the vision of a selection, after its count and
 * its cost were shown. Read by the owner and an active manager of her list; ticked and asked by the owner alone.
 */
export function createVaultChoiceRoutes(
  deps: VaultChoiceDeps,
  options: VaultChoiceRoutesOptions,
): FastifyPluginAsyncZod {
  return (app) => {
    app.get(
      '/creators/:creatorId/vault/choices',
      {
        preValidation: options.teamGuard,
        schema: { params: ParamsSchema, response: { 200: VaultChoicesViewSchema } },
      },
      (request) => readVaultChoices(deps, request.params.creatorId, userOf(request)),
    );

    app.put(
      '/creators/:creatorId/vault/choices',
      {
        preValidation: options.ownerGuard,
        schema: {
          params: ParamsSchema,
          body: VaultChoicesChangeSchema,
          response: { 200: VaultChoicesViewSchema },
        },
      },
      (request) => setVaultChoices(deps, request.params.creatorId, userOf(request), request.body),
    );

    app.post(
      '/creators/:creatorId/vault/describe',
      {
        preValidation: options.ownerGuard,
        schema: {
          params: ParamsSchema,
          body: VaultDescribeAskSchema,
          response: { 200: VaultDescribeAnswerSchema },
        },
      },
      (request) =>
        askVaultDescriptions(
          deps,
          request.params.creatorId,
          userOf(request),
          request.body,
          `request:${request.id}`,
        ),
    );

    return Promise.resolve();
  };
}
