import { CreatorIdSchema, DomainError, type CreatorErrorCode } from '@impera/contracts';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { AvatarRecords, AvatarStore } from '../../domain/avatar';

const ParamsSchema = z.object({ creatorId: CreatorIdSchema });

/** Short: a new copy (her import again) shows within minutes; the browser does not ask at each page. */
const CACHE_SECONDS = 300;

class AvatarNotFound extends DomainError {
  constructor() {
    super('creator_avatar_not_found' satisfies CreatorErrorCode, 'Aucune photo pour cette créatrice');
  }
}

/**
 * `GET /v1/creators/:creatorId/avatar` (CRM-07 a2b): her photo copied at her import, as a JPEG, from our own origin
 * (the CRM's CSP: `img-src 'self'`). The owner sees every creator's; an operator only those of his list (the guard,
 * reco 8); a creator only her own. 404 `creator_avatar_not_found` without a photo: the page shows her initials.
 */
export function createAvatarRoutes(
  avatars: { readonly store: AvatarStore; readonly records: AvatarRecords } | null,
  guard: preValidationAsyncHookHandler,
): FastifyPluginAsyncZod {
  return (app) => {
    app.get(
      '/creators/:creatorId/avatar',
      { preValidation: guard, schema: { params: ParamsSchema } },
      async (request, reply) => {
        const { user } = request;
        const { creatorId } = request.params;
        // Another creator's photo is not hers to see: said as absent, like a creator without one.
        if (user?.role === 'creator' && !user.creatorIds.includes(creatorId)) throw new AvatarNotFound();
        if (avatars === null) throw new AvatarNotFound();
        const key = await avatars.records.keyOf(creatorId);
        if (key === null) throw new AvatarNotFound();
        const jpeg = await avatars.store.get(key);
        if (jpeg === null) throw new AvatarNotFound();
        return reply
          .header('content-type', 'image/jpeg')
          .header('cache-control', `private, max-age=${String(CACHE_SECONDS)}`)
          .send(Buffer.from(jpeg));
      },
    );
    return Promise.resolve();
  };
}
