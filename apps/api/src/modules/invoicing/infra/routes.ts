import {
  ContestInvoiceBodySchema,
  DomainError,
  InvoiceAcceptanceViewSchema,
  InvoiceListQuerySchema,
  InvoiceListSchema,
  InvoiceParamsSchema,
  RefuseInvoiceContestBodySchema,
  UpholdInvoiceContestBodySchema,
  UserIdSchema,
  type InvoiceId,
  type UserId,
  type UserRole,
} from '@nirvana/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { Actor, JobLogger } from '../../contractors/pure';
import type { PayrollInvoiceAcceptance } from '../application/invoice-acceptance';
import type { DownloadedPdf } from '../application/invoice-pdfs';

/** An invoice's PDF as its reader may download it (ADR 0037 § 7). */
export type InvoicePdfDownload = (
  userId: UserId,
  invoiceId: InvoiceId,
  logger: JobLogger,
) => Promise<DownloadedPdf>;

/** The composition root's `requireRole`: 401 without a session, 403 with another role; sets `request.user`. */
export type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

function userOf(request: FastifyRequest): UserId {
  if (request.user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return UserIdSchema.parse(request.user.id);
}

const actorOf = (request: FastifyRequest): Actor => ({ userId: userOf(request), ip: request.ip });

/**
 * The invoices and credit notes under `/v1/payroll/invoices` (EQ-06, ADR 0047 § 1): the owner and the team's accounts
 * reach them, a creator never. The list (lot 8) follows the invoices' policy: one's own for a contractor, all of them
 * for the owner and an active manager, always within a bound. A document is answered by its contractor only, and its
 * contest refused or upheld with its correction by the owner only (ADR 0039); the same answer sent again gives back
 * what was recorded (200).
 */
export function createInvoicingRoutes(
  downloadPdf: InvoicePdfDownload,
  acceptance: PayrollInvoiceAcceptance,
  requireRole: RequireRole,
): FastifyPluginAsyncZod {
  const ownerOrMember = requireRole('owner', 'operator');
  return (app) => {
    app.get(
      '/payroll/invoices',
      {
        preValidation: ownerOrMember,
        schema: { querystring: InvoiceListQuerySchema, response: { 200: InvoiceListSchema } },
      },
      (request) => acceptance.list(userOf(request), request.query),
    );

    // A file, never JSON: kept out of every cache, named after its number, its type never guessed by the browser.
    app.get(
      '/payroll/invoices/:invoiceId/pdf',
      { preValidation: ownerOrMember, schema: { params: InvoiceParamsSchema } },
      async (request, reply) => {
        const pdf = await downloadPdf(userOf(request), request.params.invoiceId, request.log);
        return reply
          .header('content-type', 'application/pdf')
          .header('content-disposition', `attachment; filename="${pdf.fileName}"`)
          .header('cache-control', 'private, no-store')
          .header('x-content-type-options', 'nosniff')
          .send(Buffer.from(pdf.bytes));
      },
    );

    app.get(
      '/payroll/invoices/:invoiceId/acceptance',
      {
        preValidation: ownerOrMember,
        schema: { params: InvoiceParamsSchema, response: { 200: InvoiceAcceptanceViewSchema } },
      },
      (request) => acceptance.read(userOf(request), request.params.invoiceId),
    );

    app.post(
      '/payroll/invoices/:invoiceId/accept',
      {
        preValidation: ownerOrMember,
        schema: { params: InvoiceParamsSchema, response: { 200: InvoiceAcceptanceViewSchema } },
      },
      (request) => acceptance.accept(actorOf(request), request.params.invoiceId),
    );

    app.post(
      '/payroll/invoices/:invoiceId/contest',
      {
        preValidation: ownerOrMember,
        schema: {
          params: InvoiceParamsSchema,
          body: ContestInvoiceBodySchema,
          response: { 200: InvoiceAcceptanceViewSchema },
        },
      },
      (request) => acceptance.contest(actorOf(request), request.params.invoiceId, request.body),
    );

    app.post(
      '/payroll/invoices/:invoiceId/contest/refuse',
      {
        preValidation: ownerOrMember,
        schema: {
          params: InvoiceParamsSchema,
          body: RefuseInvoiceContestBodySchema,
          response: { 200: InvoiceAcceptanceViewSchema },
        },
      },
      (request) => acceptance.refuseContest(actorOf(request), request.params.invoiceId, request.body),
    );

    app.post(
      '/payroll/invoices/:invoiceId/contest/uphold',
      {
        preValidation: ownerOrMember,
        schema: {
          params: InvoiceParamsSchema,
          body: UpholdInvoiceContestBodySchema,
          response: { 200: InvoiceAcceptanceViewSchema },
        },
      },
      (request) => acceptance.upholdContest(actorOf(request), request.params.invoiceId, request.body),
    );

    return Promise.resolve();
  };
}
