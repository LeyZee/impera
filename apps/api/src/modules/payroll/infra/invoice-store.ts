import {
  AuditEntryIdSchema,
  BonusTierSchema,
  CommissionStatementRulesSchema,
  CommissionStatementStatusSchema,
  calendarDayAt,
  ContractorDocumentKindSchema,
  EventIdSchema,
  EVENT_PAYLOADS,
  InvoiceAgencySchema,
  InvoiceContractorSchema,
  InvoiceEventIdSchema,
  InvoiceIdSchema,
  InvoiceLineKindSchema,
  InvoiceRegimeSchema,
  newId,
  PaymentTermsSchema,
  PayPeriodSchema,
  type CommissionStatementId,
  type InvoiceRegime,
} from '@nirvana/contracts';
import { and, eq, inArray, schema, sql, withAdmin, type Database, type Transaction } from '@nirvana/db';
import { z } from 'zod';

import type { IssueWarning } from '../domain/billing';
import type { InvoiceSource } from '../domain/invoices';
import type { DocumentNotIssued, DocumentToIssue, InvoicingFacts, StoredInvoice } from '../domain/invoicing';
import type { PayrollInvoiceStore } from '../domain/ports';

import { CountedSchema } from './read-store';
import type { PayInputReads } from './snapshot';

const {
  auditLog,
  billingRegimes,
  billingRegimeValidations,
  billingSettings,
  commissionStatementLines,
  commissionStatements,
  contractAcceptances,
  contractorDocuments,
  contractorProfiles,
  contractorRegimes,
  contractTexts,
  domainEvents,
  invoiceCounters,
  invoiceEvents,
  invoiceLines,
  invoices,
  platformAccounts,
  teamMembers,
} = schema;

type Statement = typeof commissionStatements.$inferSelect;

/** What an invoice's credit notes took off, summed by Postgres as a `bigint` text: a whole amount, never negative. */
const CreditedSchema = z.coerce.number().int().nonnegative();

/**
 * What the invoice reads of a validated statement (`InvoiceSource`): its lines summed per account (an invoice bills a
 * commission per account, whatever the currencies), the entries it counted with their reasons, the names of its
 * accounts, and the period each adjustment corrects, that of the statement it cites.
 */
async function sourceOf(tx: Transaction, statement: Statement): Promise<InvoiceSource> {
  const rows = await tx
    .select({
      platformAccountId: commissionStatementLines.platformAccountId,
      netMinor: commissionStatementLines.netMinor,
      commissionMinor: commissionStatementLines.commissionMinor,
    })
    .from(commissionStatementLines)
    .where(
      and(
        eq(commissionStatementLines.statementId, statement.id),
        eq(commissionStatementLines.revision, statement.revision),
      ),
    )
    .orderBy(commissionStatementLines.platformAccountId);
  const perAccount = new Map<string, { netMinor: number; commissionMinor: number }>();
  for (const row of rows) {
    const one = perAccount.get(row.platformAccountId) ?? { netMinor: 0, commissionMinor: 0 };
    perAccount.set(row.platformAccountId, {
      netMinor: one.netMinor + row.netMinor,
      commissionMinor: one.commissionMinor + row.commissionMinor,
    });
  }
  const accountIds = [...perAccount.keys()];
  const accounts =
    accountIds.length === 0
      ? []
      : await tx
          .select({
            id: platformAccounts.id,
            handle: platformAccounts.handle,
            platform: platformAccounts.platform,
          })
          .from(platformAccounts)
          .where(inArray(platformAccounts.id, accountIds));
  const counted = CountedSchema.parse(statement.counted);
  const corrected = counted.adjustments.flatMap((one) =>
    one.correctsStatementId === null ? [] : [one.correctsStatementId],
  );
  const correctedPeriods =
    corrected.length === 0
      ? []
      : await tx
          .select({ id: commissionStatements.id, period: commissionStatements.period })
          .from(commissionStatements)
          .where(inArray(commissionStatements.id, corrected));
  const periodOf = new Map(correctedPeriods.map((row) => [row.id, PayPeriodSchema.parse(row.period)]));
  const rules = CommissionStatementRulesSchema.parse(statement.rules);
  const tier = BonusTierSchema.nullable().parse(statement.tierBonus);
  return {
    period: PayPeriodSchema.parse(statement.period),
    statement: {
      lines: [...perAccount.entries()].map(([platformAccountId, one]) => ({ platformAccountId, ...one })),
      netMinor: statement.netMinor,
      commissionRateBps: rules.commissionRateBps,
      teamShare:
        statement.teamShareBps === null ||
        statement.teamShareMinor === null ||
        statement.teamShareBaseMinor === null
          ? null
          : {
              baseNetMinor: statement.teamShareBaseMinor,
              bps: statement.teamShareBps,
              amountMinor: statement.teamShareMinor,
            },
      tierBonus: tier === null ? null : { thresholdMinor: tier.thresholdMinor, bonusMinor: tier.bonusMinor },
      collectiveBonusMinor: statement.collectiveBonusMinor,
      manualBonusesMinor: statement.bonusesMinor,
      penaltiesRequestedMinor: statement.penaltiesRequestedMinor,
      penaltiesMinor: statement.penaltiesMinor,
      carryOversInMinor: statement.carryOversInMinor,
      adjustmentsMinor: statement.adjustmentsMinor,
      totalMinor: statement.totalMinor,
    },
    accounts: new Map(accounts.map((row) => [row.id, { handle: row.handle, platform: row.platform }])),
    bonuses: counted.bonuses.map((one) => ({ amountMinor: one.amountMinor, reason: one.reason })),
    penalties: counted.penalties.map((one) => ({ reason: one.reason, ...one.amount })),
    adjustments: counted.adjustments.map((one) => ({
      amountMinor: one.amountMinor,
      reason: one.reason,
      correctsPeriod:
        one.correctsStatementId === null ? null : (periodOf.get(one.correctsStatementId) ?? null),
    })),
  };
}

