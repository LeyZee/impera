import { PayPeriodSchema } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import {
  creditNoteLines,
  creditNoteMention,
  creditsDue,
  invoiceDueOn,
  invoiceLines,
  invoiceNumber,
  invoiceTotals,
  isInvoicePrefix,
  longDay,
  periodWords,
  planCreditNotes,
  type CreditDue,
  type InvoiceLine,
  type InvoiceSource,
  type IssuedInvoice,
} from '../invoices';

const period = (day: string) => PayPeriodSchema.parse(day);
/** The spaces French sets that never break, as plain spaces, to read an amount in a test. */
const plain = (text: string | null): string | null => text?.replace(/[\u00a0\u202f]/gu, ' ') ?? null;

/**
 * Nora's second half of October: two accounts at 20 %, the tier bonus, a manual bonus, a fixed penalty and two
 * percent ones, an adjustment in the agency's favour of the first half, which is a credit note and not a line, and a
 * carry-over from September that the invoice does not repeat.
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
    ['acc-reveal', { handle: 'noravidal', platform: 'Reveal' }],
    ['acc-desirely', { handle: 'nora.v', platform: 'Desirely' }],
  ]),
  bonuses: [{ amountMinor: 2_000, reason: 'Nuit du samedi tenue seule ' }],
  penalties: [
    { kind: 'fixed', amountMinor: 1_500, reason: 'Retard au shift' },
    { kind: 'percent', bps: 250, reason: 'Script envoyé deux fois' },
    { kind: 'percent', bps: 125, reason: 'Note du fan oubliée' },
  ],
  adjustments: [{ amountMinor: -3_000, reason: 'PPV remboursé', correctsPeriod: period('2026-10-01') }],
  ...patch,
});

const total = (lines: readonly InvoiceLine[]): number =>
  lines.reduce((sum, line) => sum + line.amountMinor, 0);

describe('the words of an invoice (EQ-06)', () => {
  it('writes days and periods as French invoices do', () => {
    expect(longDay('2026-11-01')).toBe('1er novembre 2026');
    expect(longDay('2026-10-16')).toBe('16 octobre 2026');
    expect(() => longDay('2026-13-01')).toThrow(RangeError);
    expect(periodWords(period('2026-10-01'))).toBe('du 1er au 15 octobre 2026');
    expect(periodWords(period('2026-02-16'))).toBe('du 16 au 28 février 2026');
  });
});

describe('the lines of a statement’s invoice (EQ-06)', () => {
  it('prints each account, bonus, penalty and adjustment, and adds up to the period without the carry-over', () => {
    const lines = invoiceLines(source());
    expect(lines.map((line) => ({ ...line, detail: plain(line.detail) }))).toEqual([
      {
        kind: 'commission',
        label: 'Commission, compte noravidal sur Reveal',
        detail: '20 % de 1 200,00 € de net',
        amountMinor: 24_000,
      },
      {
        kind: 'commission',
        label: 'Commission, compte nora.v sur Desirely',
        detail: '20 % de 450,50 € de net',
        amountMinor: 9_010,
      },
      {
        kind: 'tier_bonus',
        label: 'Prime de palier',
        detail: '1 500,00 € de net atteints',
        amountMinor: 5_000,
      },
      { kind: 'bonus', label: 'Prime', detail: '« Nuit du samedi tenue seule »', amountMinor: 2_000 },
      {
        kind: 'penalty',
        label: 'Réfaction prévue au contrat',
        detail: '« Retard au shift »',
        amountMinor: -1_500,
      },
      // 2,5 % and 1,25 % of 1 650,50 €: 61,89 € rounded once as the engine did, 41,26 € then 20,63 €.
      {
        kind: 'penalty',
        label: 'Réfaction prévue au contrat',
        detail: '2,5 % du net : « Script envoyé deux fois »',
        amountMinor: -4_126,
      },
      {
        kind: 'penalty',
        label: 'Réfaction prévue au contrat',
        detail: '1,25 % du net : « Note du fan oubliée »',
        amountMinor: -2_063,
      },
    ]);
    // The period without the carry-over, and without the adjustment in the agency's favour: its credit note owes it.
    expect(total(lines)).toBe(30_555 - 1_234 + 3_000);
    expect(creditsDue(source())).toEqual([
      {
        kind: 'adjustment',
        amountMinor: 3_000,
        reason: 'PPV remboursé',
        correctsPeriod: period('2026-10-01'),
      },
    ]);
    // The spaces around a quotation and before a colon never break.
    expect(lines[3]?.detail).toBe('«\u00a0Nuit du samedi tenue seule\u00a0»');
    expect(lines[5]?.detail).toContain('net\u00a0: «');
  });

  it('prints the team share of a manager, the collective bonus, and an omission of an unknown period', () => {
    const lines = invoiceLines(
      source({
        statement: {
          ...source().statement,
          teamShare: { baseNetMinor: 812_345, bps: 500, amountMinor: 40_617 },
          tierBonus: null,
          collectiveBonusMinor: 10_000,
          manualBonusesMinor: 0,
          penaltiesRequestedMinor: 0,
          penaltiesMinor: 0,
          carryOversInMinor: 0,
          adjustmentsMinor: 3_000,
          totalMinor: 33_010 + 40_617 + 10_000 + 3_000,
        },
        bonuses: [],
        penalties: [],
        adjustments: [{ amountMinor: 3_000, reason: 'Vente oubliée', correctsPeriod: null }],
      }),
    );
    expect(
      lines.slice(2).map((line) => [line.kind, line.label, plain(line.detail), line.amountMinor]),
    ).toEqual([
      ['team_share', 'Part d’équipe', '5 % de 8 123,45 € de net de l’équipe', 40_617],
      ['collective_bonus', 'Prime d’objectif collectif', 'Objectif de l’équipe atteint', 10_000],
      ['adjustment', 'Régularisation', '« Vente oubliée »', 3_000],
    ]);
  });

  it('gives back what the cap of penalties held back, in a line of its own', () => {
    const lines = invoiceLines(
      source({
        statement: {
          ...source().statement,
          lines: [{ platformAccountId: 'acc-reveal', netMinor: 10_000, commissionMinor: 2_000 }],
          netMinor: 10_000,
          tierBonus: null,
          manualBonusesMinor: 0,
          penaltiesRequestedMinor: 5_000,
          penaltiesMinor: 2_000,
          carryOversInMinor: 0,
          adjustmentsMinor: 0,
          totalMinor: 0,
        },
        bonuses: [],
        penalties: [{ kind: 'fixed', amountMinor: 5_000, reason: 'Absence non prévenue' }],
        adjustments: [],
      }),
    );
    expect(lines.map((line) => [line.kind, line.amountMinor])).toEqual([
      ['commission', 2_000],
      ['penalty', -5_000],
      ['penalty_cap', 3_000],
    ]);
    expect(lines[2]?.label).toBe('Plafond des réfactions');
  });

  it('prints a percent penalty at zero when refunds took the net below zero, never minus zero', () => {
    const lines = invoiceLines(
      source({
        statement: {
          ...source().statement,
          lines: [{ platformAccountId: 'acc-reveal', netMinor: -500, commissionMinor: -100 }],
          netMinor: -500,
          tierBonus: null,
          manualBonusesMinor: 2_000,
          penaltiesRequestedMinor: 0,
          penaltiesMinor: 0,
          carryOversInMinor: 0,
          adjustmentsMinor: 0,
          totalMinor: 1_900,
        },
        penalties: [{ kind: 'percent', bps: 250, reason: 'Script envoyé deux fois' }],
        adjustments: [],
      }),
    );
    expect(Object.is(lines[2]?.amountMinor, 0)).toBe(true);
    expect(total(lines)).toBe(1_900);
  });

  it('refuses entries that are not those the statement counted, and lines that do not add up', () => {
    expect(() => invoiceLines(source({ bonuses: [] }))).toThrow('bonuses');
    expect(() => invoiceLines(source({ adjustments: [] }))).toThrow('adjustments');
    expect(() => invoiceLines(source({ penalties: source().penalties.slice(1) }))).toThrow('penalties');
    expect(() => invoiceLines(source({ accounts: new Map() }))).toThrow('acc-reveal');
    expect(() => invoiceLines(source({ statement: { ...source().statement, totalMinor: 30_556 } }))).toThrow(
      'add up',
    );
    expect(() => creditsDue(source({ bonuses: [] }))).toThrow('bonuses');
  });
});

describe('the totals of an invoice (EQ-06)', () => {
  const lines = invoiceLines(source());

  it('charges nothing more under reverse charge, and gives the VAT the agency self-assesses', () => {
    expect(invoiceTotals(lines, { treatment: 'reverse_charge', rateBps: 2_000 })).toEqual({
      exclVatMinor: 32_321,
      vatMinor: 0,
      inclVatMinor: 32_321,
      selfAssessedVatMinor: 6_464,
    });
  });

  it('charges nothing more under the franchise, and the VAT at the rate for a contractor who charges it', () => {
    expect(invoiceTotals(lines, { treatment: 'exempt' })).toEqual({
      exclVatMinor: 32_321,
      vatMinor: 0,
      inclVatMinor: 32_321,
      selfAssessedVatMinor: 0,
    });
    expect(invoiceTotals(lines, { treatment: 'charged', rateBps: 2_000 })).toEqual({
      exclVatMinor: 32_321,
      vatMinor: 6_464,
      inclVatMinor: 38_785,
      selfAssessedVatMinor: 0,
    });
  });
});

describe('the number and the due date of an invoice (EQ-06)', () => {
  it('numbers by the contractor’s prefix, the year and a sequence of four digits at least', () => {
    expect(invoiceNumber('NORA', 2026, 7)).toBe('NORA-2026-0007');
    expect(invoiceNumber('T2', 2027, 12_345)).toBe('T2-2027-12345');
    for (const prefix of ['nora', 'N', 'NORAVIDAL', 'NÉO', 'NO-RA'])
      expect(isInvoicePrefix(prefix)).toBe(false);
    expect(() => invoiceNumber('nora', 2026, 1)).toThrow(RangeError);
    expect(() => invoiceNumber('NORA', 2026, 0)).toThrow(RangeError);
    expect(() => invoiceNumber('NORA', 2026, 1.5)).toThrow(RangeError);
  });

  it('falls due the agency’s delay after the issue', () => {
    expect(invoiceDueOn('2026-10-31', 15)).toBe('2026-11-15');
    expect(invoiceDueOn('2026-12-20', 15)).toBe('2027-01-04');
    expect(invoiceDueOn('2026-11-01', 0)).toBe('2026-11-01');
    expect(() => invoiceDueOn('2026-11-01', -1)).toThrow(RangeError);
  });
});

describe('a credit note (EQ-06)', () => {
  const lines = invoiceLines(source());
  const invoice = { lines, exclVatMinor: 32_321, creditedMinor: 0 };

  it('cites the invoice it credits', () => {
    expect(creditNoteMention('NORA-2026-0007', '2026-11-01')).toBe(
      'Avoir sur la facture NORA-2026-0007 du 1er novembre 2026',
    );
  });

  it('cancels a whole invoice line by line, once and only when nothing was credited on it', () => {
    const credit = creditNoteLines(invoice, { kind: 'full' });
    expect(credit).toHaveLength(lines.length);
    expect(total(credit)).toBe(-32_321);
    expect(credit[0]).toEqual({
      ...lines[0],
      label: 'Annulation\u00a0: Commission, compte noravidal sur Reveal',
      amountMinor: -24_000,
    });
    expect(credit[4]?.amountMinor).toBe(1_500);
    expect(() => creditNoteLines({ ...invoice, creditedMinor: 1 }, { kind: 'full' })).toThrow(
      expect.objectContaining({ code: 'credit_note_amount_unprocessable', details: { leftMinor: 32_320 } }),
    );
  });

  it('reduces by an amount with its reason, up to what is left of the invoice', () => {
    expect(
      creditNoteLines(
        { ...invoice, creditedMinor: 12_321 },
        { kind: 'partial', amountMinor: 20_000, reason: 'Vente comptée deux fois' },
      ),
    ).toEqual([
      {
        kind: 'reduction',
        label: 'Réduction',
        detail: '«\u00a0Vente comptée deux fois\u00a0»',
        amountMinor: -20_000,
      },
    ]);
    for (const amountMinor of [20_001, 0, -5, 0.5]) {
      expect(() =>
        creditNoteLines(
          { ...invoice, creditedMinor: 12_321 },
          { kind: 'partial', amountMinor, reason: 'Erreur' },
        ),
      ).toThrow(expect.objectContaining({ code: 'credit_note_amount_unprocessable' }));
    }
    expect(() => creditNoteLines(invoice, { kind: 'partial', amountMinor: 100, reason: '  ' })).toThrow(
      RangeError,
    );
  });
});

/** A statement of one account and what came in, as the engine writes it: the total is the sum, nothing else. */
const simple = (
  day: string,
  commissionMinor: number,
  extra: { carryOversInMinor?: number; adjustments?: InvoiceSource['adjustments'] } = {},
): InvoiceSource => {
  const adjustments = extra.adjustments ?? [];
  const adjustmentsMinor = adjustments.reduce((sum, one) => sum + one.amountMinor, 0);
  const carryOversInMinor = extra.carryOversInMinor ?? 0;
  return source({
    period: period(day),
    statement: {
      lines:
        commissionMinor === 0
          ? []
          : [{ platformAccountId: 'acc-reveal', netMinor: commissionMinor * 5, commissionMinor }],
      netMinor: commissionMinor * 5,
      commissionRateBps: 2_000,
      teamShare: null,
      tierBonus: null,
      collectiveBonusMinor: 0,
      manualBonusesMinor: 0,
      penaltiesRequestedMinor: 0,
      penaltiesMinor: 0,
      carryOversInMinor,
      adjustmentsMinor,
      totalMinor: commissionMinor + carryOversInMinor + adjustmentsMinor,
    },
    bonuses: [],
    penalties: [],
    adjustments,
  });
};

