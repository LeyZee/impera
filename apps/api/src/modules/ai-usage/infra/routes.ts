import {
  AddAiCreditEntryBodySchema,
  AiCreditEntrySchema,
  AiUsageSchema,
  DomainError,
  type AddAiCreditEntryBody,
  type AiUsage,
} from '@impera/contracts';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { CreditActor, CreditLedger } from '../domain/ports';

export interface AiUsageRoutesOptions {
  /** `requireRole('owner')`: what the AI costs the agency, and its credits, are the owner's alone. */
  readonly guard: preValidationAsyncHookHandler;
}

export interface AiUsageRoutesApi {
  readonly read: () => Promise<AiUsage>;
  readonly add: (body: AddAiCreditEntryBody, actor: CreditActor) => ReturnType<CreditLedger['add']>;
  readonly remove: (id: string, actor: CreditActor) => Promise<boolean>;
}

const EntryParamsSchema = z.object({ id: z.uuid() });

/**
 * `GET /v1/settings/ai-usage`: the spend and the credits (ADR 0091), sums only, never a prompt nor a fan.
 * `POST /v1/settings/ai-usage/credits`: a top-up or a balance reading, idempotent on its id.
 * `DELETE /v1/settings/ai-usage/credits/:id`: a line written by mistake, taken back whole.
 */
export function createAiUsageRoutes(
  api: AiUsageRoutesApi,
  options: AiUsageRoutesOptions,
): FastifyPluginAsyncZod {
  return (app) => {
    app.addHook('preValidation', options.guard);

    app.get('/settings/ai-usage', { schema: { response: { 200: AiUsageSchema } } }, () => api.read());

    app.post(
      '/settings/ai-usage/credits',
      {
        schema: {
          body: AddAiCreditEntryBodySchema,
          response: { 200: AiCreditEntrySchema, 201: AiCreditEntrySchema },
        },
      },
      async (request, reply) => {
        if (request.user === null) throw new Error('requireRole ran without a user');
        const result = await api.add(request.body, { userId: request.user.id, ip: request.ip });
        if (result.kind === 'conflict') {
          throw new DomainError('ai_credit_conflict', 'Cette saisie existe déjà avec d’autres valeurs.');
        }
        return reply.code(result.kind === 'created' ? 201 : 200).send(result.entry);
      },
    );

    app.delete(
      '/settings/ai-usage/credits/:id',
      { schema: { params: EntryParamsSchema } },
      async (request, reply) => {
        if (request.user === null) throw new Error('requireRole ran without a user');
        const removed = await api.remove(request.params.id, { userId: request.user.id, ip: request.ip });
        if (!removed) throw new DomainError('ai_credit_not_found', 'Cette saisie n’existe plus.');
        return reply.code(204).send();
      },
    );
    return Promise.resolve();
  };
}
