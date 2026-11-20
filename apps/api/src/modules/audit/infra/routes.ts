import {
  AUDIT_CSV_MEDIA_TYPE,
  AuditExportQuerySchema,
  AuditPageSchema,
  AuditQuerySchema,
  type AuditExportQuery,
  type AuditPage,
  type AuditQuery,
} from '@impera/contracts';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { AuditActor } from '../domain/ports';

export interface AuditRoutesOptions {
  /** `requireRole('owner')`: the journal is the owner's alone (EQ-18, ADR 0024). */
  readonly guard: preValidationAsyncHookHandler;
}

export interface AuditRoutesApi {
  readonly page: (query: AuditQuery) => Promise<AuditPage>;
  readonly export: (query: AuditExportQuery, actor: AuditActor) => Promise<string>;
}

/**
 * `GET /v1/audit`: a page of the journal, newest first, by cursor. `GET /v1/audit.csv`: the same selection as a file.
 * Neither is ever kept by a cache: the names of the team are in both.
 */
export function createAuditRoutes(api: AuditRoutesApi, options: AuditRoutesOptions): FastifyPluginAsyncZod {
  return (app) => {
    app.addHook('preValidation', options.guard);
    app.get(
      '/audit',
      { schema: { querystring: AuditQuerySchema, response: { 200: AuditPageSchema } } },
      async (request, reply) => reply.header('cache-control', 'no-store').send(await api.page(request.query)),
    );
    app.get('/audit.csv', { schema: { querystring: AuditExportQuerySchema } }, async (request, reply) => {
      if (request.user === null) throw new Error('requireRole ran without a user');
      const file = await api.export(request.query, { userId: request.user.id, ip: request.ip });
      return reply
        .header('content-type', AUDIT_CSV_MEDIA_TYPE)
        .header('content-disposition', 'attachment; filename="journal-impera.csv"')
        .header('cache-control', 'no-store')
        .header('x-content-type-options', 'nosniff')
        .send(file);
    });
    return Promise.resolve();
  };
}
