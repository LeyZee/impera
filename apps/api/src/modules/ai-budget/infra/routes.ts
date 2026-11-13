import {
  AiBudgetSchema,
  PutAiBudgetBodySchema,
  type AiBudget,
  type PutAiBudgetBody,
} from '@impera/contracts';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { BudgetActor } from '../domain/ports';

export interface AiBudgetRoutesOptions {
  /** `requireRole('owner')`: the agency's money, the owner's alone (Réglages). */
  readonly guard: preValidationAsyncHookHandler;
  /** `requireRecentLogin` (ADR 0016): changing what the AI may spend needs a sign-in under 10 minutes. */
  readonly recentLogin: preValidationAsyncHookHandler;
}

export interface AiBudgetRoutesApi {
  readonly read: () => Promise<AiBudget>;
  readonly write: (body: PutAiBudgetBody, actor: BudgetActor) => Promise<AiBudget>;
}

/**
 * `GET /v1/settings/ai-budget`: the day's AI budget and the trend watch's cap in force, the defaults, the day's spend.
 * `PUT /v1/settings/ai-budget`: both values, `null` for the default; audited.
 */
export function createAiBudgetRoutes(
  api: AiBudgetRoutesApi,
  options: AiBudgetRoutesOptions,
): FastifyPluginAsyncZod {
  return (app) => {
    app.addHook('preValidation', options.guard);

    app.get('/settings/ai-budget', { schema: { response: { 200: AiBudgetSchema } } }, () => api.read());

    app.put(
      '/settings/ai-budget',
      {
        preValidation: options.recentLogin,
        schema: { body: PutAiBudgetBodySchema, response: { 200: AiBudgetSchema } },
      },
      (request) => {
        if (request.user === null) throw new Error('requireRole ran without a user');
        return api.write(request.body, { userId: request.user.id, ip: request.ip });
      },
    );
    return Promise.resolve();
  };
}
