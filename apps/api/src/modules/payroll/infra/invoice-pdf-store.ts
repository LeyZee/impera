import {
  AgencyLogoMediaTypeSchema,
  AuditEntryIdSchema,
  calendarDayAt,
  CommissionStatementRulesSchema,
  CurrencySchema,
  DEFAULT_FISCAL_YEAR_END_MONTH,
  EventIdSchema,
  EVENT_PAYLOADS,
  InvoiceAgencySchema,
  InvoiceContractorSchema,
  InvoiceIdSchema,
  InvoiceKindSchema,
  InvoiceLineKindSchema,
  InvoicePdfCopyProviderSchema,
  InvoiceRegimeSchema,
  newId,
  PayPeriodSchema,
  PlatformSchema,
  TeamMemberIdSchema,
  type InvoiceId,
} from '@nirvana/contracts';
import { and, eq, schema, sql, withAdmin, withMember, type Database, type Transaction } from '@nirvana/db';

import { documentValidUntil, treatyNeedsResidence } from '../domain/billing';
import type { StatementAnnexSource } from '../domain/invoice-pdf';
import type { InvoiceLogo, InvoiceToRender, PayrollInvoicePdfStore, StoredInvoicePdf } from '../domain/ports';

import { enqueueInvoicePdfMirror } from './invoice-queue';
import type { PayInputReads } from './snapshot';

const {
  agencyLogos,
  auditLog,
  billingSettings,
  commissionStatementLines,
  commissionStatements,
  contractAcceptances,
  contractorDocumentReviews,
  contractorDocuments,
  contractTexts,
  domainEvents,
  invoiceLines,
  invoicePdfCopies,
  invoicePdfs,
  invoices,
  platformAccounts,
} = schema;

/** A PDF's row and its copies, read in the caller's transaction (its policies apply). */
async function pdfOf(tx: Transaction, invoiceId: string): Promise<StoredInvoicePdf | null> {
  const [row] = await tx.select().from(invoicePdfs).where(eq(invoicePdfs.invoiceId, invoiceId));
  if (row === undefined) return null;
  const copies = await tx
    .select()
    .from(invoicePdfCopies)
    .where(eq(invoicePdfCopies.invoiceId, invoiceId))
    .orderBy(invoicePdfCopies.provider);
  return {
    key: row.storageKey,
    sha256: row.sha256,
    retainUntil: row.retainUntil,
    copies: copies.map((copy) => ({
      provider: InvoicePdfCopyProviderSchema.parse(copy.provider),
      key: copy.storageKey,
      sha256: copy.sha256,
      retainUntil: copy.retainUntil,
    })),
  };
}

/**
 * The storage keys of the tax residence certificates of `memberId` accepted by the owner and of `period`'s civil year:
 * the proof of the treaty for the service an invoice of that period bills. Every one: a rescan accepted besides the
 * first is proof as well. Since ADR 0041 the invoice no longer waits for them, and the transfer locks its own
 * (`payroll.lock_payout_certificate`); one already accepted is kept as long as the invoice too.
 */
async function certificateKeysOf(tx: Transaction, memberId: string, period: string): Promise<string[]> {
  const rows = await tx
    .select({
      key: contractorDocuments.storageKey,
      issuedOn: contractorDocuments.issuedOn,
      validUntil: contractorDocuments.validUntil,
    })
    .from(contractorDocuments)
    .innerJoin(contractorDocumentReviews, eq(contractorDocumentReviews.documentId, contractorDocuments.id))
    .where(
      and(
        eq(contractorDocuments.memberId, memberId),
        eq(contractorDocuments.kind, 'tax_residence'),
        eq(contractorDocumentReviews.decision, 'accepted'),
      ),
    )
    .orderBy(contractorDocuments.storageKey);
  return rows
    .filter((row) => documentValidUntil({ kind: 'tax_residence', ...row }).slice(0, 4) === period.slice(0, 4))
    .map((row) => row.key);
}

/**
 * The statement an invoice bills, line by line as its revision holds them, with the names of its accounts, its rate and
 * the day it was validated, in the agency's time zone.
 */
