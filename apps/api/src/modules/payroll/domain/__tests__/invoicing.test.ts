import { BillingRegimeIdSchema, newId, PayPeriodSchema, type InvoiceRegime } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { invoiceLines, invoiceTotals, paymentTermsMention, type InvoiceSource } from '../invoices';
import {
  creditNoteKey,
  invoiceKey,
  planInvoicing,
  reissueKey,
  type InvoicingFacts,
  type StoredInvoice,
} from '../invoicing';

const period = (day: string) => PayPeriodSchema.parse(day);

/** Regimes as the owner would set them; their mentions are data, here short invented ones. */
const ABROAD: InvoiceRegime = {
  id: newId(BillingRegimeIdSchema),
  name: 'Bénin, autoliquidation',
  vat: { treatment: 'reverse_charge', rateBps: 2_000 },
  withholding: 'treaty_exempt',
  mentions: ['Autofacturation', 'Autoliquidation'],
  documents: ['tax_residence'],
  taxIdRequired: false,
  validatedOn: '2026-09-20',
};
const FRANCHISE: InvoiceRegime = {
  id: newId(BillingRegimeIdSchema),
  name: 'France, franchise',
  vat: { treatment: 'exempt' },
  withholding: 'none',
  mentions: ['Autofacturation', 'TVA non applicable, art. 293 B du CGI'],
  documents: ['urssaf_vigilance'],
  taxIdRequired: true,
  validatedOn: '2026-09-20',
};

/**
 * Nora's second half of October, as the lot 1 tests read it: two accounts, a tier bonus, a manual bonus, three
 * penalties, and an adjustment in the agency's favour of the first half, which is a credit note and not a line.
 */
const source = (patch: Partial<InvoiceSource> = {}): InvoiceSource => ({
  period: period('2026-10-16'),
  statement: {
    lines: [
      { platformAccountId: 'acc-reveal', netMinor: 120_000, commissionMinor: 24_000 },
      { platformAccountId: 'acc-desirely', netMinor: 45_050, commissionMinor: 9_010 },
    ],
    netMinor: 165_050,
    commissionRateBps: 2_000,
    teamShare: null,
    tierBonus: { thresholdMinor: 150_000, bonusMinor: 5_000 },
    collectiveBonusMinor: 0,
    manualBonusesMinor: 2_000,
    penaltiesRequestedMinor: 7_689,
    penaltiesMinor: 7_689,
    carryOversInMinor: 1_234,
    adjustmentsMinor: -3_000,
    totalMinor: 30_555,
  },
  accounts: new Map([
    ['acc-reveal', { handle: 'noravidal', platform: 'reveal' }],
    ['acc-desirely', { handle: 'nora.v', platform: 'onlyfans' }],
  ]),
  bonuses: [{ amountMinor: 2_000, reason: 'Nuit du samedi tenue seule' }],
  penalties: [
    { kind: 'fixed', amountMinor: 1_500, reason: 'Retard au shift' },
    { kind: 'percent', bps: 250, reason: 'Script envoyé deux fois' },
    { kind: 'percent', bps: 125, reason: 'Note du fan oubliée' },
  ],
  adjustments: [
    {
      amountMinor: -3_000,
      reason: 'PPV remboursé',
      correctsPeriod: period('2026-10-01'),
      contestedInvoiceId: null,
    },
  ],
  ...patch,
});

/** A second half of October where refunds passed the sales: its lines are below zero, it has no invoice. */
const negative = (): InvoiceSource =>
  source({
    statement: {
      lines: [{ platformAccountId: 'acc-reveal', netMinor: -10_000, commissionMinor: -2_000 }],
      netMinor: -10_000,
      commissionRateBps: 2_000,
      teamShare: null,
      tierBonus: null,
      collectiveBonusMinor: 0,
      manualBonusesMinor: 0,
      penaltiesRequestedMinor: 0,
      penaltiesMinor: 0,
      carryOversInMinor: 0,
      adjustmentsMinor: 0,
      totalMinor: -2_000,
    },
    bonuses: [],
    penalties: [],
    adjustments: [],
  });

