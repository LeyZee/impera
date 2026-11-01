import {
  PayPeriodSchema,
  type InvoiceAgency,
  type InvoiceContractor,
  type RegimeVat,
} from '@nirvana/contracts';

import type { PdfDocumentSource } from '../invoice-pdf';
import { creditNoteMention, paymentTermsMention, reissueMention } from '../invoices';

/**
 * Documents to render in the tests, every party and figure invented (ADR 0010): the audit's mockup (01/11/2026) in
 * data, a credit note on it, a corrective invoice of it (ADR 0040), and the worst case the limits allow.
 */

export const AGENCY: InvoiceAgency = {
  legalName: 'Agence Exemple SAS',
  address: '1 place Inventée\n69000 Lyon',
  siren: '123456789',
  vatNumber: 'FR12123456789',
  legalForm: 'SAS',
  shareCapitalMinor: 100_000,
  rcsCity: 'Lyon',
};

export const CONTRACTOR: InvoiceContractor = {
  legalName: 'Awa Exemple',
  address: 'Lot 00, quartier Exemple\nCotonou',
  country: 'BJ',
  taxId: '0000000000000',
  businessId: null,
  vatNumber: null,
  individualEntrepreneur: false,
};

const REVERSE_CHARGE: RegimeVat = { treatment: 'reverse_charge', rateBps: 2_000 };

export const REGIME_MENTIONS = [
  'Prestataire établi hors de l’Union européenne (Bénin), résident fiscal de son pays\u00a0: retenue à la source de l’art. 182 B du CGI écartée par la convention fiscale France–Bénin.',
];

export const TERMS =
  'Règlement par virement. Aucun escompte pour paiement anticipé. En cas de retard, pénalités au taux de trois fois le taux d’intérêt légal et indemnité forfaitaire de 40\u00a0€ pour frais de recouvrement (art. L441-10 et D441-5 du Code de commerce).';

export const SERVICE =
  'Animation commerciale de comptes de créatrices (messagerie), rémunérée à la commission.';

/** The invoice of the mockup: two accounts, a tier bonus, a deduction, under reverse charge (Benin). */
export function sampleInvoice(patch: Partial<PdfDocumentSource> = {}): PdfDocumentSource {
  return {
    kind: 'invoice',
    number: 'AEX-2026-0021',
    issuedOn: '2026-11-17',
    dueOn: '2027-01-16',
    period: PayPeriodSchema.parse('2026-11-01'),
    contractor: CONTRACTOR,
    agency: AGENCY,
    vat: REVERSE_CHARGE,
    regimeMentions: REGIME_MENTIONS,
    mentions: [...REGIME_MENTIONS, paymentTermsMention('2027-01-16', TERMS)],
    serviceDescription: SERVICE,
    mandateAcceptedOn: '2026-10-03',
    acceptanceDeadline: new Date('2026-11-24T09:30:00.000Z'),
    timeZone: 'Europe/Paris',
    lines: [
      {
        kind: 'commission',
        label: 'Commission, compte @awa.demo sur Reveal',
        detail: '40\u00a0% de 1\u202f852,40\u00a0€ de net',
        amountMinor: 74_096,
      },
      {
        kind: 'commission',
        label: 'Commission, compte @awa.second sur Reveal',
        detail: '40\u00a0% de 412,50\u00a0€ de net',
        amountMinor: 16_500,
      },
      {
        kind: 'tier_bonus',
        label: 'Prime de palier',
        detail: '1\u202f500,00\u00a0€ de net atteints',
        amountMinor: 5_000,
      },
      {
        kind: 'penalty',
        label: 'Réfaction prévue au contrat',
        detail: '«\u00a0Prise de poste en retard le 9 novembre\u00a0»',
        amountMinor: -2_500,
      },
    ],
    totals: { exclVatMinor: 93_096, vatMinor: 0, inclVatMinor: 93_096 },
    credited: null,
    reissued: null,
    annex: {
      validatedOn: '2026-11-17',
      commissionRateBps: 4_000,
      accounts: [
        {
          handle: 'awa.demo',
          platform: 'reveal',
          currency: 'EUR',
          rateMicros: 1_000_000,
          rateOn: null,
          grossMinor: 231_550,
          grossEurMinor: 231_550,
          exclVatMinor: 231_550,
          netMinor: 185_240,
          commissionMinor: 74_096,
        },
        {
          handle: 'awa.second',
          platform: 'reveal',
          currency: 'EUR',
          rateMicros: 1_000_000,
          rateOn: null,
          grossMinor: 51_563,
          grossEurMinor: 51_563,
          exclVatMinor: 51_563,
          netMinor: 41_250,
          commissionMinor: 16_500,
        },
      ],
    },
    ...patch,
  };
}