async function annexOf(
  tx: Transaction,
  statementId: string,
  timeZone: string,
): Promise<StatementAnnexSource | null> {
  const [statement] = await tx
    .select({
      revision: commissionStatements.revision,
      rules: commissionStatements.rules,
      validatedAt: commissionStatements.validatedAt,
    })
    .from(commissionStatements)
    .where(eq(commissionStatements.id, statementId));
  // An invoice is issued from a validated statement only (lot 3): anything else is a fault, never an annex guessed.
  if (statement?.validatedAt == null)
    throw new Error(`The statement ${statementId} of an invoice is not validated`);
  const rows = await tx
    .select({
      handle: platformAccounts.handle,
      platform: platformAccounts.platform,
      currency: commissionStatementLines.currency,
      rateMicros: commissionStatementLines.rateMicros,
      grossMinor: commissionStatementLines.grossMinor,
      grossEurMinor: commissionStatementLines.grossEurMinor,
      exclVatMinor: commissionStatementLines.exclVatMinor,
      netMinor: commissionStatementLines.netMinor,
      commissionMinor: commissionStatementLines.commissionMinor,
    })
    .from(commissionStatementLines)
    .innerJoin(platformAccounts, eq(platformAccounts.id, commissionStatementLines.platformAccountId))
    .where(
      and(
        eq(commissionStatementLines.statementId, statementId),
        eq(commissionStatementLines.revision, statement.revision),
      ),
    )
    .orderBy(
      platformAccounts.handle,
      platformAccounts.platform,
      commissionStatementLines.currency,
      commissionStatementLines.vatBps,
      commissionStatementLines.platformFeeBps,
    );
  const rules = CommissionStatementRulesSchema.parse(statement.rules);
  /** The day of the rate a line was converted at: the statement's copy of it, never a rate read again. */
  const rateOn = (currency: string, rateMicros: number): string | null => {
    if (currency === 'EUR') return null;
    const rate = rules.exchangeRates.find(
      (one) => one.currency === currency && one.rateMicros === rateMicros,
    );
    if (rate === undefined)
      throw new Error(`The statement ${statementId} does not hold its ${currency} rate`);
    return rate.day;
  };
  return {
    validatedOn: calendarDayAt(statement.validatedAt, timeZone),
    commissionRateBps: rules.commissionRateBps,
    accounts: rows.map((row) => ({
      ...row,
      platform: PlatformSchema.parse(row.platform),
      currency: CurrencySchema.parse(row.currency),
      rateOn: rateOn(row.currency, row.rateMicros),
    })),
  };
}

/**
 * The day the contractor accepted the billing mandate a document was issued under: the newest version they had
 * accepted at its issue. Acceptances are only ever added, so the same document always reads the same day.
 */
