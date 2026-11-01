import {
  AcceptContractTextBodySchema,
  AgencyLogoParamsSchema,
  AgencyLogoSchema,
  AssignContractorRegimeBodySchema,
  BillingRegimeParamsSchema,
  BillingRegimeSchema,
  BillingRegimesSchema,
  BillingSettingsViewSchema,
  BonusIdSchema,
  BonusSchema,
  BonusTierSetSchema,
  CollectiveGoalSchema,
  CommissionStatementIdSchema,
  CommissionStatementSchema,
  ContestInvoiceBodySchema,
  ContractAcceptanceSchema,
  ContractorFileSchema,
  ContractorParamsSchema,
  ContractorProfileBodySchema,
  ContractorRegimeSchema,
  ContractTextParamsSchema,
  ContractTextSchema,
  ContractTextsSchema,
  CreateBillingRegimeBodySchema,
  CreateContractTextBodySchema,
  CreateBonusBodySchema,
  CreateBonusTierSetBodySchema,
  CreateCollectiveGoalBodySchema,
  CreatePayAdjustmentBodySchema,
  CreatePenaltyBodySchema,
  DomainError,
  ExchangeRatesSchema,
  InvoiceAcceptanceViewSchema,
  InvoiceParamsSchema,
  InvoicePrefixBodySchema,
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
  UpdateBillingSettingsBodySchema,
  UpdatePayrollSettingsBodySchema,
  PenaltyIdSchema,
  PenaltySchema,
  RefuseInvoiceContestBodySchema,
  UpholdInvoiceContestBodySchema,
  UserIdSchema,
  ValidateBillingRegimeBodySchema,
  ValidateCommissionStatementBodySchema,
  VerifyContractorProfileBodySchema,
  type InvoiceId,
  type UserId,
  type UserRole,
} from '@nirvana/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { PayrollBillingSettings } from '../application/billing-settings';
import type { PayrollEntries } from '../application/entries';
import type { PayrollInvoiceAcceptance } from '../application/invoice-acceptance';
import type { DownloadedPdf } from '../application/invoice-pdfs';
import type { PayrollReads } from '../application/periods';
import type { PayrollValidation } from '../application/validation';
import type {
  Actor,
  JobLogger,
  PayrollContractorStore,
  PayrollRegimeStore,
  PayrollRuleStore,
} from '../domain/ports';

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
 * A logo arrives as its bytes (`content-type: image/png`), never wrapped in JSON. The body may weigh up to the server's
 * limit, so that a file over 512 KB gets its reason (`too_heavy`) instead of a bare 413; the screen checks the weight
 * before sending too.
 */
const LOGO_BODY_LIMIT_BYTES = 1_048_576;

/**
 * `/v1/payroll` (EQ-04): the owner and the team's accounts reach it, a creator never. What each one reads and writes
 * is the database's call (`withMember`): every statement for the owner and an active manager, one's own for anyone
 * else; a validation, a bonus, a penalty or an adjustment by the owner or an active manager, never for oneself; a
 * payment and the team's rules (tiers, goals, minimum payout) by the owner only. A create sent again with the same `id`
 * and values gives back what was recorded (200). A document is answered by its contractor only, and its contest refused
 * or upheld with its correction by the owner only (ADR 0039); the same answer sent again gives back what was recorded
 * (200). Réglages › Facturation
 * (`/payroll/billing-settings`) is the owner's alone. A contractor's file (`/payroll/contractors/:memberId/…`) is
 * written by himself or the owner, checked and prefixed by the owner only; the contract's and the mandate's versions
 * (`/payroll/contract-texts`) are added by the owner and accepted by the contractor himself (EQ-06 lot 5a). The
 * billing regimes (`/payroll/billing-regimes`) are read by any member; the owner alone adds one, records its validation
 * by the accountant and gives a contractor his regime from a day on (`…/contractors/:memberId/regimes`, lot 5b).
 */
