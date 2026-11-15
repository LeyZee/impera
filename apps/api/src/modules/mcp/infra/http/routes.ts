import {
  CreateMcpGrantBodySchema,
  DomainError,
  MCP_GRANT_UNPROCESSABLE,
  McpGrantCreatedSchema,
  McpGrantIdSchema,
  McpGrantListSchema,
  McpGrantRefusalBodySchema,
  RefusalError,
  UserIdSchema,
  type McpGrantRefusalKind,
} from '@impera/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { GrantsApi } from '../../application/grants';
import { McpGrantNotFound } from '../../domain/errors';
import type { McpOwner } from '../../domain/ports';

export interface McpRoutesOptions {
  /** `requireRole('owner')`: in lot a the owner alone creates an access, in his own name (ADR 0026 § 3). */
  readonly guard: preValidationAsyncHookHandler;
  /** `requireRecentLogin` (ADR 0026 § 3): creating and revoking an access need a sign-in under 10 minutes. */
  readonly recentLogin: preValidationAsyncHookHandler;
}

const REFUSALS: Readonly<Record<McpGrantRefusalKind, string>> = {
  capability_repeated: 'Une capacité est cochée deux fois : décoche le doublon.',
  owner_only: 'Cette capacité ne se coche que sur un accès à ton nom.',
  role_forbidden: 'Ce rôle ne peut pas recevoir cette capacité.',
};

function ownerOf(request: FastifyRequest): McpOwner {
  if (request.user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return { userId: UserIdSchema.parse(request.user.id), ip: request.ip };
}

/**
 * `/v1/settings/mcp-grants` (MCP lot a, ADR 0026 § 3, ADR 0105): Réglages › Agents connectés. The token is in one
 * answer only, never cached on the way; no answer carries a fingerprint.
 */
export function createMcpRoutes(grants: GrantsApi, options: McpRoutesOptions): FastifyPluginAsyncZod {
  return (app) => {
    app.addHook('preValidation', options.guard);

    app.get(
      '/settings/mcp-grants',
      { schema: { response: { 200: McpGrantListSchema } } },
      async (request) => ({
        items: [...(await grants.list(ownerOf(request)))],
      }),
    );

    app.post(
      '/settings/mcp-grants',
      {
        preValidation: options.recentLogin,
        schema: {
          body: CreateMcpGrantBodySchema,
          response: { 201: McpGrantCreatedSchema, 422: McpGrantRefusalBodySchema },
        },
      },
      async (request, reply) => {
        const result = await grants.create(
          ownerOf(request),
          { role: 'owner', teamScope: 'owner' },
          request.body,
        );
        if (!result.ok)
          throw new RefusalError(MCP_GRANT_UNPROCESSABLE, {
            kind: result.kind,
            message: REFUSALS[result.kind],
          });
        return reply.code(201).header('cache-control', 'no-store').send(result.value);
      },
    );

    app.delete(
      '/settings/mcp-grants/:id',
      {
        preValidation: options.recentLogin,
        schema: { params: z.object({ id: McpGrantIdSchema }) },
      },
      async (request, reply) => {
        if (!(await grants.revoke(ownerOf(request), request.params.id))) throw new McpGrantNotFound();
        return reply.code(204).send();
      },
    );

    return Promise.resolve();
  };
}
