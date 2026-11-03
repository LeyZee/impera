import type { ContractorDocumentReview } from '@impera/contracts';
import { and, eq, inArray, schema, sql, type Transaction } from '@impera/db';

import { documentValidUntil } from '../domain/billing';

import { contractorReadsForAccounting, type ProfileForAccounting } from './accounting-reads';
import { reviewOf } from './document-rows';
import { regimeVatOf } from './regime-store';

const {
  agencyLogos,
  billingRegimes,
  billingRegimeValidations,
  billingSettings,
  contractAcceptances,
  contractorDocumentReviews,
  contractorDocuments,
  contractorRegimes,
  contractTexts,
  teamMembers,
} = schema;

type DocumentRow = typeof contractorDocuments.$inferSelect;

/** The billing mandate as an issue reads it: its current version, and the newest one the contractor accepted. */
export interface MandateForInvoicing {
  /** The highest version written, `null` before the first. */
  readonly currentVersion: number | null;
  readonly accepted: { readonly version: number; readonly contestDelayDays: number | null } | null;
}

/** A regime assigned to a contractor from a day on. */
export interface AssignmentForInvoicing {
  readonly memberId: string;
  readonly regimeId: string;
  readonly from: string;
}

/** A regime as an invoice copies it (`InvoiceRegimeSchema` reads it), with the day the accountant validated it. */
export interface RegimeForInvoicing {
  readonly id: string;
  readonly name: string;
  readonly vat: unknown;
  readonly withholding: string;
  readonly mentions: unknown;
  readonly documents: unknown;
  readonly taxIdRequired: boolean;
  readonly validatedOn: string | null;
}

/** A document of the contractor with the owner's check, `null` while it waits. */
export type DocumentForInvoicing = Pick<DocumentRow, 'kind' | 'issuedOn' | 'validUntil'> & {
  readonly review: ContractorDocumentReview | null;
};

/** A tax residence certificate of a contractor, with the owner's check. */
export type CertificateForInvoicing = Pick<DocumentRow, 'memberId' | 'id' | 'issuedOn' | 'validUntil'> & {
  readonly review: ContractorDocumentReview | null;
};

/** The agency's billing settings, as saved (`undefined` until they are). */
export type SettingsForInvoicing = typeof billingSettings.$inferSelect;

/** A logo the agency uploaded. */
export type LogoForInvoicing = Pick<typeof agencyLogos.$inferSelect, 'mediaType' | 'bytes'>;

/**
 * What the invoices read of the contractors' file (ADR 0047 § 1, ARC-07), in their caller's transaction (the job's
 * `withAdmin`, or the policies of `withMember`): the mandate and its acceptances, the regimes and their assignments,
 * the identity, the documents and their checks, the agency's settings and logo. The file alone reads its tables.
 */