/** Nora's invoice of the first half of October, issued under the regime of its day. */
const firstHalf = (patch: Partial<StoredInvoice> = {}): StoredInvoice => ({
  id: 'inv-1001',
  number: 'NORA-2026-0001',
  period: period('2026-10-01'),
  issuedOn: '2026-10-17',
  exclVatMinor: 20_000,
  creditedMinor: 0,
  regime: ABROAD,
  lines: [
    {
      kind: 'commission',
      label: 'Commission, compte @noravidal sur Reveal',
      detail: '20 % de 1 000,00 € de net',
      amountMinor: 20_000,
    },
  ],
  ...patch,
});

/** The agency's payment terms, invented: its words, never the code's. */
const TERMS =
  'Aucun escompte. Pénalités de retard au triple du taux d’intérêt légal, indemnité de 40 € pour frais de recouvrement.';
const SERVICE = 'Prestations de chatting pour le compte des créatrices de l’agence';
const ISSUED_AT = new Date('2026-11-02T09:30:00.000Z');

const facts = (patch: Partial<InvoicingFacts> = {}): InvoicingFacts => ({
  statementId: 'st-1016',
  source: source(),
  issuedAt: ISSUED_AT,
  issuedOn: '2026-11-02',
  mandate: { acceptedVersion: 1, currentVersion: 1, contestDelayDays: 15 },
  assignments: [{ regimeId: ABROAD.id, from: '2026-10-01' }],
  regimes: [ABROAD, FRANCHISE],
  identity: {
    legalName: 'Nora Vidal',
    address: '12 rue des Lilas, Cotonou',
    country: 'BJ',
    taxId: null,
    businessId: null,
    vatNumber: null,
    individualEntrepreneur: false,
    legalForm: null,
    shareCapitalMinor: null,
    rcsCity: null,
  },
  identityVerified: true,
  prefix: 'NORA',
  documents: [{ kind: 'tax_residence', issuedOn: '2026-03-10', validUntil: null }],
  settings: {
    agency: {
      legalName: 'Agence Exemple SAS',
      address: '1 place Inventée, 69000 Lyon',
      siren: '123456789',
      vatNumber: 'FR12123456789',
    },
    paymentTerms: TERMS,
    dueDays: 60,
    serviceDescription: SERVICE,
    logoSha256: null,
  },
  invoices: [firstHalf()],
  issuedKeys: new Set(),
  ...patch,
});

