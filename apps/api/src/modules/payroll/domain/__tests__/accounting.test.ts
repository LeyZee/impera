import {
  PayPeriodSchema,
  TeamMemberIdSchema,
  type Das2Beneficiary,
  type InvoiceContractor,
} from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import type { ContractorIdentity } from '../../../contractors/domain/billing';
import {
  das2Beneficiaries,
  das2Csv,
  das2Declaration,
  das2FileName,
  type Das2Contractor,
  type Das2Document,
  type Das2Statement,
} from '../accounting';

describe('the DAS2 of a year (EQ-06)', () => {
  it('declares what each contractor was paid in the calendar year, over 2 400 € only', () => {
    expect(
      das2Beneficiaries(2026, [
        // 2 400 € exactly is not over the threshold; 1 800 € was over the one before 2024 (1 200 €), no longer.
        { contractorId: 'theo', paidOn: '2026-03-02', sentMinor: 240_000 },
        { contractorId: 'ines', paidOn: '2026-05-04', sentMinor: 180_000 },
        { contractorId: 'nora', paidOn: '2025-12-31', sentMinor: 100_000 },
        { contractorId: 'nora', paidOn: '2026-01-15', sentMinor: 120_000 },
        { contractorId: 'nora', paidOn: '2026-12-31', sentMinor: 120_001 },
        { contractorId: 'basile', paidOn: '2027-01-01', sentMinor: 500_000 },
        { contractorId: 'lou', paidOn: '2026-06-30', sentMinor: 250_000 },
      ]),
    ).toEqual([
      { contractorId: 'lou', paidMinor: 250_000 },
      { contractorId: 'nora', paidMinor: 240_001 },
    ]);
    expect(das2Beneficiaries(2026, [])).toEqual([]);
  });
});

// Invented contractors (ADR 0010): no real name, address nor identifier.
const MEMBERS = ['nora', 'theo', 'lou', 'ines', 'zoe', 'basile', 'ana', 'm1', 'm2', 'm3', 'm4'] as const;
const member = (name: (typeof MEMBERS)[number]) =>
  TeamMemberIdSchema.parse(`00000000-0000-4000-8000-${String(MEMBERS.indexOf(name) + 1).padStart(12, '0')}`);

const copy = (legalName: string, extra: Partial<InvoiceContractor> = {}): InvoiceContractor => ({
  legalName,
  address: '12 rue des Exemples, Cotonou',
  country: 'BJ',
  taxId: '3201912345678',
  ...extra,
});

const today = (frozen: InvoiceContractor, change: Partial<ContractorIdentity> = {}): ContractorIdentity => ({
  legalName: frozen.legalName,
  address: frozen.address,
  country: frozen.country,
  taxId: frozen.taxId,
  businessId: frozen.businessId ?? null,
  vatNumber: frozen.vatNumber ?? null,
  individualEntrepreneur: frozen.individualEntrepreneur ?? false,
  legalForm: frozen.legalForm ?? null,
  shareCapitalMinor: frozen.shareCapitalMinor ?? null,
  rcsCity: frozen.rcsCity ?? null,
  ...change,
});

const paid = (id: string, period: string, paidOn: string, sentMinor: number): Das2Statement => ({
  id,
  period,
  status: 'paid',
  totalMinor: sentMinor,
  payment: { paidOn, sentMinor },
});

const invoice = (
  id: string,
  statementId: string,
  period: string,
  issuedOn: string,
  contractor: InvoiceContractor,
  {
    withholding = 'none',
    vatCharged = false,
  }: Partial<Pick<Das2Document, 'withholding' | 'vatCharged'>> = {},
): Das2Document => ({
  id,
  kind: 'invoice',
  statementId,
  period: PayPeriodSchema.parse(period),
  issuedOn,
  contractor,
  withholding,
  vatCharged,
});

