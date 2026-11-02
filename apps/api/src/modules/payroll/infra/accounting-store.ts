import {
  calendarDayAt,
  CommissionStatementStatusSchema,
  JournalAccountsSchema,
  PayPeriodSchema,
  TeamMemberIdSchema,
} from '@nirvana/contracts';
import { eq, inArray, schema, sql, withMember, type Database, type Transaction } from '@nirvana/db';

import { PayrollForbidden } from '../domain/errors';
import type { JournalContractor, JournalDocument, JournalStatement } from '../domain/journal';
import type { JournalFacts, PayrollAccountingStore } from '../domain/ports';

import type { PayInputReads } from './snapshot';
import { audit } from './writes';

const { billingSettings, carryOvers, commissionStatements, contractorProfiles, invoices } = schema;

/** The contractors with a document issued or a transfer made from `from` to `to`, as the owner reads them. */
async function contractorsInRange(tx: Transaction, from: string, to: string): Promise<string[]> {
  const rows = await tx.execute<{ member_id: string }>(sql`
    select ${invoices.memberId} as member_id from ${invoices}
     where ${invoices.issuedOn} between ${from} and ${to}
    union
    select ${commissionStatements.memberId} from ${commissionStatements}
     where ${commissionStatements.status} = 'paid' and ${commissionStatements.paidOn} between ${from} and ${to}`);
  return rows.rows.map((row) => row.member_id);
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
  const statements = await tx
    .select({
      memberId: commissionStatements.memberId,
      id: commissionStatements.id,
      period: commissionStatements.period,
      status: commissionStatements.status,
      totalMinor: commissionStatements.totalMinor,
      validatedAt: commissionStatements.validatedAt,
      paidOn: commissionStatements.paidOn,
      reference: commissionStatements.paymentReference,
      sentMinor: commissionStatements.sentMinor,
    })
    .from(commissionStatements)
    .where(inArray(commissionStatements.memberId, members));
  const carried = await tx
    .select({
      memberId: carryOvers.memberId,
      statementId: carryOvers.statementId,
      toPeriod: carryOvers.toPeriod,
    })
    .from(carryOvers)
    .where(inArray(carryOvers.memberId, members));
  const documents = await tx
    .select({
      memberId: invoices.memberId,
      kind: invoices.kind,
      reissuedInvoiceId: invoices.reissuedInvoiceId,
      number: invoices.number,
      prefix: invoices.prefix,
      year: invoices.year,
      sequence: invoices.sequence,
      issuedOn: invoices.issuedOn,
      statementId: invoices.statementId,
      exclVatMinor: invoices.exclVatMinor,
      vatMinor: invoices.vatMinor,
      inclVatMinor: invoices.inclVatMinor,
      selfAssessedVatMinor: invoices.selfAssessedVatMinor,
      legalName: sql<string>`${invoices.contractor} ->> 'legalName'`,
    })
    .from(invoices)
    .where(inArray(invoices.memberId, members))
    .orderBy(invoices.year, invoices.sequence);
  const profiles = await tx
    .select({
      memberId: contractorProfiles.memberId,
      prefix: contractorProfiles.invoicePrefix,
      legalName: contractorProfiles.legalName,
    })
    .from(contractorProfiles)
    .where(inArray(contractorProfiles.memberId, members));

  const contractors: JournalContractor[] = [];
  const transfersLeftOut: JournalFacts['transfersLeftOut'][number][] = [];
  for (const memberId of members) {
    const own = documents.filter((one) => one.memberId === memberId);
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

/** The journal export (EQ-06 lot 7b): see `PayrollAccountingStore`. */
export function createDrizzlePayrollAccountingStore(
  db: Database,
  reads: Pick<PayInputReads, 'agencyTimeZone'>,
): PayrollAccountingStore {
  return {
    exportJournal: (actor, from, to, render) =>
      withMember(db, actor.userId, async (tx, scope) => {
        if (scope !== 'owner') throw new PayrollForbidden({ ownerOnly: true });
        const [settings] = await tx
          .select({ accounts: billingSettings.accounts })
          .from(billingSettings)
          .where(eq(billingSettings.id, 1));
        const accounts =
          settings?.accounts === undefined || settings.accounts === null
            ? null
            : JournalAccountsSchema.parse(settings.accounts);
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
  };
}