describe('what a validated statement issues (EQ-06 lot 3)', () => {
  it('issues its invoice, then the credit note its adjustment owes on the invoice of the period it corrects', () => {
    const plan = planInvoicing(facts());
    expect(plan.notIssued).toEqual([]);
    expect(plan.warnings).toEqual([]);
    expect(plan.documents.map((one) => one.key)).toEqual([
      invoiceKey('st-1016'),
      creditNoteKey('st-1016', 0),
    ]);

    const [invoice, note] = plan.documents;
    const lines = invoiceLines(source());
    expect(invoice).toEqual({
      key: 'invoice:st-1016',
      kind: 'invoice',
      creditedInvoiceId: null,
      reissuedInvoiceId: null,
      period: '2026-10-16',
      issuedOn: '2026-11-02',
      dueOn: '2027-01-01',
      contractor: facts().identity,
      agency: facts().settings?.agency,
      regime: ABROAD,
      mentions: [...ABROAD.mentions, paymentTermsMention('2027-01-01', TERMS)],
      serviceDescription: SERVICE,
      logoSha256: null,
      lines,
      totals: invoiceTotals(lines, ABROAD.vat),
      acceptanceDeadline: new Date('2026-11-17T09:30:00.000Z'),
    });

    expect(note).toMatchObject({
      key: 'credit:st-1016:0',
      kind: 'credit_note',
      creditedInvoiceId: 'inv-1001',
      period: '2026-10-01',
      regime: ABROAD,
      mentions: [
        'Avoir sur la facture NORA-2026-0001 du 17 octobre 2026',
        'Autofacturation',
        'Autoliquidation',
      ],
      totals: { exclVatMinor: -3_000, vatMinor: 0, inclVatMinor: -3_000, selfAssessedVatMinor: -600 },
      // The service is an invoice's designation; a credit note cites its invoice instead.
      serviceDescription: null,
      logoSha256: null,
    });
    expect(note?.lines).toEqual([
      expect.objectContaining({ kind: 'adjustment', label: 'Régularisation', amountMinor: -3_000 }),
    ]);
  });

  it('prints its due date, then the agency’s payment terms as its settings word them, never on a credit note', () => {
    const plain = (text: string | undefined): string | undefined => text?.replace(/[\u00a0\u202f]/gu, ' ');
    const [invoice, note] = planInvoicing(facts()).documents;
    expect(plain(invoice?.mentions.at(-1))).toBe(`Échéance : 1er janvier 2027. ${TERMS}`);
    expect(note?.mentions.some((one) => one.startsWith('Échéance'))).toBe(false);

    // Other terms in the settings, other words on the next invoice: the code writes only the date.
    const later =
      'Aucun escompte. Pénalités de retard au taux de la BCE majoré de 10 points, indemnité de 40 €.';
    const settings = facts().settings;
    if (settings === null) throw new Error('no settings');
    const [next] = planInvoicing(facts({ settings: { ...settings, paymentTerms: later } })).documents;
    expect(plain(next?.mentions.at(-1))).toBe(`Échéance : 1er janvier 2027. ${later}`);
  });

  it('keeps the regime of the invoice it cites on a credit note, under the parties of the day', () => {
    // Nora moved to the French franchise from the 1st of November: her new invoice takes it, the credit note of
    // October keeps the regime of the invoice it cites (ADR 0036).
    const plan = planInvoicing(
      facts({
        assignments: [
          { regimeId: ABROAD.id, from: '2026-10-01' },
          { regimeId: FRANCHISE.id, from: '2026-11-01' },
        ],
        identity: {
          legalName: 'Nora Vidal',
          address: '3 rue Neuve, 69001 Lyon',
          country: 'FR',
          taxId: '12345678900011',
          businessId: '12345678900011',
          vatNumber: null,
          individualEntrepreneur: true,
          legalForm: null,
          shareCapitalMinor: null,
          rcsCity: null,
        },
        documents: [{ kind: 'urssaf_vigilance', issuedOn: '2026-10-01', validUntil: null }],
      }),
    );
    expect(plan.documents.map((one) => [one.kind, one.regime.id])).toEqual([
      ['invoice', FRANCHISE.id],
      ['credit_note', ABROAD.id],
    ]);
    expect(plan.documents[1]?.contractor.address).toBe('3 rue Neuve, 69001 Lyon');
    expect(plan.documents[1]?.totals.selfAssessedVatMinor).toBe(-600);
  });

  it('issues nothing twice: a rerun plans only what its keys say is missing', () => {
    const keys = new Set([invoiceKey('st-1016'), creditNoteKey('st-1016', 0)]);
    expect(
      planInvoicing(facts({ issuedKeys: keys, invoices: [firstHalf({ creditedMinor: 3_000 })] })).documents,
    ).toEqual([]);

    // The invoice went out, the credit note did not (no invoice of the first half yet): the rerun issues the same
    // credit note, under the same key.
    const rerun = planInvoicing(facts({ issuedKeys: new Set([invoiceKey('st-1016')]) }));
    expect(rerun.documents.map((one) => one.key)).toEqual(['credit:st-1016:0']);
  });

  it('says each document it cannot issue, the statement staying validated', () => {
    const plan = planInvoicing(
      facts({ mandate: { acceptedVersion: null, currentVersion: 1, contestDelayDays: null } }),
    );
    expect(plan.documents).toEqual([]);
    expect(plan.notIssued).toEqual([
      { document: 'invoice', reason: 'no_mandate', amountMinor: 32_321 },
      { document: 'credit_note', reason: 'no_mandate', amountMinor: 3_000 },
    ]);

    expect(planInvoicing(facts({ settings: null })).notIssued).toEqual([
      { document: 'invoice', reason: 'agency_missing', amountMinor: 32_321 },
      { document: 'credit_note', reason: 'agency_missing', amountMinor: 3_000 },
    ]);
    expect(planInvoicing(facts({ prefix: null })).notIssued).toEqual([
      { document: 'invoice', reason: 'prefix_missing', amountMinor: 32_321 },
      { document: 'credit_note', reason: 'prefix_missing', amountMinor: 3_000 },
    ]);
  });

  it('never issues a credit note no invoice can take whole: it goes to the owner', () => {
    const none = planInvoicing(facts({ invoices: [] }));
    expect(none.documents.map((one) => one.kind)).toEqual(['invoice']);
    expect(none.notIssued).toEqual([
      { document: 'credit_note', reason: 'no_invoice_to_credit', amountMinor: 3_000 },
    ]);

    const almostCredited = planInvoicing(facts({ invoices: [firstHalf({ creditedMinor: 18_000 })] }));
    expect(almostCredited.notIssued).toEqual([
      { document: 'credit_note', reason: 'no_invoice_to_credit', amountMinor: 3_000 },
    ]);
  });

  it('asks the identity of the regime the credit note keeps', () => {
    // The first half was issued under the French franchise, which prints a SIRET; Nora left it and has none now.
    const plan = planInvoicing(facts({ invoices: [firstHalf({ regime: FRANCHISE })] }));
    expect(plan.documents.map((one) => one.kind)).toEqual(['invoice']);
    expect(plan.notIssued).toEqual([
      { document: 'credit_note', reason: 'identity_incomplete', amountMinor: 3_000 },
    ]);
  });

  it('issues no document on a file the owner has not checked as it stands, and says each one', () => {
    const plan = planInvoicing(facts({ identityVerified: false }));
    expect(plan.documents).toEqual([]);
    expect(plan.notIssued).toEqual([
      { document: 'invoice', reason: 'identity_unverified', amountMinor: 32_321 },
      { document: 'credit_note', reason: 'identity_unverified', amountMinor: 3_000 },
    ]);
  });

  it('puts a negative period on the latest invoice of an earlier period, and issues it no invoice', () => {
    const plan = planInvoicing(
      facts({
        source: negative(),
        invoices: [
          firstHalf({ id: 'inv-0916', number: 'NORA-2026-0000', period: period('2026-09-16') }),
          firstHalf(),
        ],
      }),
    );
    expect(plan.notIssued).toEqual([]);
    expect(plan.documents).toHaveLength(1);
    expect(plan.documents[0]).toMatchObject({
      key: 'credit:st-1016:0',
      kind: 'credit_note',
      creditedInvoiceId: 'inv-1001',
      period: '2026-10-01',
      lines: [{ kind: 'negative_period', label: 'Solde négatif', amountMinor: -2_000 }],
    });
  });

  it('counts each credit note before the next on one invoice', () => {
    const two = source({
      statement: { ...source().statement, adjustmentsMinor: -15_000, totalMinor: 18_555 },
      adjustments: [
        {
          amountMinor: -9_000,
          reason: 'PPV remboursé',
          correctsPeriod: period('2026-10-01'),
          contestedInvoiceId: null,
        },
        {
          amountMinor: -6_000,
          reason: 'Pack remboursé',
          correctsPeriod: period('2026-10-01'),
          contestedInvoiceId: null,
        },
      ],
    });
    const plan = planInvoicing(facts({ source: two, invoices: [firstHalf({ creditedMinor: 8_000 })] }));
    // 12 000 left on the first half: the first credit note takes 9 000, the second no longer fits.
    expect(plan.documents.map((one) => [one.key, one.totals.exclVatMinor])).toEqual([
      ['invoice:st-1016', 32_321],
      ['credit:st-1016:0', -9_000],
    ]);
    expect(plan.notIssued).toEqual([
      { document: 'credit_note', reason: 'no_invoice_to_credit', amountMinor: 6_000 },
    ]);
  });
});