describe('what a period owes back (EQ-06, ADR 0036)', () => {
  it('owes each adjustment in the agency’s favour, and what its lines leave below zero, never on an invoice', () => {
    // Refunds above sales on the account, and a sale of the first half refunded since.
    const refunds = simple('2026-10-16', -1_600, {
      adjustments: [
        { amountMinor: -3_000, reason: 'PPV remboursé', correctsPeriod: period('2026-10-01') },
        { amountMinor: 500, reason: 'Vente oubliée', correctsPeriod: period('2026-10-01') },
      ],
    });
    expect(invoiceLines(refunds).map((line) => [line.kind, line.amountMinor])).toEqual([
      ['commission', -1_600],
      ['adjustment', 500],
    ]);
    expect(creditsDue(refunds)).toEqual([
      {
        kind: 'adjustment',
        amountMinor: 3_000,
        reason: 'PPV remboursé',
        correctsPeriod: period('2026-10-01'),
      },
      { kind: 'negative_period', amountMinor: 1_100, period: period('2026-10-16') },
    ]);
    expect(creditsDue(simple('2026-10-16', 0))).toEqual([]);
  });

  it('prints a credit a period owes as the adjustment with its period, or as the negative balance of a period', () => {
    const invoice = { lines: [], exclVatMinor: 30_000, creditedMinor: 0 };
    expect(
      creditNoteLines(invoice, {
        kind: 'adjustment',
        amountMinor: 3_000,
        reason: 'PPV remboursé',
        correctsPeriod: period('2026-10-01'),
      }).map((line) => ({ ...line, detail: plain(line.detail) })),
    ).toEqual([
      {
        kind: 'adjustment',
        label: 'Régularisation',
        detail: 'Période du 1er au 15 octobre 2026 : « PPV remboursé »',
        amountMinor: -3_000,
      },
    ]);
    expect(
      creditNoteLines(invoice, { kind: 'negative_period', amountMinor: 1_100, period: period('2026-10-16') }),
    ).toEqual([
      {
        kind: 'negative_period',
        label: 'Solde négatif',
        detail: 'Période du 16 au 31 octobre 2026',
        amountMinor: -1_100,
      },
    ]);
    expect(() =>
      creditNoteLines(invoice, {
        kind: 'negative_period',
        amountMinor: 30_001,
        period: period('2026-10-16'),
      }),
    ).toThrow(expect.objectContaining({ code: 'credit_note_amount_unprocessable' }));
  });

  const issued = (number: string, day: string, exclVatMinor: number, creditedMinor = 0): IssuedInvoice => ({
    number,
    period: period(day),
    exclVatMinor,
    creditedMinor,
  });
  const adjustment = (amountMinor: number, corrects: string | null): CreditDue => ({
    kind: 'adjustment',
    amountMinor,
    reason: 'PPV remboursé',
    correctsPeriod: corrects === null ? null : period(corrects),
  });
  const negative = (amountMinor: number, day: string): CreditDue => ({
    kind: 'negative_period',
    amountMinor,
    period: period(day),
  });

  it('credits an adjustment on the invoice of the period it corrects, or gives it back to the owner', () => {
    const invoices = [
      issued('NORA-2026-0001', '2026-09-16', 50_000),
      issued('NORA-2026-0002', '2026-10-01', 4_000),
    ];
    expect(planCreditNotes([adjustment(3_000, '2026-10-01')], invoices)).toEqual({
      notes: [{ invoiceNumber: 'NORA-2026-0002', request: adjustment(3_000, '2026-10-01') }],
      unplaced: [],
    });
    // More than is left of the invoice it corrects, a period without an invoice, or an unknown period: never moved to
    // another invoice, never split.
    for (const due of [
      adjustment(4_001, '2026-10-01'),
      adjustment(100, '2026-09-01'),
      adjustment(100, null),
    ]) {
      expect(planCreditNotes([due], invoices)).toEqual({ notes: [], unplaced: [due] });
    }
  });

  it('credits a negative period on the latest earlier invoice that has enough left, counting the notes before it', () => {
    const invoices = [
      issued('NORA-2026-0001', '2026-09-01', 50_000),
      issued('NORA-2026-0003', '2026-10-01', 2_000),
      issued('NORA-2026-0002', '2026-09-16', 6_000, 1_000),
      issued('NORA-2026-0004', '2026-11-01', 90_000),
    ];
    const plan = planCreditNotes(
      [adjustment(1_500, '2026-10-01'), negative(1_000, '2026-10-16'), negative(5_000, '2026-10-16')],
      invoices,
    );
    // The first half of October has 500 left once the adjustment is counted, the second half of September 5 000; a
    // later invoice never takes a period's balance.
    expect(plan.notes.map((one) => [one.invoiceNumber, one.request.amountMinor])).toEqual([
      ['NORA-2026-0003', 1_500],
      ['NORA-2026-0002', 1_000],
      ['NORA-2026-0001', 5_000],
    ]);
    expect(plan.unplaced).toEqual([]);
    expect(planCreditNotes([negative(60_000, '2026-10-16')], invoices).unplaced).toEqual([
      negative(60_000, '2026-10-16'),
    ]);
  });

  it('puts every euro the agency pays less on a document: the invoices less the credit notes are the transfers', () => {
    // Bilan's case: the first half of September pays 300 €; the second half has only a refund of 100 € on it, below
    // zero, carried over; October's first half sells 500 € and pays 400 €. Then a half with refunds above sales.
    const september = simple('2026-09-01', 30_000);
    const refunded = simple('2026-09-16', 0, {
      adjustments: [{ amountMinor: -10_000, reason: 'PPV remboursé', correctsPeriod: period('2026-09-01') }],
    });
    const october = simple('2026-10-01', 50_000, { carryOversInMinor: -10_000 });
    const refunds = simple('2026-10-16', -8_000);
    const november = simple('2026-11-01', 20_000, { carryOversInMinor: -8_000 });
    const transfersMinor = 30_000 + 0 + 40_000 + 0 + 12_000;

    const invoices: IssuedInvoice[] = [];
    let creditNotesMinor = 0;
    for (const [index, one] of [september, refunded, october, refunds, november].entries()) {
      const exclVatMinor = total(invoiceLines(one));
      const plan = planCreditNotes(creditsDue(one), invoices);
      expect(plan.unplaced).toEqual([]);
      for (const note of plan.notes) {
        const target = invoices.findIndex((invoice) => invoice.number === note.invoiceNumber);
        const invoice = invoices[target];
        if (invoice === undefined) throw new Error('No such invoice');
        invoices[target] = { ...invoice, creditedMinor: invoice.creditedMinor + note.request.amountMinor };
        creditNotesMinor += note.request.amountMinor;
      }
      if (exclVatMinor > 0)
        invoices.push(issued(`NORA-2026-000${String(index + 1)}`, one.period, exclVatMinor));
    }
    // October's invoice stays at 500 €: the 100 € it pays less is the credit note on September's first half.
    expect(invoices.map((one) => [one.number, one.exclVatMinor, one.creditedMinor])).toEqual([
      ['NORA-2026-0001', 30_000, 10_000],
      ['NORA-2026-0003', 50_000, 8_000],
      ['NORA-2026-0005', 20_000, 0],
    ]);
    expect(invoices.reduce((sum, one) => sum + one.exclVatMinor, 0) - creditNotesMinor).toBe(transfersMinor);
  });
});