/** The contractor's issued invoices, with their lines and what their credit notes took off (a positive amount). */
async function invoicesOf(tx: Transaction, memberId: string): Promise<StoredInvoice[]> {
  const rows = await tx
    .select({
      id: invoices.id,
      number: invoices.number,
      period: invoices.period,
      issuedOn: invoices.issuedOn,
      exclVatMinor: invoices.exclVatMinor,
      regime: invoices.regime,
      creditedMinor: sql<string>`coalesce((
        select -sum(n.excl_vat_minor) from invoices n
        where n.credited_invoice_id = ${invoices.id} and n.kind = 'credit_note'
      ), 0)::text`,
    })
    .from(invoices)
    .where(and(eq(invoices.memberId, memberId), eq(invoices.kind, 'invoice')));
  const lines =
    rows.length === 0
      ? []
      : await tx
          .select()
          .from(invoiceLines)
          .where(
            inArray(
              invoiceLines.invoiceId,
              rows.map((row) => row.id),
            ),
          )
          .orderBy(invoiceLines.invoiceId, invoiceLines.position);
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    period: PayPeriodSchema.parse(row.period),
    issuedOn: row.issuedOn,
    exclVatMinor: row.exclVatMinor,
    creditedMinor: CreditedSchema.parse(row.creditedMinor),
    regime: InvoiceRegimeSchema.parse(row.regime),
    lines: lines
      .filter((line) => line.invoiceId === row.id)
      .map((line) => ({
        kind: InvoiceLineKindSchema.parse(line.kind),
        label: line.label,
        detail: line.detail,
        amountMinor: line.amountMinor,
      })),
  }));
}

/** The regimes as an invoice copies them, each with the day the accountant validated it, `null` for not yet. */
async function regimesOf(tx: Transaction): Promise<InvoiceRegime[]> {
  const rows = await tx
    .select({ regime: billingRegimes, validatedOn: billingRegimeValidations.validatedOn })
    .from(billingRegimes)
    .leftJoin(billingRegimeValidations, eq(billingRegimeValidations.regimeId, billingRegimes.id));
  return rows.map(({ regime, validatedOn }) =>
    InvoiceRegimeSchema.parse({
      id: regime.id,
      name: regime.name,
      vat:
        regime.vatTreatment === 'charged'
          ? { treatment: 'charged', rateBps: regime.vatRateBps }
          : regime.vatTreatment === 'reverse_charge'
            ? { treatment: 'reverse_charge', rateBps: regime.vatRateBps }
            : { treatment: 'exempt' },
      withholding: regime.withholding,
      mentions: regime.mentions,
      documents: regime.documents,
      taxIdRequired: regime.taxIdRequired,
      validatedOn,
    }),
  );
}