/** The pair of a cancel and reissue of the first half's invoice (ADR 0039 § 3): what it had left, both ways. */
const pair = (
  leftMinor = 20_000,
  invoiceId = 'inv-1001',
  number = 'NORA-2026-0001',
): InvoiceSource['adjustments'] => [
  {
    amountMinor: -leftMinor,
    reason: `Annulation de la facture ${number} du 17 octobre 2026`,
    correctsPeriod: period('2026-10-01'),
    contestedInvoiceId: invoiceId,
  },
  {
    amountMinor: leftMinor,
    reason: `Refacturation de la facture ${number} du 17 octobre 2026`,
    correctsPeriod: period('2026-10-01'),
    contestedInvoiceId: invoiceId,
  },
];

/** The second half of October with the pair alone: it pays the same, its own invoice bills only its own period. */
const reissued = (): InvoiceSource =>
  source({
    statement: { ...source().statement, adjustmentsMinor: 0, totalMinor: 33_555 },
    adjustments: pair(),
  });

/** A regime Nora takes from the 1st of November, after the first half's invoice: another VAT, other mentions. */
const LATER: InvoiceRegime = {
  id: newId(BillingRegimeIdSchema),
  name: 'Bénin, exonération',
  vat: { treatment: 'exempt' },
  withholding: 'treaty_exempt',
  mentions: ['Autofacturation', 'Exonération de TVA, mention inventée'],
  documents: ['tax_residence'],
  taxIdRequired: false,
  validatedOn: '2026-10-20',
};
const regimeChanged: Pick<InvoicingFacts, 'assignments' | 'regimes'> = {
  assignments: [
    { regimeId: ABROAD.id, from: '2026-10-01' },
    { regimeId: LATER.id, from: '2026-11-01' },
  ],
  regimes: [ABROAD, FRANCHISE, LATER],
};