/** The credit note of the mockup: a refund after the pay, on the invoice above, keeping its regime. */
export function sampleCreditNote(patch: Partial<PdfDocumentSource> = {}): PdfDocumentSource {
  return {
    ...sampleInvoice(),
    kind: 'credit_note',
    number: 'AEX-2026-0023',
    issuedOn: '2026-12-02',
    dueOn: '2027-01-31',
    mentions: [creditNoteMention('AEX-2026-0021', '2026-11-17'), ...REGIME_MENTIONS],
    serviceDescription: null,
    acceptanceDeadline: new Date('2026-12-09T09:30:00.000Z'),
    lines: [
      {
        kind: 'adjustment',
        label: 'Régularisation',
        detail:
          'Période du 1er au 15 novembre 2026\u00a0: «\u00a0Vente remboursée par la plateforme après la paie\u00a0»',
        amountMinor: -4_500,
      },
    ],
    totals: { exclVatMinor: -4_500, vatMinor: 0, inclVatMinor: -4_500 },
    credited: { number: 'AEX-2026-0021', issuedOn: '2026-11-17' },
    annex: null,
    ...patch,
  };
}

/**
 * The corrective invoice of the mockup (ADR 0040): its address was wrong, the contest upheld; issued with its cancel
 * at the next validation, it bills the same amount again under its period, regime and mentions, with the file of the
 * day.
 */
export function sampleCorrectiveInvoice(patch: Partial<PdfDocumentSource> = {}): PdfDocumentSource {
  return {
    ...sampleInvoice(),
    number: 'AEX-2026-0025',
    issuedOn: '2026-12-02',
    dueOn: '2027-01-31',
    contractor: { ...CONTRACTOR, address: 'Lot 12, quartier Exemple\nCotonou' },
    mentions: [
      reissueMention('AEX-2026-0021', '2026-11-17'),
      ...REGIME_MENTIONS,
      paymentTermsMention('2027-01-31', TERMS),
    ],
    acceptanceDeadline: new Date('2026-12-09T09:30:00.000Z'),
    lines: [
      {
        kind: 'adjustment',
        label: 'Régularisation',
        detail:
          'Période du 1er au 15 novembre 2026\u00a0: «\u00a0Refacturation de la facture AEX-2026-0021 du 17 novembre 2026\u00a0»',
        amountMinor: 93_096,
      },
    ],
    reissued: { number: 'AEX-2026-0021', issuedOn: '2026-11-17' },
    annex: null,
    ...patch,
  };
}

/**
 * What the limits allow at most: a name of 160 characters, an address of 400, 25 mentions, 30 lines (one commission
 * for each of 20 accounts, half of them in dollars, then 10 bonuses), every figure consistent with the next.
 */
