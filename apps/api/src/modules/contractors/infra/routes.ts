import {
  AcceptContractTextBodySchema,
  AgencyLogoParamsSchema,
  AgencyLogoSchema,
  AssignContractorRegimeBodySchema,
  BillingRegimeParamsSchema,
  BillingRegimeSchema,
  BillingRegimesSchema,
  BillingSettingsViewSchema,
  ContractAcceptanceSchema,
  ContractorDocumentParamsSchema,
  ContractorDocumentReviewSchema,
  ContractorDocumentSchema,
  ContractorDocumentsQuerySchema,
  ContractorFileSchema,
  ContractorParamsSchema,
  ContractorProfileBodySchema,
  ContractorRegimeSchema,
  ContractTextParamsSchema,
  ContractTextSchema,
  ContractTextsSchema,
  CreateBillingRegimeBodySchema,
  CreateContractTextBodySchema,
  DomainError,
  InvoicePrefixBodySchema,
  JournalAccountsSchema,
  UpdateBillingSettingsBodySchema,
  UploadContractorDocumentQuerySchema,
  PendingContractorDocumentsSchema,
  UserIdSchema,
  ValidateBillingRegimeBodySchema,
  VerifyContractorProfileBodySchema,
  type UserId,
  type UserRole,
} from '@nirvana/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { PayrollBillingSettings } from '../application/billing-settings';
import type { ContractorDocuments } from '../application/contractor-documents';
import type { Actor, PayrollContractorStore, PayrollRegimeStore } from '../domain/ports';

/** The composition root's `requireRole`: 401 without a session, 403 with another role; sets `request.user`. */
export type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

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
 * A contractor's document arrives as its bytes too (`content-type: application/octet-stream`), what it is read from
 * them. Up to 12 MB, so that a file over 10 MB gets its reason (`too_heavy`) instead of a bare 413.
 */
const DOCUMENT_BODY_LIMIT_BYTES = 12 * 1_048_576;

/**
 * The contractors' file under `/v1/payroll` (EQ-06, ADR 0047 § 1): the paths did not move with the module. Réglages ›
 * Facturation (`/payroll/billing-settings`), its accounts (`…/accounts`, lot 7b) and the agency's logo are the owner's
 * alone. A contractor's file (`/payroll/contractors/:memberId/…`) is written by himself or the owner, checked and
 * prefixed by the owner only; the contract's and the mandate's versions (`/payroll/contract-texts`) are added by the
 * owner and accepted by the contractor himself (EQ-06 lot 5a). The billing regimes (`/payroll/billing-regimes`) are read
 * by any member; the owner alone adds one, records its validation by the accountant and gives a contractor his regime
 * from a day on (`…/contractors/:memberId/regimes`, lot 5b). A contractor's documents
 * (`…/contractors/:memberId/documents`, lot 5c) are filed by himself or the owner, read by them and an active manager,
 * and checked once by the owner, never on his own file; the documents waiting for that check
 * (`…/contractors/documents?review=pending`, lot 8) are listed to the owner alone. What each one reads and writes is
 * the database's call (`withMember`).
 */
export function createContractorRoutes(
  billing: PayrollBillingSettings,
  contractors: PayrollContractorStore,
  regimes: PayrollRegimeStore,
  documents: ContractorDocuments,
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
    app.addContentTypeParser(
      'application/octet-stream',
      { parseAs: 'buffer', bodyLimit: DOCUMENT_BODY_LIMIT_BYTES },
      (_request, body, done) => {
        done(null, body);
      },
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

    app.put(
      '/payroll/billing-settings/accounts',
      {
        preValidation: owner,
        schema: { body: JournalAccountsSchema, response: { 200: BillingSettingsViewSchema } },
      },
      (request) => billing.updateAccounts(actorOf(request), request.body),
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

    app.get(
      '/payroll/contractors/documents',
      {
        preValidation: owner,
        schema: {
          querystring: ContractorDocumentsQuerySchema,
          response: { 200: PendingContractorDocumentsSchema },
        },
      },
      (request) => documents.pending(userOf(request)),
    );

    app.post(
      '/payroll/contractors/:memberId/documents',
      {
        preValidation: ownerOrMember,
        schema: {
          params: ContractorParamsSchema,
          querystring: UploadContractorDocumentQuerySchema,
          response: { 200: ContractorDocumentSchema, 201: ContractorDocumentSchema },
        },
      },
      async (request, reply) => {
        // Anything but the bytes of a file (JSON, a form) is not a document's file.
        const bytes = Buffer.isBuffer(request.body) ? new Uint8Array(request.body) : new Uint8Array();
        const { document, created } = await documents.upload(
          actorOf(request),
          request.params.memberId,
          request.query,
          bytes,
        );
        return reply.code(created ? 201 : 200).send(document);
      },
    );

    // A file, never JSON: kept out of every cache, its type the one read at its upload, never guessed by the browser.
    app.get(
      '/payroll/contractors/:memberId/documents/:documentId/file',
      { preValidation: ownerOrMember, schema: { params: ContractorDocumentParamsSchema } },
      async (request, reply) => {
        const file = await documents.download(
          userOf(request),
          request.params.memberId,
          request.params.documentId,
          request.log,
        );
        return reply
          .header('content-type', file.mediaType)
          .header('content-disposition', `attachment; filename="${file.fileName}"`)
          .header('cache-control', 'private, no-store')
          .header('x-content-type-options', 'nosniff')
          .header('content-security-policy', "default-src 'none'; sandbox")
          .send(Buffer.from(file.bytes));
      },
    );

    app.post(
      '/payroll/contractors/:memberId/documents/:documentId/review',
      {
        preValidation: owner,
        schema: {
          params: ContractorDocumentParamsSchema,
          body: ContractorDocumentReviewSchema,
          response: { 200: ContractorDocumentSchema, 201: ContractorDocumentSchema },
        },
      },
      async (request, reply) => {
        const { document, created } = await documents.review(
          actorOf(request),
          request.params.memberId,
          request.params.documentId,
          request.body,
          request.log,
        );
        return reply.code(created ? 201 : 200).send(document);
      },
    );
    return Promise.resolve();
  };
}
