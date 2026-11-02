import {
  ACCOUNTING_ARCHIVE_MEDIA_TYPE,
  AccountingPeriodQuerySchema,
  AccountingJournalSchema,
  BonusIdSchema,
  BonusSchema,
  BonusTierSetSchema,
  CollectiveGoalSchema,
  CommissionStatementIdSchema,
  CommissionStatementSchema,
  ContestInvoiceBodySchema,
  CreateBonusBodySchema,
  CreateBonusTierSetBodySchema,
  CreateCollectiveGoalBodySchema,
  CreatePayAdjustmentBodySchema,
  CreatePenaltyBodySchema,
  Das2ExportSchema,
  Das2QuerySchema,
  DomainError,
  ExchangeRatesSchema,
  InvoiceAcceptanceViewSchema,
  InvoiceListQuerySchema,
  InvoiceListSchema,
  InvoiceParamsSchema,
  PageQuerySchema,
  PayAdjustmentSchema,
  PayCommissionStatementBodySchema,
  PayPeriodPageSchema,
  PayPeriodSchema,
  PayrollEntriesSchema,
  PayrollPeriodSchema,
  PayrollSettingsSchema,
  PayoutMinimumSchema,
  CreatePayoutMinimumBodySchema,
  UpdatePayrollSettingsBodySchema,
  PenaltyIdSchema,
  PenaltySchema,
  RefuseInvoiceContestBodySchema,
  UpholdInvoiceContestBodySchema,
  UserIdSchema,
  ValidateCommissionStatementBodySchema,
  type InvoiceId,
  type UserId,
  type UserRole,
} from '@nirvana/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { Actor, JobLogger } from '../../contractors/pure';
import type { PayrollAccounting } from '../application/accounting';
import type { PayrollEntries } from '../application/entries';
import type { PayrollInvoiceAcceptance } from '../application/invoice-acceptance';
import type { DownloadedPdf } from '../application/invoice-pdfs';
import type { PayrollReads } from '../application/periods';
import type { PayrollValidation } from '../application/validation';
import type { PayrollRuleStore } from '../domain/ports';

/** An invoice's PDF as its reader may download it (ADR 0037 § 7). */
export type InvoicePdfDownload = (
  userId: UserId,
  invoiceId: InvoiceId,
  logger: JobLogger,
) => Promise<DownloadedPdf>;

/** The composition root's `requireRole`: 401 without a session, 403 with another role; sets `request.user`. */
export type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

const PeriodParamsSchema = z.object({ period: PayPeriodSchema });
const StatementParamsSchema = z.object({ statementId: CommissionStatementIdSchema });
const BonusParamsSchema = z.object({ bonusId: BonusIdSchema });
const PenaltyParamsSchema = z.object({ penaltyId: PenaltyIdSchema });

