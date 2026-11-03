import { z } from 'zod';

import {
  CommissionStatementIdSchema,
  InvoiceEventIdSchema,
  InvoiceIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
} from './ids';
import {
  INVOICE_DOCUMENT_MENTIONS_MAX,
  INVOICE_LINE_DETAIL_MAX,
  INVOICE_LINE_LABEL_MAX,
  InvoiceMentionSchema,
  InvoiceNumberSchema,
  InvoiceReasonSchema,
  ServiceDescriptionSchema,
  Sha256Schema,
} from './invoices-fields';
import { trimmed } from './invoices-internal';
import { BillingRegimeSchema, InvoiceAgencySchema, InvoiceContractorSchema } from './invoices-parties';
import {
  InvoiceAcceptanceStateSchema,
  InvoiceEventKindSchema,
  InvoiceKindSchema,
  InvoiceLineKindSchema,
} from './invoices-vocabulary';
import { PayPeriodSchema } from './pay-periods';
import { CalendarDaySchema } from './team-members';

/**
 * An issued invoice or credit note (EQ-06, ADR 0036): its lines, totals, regime, events, acceptance, due state,
 * settlement and payout blocks.
 */

/** The regime as an invoice copies it at its issue. */
export const InvoiceRegimeSchema = BillingRegimeSchema.omit({ createdAt: true, countries: true });
export type InvoiceRegime = z.infer<typeof InvoiceRegimeSchema>;

/** A line as the invoice prints it, excluding VAT, negative for a deduction; a credit note's lines are negative. */
export const InvoiceLineSchema = z.object({
  kind: InvoiceLineKindSchema,
  label: trimmed(INVOICE_LINE_LABEL_MAX),
  detail: trimmed(INVOICE_LINE_DETAIL_MAX).nullable(),
  amountMinor: z.number().int(),
});
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;

/** An invoice's totals, rounded once on the total; a credit note's are negative. */
export const InvoiceTotalsSchema = z.object({
  exclVatMinor: z.number().int(),
  vatMinor: z.number().int(),
  inclVatMinor: z.number().int(),
  /** Under reverse charge, the VAT the agency both owes and deducts; nothing is invoiced. */
  selfAssessedVatMinor: z.number().int(),
});
export type InvoiceTotals = z.infer<typeof InvoiceTotalsSchema>;

/**
 * Where a document stands with its contractor: its state, the end of the delay to answer (the issue plus the mandate's
 * delay, to the second), and the reason of its contest once contested (kept after the contest ends).
 */
export const InvoiceAcceptanceSchema = z.object({
  state: InvoiceAcceptanceStateSchema,
  deadline: z.iso.datetime(),
  reason: InvoiceReasonSchema.nullable(),
});
export type InvoiceAcceptance = z.infer<typeof InvoiceAcceptanceSchema>;

/**
 * An invoice or a credit note as its reader reads it, frozen at its issue. An invoice belongs to the validated
 * statement it bills, one per statement; a credit note cites the invoice it credits, and the statement that made it
 * due when a period owed it (ADR 0036).
 */
export const InvoiceSchema = z
  .object({
    id: InvoiceIdSchema,
    kind: InvoiceKindSchema,
    memberId: TeamMemberIdSchema,
    statementId: CommissionStatementIdSchema.nullable(),
    creditedInvoiceId: InvoiceIdSchema.nullable(),
    period: PayPeriodSchema,
    number: InvoiceNumberSchema,
    issuedAt: z.iso.datetime(),
    issuedOn: CalendarDaySchema,
    dueOn: CalendarDaySchema,
    contractor: InvoiceContractorSchema,
    agency: InvoiceAgencySchema,
    regime: InvoiceRegimeSchema,
    mentions: z.array(InvoiceMentionSchema).max(INVOICE_DOCUMENT_MENTIONS_MAX),
    /** An invoice's designation of the service, copied at the issue; `null` on a credit note. */
    serviceDescription: ServiceDescriptionSchema.nullable(),
    /** The agency's logo at the issue, by its fingerprint; `null` for none. */
    logoSha256: Sha256Schema.nullable(),
    lines: z.array(InvoiceLineSchema).min(1),
    totals: InvoiceTotalsSchema,
    acceptance: InvoiceAcceptanceSchema,
    pdfSha256: Sha256Schema.nullable(),
  })
  .refine(
    (invoice) =>
      invoice.kind === 'invoice'
        ? invoice.statementId !== null &&
          invoice.creditedInvoiceId === null &&
          invoice.totals.exclVatMinor > 0
        : invoice.creditedInvoiceId !== null && invoice.totals.exclVatMinor < 0,
    'Une facture a son relevé et un total positif ; un avoir cite sa facture, avec un total négatif',
  );
