import { ConnectorWriteGuardSchema, DomainError, PlatformAccountIdSchema } from '@impera/contracts';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { PlatformAccountNotFound } from '../../domain/errors';
import type { AccountStore } from '../../domain/ports';

export interface WriteGuardRoutesOptions {
  /** `requireRole('owner')`: opening the sends of an account is the agency's call. */
  readonly guard: preValidationAsyncHookHandler;
  /** `requireRecentLogin` (ADR 0016): changing it, not reading it. */
  readonly recentLogin: preValidationAsyncHookHandler;
}

const Params = z.object({ platformAccountId: PlatformAccountIdSchema });

/** Rare: a few changes a session, the read when the screen opens. */
const LIMIT = { max: 30, timeWindow: '1 minute', skipOnError: false };

/**
 * `/v1/connector/accounts/:platformAccountId/write-guard` (16/11): an account's write guard as the owner reads and sets
 * it from the CRM, never from a file. Read and changed under the account's creator (RLS); each change in the audit log,
 * with how many conversations it names, never which.
 */
export function createWriteGuardRoutes(
  accounts: Pick<AccountStore, 'creatorOf' | 'get' | 'setWriteGuard'>,
  options: WriteGuardRoutesOptions,
): FastifyPluginAsyncZod {
  return (app) => {
    const creatorOf = async (platformAccountId: z.infer<typeof Params>['platformAccountId']) => {
      const found = await accounts.creatorOf(platformAccountId);
      if (found === null) throw new PlatformAccountNotFound();
      return found.creatorId;
    };

    app.get(
      '/connector/accounts/:platformAccountId/write-guard',
      {
        preValidation: options.guard,
        config: { rateLimit: LIMIT },
        schema: { params: Params, response: { 200: ConnectorWriteGuardSchema } },
      },
      async (request) => {
        const { platformAccountId } = request.params;
        const account = await accounts.get(await creatorOf(platformAccountId), platformAccountId);
        if (account === null) throw new PlatformAccountNotFound();
        return { writes: account.config.writes, writesOnlyTo: account.config.writesOnlyTo };
      },
    );

    app.put(
      '/connector/accounts/:platformAccountId/write-guard',
      {
        preValidation: [options.guard, options.recentLogin],
        config: { rateLimit: LIMIT },
        schema: {
          params: Params,
          body: ConnectorWriteGuardSchema,
          response: { 200: ConnectorWriteGuardSchema },
        },
      },
      async (request) => {
        const user = request.user;
        if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
        const { platformAccountId } = request.params;
        const guard = {
          writes: request.body.writes,
          writesOnlyTo: request.body.writesOnlyTo === null ? null : [...new Set(request.body.writesOnlyTo)],
        };
        const done = await accounts.setWriteGuard(
          await creatorOf(platformAccountId),
          platformAccountId,
          guard,
          {
            userId: user.id,
            ip: request.ip,
          },
        );
        if (!done) throw new PlatformAccountNotFound();
        return guard;
      },
    );
    return Promise.resolve();
  };
}
