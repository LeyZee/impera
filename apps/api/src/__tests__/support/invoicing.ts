import { createHash } from 'node:crypto';

import {
  BillingRegimeIdSchema,
  ContractAcceptanceIdSchema,
  ContractorRegimeIdSchema,
  ContractTextIdSchema,
  newId,
  type TeamMember,
} from '@nirvana/contracts';
import { eq, schema } from '@nirvana/db';

import type { PayrollTeam } from './payroll-team';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** Invented parties only (ADR 0010): no real name, address nor identifier. */
export const AGENCY = {
  legalName: 'Agence Exemple SAS',
  address: '1 place Fictive, 69000 Lyon',
  siren: '123456789',
  vatNumber: 'FR12123456789',
};
/** The agency's payment terms, a setting: an invoice prints them after its due date. */
export const TERMS =
  'Aucun escompte. Pénalités de retard au triple du taux d’intérêt légal, indemnité de 40 € pour frais de recouvrement.';
/** The designation of the service each invoice prints, a setting (EQ-06 lot 4). */
const SERVICE = 'Animation commerciale de comptes de créatrices (texte inventé pour le test).';
/** The agency's logo: an invented PNG, which the test draws (`inventedLogo`, inside the payroll module). */
interface Logo {
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

/** A contractor to bill: their prefix of numbers and their invented legal name. */
interface Contractor {
  readonly member: TeamMember;
  readonly prefix: string;
  readonly legalName: string;
}

export interface Invoicing {
  /** The one billing regime, « France, TVA facturée », validated on 2025-01-01. */
  readonly regimeId: string;
  /** The billing mandate's text, seven days to contest. */
  readonly mandate: { readonly id: string; readonly body: string; readonly contestDelayDays: number };
  /** `member` accepts the mandate, without which no invoice goes out. */
  acceptMandate(member: TeamMember): Promise<unknown>;
}

/**
 * What an issue needs before the first invoice (EQ-06): the agency's settings and logo, one validated regime, the
 * billing mandate (seven days to contest), and each contractor's regime and profile, checked by the owner. No mandate is accepted here.
 * Without `logo`, neither the logo nor the settings are written: the test saves them through Réglages › Facturation.
 */
export async function setUpInvoicing(
  team: PayrollTeam,
  logo: Logo | null,
  contractors: readonly Contractor[],
): Promise<Invoicing> {
  const admin = team.test.admin.db;
  const regimeId = newId(BillingRegimeIdSchema);
  const mandate = {
    id: newId(ContractTextIdSchema),
    kind: 'billing_mandate',
    version: 1,
    body: 'Mandat de facturation (texte inventé pour le test). Délai de contestation : sept jours.',
    contestDelayDays: 7,
  };
  if (logo !== null) {
    const logoSha256 = createHash('sha256').update(logo.bytes).digest('hex');
    await admin.insert(schema.agencyLogos).values({
      sha256: logoSha256,
      mediaType: logo.mediaType,
      bytes: Buffer.from(logo.bytes),
      createdBy: team.ownerId,
    });
    await admin.insert(schema.billingSettings).values({
      id: 1,
      agency: AGENCY,
      paymentTerms: TERMS,
      dueDays: 60,
      serviceDescription: SERVICE,
      logoSha256,
      documentReminderDays: 30,
      accounts: { expense: '622', supplierPrefix: '401', vatDeductible: '44566', vatSelfAssessed: '4452' },
      updatedBy: team.ownerId,
    });
  }
  await admin.insert(schema.billingRegimes).values({
    id: regimeId,
    name: 'France, TVA facturée',
    countries: ['FR'],
    vatTreatment: 'charged',
    vatRateBps: 2_000,
    withholding: 'none',
    mentions: ['Autofacturation'],
    documents: ['urssaf_vigilance'],
    taxIdRequired: true,
    createdBy: team.ownerId,
  });
  await admin
    .insert(schema.billingRegimeValidations)
    .values({ regimeId, validatedOn: '2025-01-01', recordedBy: team.ownerId });
  await admin
    .insert(schema.contractTexts)
    .values({ ...mandate, sha256: sha256(mandate.body), createdBy: team.ownerId });
  for (const { member, prefix, legalName } of contractors) {
    await admin.insert(schema.contractorRegimes).values({
      id: newId(ContractorRegimeIdSchema),
      memberId: member.id,
      regimeId,
      effectiveFrom: '2025-01-01',
      createdBy: team.ownerId,
    });
    await admin.insert(schema.contractorProfiles).values({
      memberId: member.id,
      legalName,
      address: '3 rue Imaginaire, 69001 Lyon',
      taxId: '12345678900011',
      businessId: '12345678900011',
      vatNumber: 'FR98123456789',
      // A company established in France (not an individual entrepreneur): its form, capital and register.
      legalForm: 'SARL',
      shareCapitalMinor: 100_000,
      rcsCity: 'Lyon',
      email: `${prefix.toLowerCase()}@example.test`,
      invoicePrefix: prefix,
      updatedBy: member.userId,
    });
    // Checked by the owner once written, as an issue asks (`identity_unverified`); the trigger refuses it at the insert.
    await admin
      .update(schema.contractorProfiles)
      .set({ verifiedAt: new Date(), verifiedBy: team.ownerId, updatedBy: team.ownerId })
      .where(eq(schema.contractorProfiles.memberId, member.id));
  }
  return {
    regimeId,
    mandate,
    acceptMandate: (member) =>
      admin.insert(schema.contractAcceptances).values({
        id: newId(ContractAcceptanceIdSchema),
        memberId: member.id,
        textId: mandate.id,
        textSha256: sha256(mandate.body),
        acceptedBy: member.userId,
      }),
  };
}