export type Invoice = z.infer<typeof InvoiceSchema>;

/** A dated step of an invoice: who made it (`null` for a job), its reason, and the statement that settled it (`paid`, `imputed`, `compensated`). */
export const InvoiceEventSchema = z.object({
  id: InvoiceEventIdSchema,
  invoiceId: InvoiceIdSchema,
  kind: InvoiceEventKindSchema,
  reason: InvoiceReasonSchema.nullable(),
  statementId: CommissionStatementIdSchema.nullable(),
  by: UserIdSchema.nullable(),
  at: z.iso.datetime(),
});
export type InvoiceEvent = z.infer<typeof InvoiceEventSchema>;

/** How a document's debt ended (EQ-06 lot 7a): the last three steps of `INVOICE_EVENT_KINDS`. */
export const INVOICE_SETTLEMENT_KINDS = ['paid', 'imputed', 'compensated'] as const;
export const InvoiceSettlementKindSchema = z.enum(INVOICE_SETTLEMENT_KINDS);
export type InvoiceSettlementKind = z.infer<typeof InvoiceSettlementKindSchema>;

/**
 * A document's settlement as a list reads it: how its debt ended, the statement that ended it, and the day, the
 * statement's transfer for `paid` and `imputed` (the day the owner recorded the money as sent), the agency's calendar
 * day of the step for `compensated`, where nothing is sent.
 */
export const InvoiceSettlementSchema = z.object({
  kind: InvoiceSettlementKindSchema,
  statementId: CommissionStatementIdSchema,
  on: CalendarDaySchema,
});
export type InvoiceSettlement = z.infer<typeof InvoiceSettlementSchema>;

/**
 * Why the transfer of a validated statement cannot be recorded (ADR 0041). The documents it pays are not all issued
 * (`documents_not_issued`): the invoices less the credit notes of the statement and of those carried into it do not
 * come to what it pays yet, and paying without an invoice is ruled out. Or, under a tax treaty that sets the 182 B
 * withholding aside, the contractor's tax residence certificate of the transfer's calendar year is missing or refused
 * (`tax_residence_missing`), or filed and not checked by the owner yet (`tax_residence_unverified`). The agency never
 * withholds 25 %: it does not pay.
 */
export const PAYOUT_BLOCK_REASONS = [
  'documents_not_issued',
  'tax_residence_missing',
  'tax_residence_unverified',
] as const;
export const PayoutBlockReasonSchema = z.enum(PAYOUT_BLOCK_REASONS);
export type PayoutBlockReason = z.infer<typeof PayoutBlockReasonSchema>;

/**
 * A transfer that waits (ADR 0041 § 4): why, and for a certificate the calendar year it must cover (`null` for the
 * documents).
 */
export const PayoutBlockSchema = z
  .object({
    reason: PayoutBlockReasonSchema,
    year: z
      .string()
      .regex(/^\d{4}$/u)
      .nullable(),
  })
  .refine((block) => (block.year === null) === (block.reason === 'documents_not_issued'), {
    message: 'Une année pour une attestation, aucune pour les documents',
    path: ['year'],
  });
export type PayoutBlock = z.infer<typeof PayoutBlockSchema>;

/** An invoice not settled turns `soon` this many days before its due date, the day its alert goes (EQ-06 lot 8). */
export const INVOICE_DUE_SOON_DAYS = 7;

/**
 * Where a document stands with its due date (EQ-06 lot 8), computed by the server on the agency's calendar day, never
 * by a screen: `settled` once its debt ended (`InvoiceSettlementSchema`); else, for an invoice (a corrective one
 * included), `overdue` from the day after its due date, `soon` from `INVOICE_DUE_SOON_DAYS` days before it, `open`
 * before. A credit note is never `soon` nor `overdue`: it carries no payment terms, the contractor's debt is taken off
 * a payout (ADR 0036), so it stays `open` until then.
 */
export const INVOICE_DUE_STATES = ['open', 'soon', 'overdue', 'settled'] as const;
export const InvoiceDueStateSchema = z.enum(INVOICE_DUE_STATES);
export type InvoiceDueState = z.infer<typeof InvoiceDueStateSchema>;