export const contractorReadsForInvoicing = {
  /** The billing mandate's current version and the newest version `memberId` accepted. */
  mandateOf: async (tx: Transaction, memberId: string): Promise<MandateForInvoicing> => {
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
    return { currentVersion: current?.version ?? null, accepted: accepted ?? null };
  },

  /** The instant `memberId` accepted the newest version of the mandate they had accepted at `at`, `null` for none. */
  mandateAcceptedAt: async (tx: Transaction, memberId: string, at: Date): Promise<Date | null> => {
    const [accepted] = await tx
      .select({ acceptedAt: contractAcceptances.acceptedAt })
      .from(contractAcceptances)
      .innerJoin(contractTexts, eq(contractTexts.id, contractAcceptances.textId))
      .where(
        and(
          eq(contractAcceptances.memberId, memberId),
          eq(contractTexts.kind, 'billing_mandate'),
          sql`${contractAcceptances.acceptedAt} <= ${at.toISOString()}::timestamptz`,
        ),
      )
      .orderBy(sql`${contractTexts.version} desc`)
      .limit(1);
    return accepted?.acceptedAt ?? null;
  },

  /** The regimes assigned to these contractors, each from its day. */
  assignmentsOf: (tx: Transaction, memberIds: readonly string[]): Promise<AssignmentForInvoicing[]> =>
    tx
      .select({
        memberId: contractorRegimes.memberId,
        regimeId: contractorRegimes.regimeId,
        from: contractorRegimes.effectiveFrom,
      })
      .from(contractorRegimes)
      .where(inArray(contractorRegimes.memberId, [...memberIds])),

  /** The regimes written for the country `memberId`'s card gives today (« ok pays »). */
  regimesOfCountry: async (tx: Transaction, memberId: string): Promise<string[]> => {
    const rows = await tx
      .select({ id: billingRegimes.id })
      .from(billingRegimes)
      .innerJoin(teamMembers, eq(teamMembers.id, memberId))
      .where(sql`${teamMembers.country} = any(${billingRegimes.countries})`);
    return rows.map((row) => row.id);
  },

  /** Every regime as an invoice copies it, each with the day the accountant validated it, `null` for not yet. */
  regimes: async (tx: Transaction): Promise<RegimeForInvoicing[]> => {
    const rows = await tx
      .select({ regime: billingRegimes, validatedOn: billingRegimeValidations.validatedOn })
      .from(billingRegimes)
      .leftJoin(billingRegimeValidations, eq(billingRegimeValidations.regimeId, billingRegimes.id));
    return rows.map(({ regime, validatedOn }) => ({
      id: regime.id,
      name: regime.name,
      vat: regimeVatOf(regime),
      withholding: regime.withholding,
      mentions: regime.mentions,
      documents: regime.documents,
      taxIdRequired: regime.taxIdRequired,
      validatedOn,
    }));
  },

  /** Each regime's withholding, as stored. */
  withholdings: (tx: Transaction): Promise<{ id: string; withholding: string }[]> =>
    tx.select({ id: billingRegimes.id, withholding: billingRegimes.withholding }).from(billingRegimes),

  /** `memberId`'s file, with the country of their member's card, `undefined` when they have none. */
  profileOf: async (tx: Transaction, memberId: string): Promise<ProfileForAccounting | undefined> => {
    const [profile] = await contractorReadsForAccounting.profilesOf(tx, [memberId]);
    return profile;
  },

  /** `memberId`'s documents, each with the owner's check. */
  documentsOf: async (tx: Transaction, memberId: string): Promise<DocumentForInvoicing[]> => {
    const rows = await tx
      .select({
        kind: contractorDocuments.kind,
        issuedOn: contractorDocuments.issuedOn,
        validUntil: contractorDocuments.validUntil,
        decision: contractorDocumentReviews.decision,
        reason: contractorDocumentReviews.reason,
      })
      .from(contractorDocuments)
      .leftJoin(contractorDocumentReviews, eq(contractorDocumentReviews.documentId, contractorDocuments.id))
      .where(eq(contractorDocuments.memberId, memberId));
    return rows.map((row) => ({
      kind: row.kind,
      issuedOn: row.issuedOn,
      validUntil: row.validUntil,
      review: reviewOf(row),
    }));
  },

  /** These contractors' tax residence certificates, each with the owner's check. */
  certificatesOf: async (
    tx: Transaction,
    memberIds: readonly string[],
  ): Promise<CertificateForInvoicing[]> => {
    const rows = await tx
      .select({
        memberId: contractorDocuments.memberId,
        id: contractorDocuments.id,
        issuedOn: contractorDocuments.issuedOn,
        validUntil: contractorDocuments.validUntil,
        decision: contractorDocumentReviews.decision,
        reason: contractorDocumentReviews.reason,
      })
      .from(contractorDocuments)
      .leftJoin(contractorDocumentReviews, eq(contractorDocumentReviews.documentId, contractorDocuments.id))
      .where(
        and(
          inArray(contractorDocuments.memberId, [...memberIds]),
          eq(contractorDocuments.kind, 'tax_residence'),
        ),
      );
    return rows.map((row) => ({
      memberId: row.memberId,
      id: row.id,
      issuedOn: row.issuedOn,
      validUntil: row.validUntil,
      review: reviewOf(row),
    }));
  },

  /**
   * The storage keys of `memberId`'s tax residence certificates accepted by the owner and of `period`'s civil year,
   * in key order: the proof of the treaty for the service an invoice of that period bills. Every one: a rescan accepted
   * besides the first is proof as well. Since ADR 0041 the invoice no longer waits for them, and the transfer locks its
   * own (`payroll.lock_payout_certificate`); one already accepted is kept as long as the invoice too.
   */
  residenceKeysOf: async (tx: Transaction, memberId: string, period: string): Promise<string[]> => {
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
      .filter(
        (row) => documentValidUntil({ kind: 'tax_residence', ...row }).slice(0, 4) === period.slice(0, 4),
      )
      .map((row) => row.key);
  },

  /** The agency's billing settings, `undefined` until they are saved. */
  settings: async (tx: Transaction): Promise<SettingsForInvoicing | undefined> => {
    const [settings] = await tx.select().from(billingSettings).where(eq(billingSettings.id, 1));
    return settings;
  },

  /** The month the agency's fiscal year ends, `null` until the settings are saved. */
  fiscalYearEndMonth: async (tx: Transaction): Promise<number | null> => {
    const [settings] = await tx
      .select({ fiscalYearEndMonth: billingSettings.fiscalYearEndMonth })
      .from(billingSettings)
      .where(eq(billingSettings.id, 1));
    return settings?.fiscalYearEndMonth ?? null;
  },

  /** A logo by its fingerprint, `undefined` when there is none. */
  logoOf: async (tx: Transaction, sha256: string): Promise<LogoForInvoicing | undefined> => {
    const [logo] = await tx
      .select({ mediaType: agencyLogos.mediaType, bytes: agencyLogos.bytes })
      .from(agencyLogos)
      .where(eq(agencyLogos.sha256, sha256));
    return logo;
  },
};
