import {
  BonusIdSchema,
  BonusSchema,
  BonusTierSetSchema,
  CollectiveGoalSchema,
  CommissionStatementIdSchema,
  CommissionStatementSchema,
  CreateBonusBodySchema,
  CreateBonusTierSetBodySchema,
  CreateCollectiveGoalBodySchema,
  CreatePayAdjustmentBodySchema,
  CreatePaySaleDecisionBodySchema,
  CreatePenaltyBodySchema,
  DomainError,
  ExchangeRatesSchema,
  HeldSalesSchema,
  PageQuerySchema,
  PayAdjustmentSchema,
  PayCommissionStatementBodySchema,
  PayPeriodPageSchema,
  PayPeriodSchema,
  PayrollEntriesSchema,
  PayrollPeriodSchema,
  PayrollSettingsSchema,
  PayoutMinimumSchema,
  PaySaleDecisionSchema,
  CreatePayoutMinimumBodySchema,
  UpdatePayrollSettingsBodySchema,
  PenaltyIdSchema,
  PenaltySchema,
  UserIdSchema,
  ValidateCommissionStatementBodySchema,
  type UserId,
  type UserRole,
} from '@nirvana/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { Actor } from '../../contractors/pure';
import type { PayrollEntries } from '../application/entries';
import type { PayrollReads } from '../application/periods';
import type { PayrollValidation } from '../application/validation';
import type { PayrollRuleStore, PayrollSaleDecisionStore } from '../domain/ports';

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
 * payment and the team's rules (tiers, goals, minimum payout) by the owner only; the held sales and a decision on one
 * by the owner or an active manager, never on a sale of their own (CRM-03). A create sent again with the same `id`
 * and values gives back what was recorded (200). The contractors' file (`/payroll/billing-settings`,
 * `/payroll/contractors/…`, `/payroll/contract-texts`, `/payroll/billing-regimes`) is the `contractors` module's, the
 * invoices and credit notes (`/payroll/invoices/…`) the `invoicing` module's and the accountant's exports
 * (`/payroll/accounting/…`) the `accounting` module's (ADR 0047 § 1).
 */
export function createPayrollRoutes(
  reads: PayrollReads,
  validation: PayrollValidation,
  entries: PayrollEntries,
  rules: PayrollRuleStore,
  decisions: PayrollSaleDecisionStore,
  requireRole: RequireRole,
): FastifyPluginAsyncZod {
  const ownerOrMember = requireRole('owner', 'operator');
  return (app) => {
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

    // CRM-03 lot b3, ADR 0050 § 5: the sales a period holds, and the validator's decision on one.
    app.get(
      '/payroll/periods/:period/held-sales',
      {
        preValidation: ownerOrMember,
        schema: { params: PeriodParamsSchema, response: { 200: HeldSalesSchema } },
      },
      (request) => decisions.heldSales(userOf(request), request.params.period),
    );

    app.post(
      '/payroll/sale-decisions',
      {
        preValidation: ownerOrMember,
        schema: {
          body: CreatePaySaleDecisionBodySchema,
          response: { 200: PaySaleDecisionSchema, 201: PaySaleDecisionSchema },
        },
      },
      async (request, reply) => {
        const { value, created } = await decisions.decide(actorOf(request), request.body);
        return reply.code(created ? 201 : 200).send(value);
      },
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

    return Promise.resolve();
  };
}
