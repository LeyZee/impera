import {
  NotificationKindsSchema,
  NOTIFICATION_INBOX_DAYS,
  NOTIFICATION_INBOX_MAX,
  NotificationInboxSchema,
  NotificationPreferencesSchema,
  PushPublicKeySchema,
  PushSubscriptionInputSchema,
  PushTestResultSchema,
  PushUnsubscribeBodySchema,
  DomainError,
  type UserRole,
} from '@impera/contracts';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { preferencesOf, publicKey, sendTest, subscribe, type DevicesDeps } from '../../application/devices';
import type { InboxReader } from '../../domain/ports';

export type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

const EVERY_ROLE: readonly UserRole[] = ['owner', 'operator', 'creator'];

function signedIn(user: { readonly id: string } | null): string {
  if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return user.id;
}

/**
 * `/v1/notifications` (CR-01), for every role: each account handles its own devices and settings, never another's
 * (RLS `own_rows`). Without CREDENTIALS_ENCRYPTION_KEYS the server cannot seal its key: 503 `service_unavailable`.
 */
export function createNotificationRoutes(
  deps: DevicesDeps | null,
  requireRole: RequireRole,
  inbox: InboxReader,
  now: () => Date = () => new Date(),
): FastifyPluginAsyncZod {
  const ready = (): DevicesDeps => {
    if (deps === null) {
      throw new DomainError(
        'service_unavailable',
        'Les notifications ne sont pas disponibles sur ce serveur',
      );
    }
    return deps;
  };
  const guard = requireRole(...EVERY_ROLE);
  return (app) => {
    app.get(
      '/notifications/push-key',
      { preValidation: guard, schema: { response: { 200: PushPublicKeySchema } } },
      async () => ({ publicKey: await publicKey(ready()) }),
    );

    app.put(
      '/notifications/subscriptions',
      { preValidation: guard, schema: { body: PushSubscriptionInputSchema, response: { 204: z.null() } } },
      async (request, reply) => {
        await subscribe(ready(), signedIn(request.user), request.body);
        return reply.code(204).send(null);
      },
    );

    app.delete(
      '/notifications/subscriptions',
      { preValidation: guard, schema: { body: PushUnsubscribeBodySchema, response: { 204: z.null() } } },
      async (request, reply) => {
        await ready().subscriptions.remove(signedIn(request.user), request.body.endpoint);
        return reply.code(204).send(null);
      },
    );

    app.get(
      '/notifications/preferences',
      { preValidation: guard, schema: { response: { 200: NotificationPreferencesSchema } } },
      (request) => preferencesOf(ready(), signedIn(request.user)),
    );

    app.put(
      '/notifications/preferences',
      {
        preValidation: guard,
        schema: { body: NotificationPreferencesSchema, response: { 200: NotificationPreferencesSchema } },
      },
      async (request) => {
        await ready().preferences.put(signedIn(request.user), request.body);
        return request.body;
      },
    );

    // Her sorts (ADR 0150 § 16 ter): the creator's own choices, for herself only (RLS own_rows).
    const creatorOnly = requireRole('creator');
    app.get(
      '/notifications/kinds',
      { preValidation: creatorOnly, schema: { response: { 200: NotificationKindsSchema } } },
      (request) => ready().preferences.kinds(signedIn(request.user)),
    );

    app.put(
      '/notifications/kinds',
      {
        preValidation: creatorOnly,
        schema: { body: NotificationKindsSchema, response: { 200: NotificationKindsSchema } },
      },
      async (request) => {
        await ready().preferences.putKinds(signedIn(request.user), request.body);
        return request.body;
      },
    );

    // « Tes notifications » (trou 9 du 21/11): read back whether push is on or off on this server.
    app.get(
      '/notifications/inbox',
      { preValidation: guard, schema: { response: { 200: NotificationInboxSchema } } },
      async (request) => {
        const since = new Date(now().getTime() - NOTIFICATION_INBOX_DAYS * 24 * 60 * 60 * 1000);
        const items = await inbox.recent(signedIn(request.user), since, NOTIFICATION_INBOX_MAX);
        return { items: [...items] };
      },
    );

    app.post(
      '/notifications/test',
      { preValidation: guard, schema: { response: { 200: PushTestResultSchema } } },
      (request) => sendTest(ready(), signedIn(request.user)),
    );
    return Promise.resolve();
  };
}
