import {
  calendarDayAt,
  CommissionStatementStatusSchema,
  InvoiceContractorSchema,
  InvoiceIdSchema,
  InvoicePdfCopyProviderSchema,
  InvoiceRegimeSchema,
  JournalAccountsSchema,
  PayPeriodSchema,
  TeamMemberIdSchema,
} from '@nirvana/contracts';
import { withMember, type Database, type Transaction } from '@nirvana/db';
import { z } from 'zod';

import { contractorReadsForAccounting as fileReads } from '../../contractors';
import { PayrollForbidden } from '../../contractors/pure';
import { invoiceReadsForAccounting as invoiceReads } from '../../invoicing';
import { payReadsForAccounting as payReads } from '../../payroll';
import type { Das2Contractor } from '../domain/accounting';
import type { JournalContractor, JournalDocument, JournalStatement } from '../domain/journal';
import type { ArchiveDocument, Das2Facts, JournalFacts, PayrollAccountingStore } from '../domain/ports';

import { audit } from './audit';
import type { AccountingReads } from './ports';

/** The contractor's name a document froze (`contractor ->> 'legalName'`), `null` when its copy has none. */
const legalNameOf = (contractor: unknown): string | null => {
  const read = z.object({ legalName: z.string() }).safeParse(contractor);
  return read.success ? read.data.legalName : null;
};

/** The contractors with a document issued or a transfer made from `from` to `to`, as the owner reads them. */
async function contractorsInRange(tx: Transaction, from: string, to: string): Promise<string[]> {
  return [
    ...new Set([
      ...(await invoiceReads.issuedBetween(tx, from, to)),
      ...(await payReads.paidBetween(tx, from, to)),
    ]),
  ];
}

/** Each contractor's facts, all of them whatever the range: the lettering follows the carry-overs back and forth. */
async function factsOf(
  tx: Transaction,
  memberIds: readonly string[],
  timeZone: string,
  from: string,
  to: string,
): Promise<Pick<JournalFacts, 'contractors' | 'transfersLeftOut'>> {
  if (memberIds.length === 0) return { contractors: [], transfersLeftOut: [] };
  const members = [...memberIds];
  const statements = await payReads.statementsOf(tx, members);
  const carried = await payReads.carryOversOf(tx, members);
  const issued = (await invoiceReads.documentsOf(tx, members)).map((one) => ({
    ...one,
    legalName: legalNameOf(one.contractor),
  }));
  const profiles = (await fileReads.profilesOf(tx, members)).map(({ profile }) => ({
    memberId: profile.memberId,
    prefix: profile.invoicePrefix,
    legalName: profile.legalName,
  }));

  const contractors: JournalContractor[] = [];
  const transfersLeftOut: JournalFacts['transfersLeftOut'][number][] = [];
  for (const memberId of members) {
    const own = issued.filter((one) => one.memberId === memberId);
    const profile = profiles.find((one) => one.memberId === memberId);
    const newest = own.at(-1);
    // The prefix the documents carry, frozen by the first one (lot 5a); the name of the file today.
    const prefix = profile?.prefix ?? newest?.prefix ?? null;
    const name = profile?.legalName ?? newest?.legalName ?? null;
    const theirs: JournalStatement[] = statements
      .filter((one) => one.memberId === memberId)
      .map((one) => ({
        id: one.id,
        period: PayPeriodSchema.parse(one.period),
        status: CommissionStatementStatusSchema.parse(one.status),
        totalMinor: one.totalMinor,
        validatedOn: one.validatedAt === null ? null : calendarDayAt(one.validatedAt, timeZone),
        payment:
          one.paidOn === null || one.sentMinor === null
            ? null
            : { paidOn: one.paidOn, reference: one.reference, sentMinor: one.sentMinor },
      }));
    if (prefix === null || name === null) {
      // No document ever, so no supplier account: a transfer recorded before pay asked for its invoice (ADR 0041).
      for (const one of theirs) {
        if (one.payment !== null && one.payment.paidOn >= from && one.payment.paidOn <= to)
          transfersLeftOut.push({ memberId: TeamMemberIdSchema.parse(memberId), period: one.period });
      }
      continue;
    }
    contractors.push({
      prefix,
      name,
      statements: theirs,
      carryOvers: carried
        .filter((one) => one.memberId === memberId)
        .map((one) => ({ statementId: one.statementId, toPeriod: PayPeriodSchema.parse(one.toPeriod) })),
      documents: own.map((one): JournalDocument => ({
        kind: one.kind === 'invoice' ? 'invoice' : 'credit_note',
        corrective: one.kind === 'invoice' && one.reissuedInvoiceId !== null,
        number: one.number,
        issuedOn: one.issuedOn,
        statementId: one.statementId,
        totals: {
          exclVatMinor: one.exclVatMinor,
          vatMinor: one.vatMinor,
          inclVatMinor: one.inclVatMinor,
          selfAssessedVatMinor: one.selfAssessedVatMinor,
        },
      })),
    });
  }
  return { contractors, transfersLeftOut };
}

/**
 * Each contractor with a transfer made in `year`, all their facts whatever the year: a transfer of January pays the
 * documents of December, and the identity is read on the documents (lot 7c).
 */