describe('a cancel and reissue: the cancel, then a corrective invoice of its own (EQ-06 lot 6, ADR 0039 § 3, ADR 0040)', () => {
  it('bills the same amount again under the cancelled invoice’s period, regime and mentions, never the regime of the day', () => {
    const plan = planInvoicing(facts({ source: reissued(), ...regimeChanged }));
    expect(plan.notIssued).toEqual([]);
    expect(
      plan.documents.map((one) => [
        one.key,
        one.kind,
        one.creditedInvoiceId,
        one.reissuedInvoiceId,
        one.regime.id,
      ]),
    ).toEqual([
      ['invoice:st-1016', 'invoice', null, null, LATER.id],
      ['credit:st-1016:0', 'credit_note', 'inv-1001', 'inv-1001', ABROAD.id],
      ['reissue:st-1016:0', 'invoice', null, 'inv-1001', ABROAD.id],
    ]);
    // The period's invoice bills its own period only: the reissued amount is no line of it.
    const [own, cancel, corrective] = plan.documents;
    expect(own?.totals.exclVatMinor).toBe(32_321);
    expect(own?.lines.some((line) => line.detail?.includes('Refacturation') ?? false)).toBe(false);
    expect(cancel?.totals).toEqual({
      exclVatMinor: -20_000,
      vatMinor: 0,
      inclVatMinor: -20_000,
      selfAssessedVatMinor: -4_000,
    });

    const lines = [
      {
        kind: 'adjustment' as const,
        label: 'Régularisation',
        detail:
          'Période du 1er au 15 octobre 2026\u00a0: «\u00a0Refacturation de la facture NORA-2026-0001 du 17 octobre 2026\u00a0»',
        amountMinor: 20_000,
      },
    ];
    expect(corrective).toEqual({
      key: reissueKey('st-1016', 0),
      kind: 'invoice',
      creditedInvoiceId: null,
      reissuedInvoiceId: 'inv-1001',
      period: '2026-10-01',
      issuedOn: '2026-11-02',
      dueOn: '2027-01-01',
      contractor: facts().identity,
      agency: facts().settings?.agency,
      regime: ABROAD,
      mentions: [
        'Facture rectificative de la facture NORA-2026-0001 du 17 octobre 2026',
        ...ABROAD.mentions,
        paymentTermsMention('2027-01-01', TERMS),
      ],
      serviceDescription: SERVICE,
      logoSha256: null,
      lines,
      totals: invoiceTotals(lines, ABROAD.vat),
      acceptanceDeadline: new Date('2026-11-17T09:30:00.000Z'),
    });
    expect(corrective?.totals.selfAssessedVatMinor).toBe(4_000);
  });

  it('issues the pair whatever the period’s own invoice does, and holds both halves together for the same reason', () => {
    // No regime of the day: the period's invoice waits, the pair keeps the first half's regime and leaves.
    const alone = planInvoicing(facts({ source: reissued(), assignments: [] }));
    expect(alone.documents.map((one) => one.key)).toEqual(['credit:st-1016:0', 'reissue:st-1016:0']);
    expect(alone.notIssued).toEqual([{ document: 'invoice', reason: 'no_regime', amountMinor: 32_321 }]);

    // An identity that lacks a mention: nothing leaves, each document is said, the corrective invoice with its cancel.
    const identity = facts().identity;
    if (identity === null) throw new Error('no identity');
    const held = planInvoicing(facts({ source: reissued(), identity: { ...identity, address: ' ' } }));
    expect(held.documents).toEqual([]);
    expect(held.notIssued).toEqual([
      { document: 'invoice', reason: 'identity_incomplete', amountMinor: 32_321 },
      { document: 'credit_note', reason: 'identity_incomplete', amountMinor: 20_000 },
      { document: 'invoice', reason: 'identity_incomplete', amountMinor: 20_000 },
    ]);

    // The next pass, the file complete: all three, the corrective invoice right after its cancel.
    expect(planInvoicing(facts({ source: reissued() })).documents.map((one) => one.key)).toEqual([
      'invoice:st-1016',
      'credit:st-1016:0',
      'reissue:st-1016:0',
    ]);
  });

  it('issues nothing twice: a cancel issued went out with its corrective invoice', () => {
    const keys = new Set([creditNoteKey('st-1016', 0), reissueKey('st-1016', 0)]);
    const rerun = planInvoicing(
      facts({ source: reissued(), issuedKeys: keys, invoices: [firstHalf({ creditedMinor: 20_000 })] }),
    );
    expect(rerun.documents.map((one) => one.key)).toEqual(['invoice:st-1016']);
    expect(rerun.notIssued).toEqual([]);
  });

  it('holds the pair while its invoice has less left than the cancel; another credit due of the period leaves', () => {
    const both = source({
      statement: { ...source().statement, adjustmentsMinor: -3_000, totalMinor: 30_555 },
      adjustments: [...source().adjustments, ...pair()],
    });
    // A credit note took 5 000 off the first half since the contest was upheld: the cancel no longer takes it whole.
    const plan = planInvoicing(facts({ source: both, invoices: [firstHalf({ creditedMinor: 5_000 })] }));
    expect(plan.documents.map((one) => [one.key, one.totals.exclVatMinor])).toEqual([
      ['invoice:st-1016', 32_321],
      ['credit:st-1016:0', -3_000],
    ]);
    expect(plan.notIssued).toEqual([
      { document: 'credit_note', reason: 'no_invoice_to_credit', amountMinor: 20_000 },
      { document: 'invoice', reason: 'no_invoice_to_credit', amountMinor: 20_000 },
    ]);
  });

  it('places the cancel before the other credit dues of its period, which cannot leave it short', () => {
    const crowded = source({
      statement: { ...source().statement, adjustmentsMinor: -3_000, totalMinor: 30_555 },
      adjustments: [...source().adjustments, ...pair()],
    });
    const plan = planInvoicing(facts({ source: crowded }));
    expect(plan.documents.map((one) => [one.key, one.totals.exclVatMinor])).toEqual([
      ['invoice:st-1016', 32_321],
      ['credit:st-1016:1', -20_000],
      ['reissue:st-1016:0', 20_000],
    ]);
    expect(plan.notIssued).toEqual([
      { document: 'credit_note', reason: 'no_invoice_to_credit', amountMinor: 3_000 },
    ]);
  });

  it('cancels and bills again a corrective invoice in turn, under the regime it kept', () => {
    // The corrective invoice of the first half, contested in its turn: its own pair names it.
    const corrective = firstHalf({
      id: 'inv-1102',
      number: 'NORA-2026-0003',
      issuedOn: '2026-11-02',
      lines: [
        {
          kind: 'adjustment',
          label: 'Régularisation',
          detail: 'Refacturation de la facture NORA-2026-0001 du 17 octobre 2026',
          amountMinor: 20_000,
        },
      ],
    });
    const chained = source({
      statement: { ...source().statement, adjustmentsMinor: 0, totalMinor: 33_555 },
      adjustments: pair(20_000, 'inv-1102', 'NORA-2026-0003'),
    });
    const plan = planInvoicing(
      facts({
        source: chained,
        ...regimeChanged,
        invoices: [firstHalf({ creditedMinor: 20_000 }), corrective],
      }),
    );
    expect(plan.notIssued).toEqual([]);
    expect(
      plan.documents.map((one) => [
        one.key,
        one.creditedInvoiceId,
        one.reissuedInvoiceId,
        one.period,
        one.regime.id,
      ]),
    ).toEqual([
      ['invoice:st-1016', null, null, '2026-10-16', LATER.id],
      ['credit:st-1016:0', 'inv-1102', 'inv-1102', '2026-10-01', ABROAD.id],
      ['reissue:st-1016:0', null, 'inv-1102', '2026-10-01', ABROAD.id],
    ]);
    expect(plan.documents[2]?.mentions[0]).toBe(
      'Facture rectificative de la facture NORA-2026-0003 du 2 novembre 2026',
    );
  });

  it('waits for no invoice in a period that has nothing to invoice: its own lines alone make its negative balance', () => {
    const below = source({
      statement: {
        lines: [{ platformAccountId: 'acc-reveal', netMinor: -125_000, commissionMinor: -25_000 }],
        netMinor: -125_000,
        commissionRateBps: 2_000,
        teamShare: null,
        tierBonus: null,
        collectiveBonusMinor: 0,
        manualBonusesMinor: 0,
        penaltiesRequestedMinor: 0,
        penaltiesMinor: 0,
        carryOversInMinor: 0,
        adjustmentsMinor: 0,
        totalMinor: -25_000,
      },
      bonuses: [],
      penalties: [],
      adjustments: pair(),
    });
    const plan = planInvoicing(
      facts({
        source: below,
        invoices: [
          firstHalf({
            id: 'inv-0916',
            number: 'NORA-2026-0000',
            period: period('2026-09-16'),
            exclVatMinor: 30_000,
          }),
          firstHalf(),
        ],
      }),
    );
    expect(plan.notIssued).toEqual([]);
    expect(plan.documents.map((one) => [one.key, one.creditedInvoiceId, one.totals.exclVatMinor])).toEqual([
      ['credit:st-1016:0', 'inv-1001', -20_000],
      ['reissue:st-1016:0', null, 20_000],
      ['credit:st-1016:1', 'inv-0916', -25_000],
    ]);
  });
});
