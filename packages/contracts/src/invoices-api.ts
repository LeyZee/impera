import { z } from 'zod';

import { CommissionStatementIdSchema, InvoiceIdSchema, TeamMemberIdSchema } from './ids';
import {
  INVOICE_DUE_STATES,
  InvoiceAcceptanceSchema,
  InvoiceDueStateSchema,
  InvoiceEventSchema,
  InvoiceSettlementSchema,
} from './invoices-documents';
import { InvoiceNumberSchema, InvoiceReasonSchema } from './invoices-fields';
import { dayNumber } from './invoices-internal';
import { INVOICE_ACCEPTANCE_STATES, InvoiceKindSchema } from './invoices-vocabulary';
import { PAY_AMOUNT_MAX_MINOR } from './money';
import { PayPeriodSchema } from './pay-periods';
import { CalendarDaySchema } from './team-members';

/**
 * The invoices through the routes (EQ-06): params, the contest bodies, the acceptance view and the list.
 */

/**
 * An invoice or a credit note in a path, for whoever reads it (the contractor, the owner, an active manager):
 *
 * - `GET /v1/payroll/invoices/:invoiceId/pdf` (EQ-06 lot 4, ADR 0037 § 7): its PDF, as `application/pdf` named after
 *   its number. Only ever a file whose SHA-256 is the one recorded at its render; `invoice_pdf_not_found` while it is
 *   being rendered, `invoice_pdf_unavailable` when neither bucket gives it intact, `invoice_pdf_gone` when a
 *   development server's stores in memory lost it with a restart.
 * - `GET /v1/payroll/invoices/:invoiceId/acceptance` (lot 6) → `InvoiceAcceptanceViewSchema`.
 * - `POST /v1/payroll/invoices/:invoiceId/accept` (lot 6, the contractor alone, ADR 0039 § 1) → the view, 200; the
 *   same answer sent again gives the view back.
 * - `POST /v1/payroll/invoices/:invoiceId/contest` (the contractor alone), body `ContestInvoiceBodySchema` → the view;
 *   the same reason sent again gives it back. The owner is told (`invoice_contested`).
 * - `POST /v1/payroll/invoices/:invoiceId/contest/refuse` (the owner alone, ADR 0039 § 3), body
 *   `RefuseInvoiceContestBodySchema` → the view; the same reason sent again gives it back.
 * - `POST /v1/payroll/invoices/:invoiceId/contest/uphold` (the owner alone, ADR 0039 § 3 to 5), body
 *   `UpholdInvoiceContestBodySchema` → the view; the contest ends upheld and its correction is written in the same
 *   transaction, as adjustments of the member's first open period that correct the document's period. The same
 *   reason and correction sent again give the view back.
 *
 * `invoice_not_found` (unknown, or not the reader's), `invoice_answer_forbidden` (another's document to answer),
 * `payroll_forbidden` (an end of a contest by anyone but the owner), `invoice_acceptance_conflict` (a step its state
 * or its delay no longer allows, or another answer than the one recorded), `credit_note_amount_unprocessable` (a
 * correction in the agency's favour above what the invoice has left), `invoice_correction_unprocessable` (a cancel
 * and reissue of a credit note, or of an invoice its credit notes took off whole).
 */
export const InvoiceParamsSchema = z.object({ invoiceId: InvoiceIdSchema });

/** « Je conteste » : the contractor's reason. */
export const ContestInvoiceBodySchema = z.object({ reason: InvoiceReasonSchema });
export type ContestInvoiceBody = z.infer<typeof ContestInvoiceBodySchema>;

/** The owner refuses a contest, with the reason the contractor reads. */
export const RefuseInvoiceContestBodySchema = z.object({ reason: InvoiceReasonSchema });
export type RefuseInvoiceContestBody = z.infer<typeof RefuseInvoiceContestBodySchema>;

/**
 * What corrects a contest the owner upholds (ADR 0039 § 3), always through pay, never a credit note written by hand:
 *
 * - `amount`: one adjustment, excluding VAT. In the contractor's favour (a sum too low), a line of their next invoice
 *   with the period it corrects; in the agency's (a sum too high), a credit note on the document's invoice at the next
 *   validation (ADR 0036).
 * - `reissue` (« Annuler et refacturer »), an error of text on an invoice (a name, an address, an identifier, a
 *   mention): two adjustments of what is left of it, in the same period. The negative one cancels it by a credit note,
 *   the positive one is a line of that period's invoice, which prints the corrected file; the payouts do not move, and
 *   the credit note never leaves without that invoice.
 */
export const ContestCorrectionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('amount'),
    amountMinor: z
      .number()
      .int()
      .min(-PAY_AMOUNT_MAX_MINOR)
      .max(PAY_AMOUNT_MAX_MINOR)
      .refine((amount) => amount !== 0, 'Un montant de 0 ne corrige rien'),
  }),
  z.object({ kind: z.literal('reissue') }),
]);
export type ContestCorrection = z.infer<typeof ContestCorrectionSchema>;

