import {
  CreatorIdSchema,
  FanCardFieldSchema,
  FanCardViewSchema,
  FanIdSchema,
  SetFanCardFieldBodySchema,
  type FanCardView,
  type FanId,
} from '@impera/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { FansService } from '../../application/fans';
import type { Card, CardValue } from '../../domain/card';

import { noFanAccess, readerFor, type FanAccess, type RequireRole } from './flag-routes';

const CardParamsSchema = z.object({ id: FanIdSchema });
const CardFieldParamsSchema = z.object({ id: FanIdSchema, field: FanCardFieldSchema });
const CreatorQuerySchema = z.object({ creatorId: CreatorIdSchema });

const valueView = (value: CardValue) => ({
  items: [...value.items],
  source: value.source,
  observedAt: value.observedAt.toISOString(),
  notedBy: value.notedBy,
  sourceMessageId: value.sourceMessageId,
});

/** The card as the contract says it (`strict`, the same on the CRM and the extension, ADR 0085 § 10). */
function cardView(fanId: FanId, card: Card): FanCardView {
  return {
    fanId,
    fields: card.fields.map((entry) => ({
      field: entry.field,
      current: entry.current === null ? null : valueView(entry.current),
      toCheck: entry.toCheck.map(valueView),
    })),
    others: card.others.map((other) => ({ ...other, observedAt: other.observedAt.toISOString() })),
  };
}

/**
 * `/v1/fans/:id/card` (ADR 0085 § 10): his card, read and corrected by those who can open the fan, as his limits are
 * read (the owner, the chatters on her list, a chatter whose access window is open on her or who holds a conversation
 * of his, each read traced, ADR 0025). A chatter corrects what he reads (§ 6: the card spares him the note, he
 * corrects it): the same reader writes. Never the creator (ADR 0063). A fan unknown to this creator is 404.
 */
export function createCardRoutes(
  fans: FansService,
  requireRole: RequireRole,
  access: FanAccess = noFanAccess,
): FastifyPluginAsyncZod {
  return (app) => {
    app.get(
      '/fans/:id/card',
      {
        preValidation: requireRole('owner', 'operator'),
        schema: {
          params: CardParamsSchema,
          querystring: CreatorQuerySchema,
          response: { 200: FanCardViewSchema },
        },
      },
      async (request) => {
        const { creatorId } = request.query;
        const fanId = request.params.id;
        await readerFor(request, creatorId, fanId, access, 'card');
        return cardView(fanId, await fans.card(creatorId, fanId));
      },
    );

    app.put(
      '/fans/:id/card/:field',
      {
        preValidation: requireRole('owner', 'operator'),
        schema: {
          params: CardFieldParamsSchema,
          querystring: CreatorQuerySchema,
          body: SetFanCardFieldBodySchema,
          response: { 200: FanCardViewSchema },
        },
      },
      async (request) => {
        const { creatorId } = request.query;
        const { id: fanId, field } = request.params;
        const author = await readerFor(request, creatorId, fanId, access, 'card');
        return cardView(fanId, await fans.editCard(creatorId, fanId, field, request.body, author));
      },
    );
    return Promise.resolve();
  };
}