function userOf(request: FastifyRequest): UserId {
  if (request.user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return UserIdSchema.parse(request.user.id);
}

const actorOf = (request: FastifyRequest): Actor => ({ userId: userOf(request), ip: request.ip });

/**
 * `/v1/payroll` (EQ-04): the owner and the team's accounts reach it, a creator never. What each one reads and writes
 * is the database's call (`withMember`): every statement for the owner and an active manager, one's own for anyone
 * else; a validation, a bonus, a penalty or an adjustment by the owner or an active manager, never for oneself; a
 * payment and the team's rules (tiers, goals, minimum payout) by the owner only. A create sent again with the same `id`
 * and values gives back what was recorded (200). A document is answered by its contractor only, and its contest refused
 * or upheld with its correction by the owner only (ADR 0039); the same answer sent again gives back what was recorded
 * (200). The contractors' file (`/payroll/billing-settings`, `/payroll/contractors/…`, `/payroll/contract-texts`,
 * `/payroll/billing-regimes`) is the `contractors` module's (ADR 0047 § 1). The accountant's export
 * (`/payroll/accounting/journal`, lot 7b), its accounts (`/payroll/billing-settings/accounts`), the DAS2 recap
 * (`/payroll/accounting/das2`, lot 7c) and the archive of the PDFs (`/payroll/accounting/archive`, lot 7d) are the
 * owner's alone. The list of invoices and credit notes (`/payroll/invoices`, lot 8) follows the invoices' policy: one's
 * own for a contractor, all of them for the owner and an active manager, always within a bound.
 */
export function createPayrollRoutes(
  reads: PayrollReads,
  validation: PayrollValidation,
  entries: PayrollEntries,
  rules: PayrollRuleStore,
  downloadPdf: InvoicePdfDownload,
  acceptance: PayrollInvoiceAcceptance,
  accounting: PayrollAccounting,
  requireRole: RequireRole,
): FastifyPluginAsyncZod {
  const ownerOrMember = requireRole('owner', 'operator');
  const owner = requireRole('owner');
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

    app.get(
      '/payroll/periods',
      {
        preValidation: ownerOrMember,
        schema: { querystring: PageQuerySchema, response: { 200: PayPeriodPageSchema } },
      },
      (request) => reads.periods(userOf(request), request.query),
    );

    app.get(
      '/payroll/periods/:period',
      {
        preValidation: ownerOrMember,
        schema: { params: PeriodParamsSchema, response: { 200: PayrollPeriodSchema } },
      },
      (request) => reads.period(userOf(request), request.params.period),
    );

    app.get(
      '/payroll/entries',
      {
        preValidation: ownerOrMember,
        schema: { querystring: PeriodParamsSchema, response: { 200: PayrollEntriesSchema } },
      },
      (request) => reads.entries(userOf(request), request.query.period),
    );

    app.post(
      '/payroll/statements/:statementId/validate',
      {
        preValidation: ownerOrMember,
        schema: {
          params: StatementParamsSchema,
          body: ValidateCommissionStatementBodySchema,
          response: { 200: CommissionStatementSchema },
        },
      },
      (request) => validation.validate(actorOf(request), request.params.statementId, request.body),
    );

    app.post(
      '/payroll/statements/:statementId/pay',
      {
        preValidation: ownerOrMember,
        schema: {
          params: StatementParamsSchema,
          body: PayCommissionStatementBodySchema,
          response: { 200: CommissionStatementSchema },
        },
      },
      (request) => entries.pay(actorOf(request), request.params.statementId, request.body),
    );

    app.post(
      '/payroll/bonuses',
      {
        preValidation: ownerOrMember,
        schema: { body: CreateBonusBodySchema, response: { 200: BonusSchema, 201: BonusSchema } },
      },
      async (request, reply) => {
        const { value, created } = await entries.createBonus(actorOf(request), request.body);
        return reply.code(created ? 201 : 200).send(value);
      },
    );

    app.post(
      '/payroll/bonuses/:bonusId/cancel',
      { preValidation: ownerOrMember, schema: { params: BonusParamsSchema, response: { 200: BonusSchema } } },
      (request) => entries.cancelBonus(actorOf(request), request.params.bonusId),
    );

    app.post(
      '/payroll/penalties',
      {
        preValidation: ownerOrMember,
        schema: { body: CreatePenaltyBodySchema, response: { 200: PenaltySchema, 201: PenaltySchema } },
      },
      async (request, reply) => {
        const { value, created } = await entries.createPenalty(actorOf(request), request.body);
        return reply.code(created ? 201 : 200).send(value);
      },
    );

    app.post(
      '/payroll/penalties/:penaltyId/cancel',
      {
        preValidation: ownerOrMember,
        schema: { params: PenaltyParamsSchema, response: { 200: PenaltySchema } },
      },
      (request) => entries.cancelPenalty(actorOf(request), request.params.penaltyId),
    );

    app.post(
      '/payroll/adjustments',
      {
        preValidation: ownerOrMember,
        schema: {
          body: CreatePayAdjustmentBodySchema,
          response: { 200: PayAdjustmentSchema, 201: PayAdjustmentSchema },
        },
      },
      async (request, reply) => {
        const { value, created } = await entries.createAdjustment(actorOf(request), request.body);
        return reply.code(created ? 201 : 200).send(value);
      },
    );

    app.post(
      '/payroll/bonus-tiers',
      {
        preValidation: ownerOrMember,
        schema: {
          body: CreateBonusTierSetBodySchema,
          response: { 200: BonusTierSetSchema, 201: BonusTierSetSchema },
        },
      },
      async (request, reply) => {
        const { value, created } = await rules.createBonusTierSet(actorOf(request), request.body);
        return reply.code(created ? 201 : 200).send(value);
      },
    );

    app.post(
      '/payroll/collective-goals',
      {
        preValidation: ownerOrMember,
        schema: {
          body: CreateCollectiveGoalBodySchema,
          response: { 200: CollectiveGoalSchema, 201: CollectiveGoalSchema },
        },
      },
      async (request, reply) => {
        const { value, created } = await rules.createCollectiveGoal(actorOf(request), request.body);
        return reply.code(created ? 201 : 200).send(value);
      },
    );

    app.post(
      '/payroll/payout-minimums',
      {
        preValidation: ownerOrMember,
        schema: {
          body: CreatePayoutMinimumBodySchema,
          response: { 200: PayoutMinimumSchema, 201: PayoutMinimumSchema },
        },
      },
      async (request, reply) => {
        const { value, created } = await rules.createPayoutMinimum(actorOf(request), request.body);
        return reply.code(created ? 201 : 200).send(value);
      },
    );

    app.get(
      '/payroll/settings',
      { preValidation: ownerOrMember, schema: { response: { 200: PayrollSettingsSchema } } },
      (request) => reads.settings(userOf(request)),
    );

    app.put(
      '/payroll/settings',
      {
        preValidation: ownerOrMember,
        schema: { body: UpdatePayrollSettingsBodySchema, response: { 200: PayrollSettingsSchema } },
      },
      (request) => rules.setSettings(actorOf(request), request.body),
    );

    app.get(
      '/payroll/exchange-rates',
      { preValidation: ownerOrMember, schema: { response: { 200: ExchangeRatesSchema } } },
      (request) => reads.exchangeRates(userOf(request)),
    );

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