/** Everything the plan reads of the contractor, the agency and the statement, in the job's transaction. */
async function factsOf(
  tx: Transaction,
  statement: Statement,
  issuedAt: Date,
  timeZone: string,
): Promise<InvoicingFacts> {
  const memberId = statement.memberId;
  const [current] = await tx
    .select({ version: sql<number | null>`max(${contractTexts.version})` })
    .from(contractTexts)
    .where(eq(contractTexts.kind, 'billing_mandate'));
  const [accepted] = await tx
    .select({ version: contractTexts.version, contestDelayDays: contractTexts.contestDelayDays })
    .from(contractAcceptances)
    .innerJoin(contractTexts, eq(contractTexts.id, contractAcceptances.textId))
    .where(and(eq(contractAcceptances.memberId, memberId), eq(contractTexts.kind, 'billing_mandate')))
    .orderBy(sql`${contractTexts.version} desc`)
    .limit(1);
  const assignments = await tx
    .select({ regimeId: contractorRegimes.regimeId, from: contractorRegimes.effectiveFrom })
    .from(contractorRegimes)
    .where(eq(contractorRegimes.memberId, memberId));
  const [profile] = await tx
    .select({ profile: contractorProfiles, country: teamMembers.country })
    .from(contractorProfiles)
    .innerJoin(teamMembers, eq(teamMembers.id, contractorProfiles.memberId))
    .where(eq(contractorProfiles.memberId, memberId));
  const documents = await tx
    .select({
      kind: contractorDocuments.kind,
      issuedOn: contractorDocuments.issuedOn,
      validUntil: contractorDocuments.validUntil,
    })
    .from(contractorDocuments)
    .where(eq(contractorDocuments.memberId, memberId));
  const [settings] = await tx.select().from(billingSettings).where(eq(billingSettings.id, 1));
  const keys = await tx
    .select({ key: invoices.idempotencyKey })
    .from(invoices)
    .where(
      sql`${invoices.idempotencyKey} = ${`invoice:${statement.id}`} or ${invoices.idempotencyKey} like ${`credit:${statement.id}:%`}`,
    );
  return {
    statementId: statement.id,
    source: await sourceOf(tx, statement),
    issuedAt,
    issuedOn: calendarDayAt(issuedAt, timeZone),
    mandate: {
      acceptedVersion: accepted?.version ?? null,
      currentVersion: current?.version ?? 0,
      contestDelayDays: accepted?.contestDelayDays ?? null,
    },
    assignments,
    regimes: await regimesOf(tx),
    identity:
      profile === undefined
        ? null
        : {
            legalName: profile.profile.legalName,
            address: profile.profile.address,
            country: profile.country,
            taxId: profile.profile.taxId,
          },
    prefix: profile?.profile.invoicePrefix ?? null,
    documents: documents.map((one) => ({
      kind: ContractorDocumentKindSchema.parse(one.kind),
      issuedOn: one.issuedOn,
      validUntil: one.validUntil,
    })),
    settings:
      settings === undefined
        ? null
        : {
            agency: InvoiceAgencySchema.parse(settings.agency),
            paymentTerms: PaymentTermsSchema.parse(settings.paymentTerms),
            dueDays: settings.dueDays,
          },
    invoices: await invoicesOf(tx, memberId),
    issuedKeys: new Set(keys.map((row) => row.key)),
  };
}

/**
 * Numbers `document` on the contractor's counter, locked `FOR UPDATE` and moved by one in this transaction (ADR 0023:
 * never a Postgres sequence, a rollback leaves no hole), then writes it with its lines and its event `issued`.
 */
async function writeDocument(
  tx: Transaction,
  statement: Statement,
  prefix: string,
  issuedAt: Date,
  document: DocumentToIssue,
  warnings: readonly IssueWarning[],
): Promise<string> {
  const year = Number(document.issuedOn.slice(0, 4));
  const counterOf = and(eq(invoiceCounters.memberId, statement.memberId), eq(invoiceCounters.year, year));
  const [counter] = await tx.select().from(invoiceCounters).where(counterOf).for('update');
  const sequence = (counter?.lastSequence ?? 0) + 1;
  if (counter === undefined) {
    await tx.insert(invoiceCounters).values({ memberId: statement.memberId, year, lastSequence: sequence });
  } else {
    await tx.update(invoiceCounters).set({ lastSequence: sequence }).where(counterOf);
  }
  const number = `${prefix}-${String(year)}-${String(sequence).padStart(4, '0')}`;
  const id = newId(InvoiceIdSchema);
  await tx.insert(invoices).values({
    id,
    kind: document.kind,
    memberId: statement.memberId,
    statementId: statement.id,
    creditedInvoiceId: document.creditedInvoiceId,
    period: document.period,
    prefix,
    year,
    sequence,
    number,
    idempotencyKey: document.key,
    issuedAt,
    issuedOn: document.issuedOn,
    issuedBy: null,
    dueOn: document.dueOn,
    contractor: InvoiceContractorSchema.parse(document.contractor),
    agency: InvoiceAgencySchema.parse(document.agency),
    regimeId: document.regime.id,
    regime: InvoiceRegimeSchema.parse(document.regime),
    mentions: [...document.mentions],
    exclVatMinor: document.totals.exclVatMinor,
    vatMinor: document.totals.vatMinor,
    inclVatMinor: document.totals.inclVatMinor,
    selfAssessedVatMinor: document.totals.selfAssessedVatMinor,
    acceptanceDeadline: document.acceptanceDeadline,
  });
  await tx.insert(invoiceLines).values(
    document.lines.map((line, index) => ({
      invoiceId: id,
      position: index + 1,
      kind: line.kind,
      label: line.label,
      detail: line.detail,
      amountMinor: line.amountMinor,
    })),
  );
  await tx
    .insert(invoiceEvents)
    .values({ id: newId(InvoiceEventIdSchema), invoiceId: id, kind: 'issued', by: null });
  await tx.insert(auditLog).values({
    id: newId(AuditEntryIdSchema),
    userId: null,
    action: document.kind === 'invoice' ? 'invoice.issue' : 'credit_note.issue',
    entity: 'invoice',
    entityId: id,
    details: {
      number,
      statementId: statement.id,
      key: document.key,
      ...(document.kind === 'invoice' && warnings.length > 0 ? { warnings } : {}),
    },
    ip: null,
  });
  return number;
}

