import {
  ConnectorAccountsQuerySchema,
  ConnectorAccountsSchema,
  ConnectorSessionBodySchema,
  ExtensionLinkTokenSchema,
} from '@impera/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { ConnectorSessions } from '../../application/sessions';
import { ConnectorLinkForbidden, ConnectorLinkUnauthenticated } from '../../domain/errors';
import type { AccountStore } from '../../domain/ports';

/** The person an extension link names; `null` for a link that names nobody. */
type LinkUser = (token: string) => Promise<{ readonly id: string; readonly role: string } | null>;

const LinkHeadersSchema = z.looseObject({ 'x-extension-link': z.string().optional() });

/** A « Sync » is rare: 10 a minute, a wrong link counted. The list is read when the popup opens. */
const SYNC_LIMIT = { max: 10, timeWindow: '1 minute', skipOnError: false };
const LIST_LIMIT = { max: 60, timeWindow: '1 minute', skipOnError: false };

/**
 * `/v1/connector`: the extension's « Sync » (reveal-connector-spec.md § 2). Both routes take the owner's extension link
 * (`x-extension-link`, ADR 0066 § 7), never the dashboard's cookie, and are exempt from the dashboard's Origin check:
 * the extension has its own origin. The link is checked first, on the raw request: without it, 401 before any 400 on
 * the body. The session is never logged nor echoed.
 */
export function createConnectorRoutes(deps: {
  readonly sessions: ConnectorSessions;
  readonly accounts: Pick<AccountStore, 'listSyncable'>;
  readonly linkUser: LinkUser;
}): FastifyPluginAsyncZod {
  return (app) => {
    const owners = new WeakMap<FastifyRequest, string>();
    const ownerOnly = async (request: FastifyRequest): Promise<void> => {
      const token = ExtensionLinkTokenSchema.safeParse(request.headers['x-extension-link']);
      const user = token.success ? await deps.linkUser(token.data) : null;
      if (user === null) throw new ConnectorLinkUnauthenticated();
      if (user.role !== 'owner') throw new ConnectorLinkForbidden();
      owners.set(request, user.id);
    };

    app.get(
      '/connector/accounts',
      {
        logLevel: 'warn',
        config: { originCheck: false, rateLimit: LIST_LIMIT },
        onRequest: ownerOnly,
        schema: {
          headers: LinkHeadersSchema,
          querystring: ConnectorAccountsQuerySchema,
          response: { 200: ConnectorAccountsSchema },
        },
      },
      async (request) => {
        const accounts = await deps.accounts.listSyncable(request.query.platform);
        return {
          accounts: accounts.map((account) => ({
            ...account,
            sessionUpdatedAt: account.sessionUpdatedAt?.toISOString() ?? null,
          })),
        };
      },
    );

    app.post(
      '/connector/sessions',
      {
        // The body is a session: nothing below `warn` is logged.
        logLevel: 'warn',
        config: { originCheck: false, rateLimit: SYNC_LIMIT },
        onRequest: ownerOnly,
        schema: { headers: LinkHeadersSchema, body: ConnectorSessionBodySchema },
      },
      async (request, reply) => {
        const userId = owners.get(request);
        if (userId === undefined) throw new ConnectorLinkUnauthenticated();
        await deps.sessions.store({
          platformAccountId: request.body.platformAccountId,
          session: request.body.session,
          correlationId: request.id,
          userId,
        });
        return reply.code(204).send();
      },
    );
    return Promise.resolve();
  };
}