async function das2FactsOf(tx: Transaction, year: number): Promise<Das2Facts> {
  const members = await payReads.paidBetween(tx, `${String(year)}-01-01`, `${String(year)}-12-31`);
  if (members.length === 0) return { contractors: [] };
  const statements = await payReads.statementsOf(tx, members);
  const carried = await payReads.carryOversOf(tx, members);
  const issued = await invoiceReads.documentsOf(tx, members);
  const profiles = await fileReads.profilesOf(tx, members);

  return {
    contractors: members.map((memberId): Das2Contractor => {
      const today = profiles.find((one) => one.profile.memberId === memberId);
      return {
        memberId: TeamMemberIdSchema.parse(memberId),
        statements: statements
          .filter((one) => one.memberId === memberId)
          .map((one) => ({
            id: one.id,
            period: one.period,
            status: CommissionStatementStatusSchema.parse(one.status),
            totalMinor: one.totalMinor,
            payment:
              one.paidOn === null || one.sentMinor === null
                ? null
                : { paidOn: one.paidOn, sentMinor: one.sentMinor },
          })),
        carryOvers: carried
          .filter((one) => one.memberId === memberId)
          .map((one) => ({ statementId: one.statementId, toPeriod: one.toPeriod })),
        documents: issued
          .filter((one) => one.memberId === memberId)
          .map((one) => {
            // What the document froze at its issue: its copy of the contractor's file and of their regime.
            const regime = InvoiceRegimeSchema.parse(one.regime);
            return {
              id: one.id,
              kind: one.kind === 'invoice' ? 'invoice' : 'credit_note',
              statementId: one.statementId,
              period: PayPeriodSchema.parse(one.period),
              issuedOn: one.issuedOn,
              contractor: InvoiceContractorSchema.parse(one.contractor),
              withholding: regime.withholding,
              vatCharged: regime.vat.treatment === 'charged',
            };
          }),
        identityToday:
          today === undefined
            ? null
            : {
                legalName: today.profile.legalName,
                address: today.profile.address,
                country: today.country,
                taxId: today.profile.taxId,
                businessId: today.profile.businessId,
                vatNumber: today.profile.vatNumber,
                individualEntrepreneur: today.profile.individualEntrepreneur,
                legalForm: today.profile.legalForm,
                shareCapitalMinor: today.profile.shareCapitalMinor,
                rcsCity: today.profile.rcsCity,
              },
      };
    }),
  };
}

/** The documents issued from `from` to `to`, with their PDF and its copies once written (lot 7d). */
async function documentsInRange(tx: Transaction, from: string, to: string): Promise<ArchiveDocument[]> {
  const { rows, pdfs, copies } = await invoiceReads.archiveBetween(tx, from, to);
  return rows.map((row): ArchiveDocument => {
    const pdf = pdfs.find((one) => one.invoiceId === row.id);
    return {
      invoiceId: InvoiceIdSchema.parse(row.id),
      memberId: TeamMemberIdSchema.parse(row.memberId),
      number: row.number,
      kind: row.kind === 'invoice' ? 'invoice' : 'credit_note',
      corrective: row.kind === 'invoice' && row.reissuedInvoiceId !== null,
      issuedOn: row.issuedOn,
      pdf:
        pdf === undefined
          ? null
          : {
              key: pdf.storageKey,
              sha256: pdf.sha256,
              retainUntil: pdf.retainUntil,
              copies: copies
                .filter((copy) => copy.invoiceId === row.id)
                .map((copy) => ({
                  provider: InvoicePdfCopyProviderSchema.parse(copy.provider),
                  key: copy.storageKey,
                  sha256: copy.sha256,
                  retainUntil: copy.retainUntil,
                })),
            },
    };
  });
}

/** The journal export (EQ-06 lot 7b), the DAS2 recap (lot 7c) and the archive (lot 7d): see `PayrollAccountingStore`. */
export function createDrizzlePayrollAccountingStore(
  db: Database,
  reads: AccountingReads,
): PayrollAccountingStore {
  return {
    exportJournal: (actor, from, to, render) =>
      withMember(db, actor.userId, async (tx, scope) => {
        if (scope !== 'owner') throw new PayrollForbidden({ ownerOnly: true });
        const stored = await fileReads.accounts(tx);
        const accounts = stored === null ? null : JournalAccountsSchema.parse(stored);
        const members = await contractorsInRange(tx, from, to);
        const facts = await factsOf(tx, members, await reads.agencyTimeZone(tx), from, to);
        const rendered = render({ accounts, ...facts });
        // What was exported, never its content: the file holds the contractors' names.
        await audit(
          tx,
          actor,
          'accounting_journal.export',
          { kind: 'accounting_journal', id: `${from}/${to}` },
          { from, to, contractors: facts.contractors.length },
        );
        return rendered;
      }),
    exportDas2: (actor, year, render) =>
      withMember(db, actor.userId, async (tx, scope) => {
        if (scope !== 'owner') throw new PayrollForbidden({ ownerOnly: true });
        const rendered = render(await das2FactsOf(tx, year));
        // The year and how many are declared, never who: the recap holds their names and addresses.
        await audit(
          tx,
          actor,
          'accounting_das2.export',
          { kind: 'accounting_das2', id: String(year) },
          { year, beneficiaries: rendered.beneficiaries.length },
        );
        return rendered;
      }),
    archiveDocuments: (actor, from, to) =>
      withMember(db, actor.userId, async (tx, scope) => {
        if (scope !== 'owner') throw new PayrollForbidden({ ownerOnly: true });
        const documents = await documentsInRange(tx, from, to);
        // The range and how many, never which: the archive streams once this is written.
        await audit(
          tx,
          actor,
          'accounting_archive.export',
          { kind: 'accounting_archive', id: `${from}/${to}` },
          { from, to, documents: documents.length },
        );
        return documents;
      }),
  };
}