describe('the DAS2 recap (EQ-06 lot 7c)', () => {
  const nora = copy('Nora Vidal');
  const theo = copy('Théo Martin', {
    address: '3 rue Imaginaire, 69001 Lyon',
    country: 'FR',
    taxId: null,
    businessId: '12345678900011',
    vatNumber: 'FR98123456789',
  });
  const inesBefore = copy('Inès Ancienne');
  const inesNow = copy('Inès Nouvelle');

  const contractors: Das2Contractor[] = [
    {
      // Under the treaty with Benin: both transfers pay invoices frozen under it.
      memberId: member('nora'),
      statements: [
        paid('n1', '2026-01-01', '2026-01-20', 150_000),
        paid('n2', '2026-01-16', '2026-02-03', 150_000),
      ],
      carryOvers: [],
      documents: [
        invoice('ni1', 'n1', '2026-01-01', '2026-01-17', nora, { withholding: 'treaty_exempt' }),
        invoice('ni2', 'n2', '2026-01-16', '2026-02-01', nora, { withholding: 'treaty_exempt' }),
      ],
      identityToday: today(nora),
    },
    {
      // Charges VAT: paid what the statement says; their file has moved since.
      memberId: member('theo'),
      statements: [paid('t1', '2026-03-01', '2026-03-20', 250_000)],
      carryOvers: [],
      documents: [invoice('ti1', 't1', '2026-03-01', '2026-03-16', theo, { vatCharged: true })],
      identityToday: today(theo, { address: '8 avenue Nouvelle, 69002 Lyon' }),
    },
    {
      // Paid before pay waited for its invoice: nothing to read an identity from.
      memberId: member('lou'),
      statements: [
        paid('l1', '2026-02-01', '2026-02-20', 130_000),
        paid('l2', '2026-02-16', '2026-03-05', 130_000),
      ],
      carryOvers: [],
      documents: [],
      identityToday: null,
    },
    {
      // A fortnight of December 2025 carried into January: the January transfer pays both invoices, under two
      // withholdings; the identity is the one of the invoice of 2026.
      memberId: member('ines'),
      statements: [
        { id: 'i0', period: '2025-12-16', status: 'validated', totalMinor: 50_000, payment: null },
        paid('i1', '2026-01-01', '2026-01-20', 250_000),
      ],
      carryOvers: [{ statementId: 'i0', toPeriod: '2026-01-01' }],
      documents: [
        invoice('ii0', 'i0', '2025-12-16', '2026-01-02', inesBefore, { withholding: 'treaty_exempt' }),
        invoice('ii1', 'i1', '2026-01-01', '2026-01-17', inesNow),
      ],
      identityToday: today(inesNow),
    },
    {
      // Paid in 2026 for a fortnight of 2025 only: the identity of the latest invoice issued by that transfer.
      memberId: member('zoe'),
      statements: [paid('z1', '2025-12-16', '2026-01-10', 300_000)],
      carryOvers: [],
      documents: [invoice('zi1', 'z1', '2025-12-16', '2026-01-05', copy('Zoé Exemple'))],
      identityToday: today(copy('Zoé Exemple')),
    },
    {
      // Under the threshold: not declared.
      memberId: member('basile'),
      statements: [paid('b1', '2026-04-01', '2026-04-20', 240_000)],
      carryOvers: [],
      documents: [invoice('bi1', 'b1', '2026-04-01', '2026-04-16', copy('Basile Exemple'))],
      identityToday: null,
    },
  ];

  it('declares each beneficiary with the identity their invoice froze, the treaty part, and what to check', () => {
    expect(das2Declaration(2026, contractors)).toEqual([
      {
        memberId: member('ines'),
        identity: inesNow,
        nature: 'commissions',
        paidMinor: 250_000,
        treatyExemptMinor: 0,
        warnings: ['regimes_mixed'],
      },
      {
        memberId: member('nora'),
        identity: nora,
        nature: 'commissions',
        paidMinor: 300_000,
        treatyExemptMinor: 300_000,
        warnings: [],
      },
      {
        memberId: member('theo'),
        identity: theo,
        nature: 'commissions',
        paidMinor: 250_000,
        treatyExemptMinor: 0,
        warnings: ['profile_changed', 'vat_charged'],
      },
      {
        memberId: member('zoe'),
        identity: copy('Zoé Exemple'),
        nature: 'commissions',
        paidMinor: 300_000,
        treatyExemptMinor: 0,
        warnings: [],
      },
      {
        memberId: member('lou'),
        identity: null,
        nature: 'commissions',
        paidMinor: 260_000,
        treatyExemptMinor: 0,
        warnings: ['identity_missing', 'transfer_without_invoice'],
      },
    ]);
  });

  it('reads only the transfers of the year, by their day', () => {
    // In 2025 nobody was paid; in 2027, neither.
    expect(das2Declaration(2025, contractors)).toEqual([]);
    expect(das2Declaration(2027, contractors)).toEqual([]);
  });

  it('compares the file only on what an old copy holds', () => {
    // A copy made before lot 4 holds no SIREN nor « EI »: a file that has them is not « changed ».
    const old = copy('Ana Ancienne', { country: 'FR', taxId: null });
    const [beneficiary] = das2Declaration(2026, [
      {
        memberId: member('ana'),
        statements: [paid('a1', '2026-05-01', '2026-05-20', 300_000)],
        carryOvers: [],
        documents: [invoice('ai1', 'a1', '2026-05-01', '2026-05-16', old)],
        identityToday: today(old, { businessId: '12345678900011', individualEntrepreneur: true }),
      },
    ]);
    expect(beneficiary?.warnings).toEqual([]);
  });
});