/**
 * Tells the owner of each document the plan could not issue (`invoice_not_issued`, and its line of `audit_log`), once:
 * a rerun (a retry, or lot 5's enqueue once a regime is validated) republishes nothing already said for this statement,
 * document, reason and amount, and a new reason is said. Two equal refusals of one run (two credit notes of the same
 * amount without an invoice) are two alerts: what was published is counted, never only looked for. Read in the job's
 * transaction, under the contractor's lock.
 */
async function publishNotIssued(
  tx: Transaction,
  statement: Statement,
  notIssued: readonly DocumentNotIssued[],
  at: Date,
): Promise<void> {
  const said = await tx
    .select({ payload: domainEvents.payload })
    .from(domainEvents)
    .where(
      and(
        eq(domainEvents.type, 'invoice_not_issued'),
        sql`${domainEvents.payload}->>'statementId' = ${statement.id}`,
      ),
    );
  const sayOf = (one: Pick<DocumentNotIssued, 'document' | 'reason' | 'amountMinor'>): string =>
    `${one.document}:${one.reason}:${String(one.amountMinor)}`;
  const left = new Map<string, number>();
  for (const row of said) {
    const key = sayOf(EVENT_PAYLOADS.invoice_not_issued.parse(row.payload));
    left.set(key, (left.get(key) ?? 0) + 1);
  }
  for (const one of notIssued) {
    const key = sayOf(one);
    const already = left.get(key) ?? 0;
    if (already > 0) {
      left.set(key, already - 1);
      continue;
    }
    const payload = EVENT_PAYLOADS.invoice_not_issued.parse({
      memberId: statement.memberId,
      statementId: statement.id,
      period: statement.period,
      ...one,
    });
    await tx.insert(domainEvents).values({
      id: newId(EventIdSchema),
      creatorId: null,
      type: 'invoice_not_issued',
      payload,
      actor: 'system',
      correlationId: `payroll.issue_invoices:${statement.id}`,
      createdAt: at,
    });
    await tx.insert(auditLog).values({
      id: newId(AuditEntryIdSchema),
      userId: null,
      action: 'invoice.not_issued',
      entity: 'commission_statement',
      entityId: statement.id,
      details: { ...one },
      ip: null,
    });
  }
}

/**
 * `payroll.issue_invoices` as the jobs (`withAdmin`, which reads every member and creator). One transaction per
 * statement, under the contractor's advisory lock: two statements of one contractor issue one after the other, so
 * that a credit note counts the one written before it.
 */
export function createDrizzlePayrollInvoiceStore(
  adminDb: Database,
  reads: PayInputReads,
  now: () => Date,
): PayrollInvoiceStore {
  return {
    issueUnscoped: (statementId: CommissionStatementId, plan) =>
      withAdmin(adminDb, async (tx) => {
        const [found] = await tx
          .select({ memberId: commissionStatements.memberId })
          .from(commissionStatements)
          .where(eq(commissionStatements.id, statementId));
        if (found === undefined) return { kind: 'not_validated' };
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`invoices.issue:${found.memberId}`}, 0))`,
        );
        const [statement] = await tx
          .select()
          .from(commissionStatements)
          .where(eq(commissionStatements.id, statementId));
        if (statement === undefined || CommissionStatementStatusSchema.parse(statement.status) === 'draft') {
          return { kind: 'not_validated' };
        }
        const issuedAt = now();
        const facts = await factsOf(tx, statement, issuedAt, await reads.agencyTimeZone(tx));
        const planned = plan(facts);
        const issued: { kind: DocumentToIssue['kind']; number: string }[] = [];
        for (const document of planned.documents) {
          if (facts.prefix === null) throw new Error('A document to issue without its prefix');
          issued.push({
            kind: document.kind,
            number: await writeDocument(tx, statement, facts.prefix, issuedAt, document, planned.warnings),
          });
        }
        await publishNotIssued(tx, statement, planned.notIssued, issuedAt);
        return { kind: 'planned', issued, notIssued: planned.notIssued, warnings: planned.warnings };
      }),
  };
}