async function mandateAcceptedOn(
  tx: Transaction,
  memberId: string,
  issuedAt: Date,
  timeZone: string,
): Promise<string> {
  const [accepted] = await tx
    .select({ acceptedAt: contractAcceptances.acceptedAt })
    .from(contractAcceptances)
    .innerJoin(contractTexts, eq(contractTexts.id, contractAcceptances.textId))
    .where(
      and(
        eq(contractAcceptances.memberId, memberId),
        eq(contractTexts.kind, 'billing_mandate'),
        sql`${contractAcceptances.acceptedAt} <= ${issuedAt.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(sql`${contractTexts.version} desc`)
    .limit(1);
  // No document is issued without an accepted mandate (lot 3): one without is a fault, never printed without it.
  if (accepted === undefined) throw new Error(`No billing mandate accepted by ${memberId} at the issue`);
  return calendarDayAt(accepted.acceptedAt, timeZone);
}

/** The logo a document froze, by its fingerprint. */
async function logoOf(tx: Transaction, sha256: string | null): Promise<InvoiceLogo | null> {
  if (sha256 === null) return null;
  const [logo] = await tx
    .select({ mediaType: agencyLogos.mediaType, bytes: agencyLogos.bytes })
    .from(agencyLogos)
    .where(eq(agencyLogos.sha256, sha256));
  if (logo === undefined) throw new Error(`The logo ${sha256} of a document is missing`);
  return { mediaType: AgencyLogoMediaTypeSchema.parse(logo.mediaType), bytes: Uint8Array.from(logo.bytes) };
}

/** An alert's payload, and what makes it the same alert as one already published (document, place, stage). */
function alertOf(alert: Parameters<PayrollInvoicePdfStore['alertUnscoped']>[0]): {
  readonly type: 'invoice_pdf_conflict' | 'invoice_pdf_missing';
  readonly payload: Record<string, string>;
} {
  if (alert.type === 'invoice_pdf_conflict') {
    return {
      type: alert.type,
      payload: EVENT_PAYLOADS.invoice_pdf_conflict.parse({
        invoiceId: alert.invoiceId,
        memberId: alert.memberId,
        number: alert.number,
        place: alert.place,
        stage: alert.stage,
      }),
    };
  }
  return {
    type: alert.type,
    payload: EVENT_PAYLOADS.invoice_pdf_missing.parse({
      invoiceId: alert.invoiceId,
      memberId: alert.memberId,
      number: alert.number,
      place: alert.place,
    }),
  };
}

/**
 * The PDFs' rows and alerts (EQ-06 lot 4, ADR 0037): the jobs and the alerts as admin (`withAdmin`, which reads every
 * member), a download as its reader (`withMember`): the invoice's policy says whose PDF it is.
 */
export function createDrizzlePayrollInvoicePdfStore(
  db: Database,
  adminDb: Database,
  reads: Pick<PayInputReads, 'agencyTimeZone'>,
  now: () => Date,
): PayrollInvoicePdfStore {
  return {
    toRenderUnscoped: (invoiceId) =>
      withAdmin(adminDb, async (tx): Promise<InvoiceToRender | null> => {
        const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
        if (invoice === undefined) return null;
        const timeZone = await reads.agencyTimeZone(tx);
        const lines = await tx
          .select()
          .from(invoiceLines)
          .where(eq(invoiceLines.invoiceId, invoiceId))
          .orderBy(invoiceLines.position);
        const [credited] =
          invoice.creditedInvoiceId === null
            ? []
            : await tx
                .select({ number: invoices.number, issuedOn: invoices.issuedOn })
                .from(invoices)
                .where(eq(invoices.id, invoice.creditedInvoiceId));
        // The invoice a corrective invoice bills again (ADR 0040): never the cancel's, which cites it as `credited`.
        const [reissued] =
          invoice.reissuedInvoiceId === null || invoice.kind !== 'invoice'
            ? []
            : await tx
                .select({ number: invoices.number, issuedOn: invoices.issuedOn })
                .from(invoices)
                .where(eq(invoices.id, invoice.reissuedInvoiceId));
        const kind = InvoiceKindSchema.parse(invoice.kind);
        const regime = InvoiceRegimeSchema.parse(invoice.regime);
        const [settings] = await tx
          .select({ fiscalYearEndMonth: billingSettings.fiscalYearEndMonth })
          .from(billingSettings)
          .where(eq(billingSettings.id, 1));
        return {
          id: InvoiceIdSchema.parse(invoice.id),
          memberId: TeamMemberIdSchema.parse(invoice.memberId),
          number: invoice.number,
          issuedAt: invoice.issuedAt,
          issuedOn: invoice.issuedOn,
          document: {
            kind,
            number: invoice.number,
            issuedOn: invoice.issuedOn,
            dueOn: invoice.dueOn,
            period: PayPeriodSchema.parse(invoice.period),
            contractor: InvoiceContractorSchema.parse(invoice.contractor),
            agency: InvoiceAgencySchema.parse(invoice.agency),
            vat: regime.vat,
            regimeMentions: regime.mentions,
            mentions: invoice.mentions,
            serviceDescription: invoice.serviceDescription,
            mandateAcceptedOn: await mandateAcceptedOn(tx, invoice.memberId, invoice.issuedAt, timeZone),
            acceptanceDeadline: invoice.acceptanceDeadline,
            timeZone,
            lines: lines.map((line) => ({
              kind: InvoiceLineKindSchema.parse(line.kind),
              label: line.label,
              detail: line.detail,
              amountMinor: line.amountMinor,
            })),
            totals: {
              exclVatMinor: invoice.exclVatMinor,
              vatMinor: invoice.vatMinor,
              inclVatMinor: invoice.inclVatMinor,
            },
            credited: credited ?? null,
            reissued: reissued ?? null,
            // The statement an invoice bills; a corrective invoice's statement is a later one, not its period's.
            annex:
              kind === 'invoice' && invoice.statementId !== null && invoice.reissuedInvoiceId === null
                ? await annexOf(tx, invoice.statementId, timeZone)
                : null,
          },
          logo: await logoOf(tx, invoice.logoSha256),
          fiscalYearEndMonth: settings?.fiscalYearEndMonth ?? DEFAULT_FISCAL_YEAR_END_MONTH,
          // Those of an invoice under a treaty, when accepted already (ADR 0041: the invoice no longer waits for them).
          certificateKeys:
            kind === 'invoice' && treatyNeedsResidence(regime)
              ? await certificateKeysOf(tx, invoice.memberId, invoice.period)
              : [],
          pdf: await pdfOf(tx, invoiceId),
        };
      }),

    recordPdfUnscoped: (invoiceId, pdf) =>
      withAdmin(adminDb, async (tx) => {
        const [written] = await tx
          .insert(invoicePdfs)
          .values({
            invoiceId,
            storageKey: pdf.key,
            sha256: pdf.sha256,
            retainUntil: pdf.retainUntil,
            createdAt: now(),
          })
          .onConflictDoNothing({ target: invoicePdfs.invoiceId })
          .returning({ invoiceId: invoicePdfs.invoiceId });
        // A row already there was written, with its copy's job, by the run before: nothing more to do.
        if (written === undefined) return;
        await enqueueInvoicePdfMirror(tx, invoiceId);
        await tx.insert(auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: null,
          action: 'invoice.pdf_store',
          entity: 'invoice',
          entityId: invoiceId,
          details: { key: pdf.key, sha256: pdf.sha256, retainUntil: pdf.retainUntil.toISOString() },
          ip: null,
        });
      }),

    recordCopyUnscoped: (invoiceId, provider, copy) =>
      withAdmin(adminDb, async (tx) => {
        const [written] = await tx
          .insert(invoicePdfCopies)
          .values({
            invoiceId,
            provider,
            storageKey: copy.key,
            sha256: copy.sha256,
            retainUntil: copy.retainUntil,
            createdAt: now(),
          })
          .onConflictDoNothing({ target: [invoicePdfCopies.invoiceId, invoicePdfCopies.provider] })
          .returning({ invoiceId: invoicePdfCopies.invoiceId });
        if (written === undefined) return;
        await tx.insert(auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: null,
          action: 'invoice.pdf_copy',
          entity: 'invoice',
          entityId: invoiceId,
          details: { provider, key: copy.key, sha256: copy.sha256 },
          ip: null,
        });
      }),

    alertUnscoped: (alert) =>
      withAdmin(adminDb, async (tx) => {
        const { type, payload } = alertOf(alert);
        // One alert per document, place and stage, even from two runs at once.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`invoices.pdf_alert:${alert.invoiceId}`}, 0))`,
        );
        const [said] = await tx
          .select({ id: domainEvents.id })
          .from(domainEvents)
          .where(
            and(
              eq(domainEvents.type, type),
              sql`${domainEvents.payload}->>'invoiceId' = ${alert.invoiceId}`,
              sql`${domainEvents.payload}->>'place' = ${alert.place}`,
              alert.type === 'invoice_pdf_conflict'
                ? sql`${domainEvents.payload}->>'stage' = ${alert.stage}`
                : sql`true`,
            ),
          )
          .limit(1);
        if (said !== undefined) return 'already';
        const at = now();
        await tx.insert(domainEvents).values({
          id: newId(EventIdSchema),
          creatorId: null,
          type,
          payload,
          actor: 'system',
          correlationId: `invoice_pdf:${alert.invoiceId}`,
          createdAt: at,
        });
        await tx.insert(auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: null,
          action: type === 'invoice_pdf_conflict' ? 'invoice.pdf_conflict' : 'invoice.pdf_missing',
          entity: 'invoice',
          entityId: alert.invoiceId,
          details: payload,
          ip: null,
        });
        return 'published';
      }),

    pdfFor: (userId, invoiceId: InvoiceId) =>
      withMember(db, userId, async (tx) => {
        const [invoice] = await tx
          .select({ memberId: invoices.memberId, number: invoices.number })
          .from(invoices)
          .where(eq(invoices.id, invoiceId));
        if (invoice === undefined) return null;
        return {
          memberId: TeamMemberIdSchema.parse(invoice.memberId),
          number: invoice.number,
          pdf: await pdfOf(tx, invoiceId),
        };
      }),
  };
}