export function worstCase(): PdfDocumentSource {
  const words = (count: number, seed: string): string =>
    Array.from({ length: count }, (_, index) => `${seed}${String(index % 10)}`).join(' ');
  const mentions = Array.from({ length: 24 }, (_, index) =>
    `Mention ${String(index + 1)}\u00a0: ${words(60, 'texte')}`.slice(0, 400),
  );
  const handle = (index: number): string => `${'compte-tres-long-'.repeat(2)}${String(index)}`;
  // 9 999,99 $US at 0,923456 € make 9 234,55 €; excluding 20 % of VAT, 7 695,46 €; net of 20 %, 6 156,37 €; 40 %.
  const accounts = Array.from({ length: 20 }, (_, index) => ({
    handle: handle(index),
    platform: 'reveal' as const,
    currency: index % 2 === 0 ? ('EUR' as const) : ('USD' as const),
    rateMicros: index % 2 === 0 ? 1_000_000 : 923_456,
    rateOn: index % 2 === 0 ? null : '2026-11-13',
    grossMinor: index % 2 === 0 ? 923_455 : 999_999,
    grossEurMinor: 923_455,
    exclVatMinor: 769_546,
    netMinor: 615_637,
    commissionMinor: 246_255,
  }));
  const lines = [
    ...accounts.map((account) => ({
      kind: 'commission' as const,
      label: `Commission, compte @${account.handle} sur Reveal`,
      detail: `40\u00a0% de 6\u202f156,37\u00a0€ de net ${words(30, 'détail')}`.slice(0, 400),
      amountMinor: account.commissionMinor,
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      kind: 'bonus' as const,
      label: `Prime ${String(index + 1)}, ${words(12, 'motif')}`,
      detail: words(40, 'détail').slice(0, 400),
      amountMinor: 123_456,
    })),
  ];
  const total = lines.reduce((sum, line) => sum + line.amountMinor, 0);
  return sampleInvoice({
    contractor: {
      ...CONTRACTOR,
      legalName: `Awa ${'Exemple-Très-Long '.repeat(9)}`.slice(0, 160).trim(),
      address: words(60, 'Rue').slice(0, 400),
    },
    regimeMentions: mentions,
    mentions: [...mentions, paymentTermsMention('2027-01-16', TERMS)],
    lines,
    totals: { exclVatMinor: total, vatMinor: 0, inclVatMinor: total },
    annex: { validatedOn: '2026-11-17', commissionRateBps: 4_000, accounts },
  });
}

/** One account on Reveal, in euros, and its commission at 40 %: the statement of a French contractor. */
const frenchAnnex = (handle: string): NonNullable<PdfDocumentSource['annex']> => ({
  validatedOn: '2026-11-17',
  commissionRateBps: 4_000,
  accounts: [
    {
      handle,
      platform: 'reveal',
      currency: 'EUR',
      rateMicros: 1_000_000,
      rateOn: null,
      grossMinor: 150_000,
      grossEurMinor: 150_000,
      exclVatMinor: 125_000,
      netMinor: 100_000,
      commissionMinor: 40_000,
    },
  ],
});

/**
 * A French contractor under the VAT franchise (art. 293 B of the CGI): an individual entrepreneur with a SIRET and no
 * VAT number; the invoice prints no VAT.
 */
export function frenchFranchise(): PdfDocumentSource {
  const mentions = [
    'Entrepreneur individuel dispensé d’immatriculation au registre du commerce et des sociétés.',
  ];
  return sampleInvoice({
    contractor: {
      legalName: 'Basile Exemple',
      address: '2 rue Inventée\n69001 Lyon',
      country: 'FR',
      taxId: null,
      businessId: '12345678900011',
      vatNumber: null,
      individualEntrepreneur: true,
    },
    vat: { treatment: 'exempt' },
    regimeMentions: mentions,
    mentions: [...mentions, paymentTermsMention('2027-01-16', TERMS)],
    lines: [
      {
        kind: 'commission',
        label: 'Commission, compte @basile.demo sur Reveal',
        detail: '40\u00a0% de 1\u202f000,00\u00a0€ de net',
        amountMinor: 40_000,
      },
    ],
    totals: { exclVatMinor: 40_000, vatMinor: 0, inclVatMinor: 40_000 },
    annex: frenchAnnex('basile.demo'),
  });
}

/** A French company that charges VAT at 20 %: its SIREN, its VAT number, the VAT and the total including it. */
export function frenchCharged(): PdfDocumentSource {
  return sampleInvoice({
    contractor: {
      legalName: 'Chloé Exemple SARL',
      address: '5 avenue Inventée\n13001 Marseille',
      country: 'FR',
      taxId: null,
      businessId: '987654321',
      vatNumber: 'FR45987654321',
      individualEntrepreneur: false,
    },
    vat: { treatment: 'charged', rateBps: 2_000 },
    regimeMentions: [],
    mentions: [paymentTermsMention('2027-01-16', TERMS)],
    lines: [
      {
        kind: 'commission',
        label: 'Commission, compte @chloe.demo sur Reveal',
        detail: '40\u00a0% de 1\u202f000,00\u00a0€ de net',
        amountMinor: 40_000,
      },
      {
        kind: 'tier_bonus',
        label: 'Prime de palier',
        detail: '1\u202f000,00\u00a0€ de net atteints',
        amountMinor: 5_000,
      },
    ],
    totals: { exclVatMinor: 45_000, vatMinor: 9_000, inclVatMinor: 54_000 },
    annex: frenchAnnex('chloe.demo'),
  });
}