export function createPayrollRoutes(
  reads: PayrollReads,
  validation: PayrollValidation,
  entries: PayrollEntries,
  rules: PayrollRuleStore,
  downloadPdf: InvoicePdfDownload,
  acceptance: PayrollInvoiceAcceptance,
  billing: PayrollBillingSettings,
  contractors: PayrollContractorStore,
  regimes: PayrollRegimeStore,
  requireRole: RequireRole,
): FastifyPluginAsyncZod {
  const ownerOrMember = requireRole('owner', 'operator');
  const owner = requireRole('owner');
  return (app) => {
    app.addContentTypeParser(
      'image/png',
      { parseAs: 'buffer', bodyLimit: LOGO_BODY_LIMIT_BYTES },
      (_request, body, done) => {
        done(null, body);
      },
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
      '/payroll/billing-settings',
      { preValidation: owner, schema: { response: { 200: BillingSettingsViewSchema } } },
      (request) => billing.read(userOf(request)),
    );

    app.put(
      '/payroll/billing-settings',
      {
        preValidation: owner,
        schema: { body: UpdateBillingSettingsBodySchema, response: { 200: BillingSettingsViewSchema } },
      },
      (request) => billing.update(actorOf(request), request.body),
    );

    app.post(
      '/payroll/billing-settings/logos',
      { preValidation: owner, schema: { response: { 200: AgencyLogoSchema, 201: AgencyLogoSchema } } },
      async (request, reply) => {
        // Anything but the bytes of a file (JSON, a form) is not a PNG.
        const bytes = Buffer.isBuffer(request.body) ? new Uint8Array(request.body) : new Uint8Array();
        const { logo, created } = await billing.addLogo(actorOf(request), bytes);
        return reply.code(created ? 201 : 200).send(logo);
      },
    );

    // The bytes under their fingerprint never change: the browser keeps them.
    app.get(
      '/payroll/billing-settings/logos/:sha256',
      { preValidation: owner, schema: { params: AgencyLogoParamsSchema } },
      async (request, reply) => {
        const bytes = await billing.logo(userOf(request), request.params.sha256);
        return reply
          .header('content-type', 'image/png')
          .header('cache-control', 'private, max-age=31536000, immutable')
          .header('x-content-type-options', 'nosniff')
          .send(Buffer.from(bytes));
      },
    );

    app.get(
      '/payroll/contractors/:memberId/file',
      {
        preValidation: ownerOrMember,
        schema: { params: ContractorParamsSchema, response: { 200: ContractorFileSchema } },
      },
      (request) => contractors.file(userOf(request), request.params.memberId),
    );

    app.put(
      '/payroll/contractors/:memberId/profile',
      {
        preValidation: ownerOrMember,
        schema: {
          params: ContractorParamsSchema,
          body: ContractorProfileBodySchema,
          response: { 200: ContractorFileSchema, 201: ContractorFileSchema },
        },
      },
      async (request, reply) => {
        const { file, created } = await contractors.writeProfile(
          actorOf(request),
          request.params.memberId,
          request.body,
        );
        return reply.code(created ? 201 : 200).send(file);
      },
    );

    app.post(
      '/payroll/contractors/:memberId/profile/verify',
      {
        preValidation: owner,
        schema: {
          params: ContractorParamsSchema,
          body: VerifyContractorProfileBodySchema,
          response: { 200: ContractorFileSchema },
        },
      },
      (request) => contractors.verifyProfile(actorOf(request), request.params.memberId, request.body),
    );

    app.put(
      '/payroll/contractors/:memberId/profile/prefix',
      {
        preValidation: owner,
        schema: {
          params: ContractorParamsSchema,
          body: InvoicePrefixBodySchema,
          response: { 200: ContractorFileSchema },
        },
      },
      (request) => contractors.setPrefix(actorOf(request), request.params.memberId, request.body),
    );

    app.get(
      '/payroll/contract-texts',
      { preValidation: ownerOrMember, schema: { response: { 200: ContractTextsSchema } } },
      (request) => contractors.texts(userOf(request)),
    );

    app.post(
      '/payroll/contract-texts',
      {
        preValidation: owner,
        schema: {
          body: CreateContractTextBodySchema,
          response: { 200: ContractTextSchema, 201: ContractTextSchema },
        },
      },
      async (request, reply) => {
        const { text, created } = await contractors.addText(actorOf(request), request.body);
        return reply.code(created ? 201 : 200).send(text);
      },
    );

    app.post(
      '/payroll/contract-texts/:textId/accept',
      {
        preValidation: ownerOrMember,
        schema: {
          params: ContractTextParamsSchema,
          body: AcceptContractTextBodySchema,
          response: { 200: ContractAcceptanceSchema, 201: ContractAcceptanceSchema },
        },
      },
      async (request, reply) => {
        const { acceptance, created } = await contractors.accept(
          actorOf(request),
          request.params.textId,
          request.body,
        );
        return reply.code(created ? 201 : 200).send(acceptance);
      },
    );

    app.get(
      '/payroll/billing-regimes',
      { preValidation: ownerOrMember, schema: { response: { 200: BillingRegimesSchema } } },
      (request) => regimes.regimes(userOf(request)),
    );

    app.post(
      '/payroll/billing-regimes',
      {
        preValidation: owner,
        schema: {
          body: CreateBillingRegimeBodySchema,
          response: { 200: BillingRegimeSchema, 201: BillingRegimeSchema },
        },
      },
      async (request, reply) => {
        const { regime, created } = await regimes.addRegime(actorOf(request), request.body);
        return reply.code(created ? 201 : 200).send(regime);
      },
    );

    app.post(
      '/payroll/billing-regimes/:regimeId/validation',
      {
        preValidation: owner,
        schema: {
          params: BillingRegimeParamsSchema,
          body: ValidateBillingRegimeBodySchema,
          response: { 200: BillingRegimeSchema, 201: BillingRegimeSchema },
        },
      },
      async (request, reply) => {
        const { regime, created } = await regimes.validateRegime(
          actorOf(request),
          request.params.regimeId,
          request.body,
        );
        return reply.code(created ? 201 : 200).send(regime);
      },
    );

    app.post(
      '/payroll/contractors/:memberId/regimes',
      {
        preValidation: owner,
        schema: {
          params: ContractorParamsSchema,
          body: AssignContractorRegimeBodySchema,
          response: { 200: ContractorRegimeSchema, 201: ContractorRegimeSchema },
        },
      },
      async (request, reply) => {
        const { assignment, created } = await regimes.assignRegime(
          actorOf(request),
          request.params.memberId,
          request.body,
        );
        return reply.code(created ? 201 : 200).send(assignment);
      },
    );
    return Promise.resolve();
  };
}
