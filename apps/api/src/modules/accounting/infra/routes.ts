import {
  ACCOUNTING_ARCHIVE_MEDIA_TYPE,
  AccountingJournalSchema,
  AccountingPeriodQuerySchema,
  Das2ExportSchema,
  Das2QuerySchema,
  DomainError,
  UserIdSchema,
  type UserId,
  type UserRole,
} from '@nirvana/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { Actor } from '../../contractors/pure';
import type { PayrollAccounting } from '../application/accounting';

/** The composition root's `requireRole`: 401 without a session, 403 with another role; sets `request.user`. */
export type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

function userOf(request: FastifyRequest): UserId {
  if (request.user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return UserIdSchema.parse(request.user.id);
}

const actorOf = (request: FastifyRequest): Actor => ({ userId: userOf(request), ip: request.ip });

/**
 * The accountant's exports under `/v1/payroll/accounting` (EQ-06 lot 7, ADR 0047 § 1), the owner's alone: the
 * journal (lot 7b), the DAS2 recap (lot 7c) and the archive of the PDFs (lot 7d). Their accounts are written with the
 * billing settings (`/payroll/billing-settings/accounts`, `contractors`).
 */
export function createAccountingRoutes(
  accounting: PayrollAccounting,
  requireRole: RequireRole,
): FastifyPluginAsyncZod {
  const owner = requireRole('owner');
  return (app) => {
    app.get(
      '/payroll/accounting/journal',
      {
        preValidation: owner,
        schema: { querystring: AccountingPeriodQuerySchema, response: { 200: AccountingJournalSchema } },
      },
      async (request, reply) => {
        const journal = await accounting.journal(actorOf(request), request.query);
        // The contractors' names are in it: never kept by a cache.
        return reply.header('cache-control', 'no-store').send(journal);
      },
    );

    app.get(
      '/payroll/accounting/das2',
      {
        preValidation: owner,
        schema: { querystring: Das2QuerySchema, response: { 200: Das2ExportSchema } },
      },
      async (request, reply) => {
        const recap = await accounting.das2(actorOf(request), request.query);
        // The contractors' names and addresses are in it: never kept by a cache.
        return reply.header('cache-control', 'no-store').send(recap);
      },
    );

    app.get(
      '/payroll/accounting/archive',
      { preValidation: owner, schema: { querystring: AccountingPeriodQuerySchema } },
      async (request, reply) => {
        const archive = await accounting.archive(actorOf(request), request.query, request.log);
        // Streamed as it is zipped; the PDFs name the contractors: never kept by a cache.
        return reply
          .header('content-type', ACCOUNTING_ARCHIVE_MEDIA_TYPE)
          .header('content-disposition', `attachment; filename="${archive.fileName}"`)
          .header('cache-control', 'no-store')
          .header('x-content-type-options', 'nosniff')
          .send(archive.stream);
      },
    );

    return Promise.resolve();
  };
}
