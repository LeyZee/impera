import { PushMessageSchema } from '@nirvana/contracts';

import type { DeliveryOutcome, PushSender } from '../domain/ports';

import { outcomeOf, pushRequest } from './web-push';

/** A push service that does not answer within this is tried again later. */
const TIMEOUT_MS = 10_000;
/** An offline device gets the message for a day; after that it is stale. */
const TTL_SECONDS = 24 * 60 * 60;

/**
 * Sends over HTTP with `fetch`. `subject` is how a push service reaches whoever sends (RFC 8292): the dashboard's own
 * https address, no mailbox to configure.
 */
export function createPushSender(
  subject: string,
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
): PushSender {
  return {
    async send(subscription, key, message): Promise<DeliveryOutcome> {
      const request = pushRequest({
        target: {
          endpoint: subscription.endpoint,
          p256dh: Buffer.from(subscription.p256dh, 'base64url'),
          auth: Buffer.from(subscription.auth, 'base64url'),
        },
        payload: Buffer.from(JSON.stringify(PushMessageSchema.parse(message))),
        keys: { publicKey: key.publicKey, privateKey: key.privateKey },
        subject,
        now: new Date(),
        ttlSeconds: TTL_SECONDS,
        urgency: 'normal',
      });
      try {
        const response = await fetchFn(request.url, {
          method: 'POST',
          headers: request.headers,
          body: request.body,
          redirect: 'error',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        return outcomeOf(response.status).kind;
      } catch {
        return 'retry';
      }
    },
  };
}