/** The owner upholds a contest: the reason the contractor reads, and its correction in the same action. */
export const UpholdInvoiceContestBodySchema = z.object({
  reason: InvoiceReasonSchema,
  correction: ContestCorrectionSchema,
});
export type UpholdInvoiceContestBody = z.infer<typeof UpholdInvoiceContestBodySchema>;

/** A document's acceptance as its reader reads it: its state and each dated step, in order (`issued` first). */
export const InvoiceAcceptanceViewSchema = z.object({
  invoiceId: InvoiceIdSchema,
  kind: InvoiceKindSchema,
  memberId: TeamMemberIdSchema,
  number: InvoiceNumberSchema,
  acceptance: InvoiceAcceptanceSchema,
  events: z.array(InvoiceEventSchema).min(1),
});
export type InvoiceAcceptanceView = z.infer<typeof InvoiceAcceptanceViewSchema>;

/** Days of issue a list covers at most, both ends included (`from` and `to` of `InvoiceListQuerySchema`). */
export const INVOICE_LIST_MAX_DAYS = 366;

/** A comma-separated list of a query string (`due=soon,overdue`), each value once and known. */
const listOf = <const T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((text) => text.split(','))
    .pipe(
      z
        .array(z.enum(values))
        .min(1)
        .refine((items) => new Set(items).size === items.length, { message: 'Une valeur une seule fois' }),
    );

/**
 * `GET /v1/payroll/invoices` (EQ-06 lot 8): the documents a reader reads (the policy of `invoices`: every one for the
 * owner and an active manager, one's own for anyone else), filtered. Every filter is optional and they add up, but a
 * list is always bounded without pages: the query gives a quinzaine (`period`, the documents of its statements), or a
 * range of days of issue (`from` and `to`, `INVOICE_LIST_MAX_DAYS` at most), or a filter that keeps only documents
 * still waiting, which are few by nature: `due` without `settled` (a document not settled is 60 days old at most,
 * unless its payout is blocked), or `acceptance` among `pending` and `contested` (an answer is due within the
 * mandate's delay). Anything else is a 400.
 */
export const InvoiceListQuerySchema = z
  .object({
    memberId: TeamMemberIdSchema.optional(),
    period: PayPeriodSchema.optional(),
    from: CalendarDaySchema.optional(),
    to: CalendarDaySchema.optional(),
    due: listOf(INVOICE_DUE_STATES).optional(),
    acceptance: listOf(INVOICE_ACCEPTANCE_STATES).optional(),
  })
  .refine((query) => (query.from === undefined) === (query.to === undefined), {
    message: 'Le début et la fin, ensemble',
    path: ['to'],
  })
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    message: 'La fin suit le début',
    path: ['to'],
  })
  .refine(
    (query) =>
      query.from === undefined ||
      query.to === undefined ||
      dayNumber(query.to) - dayNumber(query.from) < INVOICE_LIST_MAX_DAYS,
    { message: 'Un an au plus', path: ['to'] },
  )
  .refine(
    (query) =>
      query.period !== undefined ||
      query.from !== undefined ||
      (query.due !== undefined && !query.due.includes('settled')) ||
      (query.acceptance?.every((state) => state === 'pending' || state === 'contested') ?? false),
    {
      message:
        'Une quinzaine, une période, ou un filtre sur les documents encore en attente : la liste reste bornée',
      path: ['period'],
    },
  );
export type InvoiceListQuery = z.infer<typeof InvoiceListQuerySchema>;

/**
 * A document of the list: what its screens show without recomputing a rule. `corrective` marks the invoice that bills
 * again a cancelled one (ADR 0040); `creditedInvoiceId` the invoice a credit note cites; `statementId` the statement it
 * was issued for (`null` on a credit note no validation issued), and `statementPeriod` that statement's quinzaine, where
 * the document leads (`Voir le relevé`): for an invoice its own `period`, for a credit note or a corrective invoice the
 * later quinzaine that owed it, whereas `period` is the one it corrects and prints. `pdfReady` says its PDF is rendered,
 * to download.
 */
export const InvoiceListItemSchema = z.object({
  id: InvoiceIdSchema,
  kind: InvoiceKindSchema,
  corrective: z.boolean(),
  memberId: TeamMemberIdSchema,
  number: InvoiceNumberSchema,
  period: PayPeriodSchema,
  statementId: CommissionStatementIdSchema.nullable(),
  statementPeriod: PayPeriodSchema.nullable(),
  creditedInvoiceId: InvoiceIdSchema.nullable(),
  issuedOn: CalendarDaySchema,
  dueOn: CalendarDaySchema,
  exclVatMinor: z.number().int(),
  vatMinor: z.number().int(),
  inclVatMinor: z.number().int(),
  acceptance: InvoiceAcceptanceSchema,
  settlement: InvoiceSettlementSchema.nullable(),
  due: InvoiceDueStateSchema,
  pdfReady: z.boolean(),
});
export type InvoiceListItem = z.infer<typeof InvoiceListItemSchema>;

/** The list, the latest issued first (day of issue, then number), and the agency's day its `due` was computed on. */
export const InvoiceListSchema = z.object({
  today: CalendarDaySchema,
  documents: z.array(InvoiceListItemSchema),
});
export type InvoiceList = z.infer<typeof InvoiceListSchema>;