describe('the DAS2 file (EQ-06 lot 7c)', () => {
  const beneficiary = (change: Partial<Das2Beneficiary>): Das2Beneficiary => ({
    memberId: member('m1'),
    identity: copy('Nora Vidal'),
    nature: 'commissions',
    paidMinor: 300_000,
    treatyExemptMinor: 300_000,
    warnings: [],
    ...change,
  });

  it('writes one line per beneficiary, separated by semicolons, in UTF-8 with its byte order mark', () => {
    const text = das2Csv([
      beneficiary({}),
      beneficiary({
        memberId: member('m2'),
        identity: copy('=Atelier "Exemple"; SARL', {
          address: '3 rue Imaginaire\n69001 Lyon',
          country: 'FR',
          taxId: null,
          businessId: '12345678900011',
          legalForm: 'SARL',
        }),
        paidMinor: 1_234_567,
        treatyExemptMinor: 0,
        warnings: ['profile_changed', 'vat_charged'],
      }),
      beneficiary({
        memberId: member('m3'),
        identity: copy('Lou Exemple', { individualEntrepreneur: true }),
      }),
      beneficiary({
        memberId: member('m4'),
        identity: null,
        paidMinor: 260_005,
        treatyExemptMinor: 0,
        warnings: ['identity_missing'],
      }),
    ]);
    expect(text.startsWith('\uFEFF')).toBe(true);
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.slice(1, -2).split('\r\n')).toEqual([
      'Bénéficiaire;Forme juridique;Adresse;Pays;SIREN ou SIRET;Identifiant fiscal;Nature;Montant versé;Dont dispense conventionnelle;Avertissements',
      'Nora Vidal;;12 rue des Exemples, Cotonou;BJ;;3201912345678;Commissions;3000,00;3000,00;',
      // A formula never starts a cell; a quote or a semicolon quotes it; a line break becomes a comma.
      `"'=Atelier ""Exemple""; SARL";SARL;3 rue Imaginaire, 69001 Lyon;FR;12345678900011;;Commissions;12345,67;0,00;dossier changé depuis la facture / TVA facturée, hors taxes versé`,
      'Lou Exemple EI;;12 rue des Exemples, Cotonou;BJ;;3201912345678;Commissions;3000,00;3000,00;',
      '(identité absente);;;;;;Commissions;2600,05;0,00;identité absente : aucune facture où la lire',
    ]);
    expect(das2Csv([])).toBe(
      '\uFEFFBénéficiaire;Forme juridique;Adresse;Pays;SIREN ou SIRET;Identifiant fiscal;Nature;Montant versé;Dont dispense conventionnelle;Avertissements\r\n',
    );
    expect(das2FileName(2026)).toBe('das2-prestataires_2026.csv');
  });
});
